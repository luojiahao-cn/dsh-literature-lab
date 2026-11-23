# 文献实验室 · Literature Lab

每日文献检索与发现。从 RSS 订阅与邮件推送里扫描新论文，按四层漏斗逐级筛选，
只把真正值得读的论文做精读与入库（翻译走单独的 PDF 翻译流程，不在插件内）。

## 四层漏斗

| 层 | 做什么 | 成本 |
|---|---|---|
| **L0 发现 / 候选** | 扫 arXiv/RSS/检索/邮件，T0 规则过滤后进候选 | 近零 |
| **L1 摘要判断** | 取一手摘要，判断同域性 / 增量 / 用途，初判 S/A/B/C/D | 每篇一次检索 |
| **L2 初筛** | 读引言末段、结论、主图，判断方法/基线/数据会不会真用到；按当前证据重评等级（依据「初筛」） | 读 2–3 页 |
| **L3 精读** | 全文核对页码图号与公式符号，改判并出卡片与 2–3 张关键图 | 最重 |

等级在后两层可以修正，每次改判都会记下理由，用于反向校准初判。

## 当前实现（2026-11-22 重构后）

- `index.js` 只做组合根（约 253 行）：注册路由、agent 工具、生命周期与启动迁移；HTTP handler 在 `lib/http/handlers.js`，工具在 `lib/tools.js`。
- 状态：`lib/store.js` 提供按文件锁、原子写、临时文件随机后缀；`lib/state.js` 管 papers/seen；`lib/repo/papers.js`、`lib/repo/jobs.js` 是论文/任务入口；`lib/candidates.js` 管候选池。
- schema：`state/schema.json` 台账 + 启动备份；损坏文件隔离到 `state/quarantine/` 并报错，不再静默回退空库。
- 分析：L1/L2/L3 进程内串行锁；`state/claims.json` 提供条目级 claim/lease；L2 失败不写 `l2.at`，不占额度。
- 等级可被逐层重评：L1 依据摘要、L2 依据初筛（`grade_basis: triage`）、L3 依据全文（`grade_basis: fulltext`），每次都写 `grade_history`；L2 的 close-read 与 C/D 组合自相矛盾时不覆盖等级。
- 跨文件：`lib/journal.js` 给 promote 的候选→论文多步提交写 intent；启动时重放未完成事务，并做候选↔论文恢复对账。
- 运行账本：采集轮次在 `state.runs`（30 条上限，采集历史只读这里）；分析轮次在 `state.analysis_runs`（同样 30 条），避免分析把采集历史挤掉。两者都有统一 id；分析 job meta 带 `run_id`。`scripts/data-doctor.mjs` 只读对账。
- 调度：自动采集与采集后自动分析是两个开关；自动分析默认关，`analysis.auto` 只保留旧配置兼容。
- 采集记录：弹窗默认近 7 天，支持今天/近 7 天/近 30 天/自定义；`/candidates` 接受 `since/until`，counts 同窗。
- 本机 bridge：只绑 `127.0.0.1`；`POST /import` 必须带 `x-dsh-token`，不再接受 Chrome 扩展 Origin 免 token。

## L0 发现

- **arXiv API**：`sources.arxiv.categories`（如 `cs.RO`）或 `sources.arxiv.queries`（自定义查询式，优先）；
  按 `submittedDate` 区间增量查询，每批 100 条，连续两批没有新条目就停。
- **RSS/Atom**：`sources.rss`，适合期刊 TOC 与非 arXiv 来源；只按时间窗口过滤（feed 本身不提供历史）。
- **补抓**：某源上次成功早于窗口起点时，起点提前到上次成功；`window.backfillDays` 限制最多补抓几天。
- **去重**：`lib/dedup.js` 统一 DOI / arXiv 版本 / Unicode 题名；跨源命中只合并 `sources` 与 `last_seen`。
- **查询式检索**：`sources.search.queries`（每日随 discover 跑）或 `literature-lab_search`（按需）。
  三路并查 arXiv（跨分类，支持 `au:`/`abs:`/布尔语法）、OpenAlex（期刊与预印本）、Crossref（期刊书目），
  结果与 RSS/API 共用去重与过滤。
- **过滤**：标题 + 摘要 + 作者上的正则打分；`excludeKeywords` 优先排除；未配关键词时全收。
- **网络**：`lib/http.js` 负责超时、重试（429/5xx）、退避、per-host 限速与条件请求。
- **状态**：`state.sources` 记录每个源的 `last_ok_at / last_error / consecutive_failures / last_count / etag`；
  `state/seen.json` 记录所有见过的条目（含被过滤的），用于去重与追溯。
- **邮件/手工**：不内置 IMAP；`lib/email.js` 用 `ctx.tools.execute` 调 dsh-email 只读工具，解析后进候选；手工清单用 `literature-lab_ingest`，同样进候选。
- **快讯摘要只有片段**：Google 学术快讯的摘要本身是截断的。解析后按 DOI/arXiv 调一次 `lookup()` 补一手摘要，补到更长的才替换，并把来源记在候选的 `abstract_source`（`canonical` / `snippet`）；补不到的保留片段并标注，界面在元信息里显示「摘要片段」。
- **PubMed/Europe PMC / DBLP**：`lib/pubmed.js`、`lib/dblp.js`，按检索式进候选；DBLP 只有书目，摘要后续补。
- **bioRxiv / medRxiv**：`lib/preprint.js`，按日期区间分块取预印本。
- **Semantic Scholar bulk**：`lib/s2.js` 的 `searchWorks`，可通过 `search` 的 `sources:['s2']` 使用。
- **兴趣评分**：关键词、辅助词、期刊会议、作者、领域标签/MeSH、时效分别加权；配置在 `relevance`，默认全空。

## 阅读价值等级

| 级 | 含义 |
|---|---|
| **S** | 直接命中核心问题，且不可替代——会定义核心架构、关键实验或论文主张 |
| **A** | 直接对应核心问题，会改变模型、实验、硬件或论证，需要反复回看 |
| **B** | 高度相关，有重要可迁移的方法、基线或数据，能影响某项决策 |
| **C** | 背景、术语、局部方法、常见基线 |
| **D** | 全文比较后确认无信息增量，或核心主张存在足以影响用途的证据问题 |

评级不看期刊名气：先写信息增量，再看证据可信范围。全文拿不到时按手头证据给结论，并在 reason 里写清依据。

## L1 摘要判断

L1 只做一件事：拿到一手摘要，回答三个问题并给出初判。等级就是结论，后续层级可以改判。
判断结果写进 `state/papers.json`，由 agent 通过 `literature-lab_set_stage` 写回。

**写入口（2026-11-21 修订）**：AI 判断仍只由 agent 写入；UI 另提供「人工改判」，走
`POST /api/dsh-literature-lab/paper/override`，写入时打 `manual_override`，AI 之后的结果只作建议、不覆盖。
两处写入都记 `grade_history` 与 `reason`，来源分别是 `ai` 与人工。

### 三问

| 字段 | 含义 | 取值 |
|---|---|---|
| `domain` | 同域性 | `core` 本领域核心 / `edge` 相关领域 / `transferable` 方法可借鉴 / `irrelevant` 无关 |
| `increment` | 增量 | 自由文本，但必须具体：相对最近文献多了什么 |
| `use` | 用途 | `method` 改进方法 / `baseline` 当对比基线 / `citation` 写作引用 / `landscape` 了解现状 |

`increment` 去空白后至少 6 个字符，且不接受空话（「更准」「better」「state of the art」等）。

### 状态字段

```text
paper.l1 = { domain, increment, use, note, at }
paper.grade_basis = "abstract" | "triage" | "fulltext"
paper.abstract_lookup = { at, matched, has_abstract, via, reason }
grade_history[] 追加 { stage, grade, reason, basis, at, l1? }
```

### 评级依据

`grade_basis` 只记录这次评级依据的是什么证据：`abstract`（仅摘要，省略时的默认值）、
`triage`（读了引言末段/结论/主图）、`fulltext`（全文核对过）。
它不构成「状态」，不改等级，也不影响后续改判；改判本身由 `grade_history` 记录。

### 校验规则

- 三问：`domain`/`use` 必须取枚举值；`increment` 非空、≥6 字符、不是空话。
- 一致性：S 只能配 `core`；A 只能配 `core` / `edge`；`irrelevant` 只能配 D。
- 首次给 L1 定级必须带三问；已有 `paper.l1` 的改判可以不带。
- 定级/改判必须写 `reason`。
- 摘要取不到：留在 L1，只写 `abstract_lookup` 事实，不硬判、不丢。

### 原文获取

候选按下面的顺序试，失败继续下一个；成功存进插件目录的 `pdfs/`，写 `paper.pdf`（相对路径）、
`paper.pdf_bytes`、`paper.pdf_sha256`，并记一条 `download = { at, ok, via, bytes, reason, code, hint }`。

1. Zotero 本地库已有 PDF（只读复用）
2. 记录自带的 `pdf_url` / `meta.oa_url` 与 arXiv PDF
3. 出版商官方模板（按 DOI 前缀：Springer / Frontiers / PLOS / Nature / IOP / Taylor & Francis / SAGE / Elsevier），
   `download.publisherTemplates` 可关
4. 反查开放存取位置：OpenAlex → Europe PMC（含 PMC 渲染页）→ OpenAIRE **v3** → Unpaywall → Semantic Scholar；
   `pid=` 必须用 v3（v4 会忽略该参数）。正结果缓存 1 小时、空结果 6 小时，单源失败只记 `errors`
5. 落地页兜底：打开 DOI / 记录 url，读 `citation_pdf_url` 或 `<link type="application/pdf">`
6. 机构访问（`download.access`，默认关闭）：`ezproxy` 按模板改写、`webvpn` 按正则改写、
   `direct` 只在 `institutionalHosts` 上附带会话 Cookie。Cookie 存本机凭据
   （`DSH_LITERATURE_LAB_INSTITUTIONAL_COOKIE`），不写进 config、不进仓库。设置页「原文 → 机构访问」
   可直接填方式、模板、机构域名与 Cookie；`POST /access/test` 按当前配置真取一次并回报分类，不写状态

抓取与校验：

- 手动跟随重定向（最多 5 跳），**每跳重做私网地址校验**（防 SSRF）；跳 `login./idp./sso./shibboleth.`
  或 `/login|signin|sso|auth` 直接判 `paywalled`，不再陪着走
- 401/402 → `paywalled`；403 → `blocked`；429 → 按 `Retry-After` 给 host 记冷却（上限 10 分钟）
- HTML 响应先判订阅/登录词、再判 Cloudflare/人机验证，最后才归 `not-pdf`；顺序反了会把付费墙报成机器人拦截
- PDF 必须带 `%PDF-` 魔数，且尾部同时有 `%%EOF` 与 `startxref`；只有魔数没有文件尾的判 `truncated`，
  先落盘并打 `pdf_truncated` 标记（可读但有风险），下次 `overwrite` 会重新找
- 落盘走 `.part-<pid>-<ts>` → rename 原子写；记 `pdf_sha256` 便于去重与回读核对
- 失败归七类：`no-candidate / paywalled / blocked / not-pdf / truncated / too-large / failed`，
  每类带一句下一步建议；明细写 `paper.pdf_failure = { code, reason, hint, attempts[] }`，
  `attempts` 记每次尝试的 host / status / code。`download.reason` 保留中文短句给界面用
- 已有原文默认跳过，`overwrite` 才重下

### 引用核验（L1 之前）

`lib/verify.js`：判读前先确认这条引文真实存在，避免模型把不存在的文献说成 S/A。

| 结论 | 含义 | 对等级的影响 |
| --- | --- | --- |
| `crossref-ok` / `datacite-ok` / `arxiv-ok` | 一手索引有记录且题名一致 | 可用 S/A/B |
| `title-ok` | 题名能对上，但缺正式 DOI 记录 | 最高 B |
| `unindexed` | 哪个索引都没查到（中文 DOI、机构库、新预印本常见） | 不限制，标注未核验 |
| `fabricated` | DOI 有记录但指向另一篇 | 直接丢弃 |

- 判假门槛刻意收窄：只有「DOI 有记录、题名却是另一篇」才判 `fabricated`；
  查不到记录一律 `unindexed`，避免把中文期刊误杀
- 结果写 `paper.verification`，缓存 `state/verify-cache.json`（正结果 30 天、弱结果 7 天）
- 人工 `set_stage` 同样受约束：`fabricated` 拒绝定级，`title-ok` 只允许到 B

## Zotero 联动

读（默认）与写（入库）分开：

- **读取**：`literature-lab_zotero`，`action` = `profile` / `search` / `item` / `collections` / `refresh`。
  拉取 Zotero 的标题、摘要、标签、分类（缓存 `state/zotero.json`，24 小时），
  `profile` 返回标签频次、unigram/bigram 文档频次与最近样本。
- **AI 分析关键词**：`action:"suggest"` 或 `POST /zotero/suggest`，把 `profile` 交给
  DSH 的 llm 服务（默认优先 deepseek，可用 `integrations.zotero.ai` 指定 provider/model），
  返回核心/辅助/排除词与理由；UI 只填入草稿，保存后才写配置。
- **写关键词**：`literature-lab_set_keywords` 写入 `relevance.keywords / contextKeywords / excludeKeywords`，
  需要 `reason`，并校验每条正则能否编译。
- **入库**：`literature-lab_zotero {action:"import"}` 按 paper id 写入 Zotero；已入库或库里已有同 DOI/arXiv 的跳过并补抓
  `zotero_key`。映射为 `preprint`（有 arXiv id）或 `journalArticle`，带 `dsh-literature-lab` 与 `L1:<domain>` 标签。
  只写元数据，不上传 PDF 附件。
- **自动入库**：`integrations.zotero.autoImport { enabled, minGrade, requirePdf }`，默认关闭；
  `set_stage` 写完评级后按策略触发，失败记 `zotero_import`，不影响评级。
- **连接方式**：`mode` = `web`（userId + API key，可写）或 `local`（Zotero 10+ 桌面本地 API：读取免 key；写入先 `authorize`，弹窗选 Always Allow 后本地写）。
  凭据只存本机 `state/config.json`。

### 状态与接口（2026-11-22）

- 状态文件经 `lib/store.js`：按文件锁、原子写、随机临时文件；论文/任务有 repo 入口。
- `state/schema.json` 记录版本并备份；损坏文件隔离；`state/journal/` 记录未完成 promote 事务。
- `/state` 支持 `stage/q/limit/offset`；`/paper?id=` 单篇详情；`/jobs` 后台任务；`/candidates` 支持 status/q/source/since/until/limit/offset/sort。
- `/config` 不回传密钥；`/credentials` 读写 Zotero API key；`/schedule` 返回 autoAnalyze。
- `scripts/data-doctor.mjs` 只读检查 promoted 缺论文、重复 DOI/题名、PDF 缺失、run/job 关联。

### 雷达页与定时任务（2026-11-22）

- 雷达页顺序：采集概况（7/30 天周期）→ 采集栏（自动采集、采集后自动分析、回看范围、立即采集、采集设置）→ 研究兴趣 → 渠道配置（7 行；展开只有状态/配置，无单渠道运行）→ 采集记录（最近 5 条 + 查看全部）→ 采集历史（采集轮次）。
- 「自动采集」只做渠道 + 邮件；「采集后自动分析」是独立开关，默认关，打开后才跑 L1/L2/L3；手动「立即采集」不跑 AI。
- 采集记录弹窗默认近 7 天，支持今天/近 7 天/近 30 天/自定义；服务端 `since/until` 按 `added_at`（Asia/Shanghai 自然日）过滤，counts 同窗。
- 定时任务用插件自己的 `ctx.timer`，`GET/POST /schedule`；`state/schedule.json` 存下次/上次结果；分析 job 写统一 run 账本。
- 旧「布局编辑 / 隐藏渠道 / 单渠道补跑 / 历史回溯 UI」已移除；回溯采集走 agent 工具 `literature-lab_corpus`。

### 工具契约

- `literature-lab_state`：`stage` / `id` / `limit` / `offset`。
  默认 20 篇，最多 100 篇；L1 论文返回完整摘要，不截断。
  返回 `l1`、`grade_basis`（评级依据）、`abstract_lookup`、`grade_history`。
- `literature-lab_fetch_metadata`：`ids` / `limit` / `overwrite`。
  摘要返回最多 3000 字；每次尝试都写 `abstract_lookup`；
  默认跳过已有摘要，批量默认 5 篇、最多 10 篇。
- `literature-lab_search`：`query` 必填，可选 `sources` / `sinceDays` / `limit` / `ingest`；
  三路并行检索并去重，`ingest=true` 时并入队列。
- `literature-lab_corpus`：`action` = harvest / snowball / candidates / harvests / promote / analyze。
  年份检索与引文雪球走后端任务，命中先进候选；L1 摘要判读一次决定是否继续、三问和等级；S/A/B 进 L2，C/D 默认丢弃。
  另有 `download`（按额度取开放原文）、`need_download`（缺原文清单）、`email`（手动跑邮件段）
  与 `add`（标题/DOI/arXiv 直接进 L2、置顶，跳过候选）。
- `literature-lab_zotero`：`action`（profile / search / item / collections / refresh / authorize / suggest / import）
  + `q/tag/collection/yearFrom/limit/withAbstracts/refresh/key/doi/ids/dryRun`。
- `literature-lab_set_keywords`：`keywords` / `contextKeywords` / `excludeKeywords`，`reason` 必填。
- `literature-lab_ingest`：`source` / `items[]`（title 必填）；返回 `added/merged/filtered/excluded/...`。
- `literature-lab_download`：`ids` / `limit` / `overwrite`。
  默认挑还没有原文的论文，批量默认 3 篇、最多 10 篇；返回每条的原文件路径或失败原因。
- `literature-lab_set_stage`：`id` / `stage` 必填，可选 `grade` / `reason` / `basis` / `l1`。
  失败返回具体原因，且不写坏状态。

### 界面

- L1 行显示等级 badge、同域性与用途、增量文本；
- 摘要可展开（默认三行，点开看全文）；缺摘要时显示原因；
- 总览页按用户问题组织：今天值得读（今日新进且 S/A）、需要你处理（候选取舍与各层积压，含最老等待天数）、需要注意（只在异常时出现）。
- 推荐理由（why_read）按“读者能拿它做什么”生成；以数字/结果/摘要开头、或与摘要高度重合会被 validation 标为 why-read-result-first / why-read-summary-like，建议重跑 L3。
- L3 输出 `figures`（page/caption/why，最多 3 张）；服务端优先抽该页 PDF 内嵌位图存 `state/figures/<paper>/`，没有位图（矢量图）退 pdftoppm 整页渲染；`GET /figure?paper=&file=` 只服务 `l3.figures` 登记过的文件。

`locale/zh.json` 与 `locale/en.json` 里的 `meta` 供插件市场显示标题与简介；
`l1` 段是术语表，当前 UI 文案（`client.js` 内的 `DOMAIN_LABEL` 等）与它保持一致，
改动术语时两处要一起改。

## 边界

- 只取合法来源的原文：开放获取、用户自己的机构订阅会话（EZproxy / WebVPN / CARSI）、人工补件；不使用第三方镜像站，不提供任何绕过付费墙的能力
- 入库是显式决定，不从评级单独推导
- 论文文件不进笔记库；笔记写进 Zotero 子笔记
- 不改邮箱已读状态以外的任何邮件属性，不订阅、不退订
- 状态只存事实：`stage` 决定该做什么，不额外存「待办」字段

## 状态

当前：Phase 0–5 重构已落地，248 测试通过；发现→候选→L1→L2→L3、来源、邮件、PDF 上传、原文、Zotero 已可用；翻译不在插件内。Phase 6 评估为暂不合并 candidates/papers。
