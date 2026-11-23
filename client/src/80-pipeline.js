    // ── 待办（原「AI 分析」）──────────────────────────────
    // 一级分段 + 单列表：候选池与 L1/L2/L3/已完成共用一条列表，
    // 不再把「候选池 + 额度 + 三条 lane」叠在同一页。
    const CANDIDATE_PAGE = 60;

    const PIPELINE_SORTS = [
      { id: 'score', label: '兴趣分' },
      { id: 'newest', label: '最新' },
      { id: 'year', label: '年份' },
      { id: 'title', label: '题名' },
    ];

    const PIPELINE_STATUS_LABEL = Object.fromEntries(STATUS_TABS.map((tab) => [tab.id, tab.label]));

    // 待办只有三种真实状态：要继续推进的、已经流过去的、不看了的。
    // 「候选 / 待摘要判断 / 待初筛 / 待精读」是待处理内部的分节，不是可选状态。

    // ── 稍后 ──────────────────────────────────────────────────
    // 论文级动作：暂时移出待处理，到期自动回到原分段。
    const SNOOZE_OPTIONS = [
      { days: 3, label: '3 天' },
      { days: 7, label: '1 周' },
    ];
    // 到期后论文自动回到待处理；「稍后」段行里用菜单提示具体回到队列的日期。

    function snoozeUntilOf(p) {
      const until = Date.parse(p?.snooze?.until || '');
      return Number.isFinite(until) ? until : null;
    }

    /** 还没到期 = 仍然在「稍后」里；到期的视为已回到队列。 */
    function snoozeIsActive(p, now = Date.now()) {
      const until = snoozeUntilOf(p);
      return until !== null && until > now;
    }

    /**
     * 待办计数：页头、页签徽标、段按钮共用这一份，避免三个数字打架。
     * 暂停中的论文不计入待处理；dropped 同时包含候选与论文。
     */
    function queueCounts(state, now = Date.now()) {
      const summary = state?.summary || {};
      const counts = summary.counts || {};
      const stages = summary.stages || {};
      const papers = Array.isArray(state?.papers) ? state.papers : [];
      const paused = papers.filter((p) => snoozeIsActive(p, now)).length;
      const stagesTodo = (Number(stages.L1) || 0) + (Number(stages.L2) || 0) + (Number(stages.L3) || 0);
      const candTodo = (Number(counts.new) || 0) + (Number(counts.parked) || 0) + (Number(counts.failed) || 0);
      return {
        todo: Math.max(0, stagesTodo + candTodo - paused),
        paused,
        done: Number(stages.done) || 0,
        dropped: (Number(stages.dropped) || 0) + (Number(counts.dropped) || 0),
      };
    }

    /** 稍后到期日，只到天。 */

    // ── 保存视图 ──────────────────────────────────────────────
    // 内置视图不写配置；其余存 config.views，结构固定为 { id, name, status, stage, flag, q, sort }。

    /** 视图指纹：筛选变了，下拉就退回「当前筛选（临时）」。 */

    // 待处理要跨状态取候选。服务端新版本支持逗号写法，但老进程只认单个状态，
    // 所以客户端按状态分别请求再合并——重启前后都能拿到正确的列表。
    const CANDIDATE_TODO_STATUSES = ['new', 'analyzing', 'failed', 'parked'];
    // 被关键词过滤 / 命中排除词 / 已在库里：可查，但不该占主视图。

    /** 论文卡住的标记：有这些时下一步是人动手，不是等 AI。 */
    const BLOCKING_FLAGS = ['needs_pdf', 'low_confidence', 'analysis_failed', 'pdf_error'];

    /** 阻塞标记 → 一句人话原因；行上只靠这一句说明「为什么这行轮到你」。 */
    const PAPER_BLOCK_REASON = {
      needs_pdf: '缺原文，需补充 PDF',
      pdf_error: '原文解析失败，需更换 PDF',
      low_confidence: 'AI 置信度低，需人工确认',
      analysis_failed: '分析失败，可重试',
    };

    /** 候选状态人话：promoted 与 admitted 对用户是同一件事（已加入初筛）。 */
    function candidateStatusLabel(status) {
      if (status === 'promoted' || status === 'admitted') return '已加入初筛';
      if (status === 'analyzing') return '判读中';
      return PIPELINE_STATUS_LABEL[status] || status || '状态未知';
    }

    /** 候选为什么在队列里：人话，不把 parked/hold 这类枚举摆给用户。 */
    function candidateWhy(c) {
      if (c.status === 'parked') return 'AI 建议暂缓，等待确认';
      if (c.status === 'failed') return '判读失败，需人工重试';
      if (c.status === 'analyzing') return 'AI 正在判读';
      if (c.status === 'new') return '尚未判读';
      if (c.status === 'dropped') return '已丢弃';
      if (c.status === 'promoted') return '已转论文，待初筛';
      if (c.status === 'admitted') return '已转论文，待初筛';
      if (c.status === 'filtered') return '没有匹配关注词，已过滤';
      if (c.status === 'excluded') return '含排除词，已过滤';
      if (c.status === 'owned') return '已有该文献';
      return candidateStatusLabel(c.status);
    }

    /** 截断长理由：行上只给一句，完整内容留在抽屉里。 */
    function briefText(text, limit = 120) {
      const value = String(text || '').trim();
      return value.length > limit ? `${value.slice(0, limit)}…` : value;
    }

    /** 候选行的判断依据：为什么在队列里 + AI 给出的理由（截 120 字）。 */

    /** 只取「为什么卡住」的部分：阶段名由行内 chip 表达，说明行不再重复。 */

    /** 论文行的判断依据：停在哪一步 + 为什么卡住；L1 不假称 AI 会继续处理。 */

    /** 行内只给一个下一步，避免失败状态只有结论没有动作。 */

    /** 每行明确所处流程，避免只看按钮不知道这是候选还是论文、在哪一层。 */


    /** 阶段筛选的人话：L1 是「AI 还没给结论」，不写成含糊的「待看摘要」。 */

    /** 论文行元信息只留四项：年份 · 期刊 · 期刊等级 · 有/缺原文。 */
    function paperMetaNodes(p) {
      const tier = p.venue_tier || null;
      const tierTitle = tier ? [
        tier.label,
        tier.ranks?.cas ? `中科院 ${tier.ranks.cas}` : null,
        tier.ranks?.xr ? `新锐 ${tier.ranks.xr}` : null,
        tier.ranks?.jcr ? `JCR ${tier.ranks.jcr}` : null,
        tier.metrics?.impactFactor ? `IF ${tier.metrics.impactFactor}` : null,
      ].filter(Boolean).join(' · ') : '';
      const nodes = [];
      const push = (node) => {
        if (nodes.length) nodes.push(h('span', { key: `sep-${nodes.length}`, style: { color: C.caption } }, ' · '));
        nodes.push(node);
      };
      if (p.year) push(h('span', { key: 'year' }, String(p.year)));
      if (p.venue) push(h('span', { key: 'venue', style: { overflowWrap: 'anywhere' } }, String(p.venue)));
      if (tier?.label) push(h('span', { key: 'tier', title: tierTitle || tier.label, style: { color: C.accent } }, tier.label));
      push(h('span', { key: 'pdf', style: { color: p.has_pdf ? C.label3 : C.warn } }, p.has_pdf ? '本地 PDF' : '缺原文'));
      if (p.zotero_key) push(h('span', { key: 'zotero', style: { color: C.success } }, 'Zotero'));
      return nodes;
    }

    /** 候选的元信息：字段顺序与分隔符跟论文行一致，别一半用空格一半用「·」 */
    function candidateMetaNodes(c) {
      const nodes = [];
      const push = (node) => {
        if (nodes.length) nodes.push(h('span', { key: `sep-${nodes.length}`, style: { color: C.caption } }, ' · '));
        nodes.push(node);
      };
      if (c.year) push(h('span', { key: 'year' }, String(c.year)));
      if (c.venue) push(h('span', { key: 'venue', style: { overflowWrap: 'anywhere' } }, String(c.venue)));
      if ((c.sources || []).length) push(h('span', { key: 'source' }, sourceLabel(c.sources[0])));
      push(h('span', {
        key: 'abstract',
        style: { color: c.abstract ? C.label3 : C.warn },
      }, c.abstract ? '有摘要' : '缺摘要'));
      return nodes;
    }

    // 动作区：统一高度与右缘。主按钮固定最小宽度、菜单槽位恒定占位，
    // 每行按钮才会落在同一条竖线上；窄屏时整块换行后仍贴右。
    const ROW_ACTIONS = {
      marginLeft: 'auto', flexShrink: 0, display: 'flex', gap: T.space.xs,
      alignItems: 'flex-start', justifyContent: 'flex-end',
    };
    const ROW_PRIMARY = {
      display: 'inline-flex', justifyContent: 'flex-end', alignItems: 'center',
      minWidth: 96, flexShrink: 0,
    };

    const PIPELINE_ROW = {
      display: 'flex', gap: T.space.sm, alignItems: 'flex-start', flexWrap: 'wrap',
      padding: '9px 2px', borderTop: `1px solid ${C.border1}`,
    };
    /** 行内三段的排版：标题 / 元信息 / 依据。 */
    const QUEUE_TITLE = {
      fontSize: fs(14.5), fontWeight: 600, color: C.label1, lineHeight: 1.35,
      overflowWrap: 'anywhere', cursor: 'default',
    };
    const QUEUE_META = {
      // 2px 太挤，「2026」和「邮件」会粘成「2026邮件」；8px 也不至于散开
      display: 'flex', gap: T.space.sm, alignItems: 'center', flexWrap: 'wrap',
      fontSize: fs(T.font.hint), color: C.caption, lineHeight: 1.5, marginTop: 1,
    };
    const QUEUE_WHY = {
      fontSize: fs(T.font.hint), color: C.label2, lineHeight: T.line.body,
      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
    };

    /** 「补 PDF」主按钮：外观同主按钮，里面藏一个文件输入，鼠标与键盘都能触发。 */
    function PipelinePdfButton({ paperId, onUpload, label = '补 PDF' }) {
      return h('label', {
        style: {
          position: 'relative', display: 'inline-flex', alignItems: 'center',
          cursor: 'pointer', fontFamily: 'inherit', fontWeight: 500, fontSize: fs(13),
          padding: '3px 9px', borderRadius: 6, border: '1px solid transparent',
          background: C.accent, color: C.onColor, whiteSpace: 'nowrap',
        },
      }, label,
        h('input', {
          type: 'file', accept: 'application/pdf',
          'aria-label': '选择这篇论文的 PDF 文件',
          style: { position: 'absolute', width: 1, height: 1, opacity: 0 },
          onChange: (e) => { const file = e.target.files?.[0]; if (file) onUpload(paperId, file); },
        }));
    }

    /** 论文排序：score 保持服务端顺序（优先 + 首次发现倒序）。 */
    function sortPaperRows(papers, sort) {
      const list = [...papers];
      if (sort === 'newest') {
        list.sort((a, b) => String(b.first_seen || '').localeCompare(String(a.first_seen || '')));
      } else if (sort === 'year') {
        list.sort((a, b) => (Number(b.year) || 0) - (Number(a.year) || 0)
          || String(b.first_seen || '').localeCompare(String(a.first_seen || '')));
      } else if (sort === 'title') {
        list.sort((a, b) => String(a.title || '').localeCompare(String(b.title || '')));
      }
      return list;
    }

    /** 候选排序：多个状态合并后按同一口径重排，和 lib/candidates.js 一致。 */
    function sortCandidateRows(items, sort) {
      const list = [...items];
      const byNewest = (a, b) => String(b.added_at || '').localeCompare(String(a.added_at || ''));
      if (sort === 'newest') list.sort(byNewest);
      else if (sort === 'year') {
        list.sort((a, b) => (Number(b.year) || 0) - (Number(a.year) || 0) || byNewest(a, b));
      } else if (sort === 'title') {
        list.sort((a, b) => String(a.title || '').localeCompare(String(b.title || '')));
      } else {
        list.sort((a, b) => (Number(b.t0?.score) || 0) - (Number(a.t0?.score) || 0) || byNewest(a, b));
      }
      return list;
    }

    /** 候选详情：未提升成论文的候选没有抽屉数据，这里给只读详情 + 动作（含「加入初筛」）。 */
    function CandidatePreviewDialog({ candidate, onClose, onAnalyze, onRerun, onDrop, onPromote }) {
      const c = candidate;
      const a = c.analysis || null;
      const rows = [
        ['作者', (c.authors || []).join('、') || '—'],
        ['年份 / 出处', [c.year, c.venue].filter(Boolean).join(' · ') || '—'],
        ['DOI', c.doi || '—'],
        ['arXiv', c.arxiv_id || '—'],
        ['兴趣分', `${c.t0?.score ?? 0}${(c.t0?.hits || []).length ? `（命中：${c.t0.hits.join('、')}）` : ''}`],
        ['状态', candidateStatusLabel(c.status)],
      ];
      return h(Dialog, {
        title: '条目详情', onClose, width: 640,
        footer: [
          h(Button, { key: 'close', onClick: onClose }, '关闭'),
          onDrop ? h(Button, { key: 'drop', danger: true, onClick: () => { onDrop(); onClose(); } }, '丢弃') : null,
          onRerun ? h(Button, { key: 'rerun', onClick: () => { onRerun(); onClose(); } }, '重跑') : null,
          onAnalyze
            ? h(Button, {
              key: 'analyze', primary: !onPromote, onClick: () => { onAnalyze(); onClose(); },
            }, '判读')
            : null,
          onPromote
            ? h(Button, { key: 'promote', primary: true, onClick: () => { onPromote(); onClose(); } }, '加入初筛')
            : null,
        ].filter(Boolean),
      },
        h('div', {
          style: {
            fontSize: fs(T.font.section), fontWeight: 600, color: C.label1,
            lineHeight: T.line.tight, overflowWrap: 'anywhere', marginBottom: T.space.sm,
          },
        }, c.title || '(无题名)'),
        h('div', { style: { display: 'grid', gap: T.space.xs, marginBottom: T.space.md } },
          rows.map(([key, value]) => h('div', {
            key, style: { display: 'flex', gap: T.space.sm, fontSize: fs(T.font.hint) },
          },
            h('span', { style: { width: 76, flexShrink: 0, color: C.caption } }, key),
            h('span', { style: { color: C.label2, overflowWrap: 'anywhere' } }, String(value))))),
        h('div', { style: { fontSize: fs(T.font.hint), color: C.caption, marginBottom: T.space.xs } }, '摘要判断'),
        a
          ? h('div', { style: { display: 'grid', gap: T.space.xs, marginBottom: T.space.md } },
            h('div', { style: { display: 'flex', gap: T.space.xs, alignItems: 'center', flexWrap: 'wrap' } },
              h(Chip, { tone: a.error ? C.error : C.label2 }, a.verdict || a.error || '已分析'),
              a.grade ? h(GradeBadge, { grade: a.grade }) : null,
              a.confidence ? h(Chip, { tone: a.confidence === 'low' ? C.warn : C.label2 }, `置信度 ${a.confidence}`) : null),
            a.reason
              ? h('div', { style: { fontSize: fs(T.font.hint), color: C.label2, lineHeight: T.line.body, overflowWrap: 'anywhere' } }, a.reason)
              : null,
            a.error
              ? h('div', { style: { fontSize: fs(T.font.hint), color: C.error, overflowWrap: 'anywhere' } }, a.error)
              : null,
            h('div', { style: { fontSize: fs(T.font.hint), color: C.caption } },
              [
                a.model?.model ? `模型 ${a.model.model}` : null,
                null,
                a.at ? new Date(a.at).toLocaleString() : null,
              ].filter(Boolean).join(' · ')))
          : h('div', { style: { fontSize: fs(T.font.hint), color: C.caption, marginBottom: T.space.md } }, '还没判读'),
        h('div', { style: { fontSize: fs(T.font.hint), color: C.caption, marginBottom: T.space.xs } }, '摘要'),
        c.abstract
          ? h('div', {
            style: {
              fontSize: fs(T.font.meta), color: C.label2, lineHeight: T.line.body,
              whiteSpace: 'pre-wrap', overflowWrap: 'anywhere',
            },
          }, c.abstract)
          : h('div', { style: { fontSize: fs(T.font.hint), color: C.warn } }, '没有摘要'),
      );
    }

    /** 手动添加 / 本机 PDF 导入：从来源页搬到工具条后的常驻入口。 */
    function AddPaperDialog({ onClose, onAdded }) {
      const [query, setQuery] = useState('');
      const [files, setFiles] = useState([]);
      const [busy, setBusy] = useState(false);
      const [msg, setMsg] = useState(null);

      const addByQuery = async () => {
        const value = query.trim();
        if (!value || busy) return;
        setBusy(true);
        setMsg(null);
        try {
          const r = await postJson(R.add, { query: value, stage: 'L2', fetchPdf: true });
          const download = r.download?.results?.[0];
          setMsg({
            kind: 'success',
            text: `已加入初筛${download?.ok
              ? '，原文已下载'
              : download?.reason ? `，原文未取到：${download.reason}${download?.hint ? `（${download.hint}）` : ''}` : ''}：${r.paper?.title || value}`,
          });
          setQuery('');
          await onAdded?.();
        } catch (e) {
          setMsg({ kind: 'error', text: String(e?.message || e) });
        } finally { setBusy(false); }
      };

      const uploadFiles = async () => {
        if (!files.length || busy) return;
        setBusy(true);
        setMsg(null);
        let ok = 0;
        const errors = [];
        for (const file of files) {
          try {
            const form = new FormData();
            form.append('file', file);
            if (files.length === 1 && query.trim()) form.append('title', query.trim());
            await api(R.upload, { method: 'POST', body: form });
            ok += 1;
          } catch (e) {
            errors.push(`${file.name}：${e?.message || e}`);
          }
        }
        setMsg({
          kind: errors.length ? 'warn' : 'success',
          text: `已导入 ${ok}/${files.length} 个 PDF 到初筛${errors.length ? `；失败：${errors.slice(0, 3).join('；')}` : ''}`,
        });
        if (ok) {
          setFiles([]);
          await onAdded?.();
        }
        setBusy(false);
      };

      return h(Dialog, {
        title: '添加论文', onClose, width: 560,
        footer: [h(Button, { key: 'close', onClick: onClose }, '关闭')],
      },
        h(Field, { label: '标题 / DOI / arXiv ID', hint: '直接放到初筛队列，并尝试下载可获取的原文' },
          h('div', { style: { display: 'flex', gap: T.space.sm, alignItems: 'center' } },
            h('div', { style: { flex: 1, minWidth: 0 } }, h(TextInput, {
              value: query,
              onChange: setQuery,
              placeholder: '例如 10.1109/TRO.2024.1234567 或 2310.12345',
              label: '标题或标识',
            })),
            h(Button, {
              primary: true, size: 'sm', disabled: busy || !query.trim(), onClick: addByQuery,
            }, busy ? '处理中…' : '加入初筛'))),
        h(Field, { label: '本机 PDF', hint: '可多选；文件名会作为题名，加入初筛' },
          h('div', { style: { display: 'flex', gap: T.space.sm, alignItems: 'center', flexWrap: 'wrap' } },
            h('input', {
              type: 'file', accept: 'application/pdf', multiple: true,
              'aria-label': '选择 PDF 文件',
              onChange: (e) => setFiles(Array.from(e.target.files || [])),
              style: { fontSize: fs(T.font.hint), color: C.label2, maxWidth: '100%' },
            }),
            h(Button, {
              size: 'sm', disabled: busy || !files.length, onClick: uploadFiles,
            }, busy ? '导入中…' : `导入 PDF${files.length ? `（${files.length}）` : ''}`))),
        msg ? h(Notice, { kind: msg.kind }, msg.text) : null,
      );
    }

    /** 保存视图：Electron 里没有 window.prompt，用对话框收名称。 */
    function ViewsSaveDialog({ error, busy, onClose, onSave }) {
      const [name, setName] = useState('');
      const submit = () => {
        const value = name.trim();
        if (!value || busy) return;
        onSave(value);
      };
      useEffect(() => {
        const input = typeof document !== 'undefined' ? document.getElementById('litlab-views-name') : null;
        if (input && typeof input.focus === 'function') input.focus();
      }, []);
      return h(Dialog, {
        title: '保存当前筛选为视图', onClose, width: 460,
        footer: [
          h(Button, { key: 'cancel', onClick: onClose }, '取消'),
          h(Button, { key: 'ok', primary: true, disabled: busy || !name.trim(), onClick: submit }, busy ? '保存中…' : '保存'),
        ],
      },
        h(Field, { label: '视图名称', hint: '保存后可在「视图」下拉里直接回到这组筛选' },
          h(TextInput, {
            value: name,
            onChange: setName,
            placeholder: '例如 待补原文的低置信',
            label: '视图名称',
            inputId: 'litlab-views-name',
            onKeyDown: (e) => { if (e.key === 'Enter') submit(); },
          })),
        error ? h(Notice, { kind: 'error' }, error) : null);
    }

    /** 删除已保存视图：一次删一条，删完名字就消失。 */
    function ViewsDeleteDialog({ views, onClose, onDelete }) {
      return h(Dialog, {
        title: '删除视图', onClose, width: 460,
        footer: [h(Button, { key: 'close', onClick: onClose }, '关闭')],
      },
        views.length
          ? h('div', { style: { display: 'grid', gap: T.space.xs } }, views.map((view) => h('div', {
            key: view.id,
            style: { display: 'flex', alignItems: 'center', gap: T.space.sm, fontSize: fs(T.font.meta) },
          },
            h('span', { style: { flex: 1, minWidth: 0, color: C.label2, overflowWrap: 'anywhere' } },
              view.name || '（未命名视图）'),
            h(Button, { size: 'sm', danger: true, onClick: () => onDelete(view) }, '删除'))))
          : h('div', { style: { fontSize: fs(T.font.meta), color: C.caption } }, '还没有保存的视图'));
    }

    function Queue({ state, reload, loadMore, busy, config, saveConfig, onOverride, onRerun, onOpenUrl, openPaper, seg, setSeg, pref, navigate, refreshTick = 0 }) {
      const [sort, setSort] = useState('score');
      const [queryDraft, setQueryDraft] = useState('');
      const [query, setQuery] = useState('');
      // 视图：queue = 队列主视图，history = 历史子视图（暂停/已完成/已排除/被过滤）
      const [view, setView] = useState('queue');
      const [historyTab, setHistoryTab] = useState('paused');
      // 深链或点表下钻的焦点：{ kind: 'group' | 'row', key }；null = 全部
      const [focus, setFocus] = useState(null);
      const [expandedHuman, setExpandedHuman] = useState(() => new Set());
      const [expandedAi, setExpandedAi] = useState(false);
      const [historyCandidates, setHistoryCandidates] = useState({ items: [], loading: false, error: null });
      const [historyLimit, setHistoryLimit] = useState(60);
      // 正在跑的任务目标：把对应行标成「分析中」并排到 AI 队列最前
      const [runningTargets, setRunningTargets] = useState([]);
      // 任务进度：id → 当前阶段（如「查找原文中」），由 /jobs 的 progress 提供
      const [runningPhases, setRunningPhases] = useState({});
      const [candidates, setCandidates] = useState({ items: [], total: 0, counts: {} });
      // 每个候选状态一次取多少条；「加载更多」往上加，不依赖服务端分页偏移
      const [candidateLimit, setCandidateLimit] = useState(CANDIDATE_PAGE);
      const [candidateLoading, setCandidateLoading] = useState(false);
      const [candidateError, setCandidateError] = useState(null);
      const [statsError, setStatsError] = useState(null);
      const [analysisStats, setAnalysisStats] = useState(null);
      const [selected, setSelected] = useState([]);
      const [analyzing, setAnalyzing] = useState(false);
      const [stageRun, setStageRun] = useState(null);
      const [batch, setBatch] = useState(null);
      const [msg, setMsg] = useState(null);
      const [confirmDrop, setConfirmDrop] = useState(false);
      const [confirmRerun, setConfirmRerun] = useState(null);
      const [preview, setPreview] = useState(null);
      const [downloadBusy, setDownloadBusy] = useState(false);
      const [cursor, setCursor] = useState(-1);
      const runJob = useJobRunner();

      const activeSeg = view === 'history' ? historyTab : 'todo';
      const goSeg = (next) => {
        if (typeof setSeg === 'function') setSeg(next);
        if (next === 'todo') {
          setView('queue');
          setHistoryTab('paused');
        } else {
          setView('history');
          setHistoryTab(next === 'done' || next === 'dropped' ? next : 'paused');
        }
        setFocus(null);
        setSelected([]);
        setCursor(-1);
      };

      const counts = analysisStats?.counts || candidates?.counts || {};
      const countOf = (id) => Number(counts[id]) || 0;
      const noiseCount = countOf('filtered') + countOf('excluded') + countOf('owned');
      const loadedPapers = state?.papers || [];
      const paperIds = new Set(loadedPapers.map((p) => p.id));

      // 稍后拆成两份：未到期的进「稍后」分段，其余照常留在原分段。
      const nowTs = Date.now();
      const snoozedPapers = loadedPapers.filter((p) => snoozeIsActive(p, nowTs));
      const queuePapers = loadedPapers.filter((p) => !snoozeIsActive(p, nowTs));

      // 主视图的候选只取待处理四态；历史里的候选按标签单独拉（见 historyLoad）
      const candidateStatuses = CANDIDATE_TODO_STATUSES;
      const candidateKey = candidateStatuses.join(',');

      // 深链：总览把「待确认 / 缺材料 / AI 队列」或某一阶段带进来，这里折成焦点或历史标签。
      useEffect(() => {
        if (!pref || typeof pref !== 'object') {
          setFocus(null);
          setView('queue');
          return;
        }
        const validFlag = pref.flag && REVIEW_FLAGS.some((flag) => flag.id === pref.flag) ? pref.flag : null;
        if (['decide', 'material', 'ai'].includes(pref.group)) {
          setView('queue');
          setFocus(pref.group === 'ai'
            ? { kind: 'ai', key: 'ai' }
            : { kind: 'group', key: pref.group === 'decide' ? 'confirm' : 'material' });
          return;
        }
        if (['L0', 'L1', 'L2', 'L3'].includes(pref.stage)) {
          setView('queue');
          setFocus(['L0', 'L1'].includes(pref.stage)
            ? { kind: 'group', key: 'legacy' }
            : { kind: 'row', key: pref.stage === 'L2' ? 'l2' : 'l3' });
          return;
        }
        if (pref.stage === 'done' || pref.stage === 'dropped') {
          setView('history');
          setHistoryTab(pref.stage);
          setFocus(null);
          return;
        }
        if (validFlag) {
          setView('queue');
          setFocus({ kind: 'group', key: validFlag === 'needs_pdf' || validFlag === 'pdf_error' ? 'material' : validFlag === 'low_confidence' ? 'lowconf' : 'failed' });
          return;
        }
        if (pref.status) {
          setView('queue');
          setFocus({ kind: 'group', key: pref.status === 'failed' ? 'failed' : 'confirm' });
        }
      }, [pref]);

      // 任务列表每 5 秒轮询一次；有任务在跑时顺带刷新论文数据，跑完能自动更新
      useEffect(() => {
        let alive = true;
        const load = async () => {
          try {
            const data = await fetchJson(R.jobs);
            const running = (data.jobs || []).filter((job) => job.status === 'running');
            const ids = running.flatMap((job) => (Array.isArray(job?.meta?.targets) ? job.meta.targets : []));
            const phases = {};
            for (const job of running) {
              if (job?.progress?.id && job.progress.phase) phases[job.progress.id] = job.progress.phase;
            }
            if (alive) {
              setRunningTargets(ids);
              setRunningPhases(phases);
            }
          } catch { /* 任务列表失败不影响页面 */ }
        };
        load();
        const timer = setInterval(load, 5000);
        if (typeof timer?.unref === 'function') timer.unref();
        return () => { alive = false; clearInterval(timer); };
      }, [refreshTick]);

      useEffect(() => {
        if (!runningTargets.length) return undefined;
        const timer = setInterval(() => { reload?.(); }, 5000);
        if (typeof timer?.unref === 'function') timer.unref();
        return () => clearInterval(timer);
      }, [runningTargets.length, reload]);

      const loadStats = useCallback(async () => {
        try {
          const r = await api(R.analysisStats);
          setAnalysisStats(r.stats || null);
          setStatsError(null);
        } catch (e) {
          setStatsError(String(e?.message || e));
        }
      }, []);

      useEffect(() => {
        loadStats();
        const timer = setInterval(loadStats, 10000);
        if (typeof timer?.unref === 'function') timer.unref();
        return () => clearInterval(timer);
      }, [loadStats]);

      // 搜索 300ms 防抖，避免每个键位两个请求
      useEffect(() => {
        const timer = setTimeout(() => setQuery(queryDraft.trim()), 300);
        return () => clearTimeout(timer);
      }, [queryDraft]);

      const candidateUrl = (status) => `${R.candidates}?status=${encodeURIComponent(status)}`
        + `&sort=${encodeURIComponent(sort)}&limit=${candidateLimit}&offset=0&q=${encodeURIComponent(query)}`;

      // 每个状态各取一页再合并：不依赖服务端是否支持逗号写法，重启前后都对。
      const loadCandidates = useCallback(async (options) => {
        const silent = Boolean(options?.silent);
        const statuses = candidateKey ? candidateKey.split(',') : [];
        if (!statuses.length) {
          setCandidates({ items: [], counts: {} });
          setCandidateError(null);
          return;
        }
        if (!silent) setCandidateLoading(true);
        try {
          const pages = await Promise.all(statuses.map((status) => api(candidateUrl(status))));
          const seen = new Set();
          const items = [];
          let counts = {};
          for (const page of pages) {
            counts = { ...counts, ...(page.counts || {}) };
            for (const item of page.items || []) {
              if (seen.has(item.id)) continue;
              seen.add(item.id);
              items.push(item);
            }
          }
          setCandidates({ items: sortCandidateRows(items, sort), counts });
          setCandidateError(null);
        } catch (e) {
          setCandidateError(String(e?.message || e));
        } finally {
          if (!silent) setCandidateLoading(false);
        }
      }, [candidateKey, sort, query, candidateLimit, refreshTick]);

      useEffect(() => { loadCandidates(); }, [loadCandidates, refreshTick]);

      // 低频刷新首屏，静默替换，不闪 loading
      useEffect(() => {
        if (!candidateKey) return undefined;
        const timer = setInterval(() => loadCandidates({ silent: true }), 15000);
        if (typeof timer?.unref === 'function') timer.unref();
        return () => clearInterval(timer);
      }, [candidateKey, loadCandidates]);

      // 切换视图/焦点/搜索时清空选择，避免批量作用到看不见的条目
      useEffect(() => {
        setSelected([]);
        setCursor(-1);
      }, [view, historyTab, focus?.kind, focus?.key, query]);

      const refreshAll = useCallback(async () => {
        await reload?.();
        await loadCandidates();
        await loadStats();
      }, [reload, loadCandidates, loadStats]);

      // ── 稍后（论文级）─────────────────────────────────────────
      const snoozePaper = async (id, payload) => {
        try {
          await postJson(R.snooze, { id, ...payload });
          setMsg({
            kind: 'success',
            text: payload.clear ? '已恢复到队列' : `已稍后 ${payload.days} 天`,
          });
        } catch (e) {
          setMsg({ kind: 'error', text: String(e?.message || e) });
        }
        await refreshAll();
      };

      const priorityPaper = async (paper, value) => {
        try {
          await postJson(R.priority, { id: paper.id, value });
          setMsg({ kind: 'success', text: value ? '已标为优先读' : '已取消优先' });
        } catch (e) {
          setMsg({ kind: 'error', text: String(e?.message || e) });
        }
        await refreshAll();
      };

      const toggleSelected = (id) => setSelected((prev) => (prev.includes(id)
        ? prev.filter((item) => item !== id)
        : [...prev, id]));

      const openCandidate = (candidate) => {
        // 已提升的候选与论文同 id，直接开抽屉；未提升的候选没有论文记录，改开只读详情
        if (typeof openPaper === 'function' && (paperIds.has(candidate.id) || ['admitted', 'promoted'].includes(candidate.status))) {
          openPaper(candidate.id);
        } else {
          setPreview(candidate);
        }
      };

      const candidateAction = async (id, action) => {
        try {
          await postJson(R.candidateAction, { id, action });
          setMsg({ kind: 'success', text: action === 'drop' ? '已丢弃 1 条候选' : '已重新排队 1 条候选' });
        } catch (e) {
          setMsg({ kind: 'error', text: String(e?.message || e) });
        }
        await refreshAll();
      };

      /** 「加入初筛」：候选 → 论文（服务端 promote），成功与失败都留回执。 */
      /** 补全摘要：候选在 refetch 路由里按候选处理，成功后刷新列表 */
      const refetchCandidate = async (id) => {
        setMsg(null);
        try {
          const r = await postJson(R.refetch, { id });
          setMsg({
            kind: r.has_abstract ? 'success' : 'warn',
            text: r.has_abstract
              ? `已补全摘要（来源 ${r.via || '未知'}）`
              : `仍未取到摘要：${r.reason === 'no-abstract' ? '来源没有摘要' : (r.reason || '未知原因')}`,
          });
        } catch (e) {
          setMsg({ kind: 'error', text: String(e?.message || e) });
        }
        await refreshAll();
      };

      const promoteCandidate = async (candidate) => {
        const id = typeof candidate === 'string' ? candidate : candidate?.id;
        const title = typeof candidate === 'object' ? candidate?.title : '';
        if (!id) return;
        try {
          await postJson(R.promote, { id });
          setMsg({ kind: 'success', text: `已加入初筛${title ? `：${title}` : ''}` });
        } catch (e) {
          setMsg({ kind: 'error', text: `加入初筛失败：${e?.message || e}` });
        }
        await refreshAll();
      };

      const uploadPdf = async (id, file) => {
        const form = new FormData();
        form.append('file', file);
        form.append('paperId', id);
        try {
          const data = await api(R.upload, { method: 'POST', body: form });
          setMsg({ kind: 'success', text: `已补 PDF：${id}${data.paper?.text_error ? '（文本待重试）' : ''}` });
          await refreshAll();
        } catch (e) {
          setMsg({ kind: 'error', text: String(e?.message || e) });
        }
      };

      /** 逐条执行并显示 i/n 进度；失败逐条收集，不吞错。 */
      const runSequential = async (ids, label, titleOf, worker) => {
        setMsg(null);
        setBatch({ total: ids.length, done: 0, label });
        const failed = [];
        for (let i = 0; i < ids.length; i += 1) {
          const id = ids[i];
          try {
            await worker(id);
          } catch (e) {
            failed.push({ id, text: `${titleOf(id)}：${e?.message || e}` });
          }
          setBatch({ total: ids.length, done: i + 1, label });
        }
        setBatch(null);
        return failed;
      };

      const batchCandidates = async (action) => {
        const ids = [...selected];
        if (!ids.length) return;
        const label = action === 'drop' ? '丢弃' : '重跑';
        const titleOf = (id) => (listedCandidates.find((c) => c.id === id) || {}).title || id;
        const failed = await runSequential(ids, label, titleOf, (id) => postJson(R.candidateAction, { id, action }));
        setSelected([]);
        setMsg(failed.length
          ? { kind: 'error', text: `${ids.length - failed.length} 条${label}成功，${failed.length} 条失败`, failed: failed.map((item) => item.text) }
          : { kind: 'success', text: `${ids.length} 条已${label}` });
        await refreshAll();
      };

      /** 批量加入初筛：逐条 promote，失败逐条列出，不把失败吞成成功。 */
      const batchPromote = async () => {
        if (batch) return;
        const targets = selectedCandidates.filter((c) => !['admitted', 'promoted', 'dropped'].includes(c.status));
        if (!targets.length) return;
        const titleOf = (id) => (targets.find((c) => c.id === id) || {}).title || id;
        const failed = await runSequential(targets.map((c) => c.id), '加入初筛', titleOf,
          (id) => postJson(R.promote, { id }));
        setSelected([]);
        setMsg(failed.length
          ? { kind: 'error', text: `${targets.length - failed.length} 条已加入初筛，${failed.length} 条失败`, failed: failed.map((item) => item.text) }
          : { kind: 'success', text: `${targets.length} 条已加入初筛` });
        await refreshAll();
      };

      const runAnalyze = async (ids) => {
        if (jobBusy) return;
        const targets = Array.isArray(ids) ? ids.filter(Boolean) : [];
        setAnalyzing(true);
        setMsg(null);
        const out = await runJob({
          start: () => postJson(R.analyze, targets.length
            ? { ids: targets, limit: Math.min(50, targets.length) }
            : { limit: 10, sort }),
          maxTicks: 40,
          format: (r) => `判读完成：提升 ${r.admitted || 0} · 待确认 ${r.parked || 0} · 丢弃 ${r.dropped || 0} · 失败 ${r.failed || 0}`,
        });
        if (out) setMsg({ kind: out.kind, text: out.text });
        setAnalyzing(false);
        setSelected([]);
        await refreshAll();
      };

      const runStage = async (stage, ids, extraFailed) => {
        if (jobBusy) return;
        const targets = Array.isArray(ids) ? ids.filter(Boolean) : [];
        setStageRun(stage);
        setMsg(null);
        const out = await runJob({
          start: () => postJson(R.analyze, targets.length
            ? { stage, ids: targets, limit: Math.min(50, targets.length) }
            : { stage, limit: stage === 'L2' ? 10 : 5 }),
          maxTicks: stage === 'L3' ? 90 : 60,
          format: (r) => {
            const name = stage === 'L2' ? '初筛' : stage === 'L3' ? '精读' : '判读';
            if (!r.requested) {
              const reason = r.quota && Number(r.quota.remaining) === 0 ? '今日额度已用完' : '没有可处理条目';
              return `${name}未运行：${reason}`;
            }
            if (stage === 'L2') {
              return `初筛完成：建议精读 ${r.closeRead || 0} · 建议粗读 ${r.skim || 0} · 建议跳过 ${r.skip || 0} · 待 PDF ${r.needsPdf || 0} · 失败 ${r.failed || 0}`;
            }
            if (stage === 'L3') {
              return `精读完成：读完 ${r.done || 0} · 待确认 ${r.parked || 0} · Zotero ${r.zotero || 0} · 失败 ${r.failed || 0}`;
            }
            return `摘要判断完成：提升 ${r.admitted || 0} · 待确认 ${r.parked || 0} · 丢弃 ${r.dropped || 0} · 失败 ${r.failed || 0}`;
          },
        });
        if (out) {
          setMsg({ kind: out.kind, text: out.text, failed: extraFailed?.length ? extraFailed.map((item) => item.text) : null });
        } else if (extraFailed?.length) {
          setMsg({ kind: 'error', text: '任务未启动', failed: extraFailed.map((item) => item.text) });
        }
        setStageRun(null);
        setSelected([]);
        await refreshAll();
      };

      /** 某一档今天还剩多少：与服务端 remainingQuota 一致，limit 为 0 表示这一级不做。 */
      const quotaLeft = (key) => {
        if (!analysisStats) return 99;
        const limit = Number(analysisStats?.limits?.[key]) || 0;
        const used = Number(analysisStats?.usage?.[key]) || 0;
        return limit > 0 ? Math.max(0, limit - used) : 0;
      };

      /** 推进阶段（不进改判，不冻结 AI）：用于论文 L1 → 进入初筛。 */
      const advancePaperStage = async (id, stage) => {
        setMsg(null);
        try {
          await postJson(R.paperStage, { id, stage });
          setMsg({ kind: 'success', text: `已进入${STAGE_NAME[stage] || stage}` });
        } catch (e) {
          setMsg({ kind: 'error', text: String(e?.message || e) });
        }
        await refreshAll();
      };

      const downloadOpen = async () => {
        if (downloadBusy) return;
        const pdfLimit = Number(analysisStats?.limits?.pdf) || 0;
        const pdfUsed = Number(analysisStats?.usage?.pdf) || 0;
        const remaining = pdfLimit > 0 ? Math.max(0, pdfLimit - pdfUsed) : 20;
        if (remaining <= 0) {
          setMsg({ kind: 'warn', text: '原文下载额度已用完，明天继续，或手动补 PDF' });
          return;
        }
        setDownloadBusy(true);
        setMsg(null);
        try {
          // 一次用满当日剩余额度，不再每点一次只试 3 篇
          const r = await postJson(R.download, { limit: remaining });
          const results = r.results || [];
          const okCount = results.filter((item) => item.ok).length;
          setMsg({
            kind: okCount ? 'success' : 'warn',
            text: `下载原文：${okCount}/${results.length} 篇成功${r.quota ? `（今日 ${r.quota.used}/${r.quota.max}）` : ''}`,
          });
          await refreshAll();
        } catch (e) {
          setMsg({ kind: 'error', text: String(e?.message || e) });
        } finally { setDownloadBusy(false); }
      };

      const needle = query.trim().toLowerCase();
      // 搜索只影响两个框与历史的可见行，不影响概况表
      const textMatch = (item) => !needle
        || `${item.title || ''} ${item.abstract || ''} ${item.doi || ''} ${item.arxiv_id || ''} ${item.venue || ''}`
          .toLowerCase().includes(needle);

      const allEntries = [
        ...(candidates?.items || []).map((item) => classifyQueueEntry({ kind: 'candidate', item }, nowTs)),
        ...loadedPapers.map((item) => classifyQueueEntry({ kind: 'paper', item }, nowTs)),
      ].filter(Boolean);

      // 概况表永远按全量（summary + counts），搜索与焦点都不改它
      const board = pipelineBoard({
        papers: loadedPapers,
        candidates: candidates?.items || [],
        summary: state?.summary || {},
        stats: analysisStats,
        schedule: config?.schedule,
        now: nowTs,
      });
      const auto = config?.analysis?.auto !== false;

      const focusLabel = focus
        ? focus.kind === 'ai'
          ? 'AI 队列'
          : focus.kind === 'group'
            ? (BOARD_GROUPS.find((group) => group.key === focus.key)?.label || focus.key)
            : (BOARD_ROWS.find((row) => row.key === focus.key)?.label || focus.key)
        : null;
      const visibleEntries = allEntries.filter((entry) => {
        if (!textMatch(entry.item)) return false;
        if (!focus) return true;
        if (focus.kind === 'ai') return entry.side === 'ai';
        return focus.kind === 'group' ? entry.group === focus.key : entry.row === focus.key;
      });

      const humanEntries = sortHumanEntries(visibleEntries.filter((entry) => entry.side === 'human'));
      const aiEntries = sortAiEntries(visibleEntries.filter((entry) => entry.side === 'ai'), {
        sort,
        runningIds: runningTargets,
        runningPhases,
      });

      const HUMAN_PAGE = 6;
      const AI_PAGE = 4;
      const groupList = BOARD_GROUPS
        .map((group) => ({ ...group, rows: humanEntries.filter((entry) => entry.group === group.key) }))
        .filter((group) => group.rows.length);
      const aiShown = expandedAi ? aiEntries : aiEntries.slice(0, AI_PAGE);

      const humanSummary = groupList.map((group) => `${group.label} ${group.rows.length}`).join(' · ');

      // 历史：暂停/已完成/已排除用已加载论文；被过滤或被拥有按标签单独拉候选
      const historyCounts = {
        paused: Number(board?.paused) || 0,
        done: Number(state?.summary?.stages?.done) || 0,
        dropped: (Number(state?.summary?.stages?.dropped) || 0) + (Number(state?.summary?.counts?.dropped) || 0),
        noise: (Number(state?.summary?.counts?.filtered) || 0)
          + (Number(state?.summary?.counts?.excluded) || 0)
          + (Number(state?.summary?.counts?.owned) || 0),
      };
      const historyLists = {
        paused: snoozedPapers,
        done: loadedPapers.filter((p) => p.stage === 'done'),
        dropped: [
          ...loadedPapers.filter((p) => p.stage === 'dropped'),
          ...(historyTab === 'dropped' ? historyCandidates.items : []),
        ],
        noise: historyCandidates.items,
      };

      // 历史里候选不是主视图的一部分：按标签现场拉，避免主视图多背 4 个请求
      const historyCandidateStatuses = {
        noise: ['filtered', 'excluded', 'owned'],
        dropped: ['dropped'],
      }[historyTab] || [];
      useEffect(() => {
        if (view !== 'history' || !historyCandidateStatuses.length) return undefined;
        let alive = true;
        setHistoryCandidates((prev) => ({ ...prev, loading: true, error: null }));
        (async () => {
          try {
            const pages = await Promise.all(historyCandidateStatuses.map((status) => api(
              `${R.candidates}?status=${encodeURIComponent(status)}&limit=${historyLimit}&offset=0`,
            )));
            if (!alive) return;
            setHistoryCandidates({ items: pages.flatMap((page) => page.items || []), loading: false, error: null });
          } catch (error) {
            if (alive) setHistoryCandidates({ items: [], loading: false, error: String(error?.message || error) });
          }
        })();
        return () => { alive = false; };
      }, [view, historyTab, historyLimit, refreshTick]);

      // ── 行内动作 ─────────────────────────────────────────────
      const [overrideTarget, setOverrideTarget] = useState(null);

      /** 改判（改等级/阶段）：成功给回执，失败如实报，然后重拉队列。 */
      const overrideNow = async (id, patch) => {
        try {
          await onOverride?.(id, patch);
          setMsg({ kind: 'success', text: `已改判：等级 ${patch?.grade || '不变'} · 阶段 ${STAGE_NAME[patch?.stage] || '不变'}` });
        } catch (error) {
          setMsg({ kind: 'error', text: `改判失败：${String(error?.message || error)}` });
        }
        await refreshAll();
      };

      const metaOf = (entry) => {
        const item = entry.item;
        const parts = [];
        if (entry.kind === 'candidate') {
          if (item.year) parts.push(String(item.year));
          if (item.venue) parts.push(String(item.venue));
          if (item.abstract_source === 'snippet') parts.push('摘要片段');
          if (item.t0?.score) parts.push(`兴趣 ${Math.round(Number(item.t0.score))}`);
        } else {
          if (item.year) parts.push(String(item.year));
          if (item.venue) parts.push(String(item.venue));
          if (item.venue_tier?.label) parts.push(item.venue_tier.label);
          // AI 行没有本地 PDF 时写「待取原文」：系统会先自己下载，
          // 只有下载失败/额度用完才会打 needs_pdf 标记并转进人工框
          if (entry.side === 'ai') parts.push(item.has_pdf ? '有原文' : '待取原文');
        }
        return parts.join(' · ');
      };

      const hasHomePage = (item) => Boolean(homePageUrl(item));

      const rowMenu = (entry) => {
        const { kind, item, group } = entry;
        const items = [];
        if (typeof onOpenUrl === 'function' && hasHomePage(item)) {
          items.push({ key: 'page', label: '打开网页读摘要', onClick: () => onOpenUrl(item.id) });
        }
        if (kind === 'candidate') {
          items.push({ key: 'open', label: '打开详情', onClick: () => openCandidate(item) });
          if (group !== 'failed' && typeof runAnalyze === 'function') {
            items.push({ key: 'judge', label: '重新判读', onClick: () => runAnalyze([item.id]) });
          }
          if (['parked', 'failed'].includes(item.status) && typeof promoteCandidate === 'function') {
            items.push({ key: 'promote', label: '加入初筛', onClick: () => promoteCandidate(item) });
          }
          items.push({ key: 'drop', label: '丢弃', onClick: () => candidateAction(item.id, 'drop') });
        } else {
          items.push({ key: 'open', label: '打开详情', onClick: () => openPaper?.(item.id) });
          items.push({
            key: 'priority',
            label: item.priority === 'next' ? '取消优先读' : '优先读',
            active: item.priority === 'next',
            onClick: () => priorityPaper(item, item.priority === 'next' ? null : 'next'),
          });
          for (const option of SNOOZE_OPTIONS) {
            items.push({ key: `snooze-${option.days}`, label: `暂停 ${option.label}`, onClick: () => snoozePaper(item.id, { days: option.days }) });
          }
          if (['L2', 'L3'].includes(item.stage)) {
            items.push({ key: 'run-now', label: '现在处理这一篇', onClick: () => runStage(item.stage, [item.id]) });
          }
          items.push({ key: 'override', label: '改判 / 重新评级', onClick: () => setOverrideTarget(item) });
          if (['L2', 'L3'].includes(item.stage) && typeof onRerun === 'function') {
            items.push({ key: 'rerun', label: '重跑这一层', onClick: () => onRerun(item.id, item.stage) });
          }
        }
        return items;
      };

      const primaryRun = (entry) => {
        const { kind, item, group } = entry;
        if (kind === 'candidate') {
          if (group === 'material') return refetchCandidate(item.id);
          if (group === 'failed') return runAnalyze([item.id]);
          if (group === 'confirm') return promoteCandidate(item);
          return null;
        }
        if (group === 'failed') return runStage(item.stage, [item.id]);
        if (group === 'lowconf') { setOverrideTarget(item); return null; }
        if (group === 'legacy') return advancePaperStage(item.id, 'L2');
        return null;
      };

      const primaryButton = (entry) => {
        if (entry.kind === 'paper' && entry.group === 'material') {
          return h(PipelinePdfButton, {
            paperId: entry.item.id,
            onUpload: uploadPdf,
            label: (entry.item.review_flags || []).includes('pdf_error') ? '更换 PDF' : '补 PDF',
          });
        }
        if (!entry.primary) return null;
        return h(Button, { size: 'sm', primary: true, onClick: () => primaryRun(entry) }, entry.primary);
      };

      const humanRow = (entry) => {
        const item = entry.item;
        const menu = rowMenu(entry);
        return h('div', {
          key: `${entry.kind}-${item.id}`,
          style: { ...PIPELINE_ROW, gap: T.space.sm, alignItems: 'flex-start' },
        },
          h('div', { style: { display: 'flex', alignItems: 'flex-start', gap: T.space.xs, flexShrink: 0 } },
            h('input', {
              type: 'checkbox',
              checked: selected.includes(item.id),
              style: { marginTop: 4 },
              'aria-label': `选择 ${item.title || item.id}`,
              onChange: () => toggleSelected(item.id),
            }),
            // 候选等级是「最近一次判读」的快照；补摘要成功会清空 analysis，不会留下过期等级
            h('span', { style: { display: 'inline-flex', width: 22 } }, h(GradeBadge, { grade: entry.kind === 'candidate' ? item.analysis?.grade : item.grade }))),
          h('div', { style: { flex: '1 1 240px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: T.space.micro } },
            h('div', {
              role: 'button',
              tabIndex: 0,
              onClick: () => (entry.kind === 'candidate' ? openCandidate(item) : openPaper?.(item.id)),
              onKeyDown: (e) => { if (e.key === 'Enter') { e.preventDefault(); if (entry.kind === 'candidate') openCandidate(item); else openPaper?.(item.id); } },
              style: { ...QUEUE_TITLE, cursor: 'pointer' },
            }, item.title || '(无题名)'),
            h('div', { style: { display: 'flex', gap: 6, flexWrap: 'wrap' } },
              entry.group
                ? h(Chip, null, BOARD_GROUPS.find((g) => g.key === entry.group)?.label || '')
                : null,
              entry.kind === 'paper' && !item.has_pdf ? h(Chip, { tone: C.warn }, '缺原文') : null),
            entry.reason ? h('div', { style: QUEUE_WHY, title: entry.reason }, entry.reason) : null,
            h('div', { style: QUEUE_META }, metaOf(entry))),
          h('div', { style: ROW_ACTIONS },
            h('span', { style: ROW_PRIMARY }, primaryButton(entry)),
            entry.group === 'material' && typeof onOpenUrl === 'function' && hasHomePage(item)
              ? h(Button, { size: 'sm', onClick: () => onOpenUrl(item.id) }, '打开网页')
              : null,
            menu.length ? h(Menu, { label: '⋯', items: menu }) : null));
      };

      const aiRow = (entry) => {
        const item = entry.item;
        const label = entry.kind === 'candidate'
          ? (item.status === 'analyzing' ? '判读中' : '待判读')
          : (entry.row === 'l2' ? '待初筛' : '待精读');
        // 真正在跑的那条显示服务端上报的阶段；已派单但还没轮到显示「排队等待中」
        const livePhase = runningPhases[item.id]
          || (runningTargets.includes(item.id) ? '排队等待中' : null);
        return h('div', { key: `${entry.kind}-${item.id}`, style: { ...PIPELINE_ROW, alignItems: 'center' } },
          h('div', { style: { display: 'flex', gap: 6, alignItems: 'center', flexShrink: 0 } },
            item.priority === 'next' ? h(Chip, { tone: C.accent }, '优先读') : null,
            h(Chip, livePhase ? { tone: C.accent } : null, livePhase || label)),
          h('div', {
            role: 'button',
            tabIndex: 0,
            onClick: () => (entry.kind === 'candidate' ? openCandidate(item) : openPaper?.(item.id)),
            style: { flex: '1 1 240px', minWidth: 0, ...QUEUE_TITLE, fontSize: fs(13.5), fontWeight: 500, cursor: 'pointer' },
          }, item.title || '(无题名)'),
          h('div', { style: { ...QUEUE_META, flexShrink: 0 } }, metaOf(entry)),
          h(Menu, { label: '⋯', items: rowMenu(entry) }));
      };

      const historyMenu = (tab, item) => {
        if (tab !== 'done' || !item.stage) return null;
        const items = [
          { key: 'override', label: '改判 / 重新评级', onClick: () => setOverrideTarget(item) },
        ];
        if (!item.l3) {
          items.push({ key: 'to-l3', label: '转入精读', onClick: () => overrideNow(item.id, { stage: 'L3', reason: '人工转入精读' }) });
        }
        if (typeof onRerun === 'function') {
          items.push(item.l3
            ? { key: 'rerun-l3', label: '重跑精读', onClick: () => onRerun(item.id, 'L3') }
            : { key: 'rerun-l2', label: '重跑初筛', onClick: () => onRerun(item.id, 'L2') });
        }
        return h(Menu, { label: '⋯', items });
      };

      const historyRow = (tab, item) => {
        const isPaper = Boolean(item.stage);
        const status = tab === 'paused' ? '暂停中'
          : tab === 'done' ? '已完成'
            : tab === 'dropped' ? '已排除'
              : (isPaper ? '已排除' : '已过滤');
        const grade = isPaper ? item.grade : item.analysis?.grade;
        // 已完成分两种：出过精读卡片的才是精读完成，只走初筛判为粗读/跳过的是略读完成
        const statusLabel = tab === 'done' ? (item.l3 ? '精读完成' : '略读完成') : status;
        const verdictLabel = tab === 'done' && item.l2?.verdict
          ? (VERDICT_LABEL[item.l2.verdict] || item.l2.verdict)
          : null;
        const basisLabel = tab === 'done' && isPaper && item.grade_basis
          ? `依据 ${BASIS_LABEL[item.grade_basis] || item.grade_basis}`
          : null;
        const action = tab === 'paused'
          ? { label: '取消暂停', run: () => snoozePaper(item.id, { clear: true }) }
          : tab === 'done'
            ? { label: '打开详情', run: () => openPaper?.(item.id) }
            : tab === 'dropped'
              ? { label: '恢复', run: () => onOverride?.(item.id, { stage: 'L2', reason: '从「已排除」恢复' }) }
              : isPaper
                ? { label: '打开详情', run: () => openPaper?.(item.id) }
                : { label: '重新排队', run: () => candidateAction(item.id, 'rerun') };
        return h('div', { key: `${tab}-${item.id}`, style: PIPELINE_ROW },
          h('div', { style: { display: 'flex', alignItems: 'flex-start', gap: T.space.xs, flexShrink: 0 } },
            h('span', { style: { display: 'inline-flex', width: 22 } }, h(GradeBadge, { grade }))),
          h('div', { style: { flex: '1 1 240px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: T.space.micro } },
            h('div', { style: { ...QUEUE_TITLE, fontSize: fs(13.5), fontWeight: 500 } }, item.title || '(无题名)'),
            h('div', { style: { display: 'flex', gap: 6, flexWrap: 'wrap' } },
              h(Chip, null, statusLabel),
              verdictLabel ? h(Chip, null, verdictLabel) : null),
            h('div', { style: QUEUE_META }, [item.year, item.venue, basisLabel].filter(Boolean).join(' · '))),
          h('div', { style: ROW_ACTIONS },
            h('span', { style: ROW_PRIMARY }, h(Button, { size: 'sm', onClick: action.run }, action.label)),
            historyMenu(tab, item)));
      };

      // ── 键盘：人工框可见行 → AI 框可见行 ────────────────────
      const keyboardEntries = [...groupList.flatMap((group) => (expandedHuman.has(group.key) ? group.rows : group.rows.slice(0, HUMAN_PAGE))), ...aiShown];
      useEffect(() => {
        if (typeof document === 'undefined' || !document.addEventListener) return undefined;
        const onKey = (event) => {
          if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
          const tag = event.target?.tagName;
          if (tag === 'INPUT' || tag === 'TEXTAREA' || event.target?.isContentEditable) return;
          if (event.key === 'j' || event.key === 'k') {
            event.preventDefault();
            setCursor((prev) => {
              const next = event.key === 'j' ? prev + 1 : prev - 1;
              return Math.max(0, Math.min(keyboardEntries.length - 1, next));
            });
            return;
          }
          if (event.key === 'Enter' && cursor >= 0 && keyboardEntries[cursor]) {
            event.preventDefault();
            const entry = keyboardEntries[cursor];
            if (entry.kind === 'candidate') openCandidate(entry.item);
            else openPaper?.(entry.item.id);
            return;
          }
          if (event.key === '/') {
            const input = document.getElementById?.('litlab-pipeline-search');
            if (input && typeof input.focus === 'function') { event.preventDefault(); input.focus(); }
          }
        };
        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
      }, [keyboardEntries.length, cursor]);

      // ── 批量：只作用于人工框 ─────────────────────────────────
      const selectedEntries = humanEntries.filter((entry) => selected.includes(entry.item.id));
      const selectedCandidates = selectedEntries.filter((entry) => entry.kind === 'candidate').map((entry) => entry.item);
      const selectedPapers = selectedEntries.filter((entry) => entry.kind === 'paper').map((entry) => entry.item);
      const jobBusy = analyzing || Boolean(stageRun);

      const batchPapersRerun = async () => {
        if (!selectedPapers.length || jobBusy) return;
        const papers = [...selectedPapers];
        const titleOf = (id) => (papers.find((p) => p.id === id) || {}).title || id;
        const failed = await runSequential(papers.map((p) => p.id), '重跑', titleOf,
          (id) => postJson(R.paperOverride, { id, reset: true }));
        const failedIds = new Set(failed.map((item) => item.id));
        const okList = papers.filter((p) => !failedIds.has(p.id));
        setSelected([]);
        if (!okList.length) {
          setMsg({ kind: 'error', text: `${papers.length} 条重跑失败`, failed: failed.map((item) => item.text) });
          await refreshAll();
          return;
        }
        const stages = [...new Set(okList.map((p) => p.stage))];
        for (const stage of stages) {
          await runStage(stage, okList.filter((p) => p.stage === stage).map((p) => p.id), failed);
        }
      };

      const batchPapersSnooze = async (payload) => {
        if (!selectedPapers.length || batch) return;
        const papers = [...selectedPapers];
        const titleOf = (id) => (papers.find((p) => p.id === id) || {}).title || id;
        const label = payload.clear ? '恢复' : `暂停 ${payload.days} 天`;
        const failed = await runSequential(papers.map((p) => p.id), label, titleOf,
          (id) => postJson(R.snooze, { id, ...payload }));
        const okCount = papers.length - failed.length;
        setSelected([]);
        setMsg(failed.length
          ? { kind: 'error', text: `${okCount} 篇${label}成功，${failed.length} 篇失败`, failed: failed.map((item) => item.text) }
          : { kind: 'success', text: `已${label}：${okCount} 篇` });
        await refreshAll();
      };

      const batchActions = [
        selectedCandidates.length
          ? h(Button, {
            key: 'promote', size: 'sm', primary: true, disabled: Boolean(batch), onClick: batchPromote,
          }, '加入初筛')
          : null,
        selectedCandidates.length
          ? h(Button, { key: 'analyze', size: 'sm', disabled: jobBusy || Boolean(batch), onClick: () => runAnalyze(selectedCandidates.map((c) => c.id)) }, '重试判读')
          : null,
        selectedPapers.some((paper) => Boolean(paper.snooze))
          ? h(Button, {
            key: 'unsnooze',
            size: 'sm',
            disabled: Boolean(batch),
            onClick: () => batchPapersSnooze({ clear: true }),
          }, '恢复')
          : null,
        selectedPapers.length
          ? h('div', { key: 'snooze', style: { display: 'flex', gap: T.space.xs, alignItems: 'center', flexWrap: 'wrap' } },
            h('span', { style: { fontSize: fs(T.font.hint), color: C.caption } }, '暂停'),
            SNOOZE_OPTIONS.map((option) => h(Button, {
              key: `snooze-${option.days}`,
              size: 'sm',
              disabled: Boolean(batch),
              onClick: () => batchPapersSnooze({ days: option.days }),
            }, option.label)))
          : null,
        selectedCandidates.length
          ? h(Button, { key: 'drop', size: 'sm', danger: true, disabled: Boolean(batch), onClick: () => setConfirmDrop(true) }, '丢弃')
          : null,
        selectedCandidates.length
          ? h(Button, {
            key: 'cand-rerun',
            size: 'sm',
            disabled: Boolean(batch),
            onClick: () => setConfirmRerun({ kind: 'candidate', count: selectedCandidates.length }),
          }, '重跑候选')
          : null,
        selectedPapers.length
          ? h(Button, { key: 'rerun', size: 'sm', disabled: jobBusy || Boolean(batch), onClick: () => setConfirmRerun({ kind: 'paper', count: selectedPapers.length }) }, '重跑')
          : null,
        h(Button, { key: 'clear', size: 'sm', onClick: () => setSelected([]) }, '清空'),
      ].filter(Boolean);

      const selectionBar = selected.length
        ? h('div', {
          style: {
            position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 900,
            display: 'flex', justifyContent: 'center', pointerEvents: 'none',
          },
        },
          h('div', {
            style: {
              pointerEvents: 'auto',
              margin: `0 ${T.space.lg}px ${T.space.lg}px`,
              width: '100%', maxWidth: 1100,
              display: 'flex', gap: T.space.sm, alignItems: 'center', flexWrap: 'wrap',
              background: C.bg2, border: `1px solid ${C.border2}`, borderRadius: T.radius.md,
              padding: `${T.space.sm}px ${T.space.md}px`, boxShadow: '0 8px 28px rgba(0,0,0,.24)',
            },
          },
            h('div', { style: { fontSize: fs(T.font.hint), color: C.label2, marginRight: T.space.xs } },
              batch ? `处理中 ${batch.done}/${batch.total}（${batch.label}）…` : `已选 ${selected.length} 条 · 需要人处理`),
            h('div', { style: { display: 'flex', gap: T.space.xs, marginLeft: 'auto', flexWrap: 'wrap' } }, batchActions)))
        : null;

      // ── 两个框 ───────────────────────────────────────────────
      const humanEmpty = h('div', {
        style: {
          marginTop: T.space.sm, border: `1px dashed ${C.border2}`, borderRadius: T.radius.sm,
          padding: '18px 12px', textAlign: 'center',
        },
      },
        h('div', { style: { fontSize: fs(13.5), fontWeight: 600, color: C.label1 } }, '没有需要人处理的条目'),
        h('div', { style: { fontSize: fs(12.5), color: C.caption, marginTop: 4 } },
          needle || focus ? '当前筛选下没有需要人处理的条目。' : '待确认、缺原文、低置信与判读失败的条目会出现在这里。'));

      const humanCard = h(Card, {
        id: 'queue-human',
        style: { marginBottom: T.space.md, boxShadow: `inset 3px 0 0 ${C.warn}`, borderColor: C.border2 },
      },
        h('div', { style: { display: 'flex', alignItems: 'center', gap: T.space.xs, flexWrap: 'wrap' } },
          h('span', { style: { fontSize: fs(16), fontWeight: 600 } }, '需要人处理'),
          h('span', { style: { fontSize: fs(11.5), color: C.warn, background: C.bg2, borderRadius: 999, padding: '0 7px' } }, String(humanEntries.length)),
          humanSummary ? h('span', { style: { fontSize: fs(12.5), color: C.label2 } }, humanSummary) : null,
          humanEntries.length
            ? h('span', { style: { marginLeft: 'auto' } },
              h(Button, {
                size: 'sm',
                onClick: () => setSelected(selected.length === humanEntries.length ? [] : humanEntries.map((entry) => entry.item.id)),
              }, selected.length === humanEntries.length ? '取消全选' : `全选 ${humanEntries.length} 条`))
            : null),
        groupList.length
          ? groupList.map((group) => h('div', { key: group.key },
            h('div', { style: { display: 'flex', alignItems: 'center', gap: T.space.xs, padding: '8px 0 4px' } },
              h('span', { style: { fontSize: fs(12.5), fontWeight: 600, color: C.label2 } }, group.label),
              h('span', { style: { fontSize: fs(11.5), color: C.label2, background: C.bg2, borderRadius: 999, padding: '0 7px' } }, String(group.rows.length)),
              h('span', { style: { fontSize: fs(12), color: C.caption, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, group.note),
              group.key === 'material' ? h('span', { style: { marginLeft: 'auto' } },
                h(Button, { size: 'sm', onClick: downloadOpen, disabled: downloadBusy }, downloadBusy ? '正在下载…' : `下载缺失原文（今日余 ${Math.max(0, (Number(analysisStats?.limits?.pdf) || 0) - (Number(analysisStats?.usage?.pdf) || 0))}）`)) : null),
            (expandedHuman.has(group.key) ? group.rows : group.rows.slice(0, HUMAN_PAGE)).map((entry) => humanRow(entry)),
            group.rows.length > HUMAN_PAGE
              ? h('div', { style: { textAlign: 'center', padding: '6px 0' } },
                h(Button, {
                  size: 'sm',
                  onClick: () => setExpandedHuman((prev) => {
                    const next = new Set(prev);
                    if (next.has(group.key)) next.delete(group.key); else next.add(group.key);
                    return next;
                  }),
                }, expandedHuman.has(group.key) ? '收起' : `展开其余 ${group.rows.length - HUMAN_PAGE} 条`))
              : null))
          : humanEmpty);

      const runMenu = h(Menu, {
        label: '⋯',
        items: [
          { key: 'new', label: `判读候选（${aiEntries.filter((entry) => entry.kind === 'candidate').length}）`, disabled: !aiEntries.some((entry) => entry.kind === 'candidate') || quotaLeft('l1') === 0, onClick: () => runStage('L1') },
          { key: 'l2', label: `初筛（${aiEntries.filter((entry) => entry.item?.stage === 'L2').length}）`, disabled: !aiEntries.some((entry) => entry.item?.stage === 'L2') || quotaLeft('l2') === 0, onClick: () => runStage('L2') },
          { key: 'l3', label: `精读（${aiEntries.filter((entry) => entry.item?.stage === 'L3').length}）`, disabled: !aiEntries.some((entry) => entry.item?.stage === 'L3') || quotaLeft('l3') === 0, onClick: () => runStage('L3') },
        ],
      });

      const aiEmpty = h('div', {
        style: {
          marginTop: T.space.sm, border: `1px dashed ${C.border2}`, borderRadius: T.radius.sm,
          padding: '18px 12px', textAlign: 'center',
        },
      },
        h('div', { style: { fontSize: fs(13.5), fontWeight: 600, color: C.label1 } },
          needle || focus ? '当前筛选下没有等待 AI 处理的条目' : config?.schedule?.enabled === false ? '自动处理已关闭' : 'AI 队列为空'),
        h('div', { style: { fontSize: fs(12.5), color: C.caption, marginTop: 4 } },
          needle || focus ? '清除搜索或焦点后再看。' : config?.schedule?.enabled === false
            ? '开启后每天自动运行；也可以立即运行当前队列。'
            : '新采集的条目在下一轮自动运行时进入这里。'),
        !needle && !focus && typeof navigate === 'function'
          ? h('div', { style: { marginTop: 8 } }, h(Button, { size: 'sm', onClick: () => navigate('sources') }, '去雷达采集'))
          : null);

      const aiCard = h(Card, {
        id: 'queue-ai',
        style: { marginBottom: T.space.md, boxShadow: `inset 3px 0 0 ${C.accent}` },
      },
        h('div', { style: { display: 'flex', alignItems: 'center', gap: T.space.xs, flexWrap: 'wrap' } },
          h('span', { style: { fontSize: fs(16), fontWeight: 600 } }, 'AI 队列'),
          h('span', { style: { fontSize: fs(11.5), color: C.label2, background: C.bg2, borderRadius: 999, padding: '0 7px' } }, String(aiEntries.length)),
          h('span', { style: { fontSize: fs(12.5), color: C.caption } },
            `待判读 ${aiEntries.filter((entry) => entry.row === 'new').length} · 待初筛 ${aiEntries.filter((entry) => entry.row === 'l2').length} · 待精读 ${aiEntries.filter((entry) => entry.row === 'l3').length} · 可处理优先，同档按${PIPELINE_SORTS.find((item) => item.id === sort)?.label || '兴趣分'}`),
          h('div', { style: { marginLeft: 'auto', display: 'flex', gap: T.space.xs, alignItems: 'center' } },
            h(Menu, {
              label: `排序：${PIPELINE_SORTS.find((item) => item.id === sort)?.label || '兴趣分'}`,
              items: PIPELINE_SORTS.map((item) => ({
                key: item.id, label: item.label, active: item.id === sort, onClick: () => setSort(item.id),
              })),
            }),
            h(Button, {
              size: 'sm',
              disabled: jobBusy || !aiEntries.length,
              onClick: async () => {
                const candidateIds = aiEntries.filter((entry) => entry.kind === 'candidate').map((entry) => entry.item.id);
                if (candidateIds.length) await runAnalyze(candidateIds);
                // 不传 ids：判读刚提升的论文在点击时还不存在，必须让服务端按最新状态取池
                await runStage('L2');
                await runStage('L3');
              },
            }, jobBusy ? '运行中…' : '运行 AI'),
            runMenu)),
        analyzing || stageRun
          ? h('div', { style: { fontSize: fs(12.5), color: C.label2, marginTop: 6 } },
            `运行中：${STAGE_NAME[stageRun] || '判读'} · 每档受今日额度限制`)
          : board?.rows?.some((row) => row.quota && row.quota.tone === 'error')
            ? h('div', { style: { fontSize: fs(12.5), color: C.label2, marginTop: 6 } }, '今日额度已用完，队列明天继续。')
            : null,
        aiShown.length
          ? aiShown.map((entry) => aiRow(entry))
          : aiEmpty,
        aiEntries.length > AI_PAGE
          ? h('div', { style: { textAlign: 'center', padding: '6px 0' } },
            h(Button, { size: 'sm', onClick: () => setExpandedAi((value) => !value) },
              expandedAi ? '收起' : `展开全部 ${aiEntries.length} 条`))
          : null);

      // ── 页脚：搜索 + 历史入口 ─────────────────────────────────
      const footBand = h('div', { style: { display: 'flex', alignItems: 'center', gap: T.space.sm, flexWrap: 'wrap', marginTop: T.space.sm } },
        h('div', { style: { width: 280, maxWidth: '100%' } }, h(TextInput, {
          value: queryDraft,
          placeholder: '搜索标题 / DOI / 摘要',
          onChange: setQueryDraft,
          label: '搜索候选与论文',
          inputId: 'litlab-pipeline-search',
        })),
        needle ? h(Button, { size: 'sm', onClick: () => { setQueryDraft(''); setQuery(''); } }, `搜索「${queryDraft.trim()}」 ×`) : null,
        focusLabel ? h(Button, { size: 'sm', onClick: () => setFocus(null) }, `只看：${focusLabel} ×`) : null,
        h('div', { style: { marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: T.space.xs } },
          h('span', { style: { fontSize: fs(12.5), color: C.caption } },
            `历史：暂停中 ${historyCounts.paused} · 已完成 ${historyCounts.done} · 已排除 ${historyCounts.dropped} · 被过滤或已拥有 ${historyCounts.noise}`),
          h(Button, {
            size: 'sm',
            onClick: () => { setView('history'); setHistoryTab('paused'); setFocus(null); setSelected([]); },
          }, '打开历史')));

      const historyTabs = [
        { key: 'paused', label: `暂停中 ${historyCounts.paused}` },
        { key: 'done', label: `已完成 ${historyCounts.done}` },
        { key: 'dropped', label: `已排除 ${historyCounts.dropped}` },
        { key: 'noise', label: `被过滤或已拥有 ${historyCounts.noise}` },
      ];
      const historyList = (historyLists[historyTab] || []).filter((item) => !needle || textMatch(item));

      const historyTotal = historyCounts[historyTab] || 0;
      const historyCanLoadMore = historyList.length < historyTotal;
      const loadMoreHistory = async () => {
        setHistoryLimit((value) => value + 60);
        await loadMore?.();
      };

      const historyEmptyText = {
        paused: '没有暂停中的论文',
        done: '还没有已完成的论文',
        dropped: '没有已排除的条目',
        noise: '没有被过滤或已拥有的条目',
      }[historyTab];

      const historyView = h('div', null,
        h('div', { style: { display: 'flex', alignItems: 'center', gap: T.space.sm, flexWrap: 'wrap' } },
          h(Button, { size: 'sm', onClick: () => goSeg('todo') }, '← 返回队列'),
          h('span', { style: { fontSize: fs(16), fontWeight: 600 } }, '历史'),
          h('span', { style: { fontSize: fs(12.5), color: C.caption } }, '只读浏览；恢复与取消暂停各自单列一个动作')),
        h('div', { style: { display: 'flex', gap: T.space.xs, flexWrap: 'wrap', marginTop: T.space.sm } },
          historyTabs.map((tab) => h(Button, {
            key: tab.key,
            size: 'sm',
            primary: historyTab === tab.key,
            onClick: () => { setHistoryTab(tab.key); setCursor(-1); },
          }, tab.label))),
        h('div', { style: { marginTop: T.space.sm } }, h(TextInput, {
          value: queryDraft,
          placeholder: '搜索标题 / DOI / 摘要',
          onChange: setQueryDraft,
          label: '搜索历史条目',
          inputId: 'litlab-pipeline-search',
        })),
        historyCandidates.error
          ? h(Notice, { kind: 'error' }, `历史条目读取失败：${historyCandidates.error}`)
          : null,
        h(Card, { style: { marginTop: T.space.sm, padding: `0 ${T.space.md}px` } },
          historyList.length
            ? historyList.map((item) => historyRow(historyTab, item))
            : h(EmptyState, {
              title: historyCandidates.loading && ['noise', 'dropped'].includes(historyTab) ? '正在读取历史条目…' : historyEmptyText,
              desc: historyTab === 'paused'
                ? '论文菜单里的暂停到期后会回到队列。'
                : historyTab === 'done'
                  ? '精读定级后会自动出现在这里。'
                  : historyTab === 'dropped'
                    ? '丢弃的候选与论文会留在这里，可随时恢复。'
                    : '被关键词过滤、命中排除词或已在库里的候选会留在这里。',
            }),
          historyCanLoadMore
            ? h('div', { style: { display: 'flex', alignItems: 'center', gap: T.space.sm, padding: '8px 0' } },
              h('span', { style: { fontSize: fs(12.5), color: C.caption } }, `已显示 ${historyList.length} / 共 ${historyTotal} 条`),
              h(Button, { size: 'sm', disabled: historyCandidates.loading, onClick: loadMoreHistory }, historyCandidates.loading ? '正在加载…' : '加载更多'))
            : h('div', { style: { fontSize: fs(12.5), color: C.caption, padding: '8px 0' } }, `已显示全部 ${historyList.length} 条`)));

      return h('div', { style: { paddingBottom: selected.length ? 112 : 0 } },
        view === 'history' ? historyView : h('div', null,
          h(QueueBoardCard, {
            board,
            auto,
            downloadBusy,
            onDownload: downloadOpen,
            onToggleAuto: () => saveConfig?.({ analysis: { ...(config?.analysis || {}), auto: !auto } }),
            onFocusRow: (key) => setFocus((prev) => (prev && prev.kind === 'row' && prev.key === key ? null : { kind: 'row', key })),
            onLoadMore: board.truncated
              ? async () => { setCandidateLimit((value) => value + CANDIDATE_PAGE); await loadMore?.(); }
              : null,
            loadMoreBusy: busy,
          }),
          (candidateError || statsError)
            ? h(Notice, { kind: 'error' }, `队列数据读取失败：${candidateError || statsError}`)
            : null,
          msg
            ? h(Notice, { kind: msg.kind },
              h('div', null, msg.text),
              msg.failed?.length
                ? h('details', { style: { marginTop: T.space.xs } },
                  h('summary', { style: { cursor: 'pointer' } }, `逐条失败 ${msg.failed.length} 条`),
                  msg.failed.map((line, index) => h('div', {
                    key: `${index}-${line}`,
                    style: { fontSize: fs(T.font.hint), lineHeight: T.line.body, overflowWrap: 'anywhere' },
                  }, line)))
                : null)
            : null,
          focus?.kind === 'ai' ? null : humanCard,
          aiCard,
          footBand),
        selectionBar,
        preview
          ? h(CandidatePreviewDialog, {
            candidate: preview,
            onClose: () => setPreview(null),
            onAnalyze: () => runAnalyze([preview.id]),
            onRerun: () => candidateAction(preview.id, 'rerun'),
            onDrop: () => candidateAction(preview.id, 'drop'),
            onPromote: ['parked', 'failed'].includes(preview.status)
              ? () => promoteCandidate(preview)
              : undefined,
          })
          : null,
        overrideTarget
          ? h(OverrideDialog, {
            paper: overrideTarget,
            onClose: () => setOverrideTarget(null),
            onSubmit: async (patch) => { await overrideNow(overrideTarget.id, patch); setOverrideTarget(null); },
          })
          : null,
        confirmDrop
          ? h(ConfirmDialog, {
            title: '批量排除',
            text: `将排除 ${selectedCandidates.length} 条待判读条目。排除后可在「历史 · 已排除」里找到并恢复。`,
            confirmLabel: '丢弃',
            onClose: () => setConfirmDrop(false),
            onConfirm: () => { setConfirmDrop(false); batchCandidates('drop'); },
          })
          : null,
        confirmRerun
          ? h(ConfirmDialog, {
            title: confirmRerun.kind === 'candidate' ? '重跑候选' : '重跑论文',
            text: confirmRerun.kind === 'candidate'
              ? `将重跑 ${confirmRerun.count} 条候选：重新调用模型判读，覆盖当前候选状态；已提升的论文不受影响。`
              : `将重跑 ${confirmRerun.count} 篇论文：会清除人工改判，并覆盖当前初筛与精读结论。`,
            confirmLabel: '重跑',
            onClose: () => setConfirmRerun(null),
            onConfirm: () => {
              const kind = confirmRerun.kind;
              setConfirmRerun(null);
              if (kind === 'candidate') batchCandidates('rerun');
              else batchPapersRerun();
            },
          })
          : null,
      );
    }
