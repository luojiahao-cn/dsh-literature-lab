/**
 * Agent 工具定义：只声明 schema 与执行体，注册/生命周期留在 index.js。
 * 依赖由 createTools 注入，避免工具层再读模块级 BASE_DIR/serviceCtx。
 */
import path from 'node:path';
import { readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import {
  readState, updateState, viewOf, paperView, advance, applyGrade,
  setL1, recordLookup, summarize, today, STAGES, GRADES,
} from './state.js';
import { validateL1, checkGradeDomain, checkVerification, resolveBasis } from './judge.js';
import { readConfig, writeUserConfig, networkOf, interestQueryTerms } from './config.js';
import { ensureVerification } from './verify.js';
import { discover, ingest } from './discover.js';
import { searchItems } from './search.js';
import { download } from './download.js';
import { lookup } from './metadata.js';
import { suggestKeywords, calibrateThreshold } from './ai.js';
import { listJobs, cancelJob, startJob } from './jobs.js';
import { startHarvest, listHarvests, resumeHarvest } from './harvest.js';
import { queryCandidates, readCandidates, promoteCandidate, updateCandidates, rescoreCandidates } from './candidates.js';
import { analyzeCandidates, analyzeL2Papers, analyzeL3Papers } from './analysis-run.js';
import { appliedToday } from './analysis-apply.js';
import { analysisStats } from './analysis-stats.js';
import { analysisPromptState, resolveAnalysisModel } from './analysis.js';
import { digestFor } from './digest.js';
import { armSchedule, readScheduleState, stopSchedule } from './schedule.js';
import { runEmail } from './email.js';
import { addManualPaper } from './manual.js';
import { saveUploadedPdf } from './upload.js';
import { readPdfTextMeta } from './pdf.js';
import { migrateLegacyTriage } from './migrate.js';
import { healRuntime } from './heal.js';
import { ensureStateSchemas } from './schema.js';
import { startWatch } from './watch.js';
import { startBridgeServer } from './bridge-server.js';
import {
  syncZotero, buildProfile, queryLibrary, findItem, importPapers, zoteroSummary,
  shouldAutoImport, authorizeLocalWrites,
} from './zotero.js';
import {
  hasZoteroKey, setZoteroKey, migrateZoteroKey, readConfigWithSecrets,
  hasEasyScholarKey, setEasyScholarKey,
} from './secrets.js';
import { migrateKeyToCredentials } from './easyscholar.js';
import { translatePaper } from './text-translate.js';


/**
 * 工具入参取整并收进区间：非数字回退默认值，小数截断。
 * 分页类工具（state / fetch_metadata / corpus）共用。
 */
function clampInt(value, fallback, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(n)));
}


// ── 工具输出契约 ───────────────────────────────────────────
// 本版 dsh-tools 要求每个工具声明 output { schema, render, presentationMeta? }，
// 其中 render 返回的 ContentBlock[] 就是模型看到的工具结果。
function textBlock(text) {
  return [{ type: 'text', text }];
}

/** 数据型工具：完整 JSON 落给模型，避免渲染时漏字段。 */
function renderJson(_args, value) {
  return textBlock(JSON.stringify(value, null, 2));
}

/** 写入型工具：给一段能直接读的结论，失败时只留原因。 */
function renderSetStage(_args, value) {
  if (!value || value.ok === false) return textBlock(`写入失败：${value?.error || '未知原因'}`);
  const lines = [
    `已更新 ${value.id}：stage=${value.stage}`,
    `等级：${value.grade || '未评级'}；依据：${value.grade_basis || '无'}`,
  ];
  if (value.l1) lines.push(`L1 三问：${value.l1.domain} / ${value.l1.use}；增量：${value.l1.increment}`);
  const stages = value.summary?.stages;
  if (stages) lines.push(`流水线：L1 ${stages.L1} · L2 ${stages.L2} · L3 ${stages.L3} · done ${stages.done}`);
  return textBlock(lines.join('\n'));
}

/** 四个工具共用的输出声明；schema 每次新建，避免多工具共享同一对象。 */
function jsonOutput(render) {
  return { schema: { type: 'object', additionalProperties: true }, render };
}


export function createTools({ baseDir, ctx }) {
  const tools = [
    {
      name: 'literature-lab_state',
      description: '读取文献实验室状态：按层列出论文，每篇带完整摘要、L1 三问（同域性/增量/用途）、评级依据（摘要/分诊/全文）与改判历史，另附今日流水线统计。默认 20 篇、最多 100 篇，可分页；给 id 时返回单篇完整记录。判断 L1 前先用这个看摘要全文。',
      parameters: {
        type: 'object',
        properties: {
          stage: { type: 'string', description: '只看某一层：L0/L1/L2/L3/done/dropped；省略则全部' },
          id: { type: 'string', description: '可选：只看这一篇（doi:10.xxxx/yyy 或 arxiv:2611.12345），返回单篇完整字段与全部改判历史' },
          q: { type: 'string', description: '可选：按题名/摘要/增量做子串过滤' },
          limit: { type: 'number', description: '每页篇数，默认 20，最多 100' },
          offset: { type: 'number', description: '跳过多少篇（翻页用），默认 0' },
        },
        additionalProperties: false,
      },
      output: jsonOutput(renderJson),
      async execute({ stage, id, limit, offset, q } = {}) {
        const state = await readState(baseDir);
        if (id) {
          const paper = state.papers?.[id];
          if (!paper) return { ok: false, error: `未知论文 id：${id}` };
          return { ok: true, paper: paperView(id, paper, { fullHistory: true }), summary: summarize(state) };
        }
        if (stage && !STAGES.includes(stage)) {
          return { ok: false, error: `未知 stage：${stage}；可选 ${STAGES.join(' / ')}` };
        }
        const view = viewOf(state, {
          stage,
          q,
          limit: clampInt(limit, 20, 1, 100),
          offset: clampInt(offset, 0, 0, 1_000_000),
        });
        return {
          ok: true,
          summary: view.summary,
          total: view.total,
          offset: view.offset,
          limit: view.limit,
          count: view.papers.length,
          papers: view.papers,
        };
      },
    },
    {
      name: 'literature-lab_set_stage',
      description: '推进或退回一篇论文的流水线层级；可同时写 L1 三问与评级。L1 首次定级必须给 l1（domain/increment/use），已有 l1 的改判可以不带。basis 只记录这次评级依据的证据（abstract/triage/fulltext），省略按 abstract 记，不影响等级本身；后续层级可随时改判并追加历史。定级或改判必须写 reason。',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: '论文标识，如 doi:10.xxxx/yyy 或 arXiv:2611.12345' },
          stage: { type: 'string', enum: ['L0', 'L1', 'L2', 'L3', 'done', 'dropped'] },
          grade: { type: 'string', enum: ['S', 'A', 'B', 'C', 'D'], description: '可选：同时定级或改判' },
          reason: { type: 'string', description: '定级或改判的依据，必填；写清是基于摘要、分诊还是全文的什么证据' },
          basis: {
            type: 'string',
            enum: ['abstract', 'triage', 'fulltext'],
            description: '评级依据，仅作记录：abstract=仅摘要（省略时的默认值）、triage=读了引言末段/结论/主图、fulltext=全文核对过。它不改变等级本身，也不影响后续改判。',
          },
          l1: {
            type: 'object',
            description: 'L1 三问。domain: core=同域核心 / edge=同域边缘 / transferable=方法可迁移 / irrelevant=无关；use: method=改进方法 / baseline=当对比基线 / citation=写作引用 / landscape=了解现状；increment: 相对最近文献具体多了什么（去空白至少 6 字，不接受「更准」「better」这类空话）',
            properties: {
              domain: { type: 'string', enum: ['core', 'edge', 'transferable', 'irrelevant'] },
              increment: { type: 'string', description: '具体增量，不能是空话' },
              use: { type: 'string', enum: ['method', 'baseline', 'citation', 'landscape'] },
              note: { type: 'string', description: '可选补充' },
            },
            required: ['domain', 'increment', 'use'],
            additionalProperties: false,
          },
        },
        required: ['id', 'stage'],
        additionalProperties: false,
      },
      output: jsonOutput(renderSetStage),
      async execute({ id, stage, grade, reason, basis, l1 } = {}) {
        const outcome = await updateState(baseDir, (state) => {
          const paper = state.papers?.[id];
          if (!paper) return { ok: false, error: `未知论文 id：${id}` };
          if (!STAGES.includes(stage)) return { ok: false, error: `未知 stage：${stage}；可选 ${STAGES.join(' / ')}` };
          if (grade !== undefined && grade !== null && !GRADES.includes(grade)) {
            return { ok: false, error: `未知 grade：${grade}；可选 ${GRADES.join(' / ')}` };
          }
          if (!grade && basis !== undefined) {
            return { ok: false, error: 'basis 要跟 grade 一起给：只推进层级不需要评级依据' };
          }

          const resolved = resolveBasis(basis);
          if (!resolved.ok) return { ok: false, error: resolved.error };
          const finalBasis = resolved.basis;

          if (grade && !String(reason || '').trim()) {
            return { ok: false, error: '定级或改判必须写 reason：说清依据的是摘要、分诊还是全文里的什么证据' };
          }

          let nextL1 = null;
          if (l1 !== undefined && l1 !== null) {
            const checked = validateL1(l1);
            if (!checked.ok) return { ok: false, error: checked.error };
            nextL1 = checked.value;
          }
          const effectiveL1 = nextL1 || paper.l1 || null;
          if (grade && !paper.grade && stage === 'L1' && !effectiveL1) {
            return { ok: false, error: 'L1 首次定级必须同时给 l1 三问（domain / increment / use）' };
          }
          if (grade && effectiveL1) {
            const consistent = checkGradeDomain(grade, effectiveL1.domain);
            if (!consistent.ok) return { ok: false, error: consistent.error };
          }
          // 引用核验：没核实过的条目不能拿走 S/A/B，DOI 指向别篇的直接拒
          if (grade) {
            const verified = checkVerification(grade, paper.verification);
            if (!verified.ok) return { ok: false, error: verified.error };
          }

          const now = new Date().toISOString();
          if (nextL1) setL1(paper, nextL1, now);
          advance(paper, stage);
          if (grade) {
            applyGrade(paper, grade, {
              stage, reason: String(reason).trim(), basis: finalBasis, l1: effectiveL1, at: now,
            });
          }
          return { ok: true };
        });
        if (!outcome.ok) return outcome;

        // 按策略自动入库；失败只记录，不影响评级
        if (grade) {
          try {
            const config = await readConfigWithSecrets(ctx, baseDir);
            const latest = await readState(baseDir);
            const paper = latest.papers?.[id];
            if (paper && shouldAutoImport(config, paper)) {
              await importPapers(baseDir, config, latest, [paper], {});
            }
          } catch (error) {
            await updateState(baseDir, (state) => {
              const paper = state.papers?.[id];
              if (paper) {
                paper.zotero_import = {
                  at: new Date().toISOString(),
                  ok: false,
                  error: String(error?.message || error),
                };
              }
              return null;
            });
          }
        }

        const finalState = await readState(baseDir);
        const paper = finalState.papers?.[id];
        return {
          ok: true,
          id,
          stage: paper?.stage || stage,
          grade: paper?.grade || null,
          grade_basis: paper?.grade_basis || null,
          l1: paper?.l1 || null,
          zotero_key: paper?.zotero_key || null,
          summary: summarize(finalState),
        };
      },
    },
    {
      name: 'literature-lab_fetch_metadata',
      description: '为一篇或一批待判断的论文取一手摘要与书目（DOI→OpenAlex/Crossref、arXiv、题名检索相似度须 ≥0.9）。取到的摘要写进论文记录并返回全文（最多 3000 字）；每次尝试都记 abstract_lookup（含取不到的原因），取不到时论文留在 L1 不丢。默认跳过已有摘要的论文，overwrite 才重取。',
      parameters: {
        type: 'object',
        properties: {
          ids: { type: 'array', items: { type: 'string' }, description: '指定论文 id；省略则自动挑 stage=L1 且尚无摘要的论文' },
          limit: { type: 'number', description: '自动挑选时的上限，默认 5，最多 10' },
          overwrite: { type: 'boolean', description: '重取已有摘要的论文，默认 false' },
        },
        additionalProperties: false,
      },
      output: jsonOutput(renderJson),
      async execute({ ids, limit, overwrite } = {}) {
        const snapshot = await readState(baseDir);
        const papers = snapshot.papers || {};
        const size = clampInt(limit, 5, 1, 10);
        const explicit = Array.isArray(ids) && ids.length
          ? [...new Set(ids.map((id) => String(id).trim()).filter(Boolean))]
          : null;
        const missing = explicit ? explicit.filter((id) => !papers[id]) : [];
        const targets = explicit
          ? explicit.filter((id) => papers[id])
          : Object.entries(papers)
            .filter(([, p]) => p.stage === 'L1' && (overwrite || !p.abstract))
            .slice(0, size)
            .map(([id]) => id);
        if (!targets.length) {
          return { ok: true, requested: missing.length, fetched: 0, skipped: 0, missing, results: [] };
        }

        const results = [];
        const patches = {};
        for (const id of targets) {
          const paper = { ...papers[id] };
          if (paper.abstract && !overwrite) {
            results.push({ id, ok: true, skipped: 'has-abstract', has_abstract: true, via: paper.abstract_lookup?.via || null });
            continue;
          }
          const patch = {};
          try {
            const meta = await lookup({ doi: paper.doi, arxivId: paper.arxiv_id, title: paper.title });
            const matched = Boolean(meta.matched);
            const hasAbstract = Boolean(meta.abstract && String(meta.abstract).trim());
            const reason = matched ? (hasAbstract || paper.abstract ? null : 'no-abstract') : (meta.reason || 'not-matched');
            recordLookup(paper, { matched, hasAbstract, via: meta.via || null, reason });
            patch.abstract_lookup = paper.abstract_lookup;
            if (matched) {
              if (hasAbstract) patch.abstract = String(meta.abstract).trim();
              patch.meta = {
                source: meta.source,
                via: meta.via,
                venue: meta.venue || null,
                year: meta.year || null,
                authors: meta.authors || [],
                oa_status: meta.oa_status || null,
                oa_url: meta.oa_url || null,
                is_oa: meta.is_oa ?? null,
                similarity: meta.similarity ?? null,
              };
              if (!paper.doi && meta.doi) patch.doi = meta.doi;
              if (!paper.arxiv_id && meta.arxiv_id) patch.arxiv_id = meta.arxiv_id;
              patch.updated_at = new Date().toISOString();
            }
            // 顺手核验引用：S/A/B 需要一手索引里能对上，DOI 指向别篇会在这里暴露
            const verification = await ensureVerification(baseDir, {
              ...paper,
              doi: patch.doi || paper.doi,
              arxiv_id: patch.arxiv_id || paper.arxiv_id,
              title: meta.title || paper.title,
            }).catch(() => null);
            if (verification) patch.verification = verification;
            patches[id] = patch;
            results.push({
              id,
              ok: matched,
              has_abstract: hasAbstract,
              via: meta.via || null,
              reason,
              similarity: meta.similarity ?? null,
              title: meta.title || null,
              verification: verification?.status || null,
              abstract: (patch.abstract || paper.abstract || '').slice(0, 3000) || null,
            });
          } catch (error) {
            const reason = String(error?.message || error);
            recordLookup(paper, { matched: false, hasAbstract: false, reason });
            patches[id] = { abstract_lookup: paper.abstract_lookup, updated_at: new Date().toISOString() };
            results.push({ id, ok: false, has_abstract: false, reason });
          }
        }

        if (Object.keys(patches).length) {
          await updateState(baseDir, (state) => {
            for (const [id, patch] of Object.entries(patches)) {
              const paper = state.papers?.[id];
              if (!paper) continue;
              if (patch.abstract && (overwrite || !paper.abstract)) paper.abstract = patch.abstract;
              if (patch.meta) paper.meta = { ...(paper.meta || {}), ...patch.meta };
              if (patch.doi && !paper.doi) paper.doi = patch.doi;
              if (patch.arxiv_id && !paper.arxiv_id) paper.arxiv_id = patch.arxiv_id;
              if (patch.abstract_lookup) paper.abstract_lookup = patch.abstract_lookup;
              if (patch.updated_at) paper.updated_at = patch.updated_at;
            }
          });
        }

        return {
          ok: true,
          requested: targets.length + missing.length,
          fetched: results.filter((r) => r.ok && !r.skipped).length,
          skipped: results.filter((r) => r.skipped).length,
          missing,
          results,
        };
      },
    },
    {
      name: 'literature-lab_download',
      description: '为论文取原文：Zotero 已有 PDF → 记录自带/arXiv → 出版商官方模板 → OpenAlex/Europe PMC/OpenAIRE/Unpaywall/S2 反查 → 落地页 citation_pdf_url → 机构访问（download.access 配了 EZproxy/WebVPN/CARSI 会话时）。PDF 要过 %PDF- 魔数与 %%EOF/startxref 校验，原子写盘并记 sha256。失败分 no-candidate/paywalled/blocked/not-pdf/truncated/too-large/failed 七类，每类给下一步建议（下载不绕过付费墙、不用镜像站）。默认挑还没有原文的论文，已有原文的跳过。',
      parameters: {
        type: 'object',
        properties: {
          ids: { type: 'array', items: { type: 'string' }, description: '指定论文 id；省略则自动挑还没有原文的论文' },
          limit: { type: 'number', description: '自动挑选时的上限，默认 3，最多 10' },
          overwrite: { type: 'boolean', description: '重新下载已有原文的论文，默认 false' },
        },
        additionalProperties: false,
      },
      output: jsonOutput(renderJson),
      async execute({ ids, limit, overwrite } = {}) {
        return downloadWithQuota({ ids, limit, overwrite });
      },
    },
    {
      name: 'literature-lab_search',
      description: '按关键词检索文献：arXiv（跨分类，支持 arXiv 查询语法）、OpenAlex（期刊与预印本）、Crossref（期刊书目）。四路并行（arXiv/OpenAlex/Crossref/S2）、去重后返回条目；ingest=true 时并入候选池（共用关键词过滤与 seen）。只做检索，不判断科学价值。',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: '检索词；可用 arXiv 语法，如 au:"Name"、abs:"topic phrase"、cat:cs.RO AND abs:"calibration"' },
          sources: {
            type: 'array',
            items: { type: 'string', enum: ['arxiv', 'openalex', 'crossref', 's2'] },
            description: '查哪些源，默认 arXiv/OpenAlex/Crossref；可选 s2',
          },
          sinceDays: { type: 'number', description: '只看最近几天，默认 30，最大 365' },
          limit: { type: 'number', description: '每个源最多取多少条，默认 20，最多 50' },
          ingest: { type: 'boolean', description: '是否把结果并入候选池（默认 false，只返回）' },
        },
        required: ['query'],
        additionalProperties: false,
      },
      output: jsonOutput(renderJson),
      async execute({ query, sources, sinceDays, limit, ingest: doIngest } = {}) {
        const config = await readConfig(baseDir);
        const net = networkOf(config);
        const res = await searchItems(config, { text: query, sources, sinceDays, limit }, net);
        let ingested = null;
        if (doIngest) {
          const stats = await ingest(baseDir, { source: 'search:tool', items: res.items });
          ingested = {
            added: stats.added,
            merged: stats.merged,
            filtered: stats.filtered,
            excluded: stats.excluded,
            skippedKnown: stats.skippedKnown,
          };
        }
        return {
          ok: true,
          query: res.query,
          sinceDays: res.sinceDays,
          sources: res.sources,
          count: res.items.length,
          items: res.items,
          ingested,
        };
      },
    },
    {
      name: 'literature-lab_zotero',
      description: 'Zotero 联动（读取、授权、AI 建议、入库）。action=profile 返回关键词分析档案（标签频次、unigram/bigram、分类、样本）；search 按关键词/标签/分类检索缓存库；item 按 key 或 DOI 取一条；collections 列分类；refresh 强制同步；authorize 申请 Zotero 10+ 本机写权限（会弹窗）；suggest 用模型生成关键词建议；import 把论文写入 Zotero（需 ids）。库缓存 24 小时。',
      parameters: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['profile', 'search', 'item', 'collections', 'refresh', 'authorize', 'suggest', 'import'],
            description: '默认 profile；authorize 只在「本机 API」模式下用',
          },
          q: { type: 'string', description: 'search 用：匹配标题/摘要/标签' },
          tag: { type: 'string', description: 'search 用：按标签精确过滤' },
          collection: { type: 'string', description: '分类 key 或名字；profile/search 可用' },
          yearFrom: { type: 'number', description: 'search 用：年份下限' },
          limit: { type: 'number', description: '样本/结果条数，默认 30，最多 100' },
          withAbstracts: { type: 'boolean', description: 'profile 的样本是否带摘要，默认 true' },
          refresh: { type: 'boolean', description: '忽略 24h 缓存，强制重新拉取' },
          key: { type: 'string', description: 'item 用：Zotero item key' },
          doi: { type: 'string', description: 'item 用：DOI' },
          ids: { type: 'array', items: { type: 'string' }, description: 'import 用：要入库的论文 id' },
          dryRun: { type: 'boolean', description: 'import 用：只预览，不写入' },
        },
        additionalProperties: false,
      },
      output: jsonOutput(renderJson),
      async execute({ action = 'profile', q, tag, collection, yearFrom, limit, withAbstracts, refresh, key, doi, ids, dryRun } = {}) {
        try {
          const config = await readConfigWithSecrets(ctx, baseDir);
          if (action === 'import') {
            const state = await readState(baseDir);
            const wanted = Array.isArray(ids) ? ids : [];
            const papers = [];
            const missing = [];
            for (const id of wanted) {
              const paper = state.papers[id];
              if (!paper) { missing.push(id); continue; }
              paper.__id = id;
              papers.push(paper);
            }
            if (!papers.length) return { ok: false, action, error: '没有可入库的论文', missing };
            const result = await importPapers(baseDir, config, state, papers, {
              collection: collection || '',
              dryRun: Boolean(dryRun),
            });
            return { ...result, action, missing };
          }
          if (action === 'authorize') {
            const info = await authorizeLocalWrites(baseDir, config, {});
            return { ok: true, action, ...info };
          }
          if (action === 'suggest') {
            const cache = await syncZotero(baseDir, config, { refresh: Boolean(refresh) });
            const profile = buildProfile(cache, { limit: 24, withAbstracts: true });
            // 关键词分析是摘要级任务：跟随「判读模型 · 摘要判读（L1）」这一档，
    // 不再单独维护一套模型配置（原来这里永远走默认 provider 的第一个模型）。
    const { llm, provider, model } = await resolveAnalysisModel(ctx, config, 'L1');
            const suggestion = await suggestKeywords({ llm, provider, model, profile });
            return { ok: true, action, provider, model, suggestion, library: profile.library };
          }
          if (action === 'refresh') {
            await syncZotero(baseDir, config, { refresh: true });
            return { ok: true, action, summary: await zoteroSummary(baseDir) };
          }
          const cache = await syncZotero(baseDir, config, { refresh: Boolean(refresh) });
          if (action === 'collections') {
            return {
              ok: true,
              action,
              collections: (cache.collections || []).map((col) => ({
                ...col,
                count: cache.items.filter((item) => (item.collections || []).includes(col.key)).length,
              })),
            };
          }
          if (action === 'search') {
            return { ok: true, action, ...queryLibrary(cache, { q, tag, collection, yearFrom, limit }) };
          }
          if (action === 'item') {
            const item = findItem(cache, { key, doi });
            return item ? { ok: true, action, item } : { ok: false, action, error: '没有找到该条目' };
          }
          return {
            ok: true,
            action: 'profile',
            profile: buildProfile(cache, { limit, withAbstracts: withAbstracts !== false, collection }),
          };
        } catch (error) {
          return { ok: false, action, error: String(error?.message || error) };
        }
      },
    },
    {
      name: 'literature-lab_set_keywords',
      description: '把 AI 从 Zotero 库分析出的关注关键词写入配置（relevance）。只改 keywords / contextKeywords / excludeKeywords，不动其他配置；会校验每条正则能否编译。需要 reason 说明依据。',
      parameters: {
        type: 'object',
        properties: {
          keywords: { type: 'array', items: { type: 'string' }, description: '核心关键词（命中 +3）' },
          contextKeywords: { type: 'array', items: { type: 'string' }, description: '辅助关键词（命中 +1）' },
          excludeKeywords: { type: 'array', items: { type: 'string' }, description: '排除词（命中直接丢弃）' },
          reason: { type: 'string', description: '为什么这些词能代表方向（必填）' },
        },
        required: ['reason'],
        additionalProperties: false,
      },
      output: jsonOutput(renderJson),
      async execute({ keywords, contextKeywords, excludeKeywords, reason } = {}) {
        const reasonText = String(reason || '').trim();
        if (!reasonText) return { ok: false, error: '必须写 reason：说明这些关键词的依据' };
        const patch = {};
        for (const [key, list] of [['keywords', keywords], ['contextKeywords', contextKeywords], ['excludeKeywords', excludeKeywords]]) {
          if (list === undefined) continue;
          if (!Array.isArray(list)) return { ok: false, error: `${key} 必须是字符串数组` };
          const cleaned = [];
          for (const raw of list) {
            const value = String(raw || '').trim();
            if (!value) continue;
            try { new RegExp(value, 'i'); } catch { return { ok: false, error: `正则无效：${value}` }; }
            if (!cleaned.includes(value)) cleaned.push(value);
          }
          patch[key] = cleaned.slice(0, 50);
        }
        if (!Object.keys(patch).length) return { ok: false, error: '至少给一组关键词' };
        const config = await writeUserConfig(baseDir, { relevance: patch });
        return { ok: true, reason: reasonText, relevance: config.relevance };
      },
    },
    {
      name: 'literature-lab_ingest',
      description: '把外部来源的条目并入候选池：手工整理的清单、其他工具导出的条目等。邮件快讯也进候选池，不走这个工具。与 discover 共用同一套标识归一化、去重、关键词过滤与 seen 记录，不判断科学价值。每条至少给 title，其余能填就填（url/doi/arxivId/summary/authors/publishedAt）。',
      parameters: {
        type: 'object',
        properties: {
          source: { type: 'string', description: '来源标识，如 scholar-alert、manual；只用于记录出处' },
          items: {
            type: 'array',
            description: '条目数组；title 必填，其余可选',
            items: {
              type: 'object',
              properties: {
                title: { type: 'string' },
                url: { type: 'string' },
                doi: { type: 'string' },
                arxivId: { type: 'string' },
                summary: { type: 'string' },
                authors: { type: 'array', items: { type: 'string' } },
                publishedAt: { type: 'string' },
              },
              required: ['title'],
              additionalProperties: false,
            },
          },
        },
        required: ['items'],
        additionalProperties: false,
      },
      output: jsonOutput(renderJson),
      async execute({ source, items } = {}) {
        return ingest(baseDir, { source: source || 'manual', items: items || [] });
      },
    },
    {
      name: 'literature-lab_corpus',
      description: '回溯语料与候选池。action=harvest 按关键词+年份区间采集（OpenAlex/Crossref/arXiv）；snowball 从 Zotero 种子做引文雪球（references/citations/S2 推荐）；candidates 查候选池；promote 把候选收进队列（默认进初筛 L2）；analyze 跑 L1 摘要判读（S/A/B 进队列，C/D 丢弃）；add 把标题/DOI/arXiv 直接加到 L2 并置顶。采集是后台任务，返回 harvest id，用 candidates/harvest 查进度。',
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['harvest', 'snowball', 'candidates', 'harvests', 'resume', 'promote', 'analyze', 'download', 'need_download', 'email', 'add'], description: '默认 candidates' },
          query: { type: 'string', description: 'harvest 用：关键词' },
          yearFrom: { type: 'number', description: 'harvest 用：起始年份' },
          yearTo: { type: 'number', description: 'harvest 用：结束年份' },
          maxItems: { type: 'number', description: '单任务候选上限，默认 500，最多 2000' },
          direction: { type: 'string', enum: ['refs', 'cites', 'both', 'recommend', 'related'], description: 'snowball 用：取引用/被引/两者/语义推荐/相似论文' },
          seeds: {
            type: 'array',
            items: {
              type: 'object',
              properties: { doi: { type: 'string' } },
              required: ['doi'],
              additionalProperties: false,
            },
            description: 'snowball 用：显式 DOI 种子；省略则从 Zotero 选',
          },
          zoteroTag: { type: 'string', description: 'snowball 用：Zotero 标签精确匹配（可选，高级；界面上不要求）' },
          zoteroCollection: { type: 'string', description: 'snowball 用：Zotero 分类 key 或名字' },
          maxSeeds: { type: 'number', description: 'snowball 用：最多几个种子，默认 20' },
          sources: {
            type: 'array',
            items: { type: 'string', enum: ['openalex', 'crossref', 'arxiv'] },
            description: 'harvest 用：查哪些源，默认三个都查',
          },
          status: { type: 'string', description: 'candidates 用：new/parked/admitted/dropped/failed/filtered/owned/all，默认 new' },
          q: { type: 'string', description: 'candidates 用：关键词过滤' },
          limit: { type: 'number', description: 'candidates/analyze 用：条数；analyze 默认 10' },
          offset: { type: 'number', description: 'candidates 用：分页偏移' },
          id: { type: 'string', description: 'promote/resume 用：候选 id 或 harvest id' },
          ids: { type: 'array', items: { type: 'string' }, description: 'analyze 用：只分析这些候选/论文 id；省略则自动挑' },
          fetchPdf: { type: 'boolean', description: 'add 用：是否顺手取开放原文，默认 true' },
                    sort: { type: 'string', enum: ['score', 'newest', 'year', 'title'], description: 'analyze 用：分析顺序，默认兴趣分' },
          stage: { type: 'string', enum: ['L1', 'L2', 'L3'], description: 'add 直接进入的层级（默认 L2）；analyze 用 L1/L2/L3，默认 L1' },
                  },
        additionalProperties: false,
      },
      output: jsonOutput(renderJson),
      async execute({ action = 'candidates', query, yearFrom, yearTo, maxItems, direction, seeds, zoteroTag, zoteroCollection, maxSeeds, sources, status, q, limit, offset, id, ids, stage, fetchPdf, sort } = {}) {
        try {
          if (action === 'harvest') {
            return { ok: true, harvest: await startHarvest(baseDir, {
              kind: 'year',
              query,
              yearFrom,
              yearTo,
              maxItems,
              sources: Array.isArray(sources) && sources.length ? sources : undefined,
            }) };
          }
          if (action === 'snowball') {
            return { ok: true, harvest: await startHarvest(baseDir, {
              kind: 'snowball',
              direction,
              seeds: Array.isArray(seeds) ? seeds : undefined,
              zotero: zoteroTag || zoteroCollection ? { tag: zoteroTag, collection: zoteroCollection } : undefined,
              maxSeeds,
              maxItems,
            }) };
          }
          if (action === 'harvests') {
            return { ok: true, harvests: await listHarvests(baseDir) };
          }
          if (action === 'resume') {
            if (!id) return { ok: false, error: 'resume 需要 id（harvest id）' };
            return { ok: true, harvest: await resumeHarvest(baseDir, id) };
          }
          if (action === 'add') {
            if (!query) return { ok: false, error: 'add 需要标题/DOI/arXiv id' };
            return await addManualPaper(baseDir, {
              query,
              stage,
              fetchPdf: fetchPdf !== false,
              ctx,
            });
          }
          if (action === 'email') {
            return runEmail(ctx, baseDir, { limit });
          }
          if (action === 'download') {
            return downloadWithQuota({ limit: limit || 3 });
          }
          if (action === 'need_download') {
            const state = await readState(baseDir);
            const all = Object.entries(state.papers || {})
              .filter(([, p]) => !p.pdf && p.stage !== 'dropped');
            const rows = all
              .slice(0, Math.min(200, Number(limit) || 50))
              .map(([id, p]) => ({
                id,
                title: p.title,
                grade: p.grade || null,
                reason: p.download?.reason || null,
                url: p.url || (p.doi ? `https://doi.org/${p.doi}` : null),
              }));
            return { ok: true, total: all.length, items: rows };
          }
          if (action === 'promote') {
            if (!id) return { ok: false, error: 'promote 需要 id' };
            return await promoteCandidate(baseDir, id);
          }
          if (action === 'analyze') {
            return { ok: true, job: await startAnalysisJob({ ids, limit, sort, stage }) };
          }
          return { ok: true, ...(await queryCandidates(baseDir, { status, q, limit, offset })) };
        } catch (error) {
          return { ok: false, action, error: String(error?.message || error) };
        }
      },
    },
    {
      name: 'literature-lab_discover',
      description: '跑一轮 L0 发现：arXiv API（按分类/查询式，漏跑会回填）、RSS 与配置里的检索式并行拉取；去重、T0 关键词过滤后全部写入候选池，不直接进 L1。单个源失败不影响其他源，返回值带每个源的明细。不判断科学价值。',
      parameters: {
        type: 'object',
        properties: {
          hours: { type: 'number', description: '可选：覆盖配置里的时间窗口（小时）' },
        },
        additionalProperties: false,
      },
      output: jsonOutput(renderJson),
      async execute(args = {}) {
        return discover(baseDir, args.hours ? { hours: Number(args.hours) } : {});
      },
    },
  ];
  return tools;
}
