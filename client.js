window.__ModuleLoader__.load({
  id: 'dsh-literature-lab',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const { useState, useEffect, useCallback } = React;

    const PLUGIN_ID = 'dsh-literature-lab';
    const RADAR_DEFAULT_ORDER = [
      'manual', 'arxiv', 'rss', 'search', 'email',
      'pubmed', 'dblp', 'preprint', 'harvest', 'logs',
    ];
    const RADAR_LABELS = {
      get manual() { return t('channel.manual', '手动添加论文'); },
      get arxiv() { return t('channel.arxiv', 'arXiv'); },
      get rss() { return t('channel.rss', 'RSS 订阅'); },
      get search() { return t('channel.search', '跨库检索'); },
      get email() { return t('channel.email', '邮件快讯'); },
      get pubmed() { return t('channel.pubmed', 'PubMed / Europe PMC'); },
      get dblp() { return t('channel.dblp', 'DBLP'); },
      get preprint() { return t('channel.preprint', 'bioRxiv / medRxiv'); },
      get harvest() { return t('channel.harvest', '历史回溯'); },
      get logs() { return t('channel.logs', '运行日志'); },
    };
    /** 候选来源 → 人话。认不出的 key 原样返回，不猜语义。 */
    const SOURCE_LABEL = {
      'scholar-alert': '邮件',
      email: '邮件',
      arxiv: 'arXiv',
      openalex: 'OpenAlex',
      crossref: 'Crossref',
      s2: 'Semantic Scholar',
      pubmed: 'PubMed',
      dblp: 'DBLP',
      manual: '手动',
      zotero: 'Zotero',
      rss: 'RSS',
      biorxiv: 'bioRxiv',
      medrxiv: 'medRxiv',
    };
    function sourceLabel(source) {
      if (!source) return '';
      const list = Array.isArray(source) ? source : [source];
      return list.map((key) => SOURCE_LABEL[key] || key).join(' / ');
    }

    const R = {
      state: '/api/dsh-literature-lab/state',
      config: '/api/dsh-literature-lab/config',
      discover: '/api/dsh-literature-lab/discover',
      suggest: '/api/dsh-literature-lab/zotero/suggest',
      credentials: '/api/dsh-literature-lab/credentials',
      accessTest: '/api/dsh-literature-lab/access/test',
      harvest: '/api/dsh-literature-lab/harvest',
      candidates: '/api/dsh-literature-lab/candidates',
      analyze: '/api/dsh-literature-lab/analyze',
      schedule: '/api/dsh-literature-lab/schedule',
      email: '/api/dsh-literature-lab/email',
      needDownload: '/api/dsh-literature-lab/need_download',
      download: '/api/dsh-literature-lab/download',
      add: '/api/dsh-literature-lab/add',
      upload: '/api/dsh-literature-lab/upload',
      candidateAction: '/api/dsh-literature-lab/candidates/action',
      promote: '/api/dsh-literature-lab/candidates/promote',
      candidatesRescore: '/api/dsh-literature-lab/candidates/rescore',
      paperOverride: '/api/dsh-literature-lab/paper/override',
      paperRead: '/api/dsh-literature-lab/paper/read',
      paperStage: '/api/dsh-literature-lab/paper/stage',
      paperRerun: '/api/dsh-literature-lab/paper/rerun',
      paperTranslate: '/api/dsh-literature-lab/paper/translate',
      openPdf: '/api/dsh-literature-lab/paper/open-pdf',
      openUrl: '/api/dsh-literature-lab/open-url',
      analysisStats: '/api/dsh-literature-lab/analysis/stats',
      analysisPrompts: '/api/dsh-literature-lab/analysis/prompts',
      jobs: '/api/dsh-literature-lab/jobs',
      jobsCancel: '/api/dsh-literature-lab/jobs/cancel',
      paper: '/api/dsh-literature-lab/paper',
      pdf: '/api/dsh-literature-lab/pdf',
      figure: '/api/dsh-literature-lab/figure',
      zoteroImport: '/api/dsh-literature-lab/zotero/import',
      refetch: '/api/dsh-literature-lab/refetch',
      llmModels: '/api/dsh-literature-lab/llm/models',
      digest: '/api/dsh-literature-lab/digest',
      snooze: '/api/dsh-literature-lab/snooze',
      priority: '/api/dsh-literature-lab/priority',
    };

    /** 候选状态：概览与待办共用同一份，避免两处口径不一致。 */
    const STATUS_TABS = [
      { id: 'new', get label() { return t('status.new', '待判读'); } },
      { id: 'parked', get label() { return t('status.parked', '待确认'); } },
      { id: 'admitted', get label() { return t('status.admitted', '已提升'); } },
      { id: 'dropped', get label() { return t('status.dropped', '已丢弃'); } },
      { id: 'filtered', get label() { return t('status.filtered', '过滤'); } },
      { id: 'owned', get label() { return t('status.owned', '已拥有'); } },
      { id: 'excluded', get label() { return t('status.excluded', '排除'); } },
      { id: 'failed', get label() { return t('status.failed', '失败'); } },
      { id: 'all', get label() { return t('status.all', '全部'); } },
    ];

    /** 三个处理阶段的人话名字：界面上不出现 L1/L2/L3。 */
    const STAGE_NAME = { L1: '看摘要', L2: '初筛', L3: '精读', done: '已完成', dropped: '已丢弃' };
    const STAGE_PENDING = { L1: '待看摘要', L2: '待初筛', L3: '待精读' };

    /** 内部枚举 → 人话。界面上不该出现 fulltext / close-read / confidence high 这种。 */
    const VERDICT_LABEL = {
      'close-read': '建议精读', skim: '建议粗读', skip: '建议跳过', hold: '暂缓，待复核',
      'needs-pdf': '缺原文', 'needs_pdf': '缺原文',
    };
    const CONFIDENCE_LABEL = { high: '高', medium: '中', low: '低' };
    const BASIS_LABEL = { abstract: '摘要', triage: '初筛', fulltext: '全文' };
    const ABSTRACT_SOURCE_LABEL = {
      openalex: 'OpenAlex', crossref: 'Crossref', arxiv: 'arXiv', s2: 'Semantic Scholar',
      'openalex+crossref': 'OpenAlex + Crossref', manual: '手动补录',
    };

    /** 论文级待处理标记（写在 review_flags 上）。 */
    const REVIEW_FLAGS = [
      { id: 'analysis_failed', get label() { return t('review.analysis_failed', '分析失败'); }, tone: 'danger' },
      { id: 'low_confidence', get label() { return t('review.low_confidence', '低置信'); }, tone: 'warn' },
      { id: 'needs_pdf', get label() { return t('review.needs_pdf', '缺原文'); }, tone: 'warn' },
      { id: 'pdf_error', get label() { return t('review.pdf_error', '原文解析失败'); }, tone: 'danger' },
    ];
    // 用 getter 而不是 Object.fromEntries：后者在模块初始化时就把中文定死了
    const REVIEW_FLAG_LABEL = {
      get analysis_failed() { return t('review.analysis_failed', '分析失败'); },
      get low_confidence() { return t('review.low_confidence', '低置信'); },
      get needs_pdf() { return t('review.needs_pdf', '缺原文'); },
      get pdf_error() { return t('review.pdf_error', '原文解析失败'); },
    };

    /** 论文阶段 → 人话。界面不直接出现 L1/L2/L3、done、promoted 这些内部值。 */
    const STAGE_LABEL = {
      L0: '刚发现', L1: '待看摘要', L2: '待初筛', L3: '待精读', done: '已完成', dropped: '已丢弃',
    };

    // 全部颜色走 host 的主题变量，深浅色自动跟随
    const C = {
      label1: 'var(--dsw-alias-label-primary)',
      label2: 'var(--dsw-alias-label-secondary)',
      label3: 'var(--dsw-alias-label-tertiary)',
      caption: 'var(--dsw-alias-label-caption)',
      border1: 'var(--dsw-alias-border-l1)',
      border2: 'var(--dsw-alias-border-l2)',
      bg1: 'var(--dsw-alias-bg-layer-1)',
      bg2: 'var(--dsw-alias-bg-layer-2)',
      accent: 'var(--dsw-alias-state-business-primary)',
      warn: 'var(--dsw-alias-state-warn-primary)',
      success: 'var(--dsw-alias-state-success-primary)',
      error: 'var(--dsw-alias-state-error-primary)',
      hover: 'var(--dsw-alias-interactive-bg-hover)',
      // 语义补充：新代码优先用这几个，别再把状态色当按钮底色
      brand: 'var(--dsw-alias-brand-primary)',
      borderStrong: 'var(--dsw-alias-border-l3)',
      surfaceOverlay: 'var(--dsw-alias-bg-overlay)',
      onColor: 'var(--dsw-alias-label-on-color)',
    };

    /**
     * 视觉刻度：字号 / 间距 / 圆角只从这几档里取。
     * 之前散成 10 档字号、13 种 padding，改一处要 grep 半天。
     */
    const T = {
      font: { metric: 30, title: 20, section: 16, body: 14, meta: 13, hint: 12.5, mono: 12 },
      space: { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32, micro: 2 },
      radius: { xs: 4, sm: 8, md: 12 },
      line: { tight: 1.35, body: 1.6, mono: 1.4 },
    };

    /** 字号统一走 CSS 变量；只缩放文字，不缩放间距和布局。 */
    function fs(value) {
      return `calc(${value}px * var(--lab-font-scale, 1))`;
    }

    /** 半透明底/描边：宿主主题本身也用 color-mix，深浅色自动跟随。 */
    function tint(color, percent) {
      return `color-mix(in srgb, ${color} ${percent}%, transparent)`;
    }

    const FONT_MONO = 'ui-monospace, SFMono-Regular, Menlo, monospace';

    // ── 左侧栏入口 ────────────────────────────────────────────
    // 20px 只画显微镜：和侧栏其他单件图标（插件/自动化/记忆/邮件）同一种构图与线重，
    // 「论文 + 显微镜」的完整组合留给插件市场的 96px 卡片（icon.svg / assets/icon-180.png）。
    // 颜色走 currentColor，跟随宿主主题。
    const ICON_PATHS = [
      'M6 18h8',
      'M3 22h18',
      'M14 22a7 7 0 1 0 0-14h-1',
      'M9 14h2',
      'M9 12a2 2 0 0 1-2-2V6h6v4a2 2 0 0 1-2 2Z',
      'M12 6V3a1 1 0 0 0-1-1H9a1 1 0 0 0-1 1v3',
    ];
    function LabIcon({ size = 20 }) {
      return h('svg', {
        width: size, height: size, viewBox: '1 1 22 22', fill: 'none',
        stroke: 'currentColor', strokeWidth: 1.6,
        strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true,
      }, ...ICON_PATHS.map((d) => h('path', { d })));
    }

    /** 披露箭头：展开/收起渠道配置。转向由 open 控制，颜色跟随 currentColor。 */
    function ChevronIcon({ size = 14, open }) {
      return h('svg', {
        width: size, height: size, viewBox: '0 0 24 24', fill: 'none',
        stroke: 'currentColor', strokeWidth: 2,
        strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true,
        style: { transform: open ? 'rotate(180deg)' : 'none', transition: 'transform .15s' },
      }, h('path', { d: 'm6 9 6 6 6-6' }));
    }

    // ── 队列口径（纯函数）────────────────────────────────────
    // 一条只落一行一组；表格、两个框与徽标都从这里取数，渲染层不再补算。
    // 行 = 在流水线的哪一步排队；组 = 这一步为什么轮到人。
    const BOARD_ROWS = [
      { key: 'new', label: '待判读', desc: '候选 · 读摘要，给评级与三问', quota: 'l1' },
      { key: 'confirm', label: '待确认', desc: '候选 · AI 结论待确认', quota: null },
      { key: 'l2', label: '待初筛', desc: '论文 · 读引言末段、结论与图注', quota: 'l2' },
      { key: 'l3', label: '待精读', desc: '论文 · 读全文，出卡片与关键图', quota: 'l3' },
      { key: 'legacy', label: '待推进', desc: '论文 · 旧版阶段，需人工进入初筛', quota: null },
    ];
    const BOARD_GROUPS = [
      { key: 'material', label: '材料不全', note: '系统缺少摘要或原文，无法继续。' },
      { key: 'failed', label: '判读失败', note: '上一轮运行失败，可重试。' },
      { key: 'confirm', label: '待确认', note: 'AI 已给结论，需要确认去向。' },
      { key: 'lowconf', label: '低置信', note: 'AI 置信度低，需要人工定级。' },
      { key: 'legacy', label: '旧版阶段', note: '旧版阶段不由自动流程推进。' },
    ];

    /** 条目网页：与服务端 lib/links.js 同规则（url → DOI → arXiv → 题名检索）。 */
    function homePageUrl(item) {
      const raw = String(item?.url || '').trim();
      if (/^https?:\/\//i.test(raw)) return raw;
      const doi = String(item?.doi || '').trim().replace(/^https?:\/\/(dx\.)?doi\.org\//i, '');
      if (doi && /^10\.\d{4,9}\/\S+$/.test(doi)) return `https://doi.org/${doi}`;
      const arxiv = String(item?.arxiv_id || '').trim();
      if (/^\d{4}\.\d{4,5}(v\d+)?$/.test(arxiv)) return `https://arxiv.org/abs/${arxiv}`;
      const title = String(item?.title || '').trim();
      if (title.length >= 8) return `https://search.crossref.org/?q=${encodeURIComponent(title)}`;
      return null;
    }

    /**
     * 材料不全只看「现在有没有摘要」：analysis.confidence_reasons 是上一次判读的快照，
     * 补摘要成功后不会重算，拿它分类会把已经补齐的候选永远钉在材料不全里。
     */
    function candidateLacksMaterial(c) {
      return !String(c?.abstract || '').trim();
    }

    /**
     * 单条分类：返回 { row, group, side, primary, reason }，不属于队列时返回 null。
     * 优先级固定为 旧版 > 材料 > 失败 > 确认 > 低置信 > 自动，保证一条只进一个组。
     */
    function classifyQueueEntry(entry, now = Date.now()) {
      if (!entry || !entry.kind || !entry.item) return null;
      const item = entry.item;
      if (entry.kind === 'candidate') {
        const status = item.status;
        if (!['new', 'analyzing', 'failed', 'parked'].includes(status)) return null;
        const material = candidateLacksMaterial(item);
        const group = material ? 'material'
          : status === 'failed' ? 'failed'
            : status === 'parked' ? 'confirm'
              : null;
        const row = status === 'parked' ? 'confirm' : 'new';
        return {
          kind: 'candidate',
          item,
          row,
          group,
          side: group ? 'human' : 'ai',
          primary: candidatePrimary(item, group),
          reason: candidateReason(item, group),
        };
      }
      if (entry.kind === 'paper') {
        const stage = item.stage;
        if (!stage || stage === 'done' || stage === 'dropped') return null;
        if (snoozeIsActive(item, now)) return null;
        const flags = Array.isArray(item.review_flags) ? item.review_flags : [];
        let group = null;
        if (stage === 'L0' || stage === 'L1') group = 'legacy';
        // 只有「尝试过且失败」才归人工：needs_pdf 由下载失败或额度不足后的重试写入；
        // 还没试过的缺原文条目留在 AI 队列，等自动路径去取。
        else if (flags.includes('needs_pdf') || flags.includes('pdf_error')) group = 'material';
        else if (flags.includes('analysis_failed')) group = 'failed';
        else if (flags.includes('low_confidence')) group = 'lowconf';
        const row = stage === 'L0' || stage === 'L1' ? 'legacy'
          : stage === 'L2' ? 'l2' : 'l3';
        return {
          kind: 'paper',
          item,
          row,
          group,
          side: group ? 'human' : 'ai',
          primary: paperPrimary(item, group),
          reason: paperReason(item, group),
        };
      }
      return null;
    }

    function candidatePrimary(c, group) {
      if (group === 'material') return '补全摘要';
      if (group === 'failed') return '重试判读';
      if (group === 'confirm') return '加入初筛';
      return null;
    }

    function paperPrimary(p, group) {
      if (group === 'material') return (p.review_flags || []).includes('pdf_error') ? '更换 PDF' : '补 PDF';
      if (group === 'failed') return p.stage === 'L3' ? '重跑精读' : '重跑初筛';
      if (group === 'lowconf') return '改判';
      if (group === 'legacy') return '进入初筛';
      return null;
    }

    function candidateReason(c, group) {
      if (group === 'material') return '来源未提供摘要，判读无法进行。';
      if (group === 'failed') {
        const detail = String(c?.analysis?.error || '').trim();
        return detail ? `上一轮判读失败：${detail}` : '上一轮判读失败，可重试。';
      }
      if (group === 'confirm') return 'AI 建议暂缓，需要确认去向。';
      return null;
    }

    function paperReason(p, group) {
      const flags = p.review_flags || [];
      if (group === 'material') {
        if (flags.includes('pdf_error')) return '已存 PDF 无法提取文本，需更换文件。';
        if (p.pdf_failure?.hint) return `未取得本地 PDF：${p.pdf_failure.hint}`;
        if (p.pdf_failure?.reason) return `未取得本地 PDF：${p.pdf_failure.reason}`;
        return '未取得本地 PDF，初筛与精读需要原文。';
      }
      if (group === 'failed') return '上一轮分析失败，可重试。';
      if (group === 'lowconf') return 'AI 置信度低，需要人工定级。';
      if (group === 'legacy') return '不由自动流程推进，需人工进入初筛。';
      return null;
    }

    /** AI 队列的行序：能立刻处理的先出现，要等原文的靠后；同档再按所选排序。 */
    const AI_ROW_ORDER = { new: 0, l2: 1, l3: 2 };
    function sortAiEntries(entries, { sort = 'score', runningIds = [], runningPhases = {} } = {}) {
      const running = new Set(Array.isArray(runningIds) ? runningIds : []);
      const keyOf = (entry) => {
        const item = entry?.item || {};
        // 用户置顶 → 正在处理/排队 → 置顶候选 → 已有原文 → 阶段
        const pinned = entry?.kind === 'paper' && item.priority === 'next' ? -1 : 0;
        const active = (runningPhases?.[item.id] || running.has(item.id)) ? -1 : 0;
        const analyzing = entry?.kind === 'candidate' && item.status === 'analyzing' ? -1 : 0;
        const needsFetch = entry?.kind === 'paper' && !item.has_pdf ? 1 : 0;
        return [pinned, active, analyzing, needsFetch, AI_ROW_ORDER[entry?.row] ?? 9];
      };
      const byNewest = (a, b) => String(b?.item?.first_seen || '').localeCompare(String(a?.item?.first_seen || ''));
      const tie = (a, b) => {
        if (sort === 'title') return String(a?.item?.title || '').localeCompare(String(b?.item?.title || ''));
        if (sort === 'year') return (Number(b?.item?.year) || 0) - (Number(a?.item?.year) || 0) || byNewest(a, b);
        if (sort === 'newest') return byNewest(a, b);
        return (Number(b?.item?.t0?.score) || 0) - (Number(a?.item?.t0?.score) || 0) || byNewest(a, b);
      };
      return [...(entries || [])].sort((a, b) => {
        const ka = keyOf(a);
        const kb = keyOf(b);
        for (let i = 0; i < ka.length; i += 1) if (ka[i] !== kb[i]) return ka[i] - kb[i];
        return tie(a, b);
      });
    }

    /** 人工框的行序：先按分组，再按等级（S→D），无等级排最后，同档按兴趣分。 */
    const BOARD_GRADE_RANK = { S: 0, A: 1, B: 2, C: 3, D: 4 };
    function entryGrade(entry) {
      return entry?.kind === 'candidate' ? entry.item?.analysis?.grade : entry?.item?.grade;
    }
    function sortHumanEntries(entries) {
      return [...(entries || [])].sort((a, b) => (
        String(a?.group || '').localeCompare(String(b?.group || ''))
        || (BOARD_GRADE_RANK[entryGrade(a)] ?? 9) - (BOARD_GRADE_RANK[entryGrade(b)] ?? 9)
        || (Number(b?.item?.t0?.score) || 0) - (Number(a?.item?.t0?.score) || 0)
      ));
    }

    /** 今日额度：limit 为 0 表示这一级不做（服务端 remainingQuota 按 0 处理）。 */
    function formatQuota(used, limit) {
      const n = Number(limit) || 0;
      const u = Math.max(0, Number(used) || 0);
      if (n <= 0) return { text: '不做', tone: 'off' };
      if (u >= n) return { text: `已用完 · ${u} / ${n}`, tone: 'error' };
      // 显示「剩余」而不是「已用」：4 / 6 容易被读成还剩 4，实际只剩 2
      return { text: `剩 ${n - u} / ${n}`, tone: 'normal' };
    }

    /** 下次自动运行：关闭返回 null，时间非法返回「时间未设置」。 */
    function nextRunLabel(now, schedule) {
      if (!schedule || schedule.enabled === false) return null;
      const raw = String(schedule.time || '').trim();
      const match = /^(\d{1,2}):(\d{2})$/.exec(raw);
      if (!match) return { text: '时间未设置', at: null };
      const hour = Number(match[1]);
      const minute = Number(match[2]);
      if (hour > 23 || minute > 59) return { text: '时间未设置', at: null };
      const at = new Date(now);
      at.setHours(hour, minute, 0, 0);
      const tomorrow = at.getTime() <= now;
      if (tomorrow) at.setDate(at.getDate() + 1);
      return { text: `${tomorrow ? '明天' : '今天'} ${match[1].padStart(2, '0')}:${match[2]}`, at: at.getTime() };
    }

    /**
     * 队列看板：把论文、候选、额度与调度合成一张表 + 两个框的数据。
     * queued 用服务端全量计数（候选 counts、论文 stages），human/auto 用已加载条目的分类结果；
     * 已加载少于排队数时标 truncated，界面必须写明统计范围，不能声称全量。
     */
    function pipelineBoard({ papers = [], candidates = [], summary = {}, stats = null, schedule = null, now = Date.now() } = {}) {
      const stages = summary?.stages || {};
      const counts = summary?.counts || {};
      const limits = stats?.limits || {};
      const usage = stats?.usage || {};

      const paperEntries = papers.map((p) => classifyQueueEntry({ kind: 'paper', item: p }, now)).filter(Boolean);
      const candidateEntries = candidates.map((c) => classifyQueueEntry({ kind: 'candidate', item: c }, now)).filter(Boolean);
      const entries = [...candidateEntries, ...paperEntries];

      const snoozedByStage = { L0: 0, L1: 0, L2: 0, L3: 0 };
      for (const p of papers) {
        if (!snoozeIsActive(p, now)) continue;
        if (p.stage in snoozedByStage) snoozedByStage[p.stage] += 1;
      }
      const exact = {
        new: (Number(counts.new) || 0) + (Number(counts.analyzing) || 0) + (Number(counts.failed) || 0),
        confirm: Number(counts.parked) || 0,
        l2: Math.max(0, (Number(stages.L2) || 0) - snoozedByStage.L2),
        l3: Math.max(0, (Number(stages.L3) || 0) - snoozedByStage.L3),
        legacy: Math.max(0, (Number(stages.L0) || 0) + (Number(stages.L1) || 0) - snoozedByStage.L0 - snoozedByStage.L1),
      };

      const rows = BOARD_ROWS.map((row) => {
        const list = entries.filter((entry) => entry.row === row.key);
        const human = list.filter((entry) => entry.side === 'human').length;
        const auto = list.length - human;
        // 计数以服务端为准，但服务端摘要可能落后于列表：排队数不允许小于已加载数，
        // 否则会出现「排队 0、需要人处理 1」这种自相矛盾。
        const queued = Number.isFinite(exact[row.key])
          ? Math.max(exact[row.key], list.length)
          : list.length;
        const quotaUsed = row.quota ? usage[row.quota] : null;
        const quotaLimit = row.quota ? limits[row.quota] : null;
        return {
          ...row,
          queued,
          loaded: list.length,
          human,
          auto,
          truncated: Number.isFinite(exact[row.key]) ? list.length < exact[row.key] : false,
          quota: row.quota ? formatQuota(quotaUsed, quotaLimit) : null,
          owner: human && auto ? 'both' : human ? 'human' : auto ? 'auto' : 'none',
        };
      });

      const sum = (key) => rows.reduce((total, row) => total + row[key], 0);
      const groups = BOARD_GROUPS
        .map((group) => ({
          ...group,
          items: entries.filter((entry) => entry.group === group.key).map((entry) => entry.item),
        }))
        .filter((group) => group.items.length);

      return {
        rows,
        groups,
        aiItems: entries.filter((entry) => entry.side === 'ai').map((entry) => entry.item),
        humanItems: entries.filter((entry) => entry.side === 'human').map((entry) => entry.item),
        total: {
          queued: sum('queued'),
          loaded: sum('loaded'),
          human: sum('human'),
          auto: sum('auto'),
          truncated: rows.some((row) => row.truncated),
        },
        paused: Object.values(snoozedByStage).reduce((a, b) => a + b, 0),
        pdfQuota: Number.isFinite(Number(limits.pdf))
          ? { used: Number(usage.pdf) || 0, limit: Number(limits.pdf) || 0 }
          : null,
        nextRun: nextRunLabel(now, schedule),
      };
    }
    // ── 文案通道 ──────────────────────────────────────────────
    // 目标不是一次翻完全部文案，而是先把通道建起来，并迁移三类高复用枚举：
    // 页签 / 候选状态 / 需处理标记 / L1 三问 / 渠道名。其余中文留在各页面。
    // 宿主没有 locale 服务时（测试、旧宿主）t() 一律回退中文，界面永远可读。
    const I18N_NS = 'literature-lab';

    const I18N_ZH = {
      'tab.overview': '总览',
      'tab.pipeline': 'AI 分析',
      'tab.library': '成果',
      'tab.sources': '雷达',
      'tab.settings': '设置',
      'status.new': '待判读',
      'status.parked': '待确认',
      'status.admitted': '已提升',
      'status.dropped': '已丢弃',
      'status.filtered': '过滤',
      'status.owned': '已拥有',
      'status.excluded': '排除',
      'status.failed': '失败',
      'status.all': '全部',
      'review.analysis_failed': '分析失败',
      'review.low_confidence': '低置信',
      'review.needs_pdf': '缺原文',
      'domain.core': '本领域核心',
      'domain.edge': '相关领域',
      'domain.transferable': '方法可借鉴',
      'domain.irrelevant': '无关',
      'use.method': '改进方法',
      'use.baseline': '当对比基线',
      'use.citation': '写作引用',
      'use.landscape': '了解现状',
      'channel.manual': '手动添加论文',
      'channel.arxiv': 'arXiv',
      'channel.rss': 'RSS 订阅',
      'channel.search': '跨库检索',
      'channel.email': '邮件快讯',
      'channel.pubmed': 'PubMed / Europe PMC',
      'channel.dblp': 'DBLP',
      'channel.preprint': 'bioRxiv / medRxiv',
      'channel.harvest': '历史回溯',
      'channel.logs': '运行日志',
    };

    const I18N_EN = {
      'tab.overview': 'Overview',
      'tab.pipeline': 'AI Analysis',
      'tab.library': 'Library',
      'tab.sources': 'Radar',
      'tab.settings': 'Settings',
      'status.new': 'To triage',
      'status.parked': 'Needs review',
      'status.admitted': 'Admitted',
      'status.dropped': 'Dropped',
      'status.filtered': 'Filtered',
      'status.owned': 'Owned',
      'status.excluded': 'Excluded',
      'status.failed': 'Failed',
      'status.all': 'All',
      'review.analysis_failed': 'Analysis failed',
      'review.low_confidence': 'Low confidence',
      'review.needs_pdf': 'No PDF',
      'domain.core': 'Core',
      'domain.edge': 'Adjacent',
      'domain.transferable': 'Transferable',
      'domain.irrelevant': 'Irrelevant',
      'use.method': 'Method',
      'use.baseline': 'Baseline',
      'use.citation': 'Citation',
      'use.landscape': 'Landscape',
      'channel.manual': 'Manual add',
      'channel.arxiv': 'arXiv',
      'channel.rss': 'RSS feeds',
      'channel.search': 'Cross-database search',
      'channel.email': 'Email alerts',
      'channel.pubmed': 'PubMed / Europe PMC',
      'channel.dblp': 'DBLP',
      'channel.preprint': 'bioRxiv / medRxiv',
      'channel.harvest': 'Backfill',
      'channel.logs': 'Run log',
    };

    let localeFace = null;
    let translate = null;

    /**
     * 取可选的 locale 服务。
     * Cordis 里未在 inject 声明的服务用 `ctx.locale` 访问可能抛错，必须先走 `ctx.get` 并判空。
     */
    function optionalLocale(ctx) {
      try {
        if (typeof ctx?.get === 'function') {
          const viaGet = ctx.get('locale');
          if (viaGet) return viaGet;
        }
      } catch {
        // 宿主不支持 get 或该服务未激活
      }
      try {
        return ctx?.locale || null;
      } catch {
        return null;
      }
    }

    /** 在 apply 里调用：注册双语字典并绑定翻译函数。返回清理函数（宿主可能不提供 locale 服务）。 */
    function installLocale(ctx) {
      const locale = optionalLocale(ctx);
      if (!locale || typeof locale.register !== 'function') return null;
      let dispose = null;
      try {
        dispose = locale.register(I18N_NS, { zh: I18N_ZH, en: I18N_EN });
      } catch {
        // 同一 (ns, locale) 重复注册会抛错；只说明字典已在，不影响渲染
      }
      try {
        translate = locale.bind(I18N_NS);
        localeFace = locale;
      } catch {
        translate = null;
      }
      return dispose;
    }

    /** 取文案；宿主没有该键时回退到传入的中文。 */
    function t(key, fallback) {
      if (!translate) return fallback;
      try {
        const value = translate(key);
        return typeof value === 'string' && value && value !== key ? value : fallback;
      } catch {
        return fallback;
      }
    }
    // ── 通用控件（自己实现，不依赖 host 内部组件）──────────────
    /**
     * 图标按钮：方形、只有图标，名字必须通过 aria-label + title 保留，
     * 否则读屏与悬停都拿不到这按钮是干什么的。
     */
    function IconButton({ children, label, onClick, active, disabled, expanded, subtle }) {
      const [hover, setHover] = useState(false);
      return h('button', {
        type: 'button',
        'aria-label': label,
        'aria-pressed': expanded !== undefined
          ? undefined
          : (active === undefined ? undefined : Boolean(active)),
        'aria-expanded': expanded === undefined ? undefined : Boolean(expanded),
        title: label,
        disabled: Boolean(disabled),
        onClick: disabled ? undefined : onClick,
        onMouseEnter: () => setHover(true),
        onMouseLeave: () => setHover(false),
        ...FOCUS_RING,
        style: {
          appearance: 'none', display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          width: 26, height: 26, padding: 0, borderRadius: 6, flexShrink: 0,
          cursor: disabled ? 'not-allowed' : 'pointer',
          border: `1px solid ${subtle ? 'transparent' : (active ? C.accent : C.border2)}`,
          background: hover && !disabled ? C.hover : 'transparent',
          color: active ? (subtle ? C.label1 : C.accent) : (subtle ? C.label3 : C.label2),
          opacity: disabled ? 0.5 : 1,
          transition: 'background .15s, color .15s',
        },
      }, children);
    }

    /** 焦点环：键盘可见；用 outline 避免改布局。 */
    const FOCUS_RING = {
      onFocus: (e) => { e.currentTarget.style.outline = `2px solid ${C.accent}`; e.currentTarget.style.outlineOffset = '1px'; },
      onBlur: (e) => { e.currentTarget.style.outline = 'none'; },
    };

    function Button({ children, onClick, primary, danger, disabled, size = 'md', label }) {
      const [hover, setHover] = useState(false);
      // 破坏性主按钮：实心红；其余 danger 仍是红字按钮（与现有删除入口一致）。
      const filledDanger = Boolean(primary && danger);
      const base = {
        appearance: 'none', cursor: disabled ? 'not-allowed' : 'pointer',
        fontFamily: 'inherit', fontWeight: 500,
        fontSize: fs(size === 'sm' ? 12 : 13),
        padding: size === 'sm' ? '3px 9px' : '6px 13px',
        borderRadius: 6,
        border: `1px solid ${primary ? 'transparent' : C.border2}`,
        background: primary ? (danger ? C.error : C.accent) : (hover && !disabled ? C.hover : 'transparent'),
        color: primary ? C.onColor : (danger ? C.error : C.label2),
        filter: filledDanger && hover && !disabled ? 'brightness(.92)' : 'none',
        opacity: disabled ? 0.5 : 1,
        transition: 'background .15s, color .15s, filter .15s',
      };
      return h('button', {
        type: 'button', onClick: disabled ? undefined : onClick, style: base,
        'aria-label': label || undefined,
        disabled: Boolean(disabled),
        onMouseEnter: () => setHover(true),
        onMouseLeave: () => setHover(false),
        ...FOCUS_RING,
      }, children);
    }

    function TextInput({ value, onChange, placeholder, mono, width, type = 'text', label, inputId, onBlur, onKeyDown }) {
      return h('input', {
        type, value: value || '', placeholder: placeholder || '',
        id: inputId || undefined,
        'aria-label': label || placeholder || undefined,
        onChange: (e) => onChange(e.target.value),
        onKeyDown,
        ...FOCUS_RING,
        // 展开必须在前面，再叠加调用方自己的处理器，否则会被 FOCUS_RING 覆盖
        onFocus: (e) => FOCUS_RING.onFocus(e),
        onBlur: (e) => { FOCUS_RING.onBlur(e); if (typeof onBlur === 'function') onBlur(e); },
        style: {
          fontFamily: mono ? FONT_MONO : 'inherit', fontSize: fs(13.5),
          padding: '5px 9px', borderRadius: 5,
          border: `1px solid ${C.border2}`, background: C.bg1,
          color: C.label1, outline: 'none', width: width || '100%',
          boxSizing: 'border-box',
        },
      });
    }

    /**
     * 数字输入：编辑期用草稿文本，失焦或回车才提交。
     * 原生 number 清空会立刻变成 0，导致「删不掉、只能一位位加」；
     * 需要时给 −/+ 步进，比小箭头好点。
     */
    function NumberInput({ value, onChange, min, max, width = 76, label, stepper = false, step = 1 }) {
      const clampValue = (n) => {
        let next = n;
        if (Number.isFinite(Number(min))) next = Math.max(Number(min), next);
        if (Number.isFinite(Number(max))) next = Math.min(Number(max), next);
        return next;
      };
      const [draft, setDraft] = useState(String(value ?? 0));
      const [focused, setFocused] = useState(false);
      useEffect(() => {
        if (!focused) setDraft(String(value ?? 0));
      }, [value, focused]);
      const commit = (raw) => {
        const parsed = Number(String(raw).trim());
        const next = Number.isFinite(parsed) ? clampValue(parsed) : (Number(value) || 0);
        setDraft(String(next));
        if (next !== value) onChange(next);
      };
      const bump = (delta) => {
        const base = Number(draft);
        const next = clampValue((Number.isFinite(base) ? base : 0) + delta);
        setDraft(String(next));
        onChange(next);
      };
      const input = h('input', {
        type: 'text', inputMode: 'numeric', value: draft,
        'aria-label': label || undefined,
        onFocus: () => setFocused(true),
        onBlur: () => { setFocused(false); commit(draft); },
        onChange: (e) => setDraft(e.target.value),
        onKeyDown: (e) => {
          if (e.key === 'Enter') { e.preventDefault(); e.currentTarget?.blur?.(); }
          if (e.key === 'ArrowUp') { e.preventDefault(); bump(step); }
          if (e.key === 'ArrowDown') { e.preventDefault(); bump(-step); }
        },
        ...FOCUS_RING,
        style: {
          fontFamily: FONT_MONO, fontSize: fs(13.5), padding: '5px 8px',
          borderRadius: 5, border: `1px solid ${C.border2}`,
          background: C.bg1, color: C.label1, outline: 'none',
          width, boxSizing: 'border-box', textAlign: 'center',
        },
      });
      if (!stepper) return input;
      return h('div', { style: { display: 'inline-flex', alignItems: 'center', gap: T.space.xs } },
        h(Button, { size: 'sm', label: `${label || '数值'}减一`, onClick: () => bump(-step) }, '−'),
        input,
        h(Button, { size: 'sm', label: `${label || '数值'}加一`, onClick: () => bump(step) }, '+'));
    }

    function Switch({ checked, onChange, label, ariaLabel }) {
      return h('label', {
        style: { display: 'inline-flex', alignItems: 'center', gap: 7, cursor: 'pointer', fontSize: fs(13.5) },
      },
        h('button', {
          type: 'button', role: 'switch', 'aria-checked': Boolean(checked),
          'aria-label': ariaLabel || undefined,
          title: ariaLabel || undefined,
          onClick: () => onChange(!checked),
          style: {
            appearance: 'none', cursor: 'pointer',
            width: 32, height: 18, borderRadius: 9, padding: 0,
            border: `1px solid ${checked ? C.accent : C.border2}`,
            background: checked ? C.accent : C.border1,
            position: 'relative', transition: 'background .15s',
          },
        },
          h('span', {
            style: {
              position: 'absolute', top: 1.5, left: checked ? 15 : 1.5,
              width: 13, height: 13, borderRadius: '50%',
              background: C.onColor, transition: 'left .15s',
            },
          }),
        ),
        label ? h('span', { style: { color: C.label2 } }, label) : null,
      );
    }

    /**
     * 下拉菜单：一个按钮 + 浮层条目。点条目或点浮层外关闭。
     * 条目 = { key, label, active, disabled, onClick }。
     * 工具条上的低频动作收进这里，避免一排并列按钮把页面压满。
     */
    function Menu({ label, items, primary, disabled }) {
      const [open, setOpen] = useState(false);
      useEffect(() => {
        if (!open) return undefined;
        if (typeof document === 'undefined' || !document.addEventListener) return undefined;
        const onDown = (event) => {
          const target = event?.target;
          if (target && typeof target.closest === 'function' && target.closest('[data-litlab-menu]')) return;
          setOpen(false);
        };
        document.addEventListener('mousedown', onDown);
        return () => document.removeEventListener('mousedown', onDown);
      }, [open]);
      const list = (items || []).filter(Boolean);
      return h('div', { 'data-litlab-menu': '1', style: { position: 'relative', display: 'inline-flex' } },
        h(Button, {
          size: 'sm',
          primary,
          disabled,
          label: typeof label === 'string' ? label : undefined,
          onClick: () => setOpen((value) => !value),
        }, label),
        open
          ? h('div', {
            role: 'menu',
            style: {
              position: 'absolute', top: 'calc(100% + 4px)', left: 0, zIndex: 950,
              minWidth: 176, padding: 4, display: 'grid', gap: 2,
              background: C.bg1, border: `1px solid ${C.border2}`, borderRadius: T.radius.sm,
              boxShadow: '0 8px 24px rgba(0,0,0,.22)',
            },
          }, list.map((item) => h('button', {
            key: item.key || item.label,
            type: 'button',
            role: 'menuitem',
            disabled: Boolean(item.disabled),
            onClick: () => {
              if (item.disabled) return;
              setOpen(false);
              if (typeof item.onClick === 'function') item.onClick();
            },
            style: {
              appearance: 'none', textAlign: 'left',
              cursor: item.disabled ? 'not-allowed' : 'pointer',
              fontFamily: 'inherit', fontSize: fs(T.font.hint),
              padding: '5px 8px', borderRadius: 4, border: 'none',
              background: item.active ? C.hover : 'transparent',
              color: item.disabled ? C.caption : (item.active ? C.accent : C.label2),
              opacity: item.disabled ? 0.55 : 1,
            },
          }, item.label)))
          : null);
    }

    /** 关键词列表：chips + 回车添加；tone 只改底色（accent 核心 / danger 排除）。 */
    function Chips({ items, onChange, placeholder, tone }) {
      const [draft, setDraft] = useState('');
      const [focused, setFocused] = useState(false);
      const [hovered, setHovered] = useState(null);
      const list = items || [];
      const accent = tone === 'accent' ? C.accent : tone === 'danger' ? C.error : null;
      const chipBg = accent ? tint(accent, 8) : tint(C.label1, 5);
      const chipBorder = accent ? tint(accent, 22) : tint(C.label1, 8);
      const chipBorderHover = accent ? tint(accent, 40) : tint(C.label1, 20);
      const add = () => {
        const v = draft.trim();
        if (!v || list.includes(v)) { setDraft(''); return; }
        onChange([...list, v]);
        setDraft('');
      };
      return h('div', {
        onMouseLeave: () => setHovered(null),
        onFocus: () => setFocused(true),
        onBlur: (e) => {
          const next = e?.relatedTarget;
          const box = e?.currentTarget;
          if (next && box && typeof box.contains === 'function' && box.contains(next)) return;
          setFocused(false);
        },
        style: {
          display: 'flex', flexWrap: 'wrap', gap: 5, alignItems: 'center', alignContent: 'center',
          padding: '7px 9px', borderRadius: T.radius.sm, minHeight: 42,
          border: `1px solid ${focused ? (accent || C.accent) : C.border2}`,
          background: tint(C.label1, 4),
          boxShadow: focused ? `0 0 0 3px ${tint(accent || C.accent, 14)}` : 'none',
          transition: 'border-color .15s, box-shadow .15s',
          cursor: 'text',
        },
      },
        list.map((it) => h('span', {
          key: it,
          onMouseEnter: () => setHovered(it),
          style: {
            display: 'inline-flex', alignItems: 'center', gap: 1,
            fontSize: fs(12.5), lineHeight: '18px', padding: '2px 2px 2px 8px', borderRadius: 6,
            background: chipBg, border: `1px solid ${hovered === it ? chipBorderHover : chipBorder}`,
            color: tone === 'danger' ? C.label2 : C.label1, fontFamily: FONT_MONO, whiteSpace: 'nowrap',
            transition: 'border-color .12s, background .12s',
          },
        },
          it,
          h('button', {
            type: 'button', onClick: () => onChange(list.filter((x) => x !== it)),
            'aria-label': `移除 ${it}`,
            style: {
              appearance: 'none', border: 'none', cursor: 'pointer', flexShrink: 0,
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              width: 16, height: 16, padding: 0, borderRadius: 4,
              background: hovered === it ? tint(C.error, 14) : 'transparent',
              color: hovered === it ? C.error : C.label3,
              fontSize: fs(12), lineHeight: 1,
              transition: 'background .12s, color .12s',
            },
          }, '×'),
        )),
        h('input', {
          type: 'text', value: draft,
          placeholder: placeholder || '',
          onChange: (e) => setDraft(e.target.value),
          onKeyDown: (e) => {
            if (e.key === 'Enter') { e.preventDefault(); add(); }
            if (e.key === 'Backspace' && !draft && list.length) onChange(list.slice(0, -1));
          },
          onBlur: add,
          style: {
            flex: 1, minWidth: 120, border: 'none', outline: 'none',
            background: 'transparent', color: C.label1,
            fontSize: fs(13), fontFamily: FONT_MONO, padding: '3px 0',
          },
        }),
      );
    }

    /** 字段：标签 + 可选计数 + 说明 + 控件，计数用等宽数字。 */
    function Field({ label, hint, children, count, right }) {
      return h('div', { style: { marginBottom: T.space.lg } },
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 6, marginBottom: 5, minHeight: 20 } },
          h('div', { style: { fontSize: fs(13), color: C.label1, fontWeight: 600 } }, label),
          count === undefined || count === null
            ? null
            : h('span', {
              style: {
                fontSize: fs(11.5), lineHeight: '16px', padding: '0 6px', borderRadius: 9,
                color: count ? C.label2 : C.label3, background: tint(C.label1, 5),
                fontVariantNumeric: 'tabular-nums',
              },
            }, String(count)),
          right ? h('div', { style: { marginLeft: 'auto' } }, right) : null),
        hint ? h('div', { style: { fontSize: fs(T.font.hint), color: C.caption, marginBottom: 6, lineHeight: T.line.body } }, hint) : null,
        children,
      );
    }

    /**
     * 配置行：标签在左、控件在右，容器变窄时整行折成上下两行。
     * 折行只靠 flex-basis，不读 window.innerWidth——弹窗、预览、分栏里都按容器宽度响应。
     * 标签用主文字色（字段名是正文）；说明挂在控件下方、占满控件宽度，不挤在标签列里。
     */
    function ConfigRow({ label, hint, control, first }) {
      return h('div', {
        style: {
          display: 'flex', alignItems: 'flex-start', flexWrap: 'wrap',
          gap: `${T.space.xs}px ${T.space.lg}px`,
          padding: `${T.space.sm}px 0`,
          borderTop: first ? 'none' : `1px solid ${C.border1}`,
        },
      },
        h('div', { style: { flex: '0 0 128px', minWidth: 96, paddingTop: 2 } },
          h('div', { style: { fontSize: fs(T.font.body), color: C.label1, lineHeight: T.line.tight } }, label)),
        h('div', { style: { flex: '1 1 260px', minWidth: 0 } },
          h('div', {
            style: {
              minHeight: 28, display: 'flex', alignItems: 'center',
              flexWrap: 'wrap', gap: T.space.sm,
            },
          }, control || null),
          hint
            ? h('div', {
              style: {
                fontSize: fs(T.font.hint), color: C.caption, marginTop: T.space.micro, lineHeight: T.line.body,
              },
            }, hint)
            : null));
    }

    /** 可编辑列表的一行：行间细线 + 可选行首开关 + 尾部删除；窄屏自然折行。 */
    function ListRow({ leading, children, onRemove, removeLabel, first }) {
      return h('div', {
        style: {
          display: 'flex', alignItems: 'center', flexWrap: 'wrap',
          gap: T.space.sm, padding: `${T.space.xs + 2}px 0`,
          borderTop: first ? 'none' : `1px solid ${C.border1}`,
        },
      },
        leading || null,
        h('div', {
          style: {
            flex: '1 1 240px', minWidth: 0,
            display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: T.space.sm,
          },
        }, children),
        onRemove
          ? h(Button, { size: 'sm', danger: true, label: removeLabel, onClick: onRemove }, '删除')
          : null);
    }

    /** 只读标签串：把「自动使用研究兴趣词……」从一句灰话变成可核对的词。 */
    function ChipList({ items, empty }) {
      const list = Array.isArray(items) ? items.filter(Boolean) : [];
      if (!list.length) {
        return h('div', {
          style: { fontSize: fs(T.font.hint), color: C.caption, lineHeight: T.line.body },
        }, empty || '暂无');
      }
      return h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: T.space.xs } },
        list.map((text) => h(Chip, { key: text }, text)));
    }

    /** 配置里的空态：一行说明，不放大块虚线框。 */
    function ConfigEmpty({ children }) {
      return h('div', {
        style: {
          fontSize: fs(T.font.hint), color: C.caption,
          lineHeight: T.line.body, padding: `${T.space.xs}px 0`,
        },
      }, children);
    }

    function Card({ children, style }) {
      return h('div', {
        style: {
          border: `1px solid ${C.border2}`, borderRadius: 8,
          background: C.bg1, padding: '16px 18px', ...style,
        },
      }, children);
    }

    function SectionTitle({ children, hint, right }) {
      return h('div', {
        style: { marginBottom: 14, display: 'flex', alignItems: 'flex-start', gap: 10 },
      },
        h('div', { style: { flex: 1 } },
          h('div', { style: { fontSize: fs(16), fontWeight: 600, color: C.label1 } }, children),
          hint ? h('div', { style: { fontSize: fs(13), color: C.caption, marginTop: 4 } }, hint) : null,
        ),
        right || null,
      );
    }

    /**
     * 空态：标题 + 说明 + 1–2 个主行动。数据少的时候它就是页面主体，
     * 所以文字权重要比旧 Empty 高，并且必须给出下一步。
     */
    function EmptyState({ title, desc, hint, actions }) {
      return h('div', {
        style: {
          padding: `${T.space.xl}px ${T.space.lg}px`, textAlign: 'center',
          border: `1px dashed ${C.border2}`, borderRadius: T.radius.sm, background: C.bg1,
        },
      },
        h('div', { style: { fontSize: fs(T.font.body), fontWeight: 600, color: C.label2 } }, title),
        desc
          ? h('div', {
            style: {
              fontSize: fs(T.font.hint), color: C.caption, marginTop: T.space.xs,
              lineHeight: T.line.body, maxWidth: 460, marginLeft: 'auto', marginRight: 'auto',
            },
          }, desc)
          : null,
        hint ? h('div', { style: { fontSize: fs(T.font.hint), color: C.caption, marginTop: T.space.xs } }, hint) : null,
        actions && actions.filter(Boolean).length
          ? h('div', { style: { display: 'flex', gap: T.space.sm, justifyContent: 'center', flexWrap: 'wrap', marginTop: T.space.md } },
            actions.filter(Boolean))
          : null);
    }

    /** 统计格：一个数字 + 名字，可选可点。用来给低数据量页面一个「存量」可看。 */
    function StatTile({ label, value, hint, onClick }) {
      const clickable = typeof onClick === 'function';
      const [hover, setHover] = useState(false);
      return h(clickable ? 'button' : 'div', {
        type: clickable ? 'button' : undefined,
        onClick: clickable ? onClick : undefined,
        onMouseEnter: () => setHover(true),
        onMouseLeave: () => setHover(false),
        ...(clickable ? { ...FOCUS_RING, 'aria-label': `${label} ${value}` } : {}),
        style: {
          appearance: 'none', textAlign: 'left', fontFamily: 'inherit',
          flex: '1 1 120px', minWidth: 96,
          padding: `${T.space.sm}px ${T.space.md}px`, borderRadius: T.radius.sm,
          border: `1px solid ${clickable && hover ? C.borderStrong : C.border2}`,
          background: clickable && hover ? C.hover : 'transparent',
          cursor: clickable ? 'pointer' : 'default',
        },
      },
        h('div', { style: { fontSize: fs(T.font.metric), fontWeight: 600, color: C.label1, lineHeight: T.line.tight } }, String(value)),
        h('div', { style: { fontSize: fs(T.font.hint), color: C.caption, marginTop: 2 } }, label),
        hint ? h('div', { style: { fontSize: fs(T.font.hint), color: C.label3, marginTop: 1 } }, hint) : null);
    }

    /** 页头：一个页名 + 一行状态 + 本页动作。页面正文不再重复页名。 */
    function PageHeader({ title, status, actions }) {
      return h('div', {
        style: {
          display: 'flex', alignItems: 'flex-start', gap: T.space.md,
          flexWrap: 'wrap', marginBottom: T.space.lg,
        },
      },
        h('div', { style: { flex: 1, minWidth: 220 } },
          h('div', { style: { fontSize: fs(T.font.title), fontWeight: 600, color: C.label1 } }, title),
          status
            ? h('div', { style: { fontSize: fs(T.font.hint), color: C.caption, marginTop: 3, lineHeight: T.line.body } }, status)
            : null),
        h('div', { style: { display: 'flex', gap: T.space.xs, alignItems: 'center', flexWrap: 'wrap' } },
          (actions || []).filter(Boolean)));
    }

    function Empty({ children }) {
      return h('div', {
        style: {
          padding: '28px 20px', textAlign: 'center', color: C.caption,
          fontSize: fs(14), border: `1px dashed ${C.border2}`, borderRadius: 8,
        },
      }, children);
    }

    // ── 只读 Markdown 渲染（零依赖，不做 HTML 注入）──────────
    // 卡片是给人在界面上读的；直接把 Markdown 源码丢进 <pre> 会有 # 和 - 的噪音，
    // 而且行宽会拉满整页。这里只实现卡片实际用到的语法子集。
    const MD = {
      h1: { fontSize: fs(19), fontWeight: 600, color: C.label1, margin: '20px 0 10px', lineHeight: T.line.tight },
      h2: { fontSize: fs(16.5), fontWeight: 600, color: C.label1, margin: '18px 0 8px', lineHeight: T.line.tight },
      h3: { fontSize: fs(15), fontWeight: 600, color: C.label1, margin: '14px 0 6px', lineHeight: T.line.tight },
      p: { margin: '0 0 10px', color: C.label1, lineHeight: 1.85, overflowWrap: 'anywhere' },
      li: { margin: '0 0 5px', color: C.label1, lineHeight: 1.8, overflowWrap: 'anywhere' },
      list: { margin: '0 0 10px', paddingLeft: 22 },
      quote: {
        margin: '0 0 10px', paddingLeft: 12, borderLeft: `3px solid ${C.borderStrong}`,
        color: C.label2, lineHeight: 1.8,
      },
      strong: { fontWeight: 600, color: C.label1 },
      em: { fontStyle: 'italic' },
      link: { color: C.accent, textDecoration: 'none', borderBottom: `1px solid ${C.accent}` },
      code: {
        fontFamily: FONT_MONO, fontSize: fs(12.5), background: C.bg2, color: C.label1,
        padding: '1px 5px', borderRadius: 4,
      },
      pre: {
        fontFamily: FONT_MONO, fontSize: fs(12.5), background: C.bg2, color: C.label1,
        padding: T.space.md, borderRadius: T.radius.sm, overflowX: 'auto',
        lineHeight: T.line.mono, margin: '0 0 12px', whiteSpace: 'pre',
      },
      hr: { border: 'none', borderTop: `1px solid ${C.border1}`, margin: '14px 0' },
    };

    /** 行内标记：`code` / **bold** / *italic* / [文字](链接)。 */
    function inlineMarkdown(text, keyPrefix) {
      const out = [];
      const re = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*|\[[^\]]+\]\([^)]+\))/g;
      let last = 0;
      let hit;
      let index = 0;
      while ((hit = re.exec(text)) !== null) {
        if (hit.index > last) out.push(text.slice(last, hit.index));
        const token = hit[0];
        const key = `${keyPrefix}-i${index += 1}`;
        if (token.startsWith('`')) out.push(h('code', { key, style: MD.code }, token.slice(1, -1)));
        else if (token.startsWith('**')) out.push(h('strong', { key, style: MD.strong }, token.slice(2, -2)));
        else if (token.startsWith('*')) out.push(h('em', { key, style: MD.em }, token.slice(1, -1)));
        else {
          const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(token);
          out.push(h('a', {
            key, href: link ? link[2] : '#', target: '_blank', rel: 'noreferrer', style: MD.link,
          }, link ? link[1] : token));
        }
        last = hit.index + token.length;
      }
      if (last < text.length) out.push(text.slice(last));
      return out;
    }

    /** 卡片 Markdown → React 节点。只认标题/列表/引用/代码块/分隔线/段落。 */
    function MarkdownBlock({ text, maxWidth = 760 }) {
      const lines = String(text || '').replace(/\r\n?/g, '\n').split('\n');
      const blocks = [];
      let i = 0;
      let key = 0;
      const nextKey = () => `md-${key += 1}`;
      while (i < lines.length) {
        const line = lines[i];
        if (!line.trim()) { i += 1; continue; }

        const fence = /^\s*```/.exec(line);
        if (fence) {
          const body = [];
          i += 1;
          while (i < lines.length && !/^\s*```/.test(lines[i])) { body.push(lines[i]); i += 1; }
          i += 1;
          blocks.push(h('pre', { key: nextKey(), style: MD.pre }, body.join('\n')));
          continue;
        }

        const heading = /^(#{1,4})\s+(.*)$/.exec(line);
        if (heading) {
          const level = heading[1].length;
          const style = level === 1 ? MD.h1 : level === 2 ? MD.h2 : MD.h3;
          const tag = level === 1 ? 'h1' : level === 2 ? 'h2' : 'h3';
          blocks.push(h(tag, { key: nextKey(), style }, inlineMarkdown(heading[2], `h${key}`)));
          i += 1;
          continue;
        }

        if (/^\s*(?:---|\*\*\*|___)\s*$/.test(line)) {
          blocks.push(h('hr', { key: nextKey(), style: MD.hr }));
          i += 1;
          continue;
        }

        if (/^\s*>\s?/.test(line)) {
          const body = [];
          while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
            body.push(lines[i].replace(/^\s*>\s?/, ''));
            i += 1;
          }
          blocks.push(h('div', { key: nextKey(), style: MD.quote }, inlineMarkdown(body.join(' '), `q${key}`)));
          continue;
        }

        if (/^\s*(?:[-*+]|\d+\.)\s+/.test(line)) {
          const ordered = /^\s*\d+\.\s+/.test(line);
          const items = [];
          while (i < lines.length && /^\s*(?:[-*+]|\d+\.)\s+/.test(lines[i])) {
            const raw = lines[i].replace(/^\s*(?:[-*+]|\d+\.)\s+/, '');
            items.push(h('li', { key: nextKey(), style: MD.li }, inlineMarkdown(raw, `l${key}`)));
            i += 1;
          }
          blocks.push(h(ordered ? 'ol' : 'ul', { key: nextKey(), style: MD.list }, items));
          continue;
        }

        const para = [];
        while (i < lines.length && lines[i].trim()
          && !/^(#{1,4})\s+/.test(lines[i])
          && !/^\s*(?:[-*+]|\d+\.)\s+/.test(lines[i])
          && !/^\s*>\s?/.test(lines[i])
          && !/^\s*```/.test(lines[i])) {
          para.push(lines[i].trim());
          i += 1;
        }
        if (!para.length) { i += 1; continue; }
        blocks.push(h('p', { key: nextKey(), style: MD.p }, inlineMarkdown(para.join(' '), `p${key}`)));
      }
      return h('div', {
        style: { maxWidth, color: C.label1, fontSize: fs(T.font.body), lineHeight: 1.85 },
      }, blocks);
    }

    /** 骨架屏：首屏加载占位。aria-hidden，避免读屏把占位当内容。 */
    function Skeleton({ height = 44, width = '100%' }) {
      return h('div', {
        'aria-hidden': 'true',
        style: {
          height, width, borderRadius: T.radius.sm, background: C.border1,
          marginBottom: T.space.sm, opacity: 0.7,
        },
      });
    }

    function Notice({ kind, children }) {
      const tone = kind === 'error' ? C.error : kind === 'success' ? C.success : C.warn;
      return h('div', {
        role: 'status', 'aria-live': 'polite',
        style: {
          padding: '9px 13px', marginBottom: 14, borderRadius: 6, fontSize: fs(13.5),
          border: `1px solid ${tone}`, color: tone, lineHeight: 1.6,
        },
      }, children);
    }

    function GradeBadge({ grade }) {
      // 没有等级时也占同样的 22px 槽位：否则「—」比字母徽章窄，列表里标题会左右错开
      if (!grade) {
        return h('span', {
          style: {
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            width: 22, height: 22, flexShrink: 0, color: C.caption, fontSize: fs(12),
          },
        }, '—');
      }
      const tone = { S: C.accent, A: C.accent, B: C.success, C: C.label3, D: C.caption }[grade] || C.label3;
      return h('span', {
        style: {
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          width: 22, height: 22, borderRadius: 6, border: `1px solid ${tone}`,
          background: C.bg2, color: tone, fontSize: fs(12), fontWeight: 700,
          fontFamily: FONT_MONO, flexShrink: 0,
        },
      }, grade);
    }

    // L1 三问与评级依据的展示文案（与 lib/judge.js 的枚举一一对应）
    const DOMAIN_LABEL = {
      get core() { return t('domain.core', '本领域核心'); },
      get edge() { return t('domain.edge', '相关领域'); },
      get transferable() { return t('domain.transferable', '方法可借鉴'); },
      get irrelevant() { return t('domain.irrelevant', '无关'); },
    };
    const USE_LABEL = {
      get method() { return t('use.method', '改进方法'); },
      get baseline() { return t('use.baseline', '当对比基线'); },
      get citation() { return t('use.citation', '写作引用'); },
      get landscape() { return t('use.landscape', '了解现状'); },
    };
    function Chip({ children, tone, title }) {
      return h('span', {
        title: title || undefined,
        style: {
          fontSize: fs(11.5), padding: '1px 6px', borderRadius: 9,
          border: `1px solid ${C.border2}`, color: tone || C.label2, whiteSpace: 'nowrap',
        },
      }, children);
    }

    /** 渲染异常兜底：整页白屏降级为一块可重试的错误提示。 */
    class ErrorBoundary extends React.Component {
      constructor(props) {
        super(props);
        this.state = { error: null };
      }

      static getDerivedStateFromError(error) {
        return { error };
      }

      render() {
        if (this.state.error) {
          return h('div', { style: { padding: '22px 28px', color: C.label1 } },
            h(Notice, { kind: 'error' },
              `这个页面出错了，可以点「重试」重新加载。错误详情：${String(this.state.error?.message || this.state.error)}`),
            h(Button, { onClick: () => this.setState({ error: null }) }, '重试'));
        }
        return this.props.children;
      }
    }

    /** 后台任务轮询：有运行中任务时 2s，否则 15s；页面隐藏时跳过。 */
    function useJobs(onFinish) {
      const [jobs, setJobs] = useState([]);
      const [error, setError] = useState(null);
      const [seen] = useState(() => ({}));
      const load = useCallback(async () => {
        try {
          const d = await api(R.jobs);
          const next = d.jobs || [];
          setJobs(next);
          setError(null);
          for (const job of next) {
            const prev = seen[job.id];
            seen[job.id] = job.status;
            if (prev === 'running' && job.status !== 'running') onFinish?.(job);
          }
        } catch (e) { setError(String(e?.message || e)); }
      }, [onFinish, seen]);
      useEffect(() => { load(); }, [load]);
      const anyRunning = jobs.some((j) => j.status === 'running');
      useEffect(() => {
        const timer = setInterval(load, anyRunning ? 2000 : 15000);
        // Node 测试环境里让定时器不阻塞进程退出（浏览器返回数字，无 unref）
        if (typeof timer?.unref === 'function') timer.unref();
        return () => clearInterval(timer);
      }, [load, anyRunning]);
      return { jobs, running: jobs.filter((j) => j.status === 'running'), error };
    }

    /** 顶栏任务入口：运行中数量 + 可展开列表与取消。 */
    function JobBadge({ running, onCancel }) {
      const [open, setOpen] = useState(false);
      if (!running.length) return null;
      return h('div', { style: { position: 'relative' } },
        h(Button, {
          size: 'sm', label: '运行中的任务', onClick: () => setOpen(!open),
        }, `⟳ ${running.length} 个任务运行中`),
        open
          ? h('div', {
            style: {
              position: 'absolute', right: 0, top: '100%', marginTop: 6, zIndex: 1050, width: 320,
              background: C.bg1, border: `1px solid ${C.border2}`, borderRadius: 8,
              padding: 10, boxShadow: '0 8px 28px rgba(0,0,0,.24)',
            },
          }, running.map((job) => h('div', {
            key: job.id,
            style: { display: 'flex', gap: 8, alignItems: 'center', padding: '4px 0' },
          },
            h('span', { style: { flex: 1, fontSize: fs(13), color: C.label2 } },
              `${job.name || job.id} · ${job.started_at ? new Date(job.started_at).toLocaleTimeString() : '—'}`),
            h(Button, { size: 'sm', label: `取消 ${job.name || job.id}`, onClick: () => onCancel(job.id) }, '取消'))))
          : null);
    }

    /** 整页骨架：首屏还没拿到 state 时用，避免一句「读取中…」。 */
    function PageSkeleton() {
      return h('div', { 'aria-busy': 'true', 'aria-label': '加载中' },
        h(Skeleton, { height: 64 }),
        h('div', {
          style: {
            display: 'grid', gap: T.space.md,
            gridTemplateColumns: 'repeat(auto-fit, minmax(min(200px, 100%), 1fr))',
          },
        }, [0, 1, 2, 3].map((i) => h(Skeleton, { key: i, height: 92 }))),
        h(Skeleton, { height: 220 }));
    }

    /** 轻提示：进入终态时给一条回执，4s 自动消失。 */
    function Toast({ toast, onClose }) {
      useEffect(() => {
        if (!toast) return undefined;
        const timer = setTimeout(onClose, 4000);
        return () => clearTimeout(timer);
      }, [toast, onClose]);
      if (!toast) return null;
      return h('div', {
        role: 'status', 'aria-live': 'polite',
        style: {
          position: 'fixed', right: 20, bottom: 20, zIndex: 1100, maxWidth: 380,
          background: C.bg1, border: `1px solid ${toast.kind === 'error' ? C.error : C.border2}`,
          color: toast.kind === 'error' ? C.error : C.label1, borderRadius: 8,
          padding: '10px 14px', fontSize: fs(13.5), lineHeight: 1.6, boxShadow: '0 8px 28px rgba(0,0,0,.24)',
        },
      }, toast.text);
    }

    /** 精读关键图：服务端从 PDF 里抽的图（或矢量图整页），2–3 张。 */
    function FigureGallery({ paper }) {
      const figures = Array.isArray(paper?.l3?.figures) ? paper.l3.figures : [];
      if (!figures.length) return null;
      const srcOf = (fig) => `${R.figure}?paper=${encodeURIComponent(paper.id || '')}&file=${encodeURIComponent(fig.file || '')}`;
      return h('div', { style: { marginTop: 18, paddingTop: 14, borderTop: `1px solid ${C.border1}` } },
        h('div', { style: { fontSize: fs(13.5), fontWeight: 600, color: C.label1, marginBottom: 10 } }, `关键图 ${figures.length} 张`),
        h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 14 } },
          figures.map((fig, index) => h('figure', {
            key: `${fig.file}-${index}`,
            style: { margin: 0, flex: '1 1 320px', minWidth: 260, maxWidth: 520, background: C.bg2, border: `1px solid ${C.border1}`, borderRadius: T.radius.sm, padding: 10 },
          },
            h('a', { href: srcOf(fig), target: '_blank', rel: 'noreferrer', style: { display: 'block' } },
              h('img', {
                src: srcOf(fig), alt: fig.caption || `第 ${fig.page} 页关键图`, loading: 'lazy',
                style: { display: 'block', width: '100%', maxHeight: 420, objectFit: 'contain', background: C.bg1, borderRadius: T.radius.xs },
              })),
            h('figcaption', { style: { marginTop: 8, fontSize: fs(12.5), color: C.label2, lineHeight: 1.6 } },
              h('div', { style: { display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' } },
                h('span', null, `第 ${fig.page} 页${fig.caption ? ` · ${fig.caption}` : ''}`),
                index === 0 || Number(fig.rank) === 1 ? h(Chip, { tone: C.accent }, 'AI 首选') : null,
                fig.kind === 'page' ? h(Chip, { tone: C.warn }, '整页截图') : null),
              fig.why ? h('div', { style: { color: C.label3, marginTop: 3 } }, fig.why) : null)))),
      );
    }

    /** 阅读视图：全宽。PDF 与 L3 长卡片放这里，不挤进 560px 抽屉。 */
    function ReadingView({ paper, textMeta, onClose }) {
      const [tab, setTab] = useState('card');
      useEffect(() => {
        if (typeof document === 'undefined' || !document.addEventListener) return undefined;
        const onKey = (e) => { if (e.key === 'Escape') onClose(); };
        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
      }, [onClose]);
      const card = paper?.l3?.card_markdown || '';
      const tabs = card ? [{ id: 'card', label: '精读卡片' }] : [];
      const current = tabs.some((t) => t.id === tab) ? tab : (tabs[0]?.id || 'none');
      return h('div', {
        style: { position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,.4)', display: 'flex', flexDirection: 'column' },
      },
        h('div', {
          role: 'dialog', 'aria-modal': 'true', 'aria-label': '阅读全文',
          style: { flex: 1, display: 'flex', flexDirection: 'column', margin: '24px auto', width: 'min(1100px, calc(100vw - 48px))', background: C.bg1, border: `1px solid ${C.border2}`, borderRadius: 12, overflow: 'hidden' },
        },
          h('div', { style: { display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', borderBottom: `1px solid ${C.border1}` } },
            h('div', { style: { flex: 1, minWidth: 0 } },
              h('div', { style: { fontSize: fs(15), fontWeight: 600, color: C.label1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, paper?.title || ''),
              h('div', { style: { fontSize: fs(12.5), color: C.caption, marginTop: 2 } },
                [paper?.venue, paper?.year, paper?.doi || paper?.arxiv_id].filter(Boolean).join(' · ')
                + (textMeta ? ` · 文本 ${textMeta.pages || 0} 页${textMeta.scanned ? '（疑似扫描件）' : ''}` : ''))),
            tabs.map((t) => h(Button, {
              key: t.id, size: 'sm', primary: current === t.id, onClick: () => setTab(t.id),
            }, t.label)),
            h(Button, { size: 'sm', onClick: onClose, label: '关闭阅读视图' }, '关闭')),
          h('div', { style: { flex: 1, minHeight: 0, overflow: 'auto', padding: 0 } },
            current === 'card'
              ? h('div', { style: { padding: 18 } }, h(MarkdownBlock, { text: card, maxWidth: 900 }), h(FigureGallery, { paper }))
              : h(Empty, null, '这篇还没有精读卡片')),
        ));
    }

    /**
     * 单篇入库回执：POST /zotero/import 返回 { ok, result: { ok, dryRun, collection, results }, paper }，
     * 这条论文真实的结果在 results[0]。旧桩/早期版本可能直接给数组，这里都兼容，
     * 免得又出现「失败也提示已写入」。
     */
    function zoteroImportReceipt(d) {
      const payload = d?.result;
      if (Array.isArray(payload)) return payload[0] || {};
      if (payload && Array.isArray(payload.results)) return payload.results[0] || {};
      if (Array.isArray(d?.results)) return d.results[0] || {};
      return {};
    }

    /** 论文抽屉：判断层（三问、结论、置信度、历史、改判）。 */
    function PaperDrawer({ paperId, initialTab = 'judge', onClose, onOverride, onRerun, onUpload, onChanged, onOpenPdf }) {
      const [paper, setPaper] = useState(null);
      const [textMeta, setTextMeta] = useState(null);
      const [error, setError] = useState(null);
      const [tab, setTab] = useState(initialTab);
      const [editing, setEditing] = useState(false);
      // null = 关闭；'L2' / 'L3' = 待确认的重跑阶段
      const [confirmRerun, setConfirmRerun] = useState(null);
      const [importPreview, setImportPreview] = useState(null);
      const [reading, setReading] = useState(false);
      const [acting, setActing] = useState(null);
      const [note, setNote] = useState(null);
      const runAction = async (kind, path, body, format) => {
        if (acting) return;
        setActing(kind);
        setNote(null);
        try {
          const data = await postJson(path, body);
          setNote({ kind: 'success', text: format(data) });
          await load();
          onChanged?.();
        } catch (e) {
          setNote({ kind: 'error', text: String(e?.message || e) });
        } finally {
          setActing(null);
        }
      };

      const load = useCallback(async () => {
        setError(null);
        try {
          const d = await api(`${R.paper}?id=${encodeURIComponent(paperId)}`);
          setPaper(d.paper);
          setTextMeta(d.text || null);
        } catch (e) { setError(String(e?.message || e)); }
      }, [paperId]);

      useEffect(() => { setPaper(null); setTab(initialTab === 'pdf' ? 'judge' : (initialTab || 'judge')); setReading(false); load(); }, [load, initialTab]);
      useEffect(() => {
        if (typeof document === 'undefined' || !document.addEventListener) return undefined;
        const onKey = (e) => { if (e.key === 'Escape' && !editing && !confirmRerun && !reading) onClose(); };
        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
      }, [onClose, editing, confirmRerun, reading]);

      const flags = paper?.review_flags || [];
      const l1 = paper?.l1;
      const l2 = paper?.l2;
      const l3 = paper?.l3;
      const usage = l2?.usage || l3?.usage || null;
      const judge = h('div', null,
        l1
          ? h('div', { style: { marginBottom: 14 } },
            h('div', { style: { fontSize: fs(13), color: C.caption, marginBottom: 6 } }, '摘要判断'),
            h('div', { style: { display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 6 } },
              h(Chip, { tone: l1.domain === 'irrelevant' ? C.caption : C.accent }, DOMAIN_LABEL[l1.domain] || l1.domain || '—'),
              h(Chip, null, USE_LABEL[l1.use] || l1.use || '—')),
            h('div', { style: { fontSize: fs(13.5), color: C.label2, lineHeight: 1.7 } }, `增量：${l1.increment || '—'}`))
          : h('div', { style: { fontSize: fs(13.5), color: C.caption, marginBottom: 14 } }, '还没有做摘要判断'),
        h('div', { style: { marginBottom: 14 } },
          h('div', { style: { fontSize: fs(13), color: C.caption, marginBottom: 4 } }, '初筛'),
          l2
            ? h('div', null,
              h('div', { style: { display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 4 } },
                h(Chip, null, VERDICT_LABEL[l2.verdict] || l2.verdict || '—'),
                l2.confidence ? h(Chip, { tone: l2.confidence === 'low' ? C.warn : C.label2 }, `置信度${CONFIDENCE_LABEL[l2.confidence] || l2.confidence}`) : null),
              h('div', { style: { fontSize: fs(13.5), color: C.label2, lineHeight: 1.7 } }, l2.reason || '（无理由记录）'))
            : h('div', { style: { fontSize: fs(13.5), color: C.caption } }, '还没做初筛')),
        h('div', { style: { marginBottom: 14 } },
          h('div', { style: { fontSize: fs(13), color: C.caption, marginBottom: 4 } }, '精读'),
          l3
            ? h('div', null,
              h('div', { style: { display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 4 } },
                h(GradeBadge, { grade: l3.final_grade }),
                l3.confidence ? h(Chip, { tone: l3.confidence === 'low' ? C.warn : C.label2 }, `置信度${CONFIDENCE_LABEL[l3.confidence] || l3.confidence}`) : null),
              h('div', { style: { fontSize: fs(13.5), color: C.label2, lineHeight: 1.7 } }, l3.summary || '（无摘要记录）'))
            : h('div', { style: { fontSize: fs(13.5), color: C.caption } }, '还没做精读')),
        usage?.estimated_tokens
          ? h('div', { style: { fontSize: fs(12.5), color: C.caption, marginBottom: 8 } }, `本次分析用量：${usage.estimated_tokens}`)
          : null,
        paper?.manual_override
          ? h('div', { style: { fontSize: fs(12.5), color: C.caption } }, '这篇有人工改判记录，AI 结论不会覆盖它。')
          : null);

      const abstractPane = h('div', null,
        paper?.abstract
          ? h('div', { style: { fontSize: fs(13.5), color: C.label1, lineHeight: 1.8, whiteSpace: 'pre-wrap' } }, paper.abstract)
          : h('div', { style: { fontSize: fs(13.5), color: C.warn } },
            `摘要未取到${paper?.abstract_lookup?.reason ? `（${reasonText(paper.abstract_lookup.reason)}）` : ''}`),
        paper?.meta_source ? h('div', { style: { fontSize: fs(12.5), color: C.caption, marginTop: 10 } }, `摘要来源：${ABSTRACT_SOURCE_LABEL[paper.meta_source] || paper.meta_source}`) : null);

      const history = (paper?.grade_history || []).slice().reverse();
      const historyPane = history.length
        ? h('div', null, history.map((h0, i) => h('div', {
          key: `${h0.at || i}-${i}`,
          style: { padding: '8px 0', borderTop: i === 0 ? 'none' : `1px solid ${C.border1}` },
        },
          h('div', { style: { display: 'flex', gap: 8, alignItems: 'center', marginBottom: 3 } },
            h(GradeBadge, { grade: h0.grade }),
            h('span', { style: { fontSize: fs(12.5), color: C.caption } }, STAGE_LABEL[h0.stage] || h0.stage || ''),
            h('span', { style: { fontSize: fs(12.5), color: C.caption } }, h0.basis || ''),
            h('span', { style: { fontSize: fs(12.5), color: C.caption, marginLeft: 'auto' } },
              h0.at ? new Date(h0.at).toLocaleString() : '')),
          h('div', { style: { fontSize: fs(13), color: C.label2, lineHeight: 1.65 } }, h0.reason || '（无理由）'))))
        : h(Empty, null, '还没有评级记录');

      const body = h('div', { style: { flex: 1, minHeight: 0, overflowY: 'auto', padding: '0 18px 16px' } },
        h('div', { style: { display: 'flex', gap: 18, borderBottom: `1px solid ${C.border1}`, marginBottom: 14 } },
          [['judge', '判断'], ['abstract', '摘要'], paper?.l3?.card_markdown ? ['card', '精读卡片'] : null, ['history', '历史']].filter(Boolean).map(([id, label]) => h('button', {
            key: id, type: 'button', onClick: () => setTab(id),
            style: {
              appearance: 'none', background: 'none', border: 'none', padding: '8px 0',
              borderBottom: tab === id ? `2px solid ${C.accent}` : '2px solid transparent',
              marginBottom: -1, cursor: 'pointer', fontFamily: 'inherit', fontSize: fs(13.5),
              color: tab === id ? C.accent : C.label3,
            },
          }, label))),
        tab === 'judge' ? judge : tab === 'abstract' ? abstractPane : tab === 'card'
          ? h('div', { style: { fontSize: fs(14), lineHeight: 1.8 } }, h(MarkdownBlock, { text: paper?.l3?.card_markdown || '', maxWidth: 900 }), h(FigureGallery, { paper }))
          : historyPane);

      const actionNote = note ? h('div', { style: { padding: '8px 18px 0' } }, h(Notice, { kind: note.kind }, note.text)) : null;
      const actions = h('div', {
        style: { display: 'flex', gap: 8, flexWrap: 'wrap', padding: '12px 18px', borderTop: `1px solid ${C.border1}`, background: C.bg1 },
      },
        onOverride ? h(Button, { primary: true, size: 'sm', onClick: () => setEditing(true) }, '改判') : null,
        onRerun && ['L2', 'L3'].includes(paper?.stage) ? h(Button, { size: 'sm', onClick: () => setConfirmRerun(paper.stage) }, '重跑本层') : null,
        onRerun && paper?.l3 && paper?.stage !== 'L3' ? h(Button, { size: 'sm', onClick: () => setConfirmRerun('L3') }, '重新精读') : null,
        paper?.has_pdf && onOpenPdf ? h(Button, { size: 'sm', onClick: () => onOpenPdf(paper.id) }, '打开 PDF') : null,
        paper?.l3?.card_markdown ? h(Button, { size: 'sm', onClick: () => setReading(true) }, '精读卡片') : null,
        paper?.zotero_key
          ? h('span', { style: { fontSize: fs(12.5), color: C.success, alignSelf: 'center' } }, '已入库 Zotero')
          : h(Button, {
            size: 'sm',
            disabled: acting === 'importPreview' || acting === 'import',
            onClick: () => runAction(
              'importPreview',
              R.zoteroImport,
              { id: paper.id, dryRun: true },
              (d) => {
                const r = zoteroImportReceipt(d);
                if (r.skipped === 'already-imported') return '这篇已经在 Zotero 里了';
                if (!(d?.ok && r.ok)) return `预览失败：${r.error || d?.error || '未知原因'}`;
                setImportPreview(d);
                return '已生成入库预览，请确认';
              },
            ),
          }, acting === 'importPreview' ? '预览中…' : '入库 Zotero'),
        h(Button, {
          size: 'sm',
          disabled: acting === 'refetch',
          onClick: () => runAction(
            'refetch',
            R.refetch,
            { id: paper.id },
            (d) => (d.has_abstract ? `已重取摘要（来源 ${d.via || '未知'}）` : `没取到摘要：${d.reason || '未知原因'}`),
          ),
        }, acting === 'refetch' ? '重取中…' : '重取摘要'),
        paper?.stage === 'L2' && !paper?.has_pdf && onUpload
          ? h('label', { style: { fontSize: fs(12.5), color: C.accent, cursor: 'pointer', alignSelf: 'center' } },
            '补 PDF',
            h('input', {
              type: 'file', accept: 'application/pdf', style: { display: 'none' },
              onChange: (e) => { const f = e.target.files?.[0]; if (f) onUpload(paper.id, f); },
            }))
          : null);

      return h('div', {
        style: { position: 'fixed', inset: 0, zIndex: 950, background: 'rgba(0,0,0,.28)', display: 'flex', justifyContent: 'flex-end' },
        onMouseDown: (e) => { if (e.target === e.currentTarget) onClose(); },
      },
        h('div', {
          role: 'dialog', 'aria-modal': 'true', 'aria-label': '论文详情',
          style: { width: 'min(560px, 100vw)', height: '100%', background: C.bg1, borderLeft: `1px solid ${C.border2}`, boxShadow: '-8px 0 32px rgba(0,0,0,.24)', display: 'flex', flexDirection: 'column' },
        },
          h('div', { style: { padding: '14px 18px 0' } },
            h('div', { style: { display: 'flex', alignItems: 'flex-start', gap: 10 } },
              h(GradeBadge, { grade: paper?.grade }),
              h('div', { style: { flex: 1, minWidth: 0 } },
                h('div', { style: { fontSize: fs(15), fontWeight: 600, color: C.label1, lineHeight: 1.5 } }, paper?.title || '读取中…'),
                h('div', { style: { fontSize: fs(12.5), color: C.caption, marginTop: 3, overflowWrap: 'anywhere' } },
                  [paper?.venue, paper?.year, paper?.doi, paper?.arxiv_id].filter(Boolean).join(' · ') || '—'),
                h('div', { style: { fontSize: fs(12.5), color: C.caption, marginTop: 3, overflowWrap: 'anywhere' } },
                  [
                    (paper?.authors || []).slice(0, 4).join(', '),
                    paper?.sources?.length ? `来源 ${paper.sources.join(' / ')}` : null,
                    paper?.first_seen ? `${paper.first_seen} 加入` : null,
                  ].filter(Boolean).join(' · ') || '—')),
              h('button', {
                type: 'button', 'aria-label': '关闭详情', onClick: onClose,
                style: { appearance: 'none', border: 'none', background: 'none', cursor: 'pointer', color: C.label3, fontSize: fs(19), lineHeight: 1, padding: 2 },
              }, '×')),
            h('div', { style: { display: 'flex', gap: 6, flexWrap: 'wrap', margin: '8px 0 10px' } },
              h(Chip, null, STAGE_LABEL[paper?.stage] || paper?.stage || '—'),
              paper?.has_pdf ? h(Chip, { tone: C.success }, 'PDF') : null,
              paper?.zotero_key ? h(Chip, { tone: C.accent }, 'Zotero') : null,
              paper?.translated ? h(Chip, { tone: C.success }, '译文') : null,
              flags.map((f) => h(Chip, { key: f, tone: f === 'analysis_failed' ? C.error : C.warn }, REVIEW_FLAG_LABEL[f] || f)))),
          error
            ? h('div', { style: { padding: '0 18px 16px' } },
              h(Notice, { kind: 'error' }, `读取详情失败：${error}`),
              h(Button, { size: 'sm', onClick: load }, '重试'))
            : (!paper
              ? h('div', { style: { padding: '0 18px 16px' } }, h(Empty, null, '读取中…'))
              : h('div', { style: { flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' } },
                body,
                actionNote,
                actions)),
          reading && paper ? h(ReadingView, { paper, textMeta, onClose: () => setReading(false) }) : null,
          editing && paper
            ? h(OverrideDialog, {
              paper,
              onClose: () => setEditing(false),
              onSubmit: async (patch) => { await onOverride(paper.id, patch); await load(); },
            })
            : null,
          importPreview && paper
            ? h(ConfirmDialog, {
              title: '确认写入 Zotero',
              text: `将写入 1 篇：${paper.title || paper.id}。已存在的同 DOI/arXiv 条目会跳过，不覆盖已有笔记。`,
              confirmLabel: '确认入库',
              onClose: () => setImportPreview(null),
              onConfirm: () => {
                setImportPreview(null);
                runAction(
                  'import',
                  R.zoteroImport,
                  { id: paper.id },
                  (d) => {
                    const r = zoteroImportReceipt(d);
                    if (r.skipped === 'already-imported') return '这篇已经在 Zotero 里了';
                    if (!(d?.ok && r.ok)) return `入库失败：${r.error || d?.error || '未知原因'}`;
                    return '已写入 Zotero';
                  },
                );
              },
            })
            : null,
          confirmRerun && paper
            ? h(ConfirmDialog, {
              title: confirmRerun === 'L3' ? '重新精读' : '重新交给 AI 分析',
              text: confirmRerun === 'L3'
                ? '会把这篇放回精读层并重跑全文分析；会清除人工改判标记，人工改判记录仍保留在历史里。'
                : '会清除这篇的人工改判标记，然后按当前阶段重跑。人工改判记录仍保留在历史里。',
              confirmLabel: confirmRerun === 'L3' ? '重新精读' : '重跑',
              onClose: () => setConfirmRerun(null),
              onConfirm: () => { const stage = confirmRerun; setConfirmRerun(null); onRerun(paper.id, stage); },
            })
            : null,
        ));
    }

    /** 遮罩对话框：Esc 关闭、点遮罩关闭、role=dialog。 */
    function Dialog({ title, children, footer, onClose, width = 460 }) {
      useEffect(() => {
        if (typeof document === 'undefined' || !document.addEventListener) return undefined;
        const onKey = (e) => { if (e.key === 'Escape') onClose(); };
        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
      }, [onClose]);
      return h('div', {
        style: {
          position: 'fixed', inset: 0, zIndex: 1000, display: 'flex',
          alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,.32)',
        },
        onMouseDown: (e) => { if (e.target === e.currentTarget) onClose(); },
      }, h('div', {
        role: 'dialog', 'aria-modal': 'true', 'aria-label': title,
        style: {
          width, maxWidth: 'calc(100vw - 32px)', maxHeight: 'calc(100vh - 48px)', overflowY: 'auto',
          background: C.bg1, border: `1px solid ${C.border2}`, borderRadius: 12,
          padding: '18px 20px', boxShadow: '0 12px 40px rgba(0,0,0,.28)',
        },
      },
        h('div', { style: { display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 12 } },
          h('div', { style: { flex: 1, fontSize: fs(16), fontWeight: 600, color: C.label1 } }, title),
          h('button', {
            type: 'button', 'aria-label': '关闭', onClick: onClose,
            style: {
              appearance: 'none', border: 'none', background: 'none', cursor: 'pointer',
              color: C.label3, fontSize: fs(19), lineHeight: 1, padding: 2,
            },
          }, '×')),
        children,
        footer ? h('div', { style: { display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 18 } }, footer) : null,
      ));
    }

    /** 二次确认对话框。 */
    function ConfirmDialog({ title, text, confirmLabel = '确定', danger, onClose, onConfirm }) {
      return h(Dialog, {
        title, onClose,
        footer: [
          h(Button, { key: 'cancel', onClick: onClose }, '取消'),
          h(Button, { key: 'ok', primary: true, danger, onClick: onConfirm }, confirmLabel),
        ],
      }, h('div', { style: { fontSize: fs(14), color: C.label2, lineHeight: 1.7 } }, text));
    }

    /** 改判：等级 + 阶段 + 必填依据；前端先做等级/同域性自洽校验。 */
    function OverrideDialog({ paper, onClose, onSubmit }) {
      const [grade, setGrade] = useState(paper.grade || 'B');
      const [stage, setStage] = useState(paper.stage || 'L2');
      const [reason, setReason] = useState('');
      const [busy, setBusy] = useState(false);
      const [error, setError] = useState(null);
      const domain = paper.l1?.domain || null;
      const conflict = (() => {
        if (!domain) return null;
        if (grade === 'S' && domain !== 'core') return 'S 只能给「本领域核心」';
        if (grade === 'A' && domain !== 'core' && domain !== 'edge') return 'A 只能给「本领域核心」或「相关领域」';
        if (domain === 'irrelevant' && grade !== 'D') return '「无关」的论文只能给 D';
        return null;
      })();
      const tooShort = reason.trim().length < 6;
      const disabled = busy || tooShort || Boolean(conflict);
      const submit = async () => {
        if (disabled) return;
        setBusy(true);
        setError(null);
        try {
          await onSubmit({ grade, stage, reason: reason.trim() });
          onClose();
        } catch (e) {
          setError(String(e?.message || e));
        } finally { setBusy(false); }
      };
      return h(Dialog, {
        title: '改判', onClose, width: 540,
        footer: [
          h(Button, { key: 'cancel', onClick: onClose }, '取消'),
          h(Button, { key: 'ok', primary: true, disabled, onClick: submit }, busy ? '提交中…' : '确定'),
        ],
      },
        h('div', { style: { fontSize: fs(13), color: C.caption, marginBottom: 12 } },
          `当前：${paper.stage || '—'} · 等级 ${paper.grade || '—'}${domain ? ` · 领域 ${DOMAIN_LABEL[domain] || domain}` : ''}`),
        h(Field, { label: '新等级' },
          h('div', { style: { display: 'flex', gap: 6, alignItems: 'center' } },
            ['S', 'A', 'B', 'C', 'D'].map((g) => h(Button, {
              key: g, size: 'sm', primary: grade === g, onClick: () => setGrade(g),
            }, `${g} ${g === 'S' ? '必读' : g === 'A' ? '重要' : g === 'B' ? '有用' : g === 'C' ? '背景' : '无增量'}`)))),
        h(Field, { label: '新阶段' },
          h('select', {
            value: stage, 'aria-label': '新阶段',
            onChange: (e) => setStage(e.target.value),
            style: {
              fontSize: fs(13.5), padding: '5px 9px', borderRadius: 5,
              border: `1px solid ${C.border2}`, background: C.bg1, color: C.label1,
            },
          }, ['L1', 'L2', 'L3', 'done', 'dropped'].map((st) => h('option', { key: st, value: st }, STAGE_NAME[st] || st)))),
        h(Field, {
          label: '依据（必填，≥6 字）',
          hint: conflict || (tooShort && reason ? '再多写几个字，说明相对什么证据' : '写清是基于摘要、初筛还是全文的什么证据'),
        },
          h('textarea', {
            value: reason, rows: 3,
            'aria-label': '改判依据',
            'aria-invalid': Boolean(conflict || (tooShort && reason.length > 0)),
            onChange: (e) => setReason(e.target.value),
            style: {
              width: '100%', fontSize: fs(13.5), padding: 8, borderRadius: 5,
              border: `1px solid ${conflict ? C.error : C.border2}`, background: C.bg1,
              color: C.label1, boxSizing: 'border-box', fontFamily: 'inherit',
            },
          })),
        error ? h(Notice, { kind: 'error' }, error) : null,
      );
    }

    /**
     * 统一接口调用：解析 JSON；非 2xx 或 {ok:false} 一律抛错。
     * 目的：禁止再用「catch 后返回 null」的写法把失败静默成"什么都没发生"。
     */
    async function api(path, options) {
      let res;
      try {
        res = await fetch(path, { credentials: 'same-origin', ...(options || {}) });
      } catch (e) {
        const raw = String(e?.message || e);
        const hint = /Failed to fetch|NetworkError|load failed/i.test(raw)
          ? '连不上本地服务：确认 DSH 还在运行，然后重试'
          : raw;
        throw new Error(`网络错误：${hint}`);
      }
      let data = null;
      try { data = await res.json(); } catch { data = null; }
      if (!res.ok || !data || data.ok === false) {
        const code = Number(res.status) || 0;
        const hint = code === 400 ? '请求内容不对'
          : code === 401 || code === 403 ? '没有权限'
            : code === 404 ? '找不到这个功能（插件版本可能不匹配）'
              : code === 409 ? '当前状态不允许这个操作'
                : code >= 500 ? '插件内部出错了，稍后重试'
                  : '请求失败';
        throw new Error(data?.error || `${hint}（${code}）`);
      }
      return data;
    }

    /** GET 的语义别名：Workbench 里的局部变量叫 api（useApi 的返回值），用它避免遮蔽。 */
    function fetchJson(path) {
      return api(path);
    }

    /** POST JSON 的快捷方式。 */
    function postJson(path, body) {
      return api(path, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body || {}),
      });
    }

    /**
     * 启动后台 job 并轮询到终态。
     * - 组件卸载后停止，不再对已卸载组件 setState
     * - 轮询上限到点不静默：返回 warn 文案
     * - 返回 { kind, text, result }；被取消时返回 null
     * 用 useState 承载可变控制块，避免依赖 useRef 在宿主/测试之间的差异。
     */
    function useJobRunner() {
      const [ctl] = useState(() => ({ cancelled: false, busy: false }));
      useEffect(() => () => { ctl.cancelled = true; }, [ctl]);
      return async ({ start, maxTicks = 40, pollMs = 2000, format }) => {
        if (ctl.busy) return null;
        ctl.busy = true;
        try {
          const started = await start();
          const jobId = started?.job?.id;
          if (!jobId) return { kind: 'error', text: '未能启动任务（没有 job id）' };
          for (let i = 0; i < maxTicks; i += 1) {
            await new Promise((resolve) => setTimeout(resolve, pollMs));
            if (ctl.cancelled) return null;
            const jobs = await api(R.jobs);
            const job = (jobs.jobs || []).find((item) => item.id === jobId);
            if (!job || job.status === 'running') continue;
            if (job.status === 'done') return { kind: 'success', text: format(job.result || {}), result: job.result };
            const jobStatusText = { failed: '失败', cancelled: '已取消', error: '出错' }[job.status] || '没有完成';
            return { kind: 'error', text: job.error || `任务${jobStatusText}` };
          }
          return { kind: 'warn', text: '任务仍在后台运行，稍后刷新查看' };
        } catch (e) {
          return { kind: 'error', text: String(e?.message || e) };
        } finally {
          ctl.busy = false;
        }
      };
    }

    // ── 数据 hooks ────────────────────────────────────────────
    function useApi() {
      const [state, setState] = useState(null);
      const [config, setConfig] = useState(null);
      const [hasApiKey, setHasApiKey] = useState(false);
      const [hasEasyScholarKey, setHasEasyScholarKey] = useState(false);
      const [hasInstitutionalCookie, setHasInstitutionalCookie] = useState(false);
      const [error, setError] = useState(null);
      const [busy, setBusy] = useState(false);

      const reload = useCallback(async () => {
        setBusy(true);
        try {
          const [s, c] = await Promise.all([api(`${R.state}?limit=100`), api(R.config)]);
          setState(s);
          setConfig(c.config);
          setHasApiKey(Boolean(c.hasApiKey));
          setHasEasyScholarKey(Boolean(c.hasEasyScholarKey));
          setHasInstitutionalCookie(Boolean(c.hasInstitutionalCookie));
          setError(null);
        } catch (e) {
          setError(String(e?.message || e));
        } finally {
          setBusy(false);
        }
      }, []);

      useEffect(() => { reload(); }, [reload]);

      const loadMore = useCallback(async () => {
        if (!state || (state.papers?.length || 0) >= (state.total || 0)) return;
        setBusy(true);
        try {
          const d = await api(`${R.state}?limit=100&offset=${state.papers.length}`);
          setState((prev) => prev ? {
            ...prev,
            papers: [...prev.papers, ...d.papers],
            offset: d.offset,
            limit: d.limit,
            total: d.total,
          } : prev);
        } catch (e) { setError(String(e?.message || e)); }
        finally { setBusy(false); }
      }, [state]);

      const saveConfig = useCallback(async (patch) => {
        setBusy(true);
        try {
          const d = await postJson(R.config, patch);
          setConfig(d.config);
          setHasApiKey(Boolean(d.hasApiKey));
          setHasEasyScholarKey(Boolean(d.hasEasyScholarKey));
          if (typeof d.hasInstitutionalCookie === 'boolean') setHasInstitutionalCookie(d.hasInstitutionalCookie);
          setError(null);
          return true;
        } catch (e) { setError(String(e?.message || e)); return false; }
        finally { setBusy(false); }
      }, []);

      const overridePaper = useCallback(async (id, patch) => {
        try {
          const d = await postJson(R.paperOverride, { id, ...patch });
          await reload();
          return d;
        } catch (e) {
          setError(String(e?.message || e));
          throw e;
        }
      }, [reload]);

      const runDiscover = useCallback(async (only) => {
        setBusy(true);
        try {
          const d = await postJson(R.discover, Array.isArray(only) && only.length ? { only } : {});
          await reload();
          return d;
        } catch (e) { setError(String(e?.message || e)); return null; }
        finally { setBusy(false); }
      }, [reload]);

      const saveCredential = useCallback(async (key) => {
        try {
          const d = await postJson(R.credentials, { zoteroApiKey: String(key || '') });
          setHasApiKey(Boolean(d.hasApiKey));
          setHasEasyScholarKey(Boolean(d.hasEasyScholarKey));
          setHasInstitutionalCookie(Boolean(d.hasInstitutionalCookie));
          return true;
        } catch (e) { setError(String(e?.message || e)); return false; }
      }, []);

      /** 机构会话 Cookie：只写不读回；空串表示清除。 */
      const saveInstitutionalCookie = useCallback(async (cookie) => {
        try {
          const d = await postJson(R.credentials, { institutionalCookie: String(cookie || '') });
          setHasInstitutionalCookie(Boolean(d.hasInstitutionalCookie));
          return true;
        } catch (e) { setError(String(e?.message || e)); return false; }
      }, []);

      /** 机构访问自检：拿一个链接真的试一次，返回分类结果（不写任何状态）。 */
      const testAccess = useCallback(async (url) => postJson(R.accessTest, { url: String(url || '') }), []);

      /**
       * easyScholar key 走同一个凭据接口，只是 body 字段不同。
       * 空串＝清除；返回 boolean 让设置页能区分成功与失败。
       */
      const saveEasyScholarKey = useCallback(async (key) => {
        try {
          const d = await postJson(R.credentials, { easyScholarKey: String(key || '') });
          setHasApiKey(Boolean(d.hasApiKey));
          setHasEasyScholarKey(Boolean(d.hasEasyScholarKey));
          return true;
        } catch (e) { setError(String(e?.message || e)); return false; }
      }, []);

      // 阅读队列：标已读 / 未读（单条或批量），成功后重新拉 state
      const markPaperRead = useCallback(async (idOrIds, read = true) => {
        const payload = Array.isArray(idOrIds) ? { ids: idOrIds, read } : { id: idOrIds, read };
        try {
          await postJson(R.paperRead, payload);
          await reload();
          return true;
        } catch (e) { setError(String(e?.message || e)); return false; }
      }, [reload]);

      // hasEasyScholarKey 是设置页 easyScholar 卡片的已有标记：读不到就当 false。
      const translatePaper = useCallback(async (id, force = false) => {
        try {
          const d = await postJson(R.paperTranslate, { id, force });
          await reload();
          return d;
        } catch (e) { setError(String(e?.message || e)); throw e; }
      }, [reload]);

      return { state, config, error, busy, reload, loadMore, saveConfig, saveCredential, saveEasyScholarKey, saveInstitutionalCookie, testAccess, hasApiKey, hasEasyScholarKey, hasInstitutionalCookie, runDiscover, setConfig, overridePaper, markPaperRead, translatePaper };
    }

    // ── 概览 ──────────────────────────────────────────────────
    const LOOKUP_REASON = {
      'not-matched': '未匹配到同一篇',
      'no-abstract': '来源没有摘要',
      'doi-not-found': 'DOI 查不到',
      'crossref-miss': 'Crossref 也没有',
      'arxiv-miss': 'arXiv 查不到',
      'arxiv-error': 'arXiv 请求失败',
      'title-search-error': '题名检索失败',
      'nothing-to-look-up': '没有可检索的标识',
    };

    /** 把 abstract_lookup.reason 转成人话；认不出的码原样显示，不猜。 */
    function reasonText(code) {
      if (!code) return '原因未记录';
      if (LOOKUP_REASON[code]) return LOOKUP_REASON[code];
      if (/^similarity/i.test(code)) return `题名相似度不足（${code}）`;
      return code;
    }

    function PaperRow({ p, onUpload, onOverride, onRerun, onOpen }) {
      const [open, setOpen] = useState(false);
      const [editing, setEditing] = useState(false);
      const [confirmRerun, setConfirmRerun] = useState(false);
      const hist = (p.grade_history || []).slice(-1)[0];
      const abstract = p.abstract || '';
      const canExpand = abstract.length > 180;
      const lookup = p.abstract_lookup;
      const l1 = p.l1;
      return h('div', {
        style: {
          display: 'flex', gap: 12, alignItems: 'flex-start',
          padding: '11px 0', borderTop: `1px solid ${C.border1}`,
        },
      },
        h('div', { style: { flexShrink: 0, width: 20 } },
          h(GradeBadge, { grade: p.grade }),
        ),
        h('div', { style: { flex: 1, minWidth: 0 } },
          h('div', {
            style: {
              fontSize: fs(14), color: C.label1, fontWeight: 500,
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              cursor: onOpen ? 'pointer' : 'default',
            },
            title: onOpen ? `${p.title}（点击查看详情）` : p.title,
            role: onOpen ? 'button' : undefined,
            tabIndex: onOpen ? 0 : undefined,
            onClick: onOpen ? () => onOpen(p.id) : undefined,
            onKeyDown: onOpen ? (e) => { if (e.key === 'Enter') onOpen(p.id); } : undefined,
          }, p.title || '(无题名)'),
          h('div', {
            style: { fontSize: fs(12.5), color: C.caption, marginTop: 3, display: 'flex', gap: 10, flexWrap: 'wrap' },
          },
            p.doi ? h('span', { style: { fontFamily: FONT_MONO } }, p.doi) : null,
            p.arxiv_id ? h('span', { style: { fontFamily: FONT_MONO } }, p.arxiv_id) : null,
            p.priority ? h(Chip, { tone: C.accent }, '优先') : null,
            p.first_seen ? h('span', null, p.first_seen) : null,
            p.venue ? h('span', null, p.venue) : null,
            p.meta_source ? h('span', { style: { color: C.caption } }, `摘要来源 ${ABSTRACT_SOURCE_LABEL[p.meta_source] || p.meta_source}`) : null,
          ),
          p.venue_tier
            ? h('div', {
              style: { marginTop: 5, display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', fontSize: fs(12.5), color: C.caption },
              title: [
                p.venue_tier.ranks?.cas ? `中科院 ${p.venue_tier.ranks.cas}` : null,
                p.venue_tier.ranks?.xr ? `新锐 ${p.venue_tier.ranks.xr}` : null,
                p.venue_tier.ranks?.jcr ? `JCR ${p.venue_tier.ranks.jcr}` : null,
                p.venue_tier.metrics?.impactFactor ? `IF ${p.venue_tier.metrics.impactFactor}` : null,
              ].filter(Boolean).join(' · '),
            },
              h('span', null, '等级'),
              h(Chip, { tone: C.accent }, p.venue_tier.label),
              p.venue_tier.ranks?.cas ? h('span', null, `中科院 ${p.venue_tier.ranks.cas}`) : null,
              p.venue_tier.metrics?.impactFactor ? h('span', null, `IF ${p.venue_tier.metrics.impactFactor}`) : null)
            : null,
          l1
            ? h('div', { style: { marginTop: 6, display: 'flex', gap: 6, alignItems: 'baseline', flexWrap: 'wrap' } },
              h(Chip, { tone: l1.domain === 'irrelevant' ? C.caption : C.accent }, DOMAIN_LABEL[l1.domain] || l1.domain),
              h(Chip, null, USE_LABEL[l1.use] || l1.use),
              h('span', { style: { fontSize: fs(13), color: C.label2, lineHeight: 1.6, flexBasis: '100%' } },
                `增量：${l1.increment}`))
            : null,
          abstract
            ? h('div', {
              style: {
                fontSize: fs(13), color: C.label3, marginTop: 6, lineHeight: 1.6,
                ...(open
                  ? {}
                  : { display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }),
              },
            }, abstract)
            : (lookup && !lookup.has_abstract
              ? h('div', { style: { fontSize: fs(12.5), color: C.warn, marginTop: 6 } },
                `摘要未取到（${reasonText(lookup.reason)}）`)
              : (p.stage === 'L1'
                ? h('div', { style: { fontSize: fs(12.5), color: C.caption, marginTop: 6 } },
                  '摘要待取（用 literature-lab_fetch_metadata）')
                : null)),
          canExpand
            ? h('button', {
              type: 'button',
              onClick: () => setOpen(!open),
              style: {
                appearance: 'none', border: 'none', background: 'none', padding: 0,
                marginTop: 5, cursor: 'pointer', color: C.accent,
                fontSize: fs(12.5), fontFamily: 'inherit',
              },
            }, open ? '收起摘要' : `展开完整摘要（${abstract.length} 字）`)
            : null,
          hist?.reason
            ? h('div', { style: { fontSize: fs(12.5), color: C.label3, marginTop: 5, lineHeight: 1.55 } },
              `评级理由：${hist.reason}`)
            : null,
        ),
        h('div', { style: { display: 'flex', gap: 6, flexShrink: 0, alignItems: 'center' } },
          p.has_pdf
            ? h('span', {
              title: p.pdf
                ? `${p.pdf}${p.pdf_bytes ? ` · ${Math.round(p.pdf_bytes / 1024)} KB` : ''}`
                : '已有原文',
              style: { fontSize: fs(11.5), color: C.success },
            }, 'PDF')
            : null,
          p.zotero_key ? h('span', { style: { fontSize: fs(11.5), color: C.accent } }, 'Zotero') : null,
          p.translated ? h('span', { style: { fontSize: fs(11.5), color: C.success } }, '译文') : null,
          onOverride
            ? h(Button, { size: 'sm', onClick: () => setEditing(true) }, '改判')
            : null,
          ['L2', 'L3'].includes(p.stage) && onRerun
            ? h(Button, { size: 'sm', onClick: () => setConfirmRerun(true) }, '重跑')
            : null,
          p.stage === 'L2' && !p.has_pdf && onUpload
            ? h('label', {
              style: { fontSize: fs(11.5), color: C.accent, cursor: 'pointer', whiteSpace: 'nowrap' },
            }, '补 PDF',
              h('input', {
                type: 'file', accept: 'application/pdf', style: { display: 'none' },
                onChange: (e) => { const f = e.target.files?.[0]; if (f) onUpload(p.id, f); },
              }))
            : null,
        ),
        editing && onOverride
          ? h(OverrideDialog, {
            paper: p,
            onClose: () => setEditing(false),
            onSubmit: (patch) => onOverride(p.id, patch),
          })
          : null,
        confirmRerun && onRerun
          ? h(ConfirmDialog, {
            title: '重新交给 AI 分析',
            text: '会清除这篇的人工改判标记，然后按当前阶段重跑。人工改判记录仍保留在历史里。',
            confirmLabel: '重跑',
            onClose: () => setConfirmRerun(false),
            onConfirm: () => { setConfirmRerun(false); onRerun(p.id, p.stage); },
          })
          : null,
      );
    }

    // ── 来源页（雷达式）──────────────────────────────────────
    // 分区：采集栏 → 采集记录 → 源列表（点开右侧详情抽屉）→ 研究兴趣摘要 →
    // 渠道配置（默认全部收起）→ 折叠区（历史回溯 / 运行日志 / 布局编辑）。
    // 低频配置（渠道配置、历史回溯、运行日志、布局编辑）默认收起。

    /** 状态键 → 渠道 id；补跑与开关只认渠道级 key（rss:feed、search:q 都归到渠道）。 */
    function sourceChannel(key) {
      const text = String(key || '');
      if (text === 'arxiv') return 'arxiv';
      if (text === 'biorxiv' || text === 'medrxiv') return 'preprint';
      const head = text.split(':')[0];
      if (head === 'rss' || head === 'search' || head === 'pubmed' || head === 'dblp') return head;
      if (head === 'mail' || head === 'email' || head === 'scholar-alert') return 'email';
      return null;
    }

    /** 渠道 id → state.sources 里的源前缀。preprint 落库成 biorxiv/medrxiv 两个源。 */
    const CHANNEL_SOURCES = {
      arxiv: ['arxiv'],
      rss: ['rss'],
      search: ['search'],
      email: ['email', 'mail:', 'scholar-alert'],
      pubmed: ['pubmed'],
      dblp: ['dblp'],
      preprint: ['biorxiv', 'medrxiv'],
    };
    const CHANNEL_IDS = Object.keys(CHANNEL_SOURCES);

    /** 把源错误翻译成用户能判断的一句话；原始信息保留在括号里便于排查。 */
    function sourceErrorText(raw) {
      const text = String(raw || '').trim();
      if (!text) return '上次采集失败';
      const status = text.match(/\b(4\d\d|5\d\d)\b/);
      if (status) {
        const code = Number(status[1]);
        if (code === 403 || code === 401) return `对方拒绝了访问（HTTP ${code}），可能限流或需要登录`;
        if (code === 404) return `地址不存在了（HTTP 404），可能栏目改版`;
        if (code === 429) return '请求太频繁被限流（HTTP 429），稍后再试';
        if (code >= 500) return `对方服务器出错（HTTP ${code}），通常过一会自己恢复`;
        return `请求失败（HTTP ${code}）`;
      }
      if (/timeout|ETIMEDOUT|timed out/i.test(text)) return '连接超时，可能是网络不稳定';
      if (/ENOTFOUND|EAI_AGAIN|getaddrinfo/i.test(text)) return '域名解析失败，检查网络或地址';
      if (/ECONNREFUSED/i.test(text)) return '连接被拒绝，服务可能没开';
      if (/certificate|CERT_/i.test(text)) return '证书校验失败';
      return `采集失败：${text}`;
    }

    /** 邮件段错误原文（search/read/mark ...）→ 一句人话；取不到就原样返回。 */
    function emailErrorText(raw) {
      const text = String(raw || '').trim();
      const search = text.match(/^search\s+([^:]+):\s*(.*)$/);
      if (search) return `读取 ${search[1]} 的邮件失败：${search[2]}`;
      const read = text.match(/^read\s+(\S+):\s*(.*)$/);
      if (read) return `读取一封邮件失败：${read[2]}`;
      const mark = text.match(/^mark\s+(\S+):\s*(.*)$/);
      if (mark) return `标记已读失败：${mark[2]}`;
      return text || '未知错误';
    }

    /** 相对时间：源列表与抽屉只回答「多久没成功」。 */
    function sourceAgo(iso) {
      const at = Date.parse(iso || '');
      if (!Number.isFinite(at)) return '';
      const minutes = Math.max(0, Math.round((Date.now() - at) / 60000));
      if (minutes < 1) return '刚刚';
      if (minutes < 60) return `${minutes} 分钟前`;
      if (minutes < 1440) return `${Math.floor(minutes / 60)} 小时前`;
      return `${Math.floor(minutes / 1440)} 天前`;
    }

    /** 采集范围快捷档：界面按「天」表达，配置里仍存小时。 */
    const RANGE_PRESET_DAYS = [1, 2, 3, 7];

    /** 天 → 小时：夹到 0.5–30 天，按整小时写回，避免浮点尾巴进配置。 */
    function rangeDaysToHours(days) {
      const n = Number(days);
      if (!Number.isFinite(n)) return 48;
      return Math.round(Math.min(30, Math.max(0.5, n)) * 24);
    }

    /** config.window → 卡片草稿；缺省与另一端一致（48 小时 / 漏跑补采 14 天）。 */
    function rangeDraftFromConfig(config) {
      const hours = Number(config?.window?.hours);
      const backfillDays = Number(config?.window?.backfillDays);
      return {
        hours: Number.isFinite(hours) && hours > 0 ? hours : 48,
        backfillDays: Number.isFinite(backfillDays) ? Math.max(0, Math.min(90, backfillDays)) : 14,
      };
    }

    /** 来源 key → 人能读的名字：RSS 用订阅名，检索用手写检索式，其余用渠道名。 */
    function RadarSourceName(key, channels) {
      const text = String(key || '');
      const cut = text.indexOf(':');
      const head = cut >= 0 ? text.slice(0, cut) : text;
      const tail = cut >= 0 ? text.slice(cut + 1) : '';
      if (head === 'rss') {
        const feed = (Array.isArray(channels?.rss) ? channels.rss : []).find((item) => item.id === tail);
        return feed?.name || 'RSS 订阅';
      }
      if (head === 'search') {
        const query = (Array.isArray(channels?.search?.queries) ? channels.search.queries : [])
          .find((item) => item.id === tail);
        return query?.text ? `检索「${query.text}」` : '跨库检索';
      }
      if (head === 'pubmed') return tail ? `PubMed「${tail}」` : 'PubMed / Europe PMC';
      if (head === 'dblp') return tail ? `DBLP「${tail}」` : 'DBLP';
      if (text === 'biorxiv') return 'bioRxiv';
      if (text === 'medrxiv') return 'medRxiv';
      if (text.startsWith('ingest:')) return `导入 · ${tail || '手动'}`;
      const channel = sourceChannel(text);
      return channel ? (RADAR_LABELS[channel] || channel) : (text || '未知来源');
    }

    /** 候选的 sources 数组 → 来源标签（去重，最多 4 个）。 */
    function RadarSourceTags(sources) {
      const list = Array.isArray(sources) ? sources : [];
      const tags = [];
      for (const raw of list) {
        const key = String(raw || '');
        const channel = sourceChannel(key);
        let label = '';
        if (key === 'arxiv') label = 'arXiv';
        else if (key === 'biorxiv') label = 'bioRxiv';
        else if (key === 'medrxiv') label = 'medRxiv';
        else if (channel === 'rss') label = 'RSS';
        else if (channel === 'search') label = '检索';
        else if (channel === 'email') label = '邮件';
        else if (channel === 'pubmed') label = 'PubMed';
        else if (channel === 'dblp') label = 'DBLP';
        else if (channel === 'preprint') label = '预印本';
        else if (key.startsWith('ingest:')) label = '导入';
        else if (channel) label = RADAR_LABELS[channel] || channel;
        else label = key;
        if (label && !tags.includes(label)) tags.push(label);
        if (tags.length >= 4) break;
      }
      return tags;
    }

    /** 抓到的时刻：今天只显示时:分，更早显示月-日。 */
    function RadarClock(iso) {
      const at = Date.parse(iso || '');
      if (!Number.isFinite(at)) return '';
      const date = new Date(at);
      const now = new Date();
      const two = (n) => String(n).padStart(2, '0');
      const sameDay = date.getFullYear() === now.getFullYear()
        && date.getMonth() === now.getMonth() && date.getDate() === now.getDate();
      return sameDay
        ? `${two(date.getHours())}:${two(date.getMinutes())}`
        : `${two(date.getMonth() + 1)}-${two(date.getDate())}`;
    }

    /** 下次运行的人话：今天 / 明天 / 月-日 + 时:分。 */
    function RadarWhen(iso) {
      const at = Date.parse(iso || '');
      if (!Number.isFinite(at)) return '';
      const date = new Date(at);
      const now = new Date();
      const two = (n) => String(n).padStart(2, '0');
      const clock = `${two(date.getHours())}:${two(date.getMinutes())}`;
      const dayStart = (value) => new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime();
      const days = Math.round((dayStart(date) - dayStart(now)) / 86400000);
      if (days === 0) return `今天 ${clock}`;
      if (days === 1) return `明天 ${clock}`;
      return `${two(date.getMonth() + 1)}-${two(date.getDate())} ${clock}`;
    }

    /** 近 7 天每个源抓到多少条：从 state.runs 的每源明细聚合。 */
    function RadarWeekCounts(state) {
      const since = Date.now() - 7 * 86400000;
      const counts = {};
      for (const run of (Array.isArray(state?.runs) ? state.runs : [])) {
        const at = Date.parse(run?.at || '');
        if (Number.isFinite(at) && at < since) continue;
        for (const item of (Array.isArray(run?.sources) ? run.sources : [])) {
          const key = String(item?.key || '');
          const count = Number(item?.count) || 0;
          // 部分失败也照样算采集量：ok=false 只表示这一轮有错误，不代表 0 条。
          if (!key || count <= 0) continue;
          counts[key] = (counts[key] || 0) + count;
        }
      }
      return counts;
    }

    /**
     * 每个源在 state.runs 里最近一条记录：采集到多少条、该轮过滤/排除多少、补跑是否被截断。
     * 过滤/排除在服务端只有整轮口径（按渠道拆不开），行里写成「本轮」避免被当成单源数字。
     */
    function RadarRunStats(state) {
      const runs = (Array.isArray(state?.runs) ? state.runs : []).slice()
        .sort((a, b) => String(b?.at || b?.date || '').localeCompare(String(a?.at || a?.date || '')));
      const map = {};
      for (const run of runs) {
        for (const item of (Array.isArray(run?.sources) ? run.sources : [])) {
          const key = String(item?.key || '');
          if (!key || map[key]) continue;
          map[key] = {
            date: run.date || '',
            count: Number(item.count) || 0,
            scanned: Number(run.scanned) || 0,
            filtered: Number(run.filtered) || 0,
            excluded: Number(run.excluded) || 0,
            truncated: Boolean(item.backfill_truncated),
            ok: item.ok !== false,
          };
        }
      }
      return map;
    }

    /** 状态点：绿=正常 / 红=失败 / 黄=未配置 / 灰=未运行 / 空心=已停用。 */
    function RadarDot({ failed, ran, off, tone }) {
      const hollow = Boolean(off) || tone === 'off';
      const color = tone === 'missing' ? C.warn
        : (tone === 'fail' || failed) ? C.error
          : (tone === 'ok' || ran) ? C.success
            : C.label3;
      return h('span', {
        'aria-hidden': 'true',
        style: {
          width: 8, height: 8, borderRadius: '50%', flexShrink: 0, boxSizing: 'border-box',
          background: hollow ? 'transparent' : color,
          border: hollow ? `1.5px solid ${C.borderStrong}` : 'none',
        },
      });
    }

    /**
     * 采集栏：状态 + 立即采集 + 收起式采集设置。
     * 调度走 R.schedule；回看范围走 config.window（改动即保存）。
     */
    function RadarScanBar({ config, saveConfig, enabledCount, localBusy, onRunAll, onAddPaper }) {
      const [draft, setDraft] = useState(() => rangeDraftFromConfig(config));
      const [pending, setPending] = useState(0);
      const [msg, setMsg] = useState(null);
      const [schedule, setSchedule] = useState(null);
      const [timeDraft, setTimeDraft] = useState('07:00');
      const [savingSchedule, setSavingSchedule] = useState(false);
      const [open, setOpen] = useState(false);
      const [custom, setCustom] = useState(false);
      const [customValue, setCustomValue] = useState('');

      useEffect(() => {
        if (pending > 0) return;
        setDraft(rangeDraftFromConfig(config));
      }, [config, pending]);

      const loadSchedule = useCallback(async () => {
        try {
          const data = await api(R.schedule);
          setSchedule(data.schedule || null);
          setTimeDraft(data.schedule?.time || '07:00');
          setMsg(null);
        } catch (error) {
          setMsg({ kind: 'error', text: `读取自动采集设置失败：${error?.message || error}` });
        }
      }, []);
      useEffect(() => { loadSchedule(); }, [loadSchedule]);

      const saveSchedule = async (enabled, time, autoAnalyze = schedule?.autoAnalyze === true) => {
        setSavingSchedule(true);
        try {
          const data = await postJson(R.schedule, { enabled, time, autoAnalyze });
          setSchedule(data.schedule
            ? { ...data.schedule, autoAnalyze: typeof data.schedule.autoAnalyze === 'boolean' ? data.schedule.autoAnalyze : autoAnalyze }
            : null);
          setTimeDraft(data.schedule?.time || time);
          setMsg(null);
        } catch (error) {
          setMsg({ kind: 'error', text: `自动采集保存失败：${error?.message || error}` });
        } finally { setSavingSchedule(false); }
      };

      // 时间离开输入框或回车即生效，不设单独的「应用时间」按钮。
      const commitTime = async () => {
        if (!schedule) {
          setMsg({ kind: 'error', text: '自动采集设置读取失败，请重试读取' });
          return;
        }
        const raw = String(timeDraft || '').trim();
        if (!raw) { setTimeDraft(schedule?.time || '07:00'); return; }
        const match = /^(\d{1,2}):(\d{2})$/.exec(raw);
        if (!match) {
          setMsg({ kind: 'error', text: '时间格式应为 08:30（24 小时制）' });
          setTimeDraft(schedule?.time || '07:00');
          return;
        }
        const hour = Number(match[1]);
        const minute = Number(match[2]);
        if (hour > 23 || minute > 59) {
          setMsg({ kind: 'error', text: '小时需在 0–23、分钟在 0–59 之间' });
          setTimeDraft(schedule?.time || '07:00');
          return;
        }
        const normalized = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
        setTimeDraft(normalized);
        if (normalized === schedule?.time) return;
        await saveSchedule(Boolean(schedule?.enabled), normalized);
      };

      const commitRange = async (next) => {
        setDraft(next);
        setPending((n) => n + 1);
        try {
          const ok = await saveConfig({ window: { hours: next.hours, backfillDays: draft.backfillDays } });
          if (!ok) {
            setMsg({ kind: 'error', text: '采集设置保存失败：配置未写入，可重试' });
            return;
          }
          setMsg(null);
        } catch (error) {
          setMsg({ kind: 'error', text: `采集设置保存失败：${error?.message || error}` });
        } finally {
          setPending((n) => Math.max(0, n - 1));
        }
      };

      const startCustom = (value) => {
        setCustom(true);
        setCustomValue(String(value));
      };
      const commitCustom = () => {
        const n = Number(customValue);
        if (Number.isFinite(n) && n > 0) commitRange({ ...draft, hours: rangeDaysToHours(n) });
        setCustom(false);
      };

      const days = Math.round((draft.hours / 24) * 100) / 100;
      const caption = { fontSize: fs(T.font.hint), color: C.caption };
      const bodyText = { fontSize: fs(T.font.body), color: C.label2 };
      const rowStyle = { display: 'flex', alignItems: 'center', gap: T.space.sm, flexWrap: 'wrap' };
      const groupLabel = {
        width: 78, flex: 'none',
        fontSize: fs(T.font.body), fontWeight: 600, color: C.label1, whiteSpace: 'nowrap',
      };

      const channelText = enabledCount ? `${enabledCount} 个渠道已启用` : '还没有启用渠道';
      const statusText = !schedule
        ? (msg?.kind === 'error' ? '采集设置读取失败' : '读取设置中…')
        : schedule.enabled
          ? `自动采集 · 每天 ${schedule.time || timeDraft}${schedule.autoAnalyze ? ' · 采集后自动分析' : ''} · 下次 ${RadarWhen(schedule?.next_run_at) || '未排期'} · ${channelText}`
          : `自动采集已关闭 · ${channelText}`;
      const dotTone = !schedule ? C.label3 : schedule.enabled ? C.success : C.label3;

      return h(Card, { style: { marginBottom: T.space.md, padding: '12px 18px' } },
        h('div', { style: { ...rowStyle, minHeight: 32 } },
          h('span', { style: { fontSize: fs(15), fontWeight: 600, color: C.label1, whiteSpace: 'nowrap' } }, '采集'),
          h('span', { style: { ...caption, display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' } },
            h('i', { style: { width: 6, height: 6, borderRadius: '50%', background: dotTone, flex: 'none' } }),
            statusText),
          h('div', { style: { marginLeft: 'auto', display: 'flex', gap: T.space.xs, alignItems: 'center' } },
            // 三个动作同尺寸：立即采集是主操作，手动添加是另一种入口，设置放最后
            h(Button, { size: 'sm', primary: true, disabled: localBusy, onClick: onRunAll },
              localBusy ? '采集中…' : '立即采集'),
            onAddPaper ? h(Button, { size: 'sm', onClick: onAddPaper }, '手动添加论文') : null,
            h(Button, { size: 'sm', onClick: () => setOpen((value) => !value) },
              open ? '收起设置' : '采集设置'))),
        open
          ? h('div', {
            style: {
              marginTop: 12, paddingTop: 12, borderTop: `1px solid ${C.border1}`,
              display: 'grid', gap: 10,
            },
          },
            h('div', { style: rowStyle },
              h('span', { style: groupLabel }, '自动采集'),
              h(Switch, {
                checked: Boolean(schedule?.enabled),
                onChange: (value) => {
                  if (!schedule) { loadSchedule(); return; }
                  saveSchedule(value, timeDraft);
                },
                ariaLabel: '自动采集',
              }),
              h('span', { style: caption }, '每天'),
              h('div', { style: { width: 108 } },
                h(TextInput, {
                  type: 'time', value: timeDraft, mono: true,
                  label: '每天自动采集的时间（24 小时制）',
                  onChange: setTimeDraft,
                  onBlur: commitTime,
                  onKeyDown: (e) => { if (e.key === 'Enter') e.currentTarget?.blur?.(); },
                })),
              !schedule
                ? h('span', { style: caption }, msg?.kind === 'error' ? '设置读取失败' : '读取设置中…')
                : h('span', { style: caption },
                  schedule.enabled
                    ? `下次 ${RadarWhen(schedule?.next_run_at) || '未排期'}`
                    : '关闭后只能手动采集'),
              savingSchedule ? h('span', { style: caption }, '保存中…') : null,
              schedule === null && msg?.kind === 'error'
                ? h(Button, { size: 'sm', onClick: loadSchedule }, '重试读取')
                : null),
            h('div', { style: rowStyle },
              h('span', { style: { ...groupLabel, width: 100 } }, '采集后自动分析'),
              h(Switch, {
                checked: Boolean(schedule?.autoAnalyze),
                onChange: (value) => {
                  if (!schedule) { loadSchedule(); return; }
                  saveSchedule(Boolean(schedule.enabled), timeDraft, value);
                },
                ariaLabel: '采集后自动分析',
              }),
              h('span', { style: caption }, '采集完成后自动跑摘要判读、初筛、精读，会消耗每日 AI 额度')),
            h('div', { style: rowStyle },
              h('span', { style: bodyText }, '每次采集会把最近 '),
              custom
                ? h('span', { style: { display: 'inline-flex', alignItems: 'center', gap: 6 } },
                  h(TextInput, {
                    type: 'number', value: customValue, mono: true, width: 78,
                    label: '自定义回看天数（0.5–30）',
                    onChange: setCustomValue,
                    onBlur: commitCustom,
                    onKeyDown: (e) => { if (e.key === 'Enter') e.currentTarget?.blur?.(); },
                  }),
                  h('span', { style: bodyText }, '天'))
                : h(Menu, {
                  label: `${days} 天`,
                  items: [
                    ...RANGE_PRESET_DAYS.map((d) => ({
                      key: String(d), label: `${d} 天`,
                      onClick: () => commitRange({ ...draft, hours: rangeDaysToHours(d) }),
                    })),
                    { key: 'custom', label: '自定义', onClick: () => startCustom(days) },
                  ],
                }),
              h('span', { style: bodyText }, ' 的内容再查一遍。')),
            h('div', { style: { ...caption, marginTop: -4 } }, '查得越久越不容易漏，但重复也会更多。'),
            pending > 0 ? h('div', { style: caption }, '保存中…') : null)
          : null,
        msg && msg.kind === 'error'
          ? h('div', { style: { marginTop: 8 } }, h(Notice, { kind: msg.kind }, msg.text))
          : null);
    }

    /** 采集概况：窗口 7/30 天，双条账本（采集 → 去重 → 去向）+ 来源柱。 */
    const SOURCE_CHANNEL_LABEL = {
      arxiv: 'arXiv', rss: 'RSS', search: '跨库', pubmed: 'PubMed', dblp: 'DBLP',
      preprint: '预印本', email: '邮件', manual: '手动', ingest: '导入',
    };
    const SOURCE_ZERO_ORDER = ['arxiv', 'rss', 'search', 'pubmed', 'dblp', 'preprint', 'email'];

    function overviewSourceId(key) {
      const text = String(key || '');
      if (text === 'arxiv') return 'arxiv';
      if (text.startsWith('rss')) return 'rss';
      if (text.startsWith('search')) return 'search';
      if (text.startsWith('pubmed')) return 'pubmed';
      if (text.startsWith('dblp')) return 'dblp';
      if (text === 'biorxiv' || text === 'medrxiv' || text.startsWith('preprint')) return 'preprint';
      if (text === 'email' || text.startsWith('mail')) return 'email';
      if (text === 'manual') return 'manual';
      if (text.startsWith('ingest')) return 'ingest';
      return text;
    }

    function useNarrowLayout(breakpoint = 820) {
      const read = () => (typeof window !== 'undefined' && typeof window.innerWidth === 'number'
        ? window.innerWidth < breakpoint
        : false);
      const [narrow, setNarrow] = useState(read);
      useEffect(() => {
        if (typeof window === 'undefined' || !window.addEventListener) return undefined;
        const onResize = () => setNarrow(read());
        window.addEventListener('resize', onResize);
        return () => window.removeEventListener('resize', onResize);
      }, []);
      return narrow;
    }

    function RadarOverviewCard({ state, onOpenRecord }) {
      const runs = Array.isArray(state?.runs) ? state.runs : [];
      const [days, setDays] = useState(7);
      const narrow = useNarrowLayout();
      const since = Date.now() - days * 86400000;
      const inWindow = runs.filter((run) => {
        const at = Date.parse(run?.at || run?.date || '');
        return Number.isFinite(at) && at >= since;
      });
      const sum = (key) => inWindow.reduce((acc, run) => acc + (Number(run?.[key]) || 0), 0);
      const scanned = sum('scanned');
      const added = sum('added');
      const merged = sum('merged');
      const filtered = sum('filtered');
      const excluded = sum('excluded');
      const owned = sum('owned');
      const known = sum('skippedKnown');
      const dedup = Math.max(0, scanned - merged - known);
      const repeat = merged + known;
      const dedupPct = scanned ? (dedup / scanned) * 100 : 0;
      const repeatPct = scanned ? (repeat / scanned) * 100 : 0;
      const accountPct = (value) => (dedup ? (value / dedup) * 100 : 0);
      const lastProductive = runs.find((run) => (Number(run?.scanned) || 0) > 0) || null;

      const sourceTotals = {};
      inWindow.forEach((run) => {
        (run?.sources || []).forEach((source) => {
          const count = Number(source?.count) || 0;
          if (!count) return;
          const id = overviewSourceId(source.key);
          sourceTotals[id] = (sourceTotals[id] || 0) + count;
        });
      });
      const sourceTotal = Object.values(sourceTotals).reduce((acc, value) => acc + value, 0);
      const sourceRows = Object.entries(sourceTotals)
        .map(([id, count]) => ({ id, count, label: SOURCE_CHANNEL_LABEL[id] || id }))
        .sort((a, b) => b.count - a.count);
      const zeroRows = SOURCE_ZERO_ORDER
        .filter((id) => !sourceTotals[id])
        .map((id) => ({ id, label: SOURCE_CHANNEL_LABEL[id] || id }));

      const counts = state?.summary?.counts || {};
      const stageCounts = state?.summary?.stages || {};
      const nextAi = (Number(counts.new) || 0) + (Number(stageCounts.L2) || 0) + (Number(stageCounts.L3) || 0);
      const doneCount = Number(stageCounts.done) || 0;
      const filteredCount = (Number(counts.filtered) || 0) + (Number(counts.excluded) || 0);
      const analyzingCount = Number(counts.analyzing) || 0;
      const failedCount = Number(counts.failed) || 0;
      const droppedCount = Number(counts.dropped) || 0;
      const papers = Array.isArray(state?.papers) ? state.papers : [];
      const cards = papers.filter((paper) => paper?.l3?.card_markdown).length;
      const library = Number(state?.summary?.library) || 0;

      const caption = { fontSize: fs(T.font.hint), color: C.caption };
      const strong = { fontWeight: 600, color: C.label1, fontVariantNumeric: 'tabular-nums' };
      const lastWhen = lastProductive ? (RadarWhen(lastProductive.at || lastProductive.date) || '') : '';
      const lastOwned = Number(lastProductive?.owned) || 0;
      const lastKnown = Number(lastProductive?.skippedKnown) || 0;
      const lastExtras = [
        lastOwned ? `已在 Zotero ${lastOwned} 条` : '',
        lastKnown ? `已建论文 ${lastKnown} 条` : '',
      ].filter(Boolean).join(' · ');
      const lastText = lastProductive
        ? `上一轮 ${lastWhen} · 采集到 ${Number(lastProductive.scanned) || 0} 条：重复 ${Number(lastProductive.merged) || 0} · 过滤 ${Number(lastProductive.filtered) || 0} · 排除 ${Number(lastProductive.excluded) || 0} · 候选 ${Number(lastProductive.added) || 0}${lastExtras ? ` · ${lastExtras}` : ''}`
        : '暂无采集轮次';
      const windowText = scanned
        ? `近 ${days} 天采集到 ${scanned} 条，其中重复或已建 ${repeat} 条，去重后 ${dedup} 条；进入 AI 队列 ${added} 条，关键词过滤 ${filtered} 条，命中排除词 ${excluded} 条${owned ? `，已在 Zotero ${owned} 条` : ''}。`
        : `近 ${days} 天还没有采集记录。`;
      const legend = [
        added ? { key: 'added', label: '进入 AI 队列', value: added, tone: C.accent } : null,
        filtered ? { key: 'filtered', label: '关键词过滤', value: filtered, tone: C.warn } : null,
        excluded ? { key: 'excluded', label: '命中排除词', value: excluded, tone: C.error } : null,
        owned ? { key: 'owned', label: '已在 Zotero', value: owned, tone: C.label3 } : null,
      ].filter(Boolean);

      return h(Card, { style: { marginBottom: T.space.md } },
        h('div', { style: { display: 'flex', alignItems: 'baseline', gap: T.space.sm, flexWrap: 'wrap' } },
          h('div', { style: { flex: 1, minWidth: 160, fontSize: fs(16), fontWeight: 600, color: C.label1 } }, '采集概况'),
          h('div', { style: { display: 'flex', alignItems: 'center', gap: T.space.xs } },
            h(Button, { size: 'sm', primary: days === 7, onClick: () => setDays(7) }, '近 7 天'),
            h(Button, { size: 'sm', primary: days === 30, onClick: () => setDays(30) }, '近 30 天'),
            h('span', { style: { ...caption, marginLeft: T.space.xs } }, `${inWindow.length} 轮`))),
        h('div', {
          style: {
            display: 'flex', gap: narrow ? T.space.md : 28, marginTop: 14,
            flexDirection: narrow ? 'column' : 'row', alignItems: 'stretch',
          },
        },
          h('div', { style: { flex: narrow ? 'none' : '1.6 1 0', minWidth: 0 } },
            h('div', { style: { ...caption, lineHeight: T.line.body } }, lastText),
            h('div', {
              role: 'img', 'aria-label': windowText,
              style: {
                marginTop: 12, borderTop: `1px solid ${C.border1}`, paddingTop: 10,
              },
            },
              h('div', { style: { display: 'flex', alignItems: 'baseline', gap: 10 } },
                h('span', { style: { ...caption, fontWeight: 600, color: C.label2 } }, `近 ${days} 天合计`),
                h('span', { style: { ...caption, marginLeft: 'auto' } },
                  '采集到 ', h('b', { style: strong }, String(scanned)), ' 条（含重复）')),
              scanned
                ? h('div', { style: { display: 'flex', height: 10, marginTop: 7, borderRadius: 5, overflow: 'hidden', background: C.bg2 } },
                  h('span', { style: { width: `${dedupPct}%`, background: tint(C.label1, 14) } }),
                  h('span', {
                    style: {
                      width: `${repeatPct}%`,
                      background: `repeating-linear-gradient(135deg, ${tint(C.label1, 12)} 0 3px, transparent 3px 6px)`,
                    },
                  }))
                : h('div', { style: { ...caption, marginTop: 8 } }, '还没有采集记录'),
              scanned
                ? h('div', { style: { display: 'flex', alignItems: 'baseline', marginTop: 6, ...caption } },
                  h('span', null, '去重后 ', h('b', { style: strong }, String(dedup)), ' 条'),
                  repeat
                    ? h('span', { style: { marginLeft: 'auto' } },
                      known ? '重复或已建 ' : '已采集过 ', h('b', { style: strong }, String(repeat)), ' 条')
                    : null)
                : null,
              scanned && dedup
                ? h('div', { style: { display: 'flex', width: `${dedupPct}%`, height: 18, borderRadius: 6, overflow: 'hidden', background: C.bg2, marginTop: 6 } },
                  added ? h('span', { style: { width: `${accountPct(added)}%`, background: C.accent } }) : null,
                  filtered ? h('span', { style: { width: `${accountPct(filtered)}%`, background: C.warn } }) : null,
                  excluded ? h('span', { style: { width: `${accountPct(excluded)}%`, background: C.error } }) : null,
                  owned ? h('span', { style: { width: `${accountPct(owned)}%`, background: C.label3 } }) : null)
                : null,
              legend.length
                ? h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '6px 16px', marginTop: 8, ...caption } },
                  legend.map((item) => h('span', { key: item.key, style: { display: 'inline-flex', alignItems: 'center', gap: 6 } },
                    h('i', { style: { width: 8, height: 8, borderRadius: 2, background: item.tone } }),
                    item.label, ' ', h('b', { style: strong }, String(item.value)),
                    h('span', { style: { color: C.label3, marginLeft: 4 } }, `${Math.round(accountPct(item.value))}%`))))
                : null)),
          h('div', {
            style: {
              flex: narrow ? 'none' : '0 1 34%', minWidth: narrow ? 0 : 280,
              maxWidth: narrow ? undefined : 420,
              borderLeft: narrow ? 'none' : `1px solid ${C.border1}`,
              paddingLeft: narrow ? 0 : 28,
              borderTop: narrow ? `1px solid ${C.border1}` : 'none',
              paddingTop: narrow ? 14 : 0,
            },
          },
            h('div', { style: { ...caption, fontWeight: 600, color: C.label2 } }, `来源 · 近 ${days} 天采集`),
            h('div', { style: { ...caption, marginTop: 4, lineHeight: T.line.body } }, '含重复；一根条 = 该渠道抓到的条目数'),
            sourceRows.length
              ? h('div', { style: { marginTop: 10, display: 'grid', gap: 10 } },
                sourceRows.map((row) => h('div', {
                  key: row.id,
                  style: { display: 'grid', gridTemplateColumns: '74px 1fr 44px', alignItems: 'center', gap: 10 },
                },
                  h('span', { style: { ...caption, color: C.label1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, row.label),
                  h('div', { style: { height: 10, borderRadius: 5, background: C.bg2, overflow: 'hidden' } },
                    h('div', {
                      style: {
                        height: '100%', borderRadius: 5, background: tint(C.accent, 42),
                        width: `${sourceTotal ? (row.count / sourceTotal) * 100 : 0}%`,
                      },
                    })),
                  h('span', { style: { textAlign: 'right', ...caption, fontWeight: 600, color: C.label1 } }, String(row.count)))))
              : h('div', { style: { ...caption, marginTop: 10 } }, '还没有来源数据'),
            sourceRows.length && zeroRows.length
              ? h('div', { style: { ...caption, marginTop: 10, lineHeight: T.line.body } },
                `其余 ${zeroRows.map((row) => row.label).join('、')}：0 条`)
              : null)),
        onOpenRecord
          ? h('div', { style: { marginTop: 14, paddingTop: 10, borderTop: `1px solid ${C.border1}`, display: 'flex', justifyContent: 'flex-end' } },
            h(Button, { size: 'sm', onClick: onOpenRecord }, '查看采集记录'))
          : null);
    }

    /** 刚扫到什么：最近进候选池的 8 条；点标题直接打开这一条的候选详情。 */
    /** 采集历史：每轮的结果、来源与失败原因；刷新后仍在。 */
    function historyStamp(run) {
      const date = new Date(run?.at || run?.date || '');
      if (!Number.isFinite(date.getTime())) return String(run?.date || '');
      const pad = (n) => String(n).padStart(2, '0');
      return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
    }

    function historyChannels(run) {
      const ids = new Set((run?.sources || []).map((source) => overviewSourceId(source?.key)));
      if (run?.kind === 'email') ids.add('email');
      if (run?.kind === 'manual') ids.add('manual');
      if (run?.kind === 'ingest') ids.add('ingest');
      const labels = [...ids].map((id) => SOURCE_CHANNEL_LABEL[id] || id);
      return labels.join(' / ') || '采集';
    }

    function historyStats(run) {
      const scanned = Number(run?.scanned) || 0;
      const added = Number(run?.added) || 0;
      const filtered = Number(run?.filtered) || 0;
      const merged = Number(run?.merged) || 0;
      if (run?.kind === 'email') {
        return `邮件 ${Number(run.emails) || 0} 封 · 解析 ${Number(run.parsed) || 0} 条 · 新增 ${added} 条`
          + (filtered ? ` · 过滤 ${filtered} 条` : '');
      }
      return `采集 ${scanned} 条 · 新增 ${added} 条`
        + (filtered ? ` · 过滤 ${filtered} 条` : '')
        + (merged ? ` · 合并 ${merged} 条` : '');
    }

    function historyErrors(run) {
      const errors = [];
      if (Array.isArray(run?.errors)) {
        for (const raw of run.errors) errors.push(emailErrorText(raw));
      }
      for (const source of run?.sources || []) {
        if (source && source.ok === false && source.error) {
          const label = SOURCE_CHANNEL_LABEL[overviewSourceId(source.key)] || source.label || source.key;
          errors.push(`${label}：${sourceErrorText(source.error)}`);
        }
      }
      return [...new Set(errors)];
    }

    function RadarHistoryCard({ state }) {
      // 采集历史只显示采集轮次；AI 分析轮次留在 run 账本/待办，不混进采集历史。
      const runs = Array.isArray(state?.runs) ? state.runs.filter((run) => run?.kind !== 'analysis').slice(0, 30) : [];
      const [expanded, setExpanded] = useState(null);
      const [showAll, setShowAll] = useState(false);
      const visible = showAll ? runs : runs.slice(0, 5);
      const caption = { fontSize: fs(T.font.hint), color: C.caption };
      const body = { fontSize: fs(T.font.body), color: C.label1 };

      return h(Card, { style: { marginBottom: T.space.md } },
        h(SectionTitle, {
          hint: '最近几轮采集的结果；失败原因留在这里',
          right: runs.length > 5
            ? h(Button, { size: 'sm', onClick: () => setShowAll((value) => !value) },
              showAll ? '只看最近 5 轮' : `查看全部 ${runs.length} 轮`)
            : null,
        }, '采集历史'),
        runs.length
          ? h('div', null, visible.map((run, index) => {
            const key = `${run?.at || run?.date || 'run'}-${index}`;
            const errors = historyErrors(run);
            const open = expanded === key;
            return h('div', { key, style: { borderTop: index ? `1px solid ${C.border1}` : 'none' } },
              h('div', {
                role: 'button',
                tabIndex: 0,
                'aria-expanded': open,
                onClick: () => setExpanded(open ? null : key),
                onKeyDown: (event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault?.();
                    setExpanded(open ? null : key);
                  }
                },
                style: {
                  display: 'flex', alignItems: 'baseline', gap: T.space.sm,
                  flexWrap: 'wrap', padding: `${T.space.xs + 2}px 0`, cursor: 'pointer',
                },
              },
                h('span', { style: { ...caption, width: 88, flex: 'none', fontVariantNumeric: 'tabular-nums' } },
                  historyStamp(run)),
                h('span', { style: { flex: 1, minWidth: 160, ...body } }, historyChannels(run)),
                h('span', { style: { ...caption, fontVariantNumeric: 'tabular-nums' } }, historyStats(run)),
                errors.length
                  ? h('span', { style: { ...caption, color: C.warn, fontWeight: 600, whiteSpace: 'nowrap' } },
                    `${errors.length} 处失败`)
                  : h('span', { style: { ...caption, color: C.success, whiteSpace: 'nowrap' } }, '正常')),
              open
                ? h('div', { style: { padding: `0 0 ${T.space.sm}px 96px`, display: 'grid', gap: 4 } },
                  errors.length
                    ? errors.map((error) => h('div', { key: error, style: { ...caption, color: C.warn, lineHeight: 1.6 } }, error))
                    : h('div', { style: { ...caption } }, '这一轮没有失败'),
                  run?.kind === 'email'
                    ? h('div', { style: { ...caption } },
                      `读取 ${Number(run.emails) || 0} 封 · 解析 ${Number(run.parsed) || 0} 条 · 新增 ${Number(run.added) || 0} 条`)
                    : (run?.sources || []).map((source) => {
                      const label = SOURCE_CHANNEL_LABEL[overviewSourceId(source?.key)] || source?.label || source?.key;
                      return h('div', { key: `${key}:${source?.key}`, style: { ...caption } },
                        `${label}：采集 ${Number(source?.count) || 0} 条${source?.ok === false ? '（失败）' : ''}`);
                    }))
                : null);
          }))
          : h(EmptyState, {
            title: '还没有采集记录',
            desc: '运行采集后，这里会保留每一轮的结果与失败原因',
          }));
    }

    /** 渠道短名：采集记录的「来源」一行用它，避免长名把行撑开。 */
    const FRESH_CHANNEL_LABEL = {
      arxiv: 'arXiv', rss: 'RSS', search: '跨库', email: '邮件',
      pubmed: 'PubMed', dblp: 'DBLP', preprint: '预印本',
    };
    const FRESH_STATUS_TONE = {
      new: C.accent, analyzing: C.accent, failed: C.error, excluded: C.error,
      filtered: C.warn, parked: C.warn, admitted: C.success, promoted: C.success,
      owned: C.label3, dropped: C.label3,
    };

    /** 采集记录：近 7 天采集量、候选池状态分布、来源贡献，以及最近抓到的一页条目。 */
    function RadarFreshCard({ fresh, stats, onRetry, onOpenItem, onOpenAll }) {
      const items = Array.isArray(fresh?.items) ? fresh.items : [];
      const visible = items.slice(0, 5);
      const tagsStyle = {
        display: 'flex', gap: T.space.xs, flexShrink: 0, flexWrap: 'wrap',
        maxWidth: 230, justifyContent: 'flex-end', alignItems: 'center',
      };
      const num = (value) => h('b', {
        style: { fontWeight: 600, color: C.label1, fontVariantNumeric: 'tabular-nums' },
      }, String(value ?? 0));
      const statusText = (status) => (status === 'analyzing' ? '分析中' : candidateStatusLabel(status));
      const caption = { fontSize: fs(T.font.hint), color: C.caption };
      return h(Card, { style: { marginBottom: T.space.md } },
        h(SectionTitle, {
          hint: '最近 5 条；查看全部可筛选与搜索',
          right: h(Button, {
            size: 'sm', disabled: Boolean(fresh?.loading), onClick: onRetry,
          }, fresh?.loading ? '刷新中…' : '刷新'),
        }, '采集记录'),
        stats
          ? h('div', { style: { ...caption, lineHeight: T.line.body, marginBottom: T.space.xs } },
            '近 7 天采集 ', num(stats.weekFetched), ' 条',
            stats.channels && stats.channels.length
              ? h('span', null,
                ' · 来源 ',
                stats.channels.slice(0, 6)
                  .map((item) => `${FRESH_CHANNEL_LABEL[item.id] || item.id} ${item.count}`)
                  .join(' · '))
              : null)
          : null,
        fresh?.error
          ? h('div', null,
            h(Notice, { kind: 'error' }, `读取最近条目失败：${fresh.error}`),
            h(Button, { size: 'sm', onClick: onRetry }, '重试'))
          : !items.length
            ? h(EmptyState, {
              title: fresh?.loading ? '读取中…' : '暂无采集记录',
              desc: fresh?.loading
                ? undefined
                : '运行一次采集后，抓到的条目会出现在这里（含被过滤的）',
              actions: fresh?.loading ? null : [h(Button, { size: 'sm', onClick: onRetry }, '刷新')],
            })
            : h('div', null, visible.map((item) => h('div', {
              key: item.id,
              style: {
                display: 'flex', alignItems: 'flex-start', gap: T.space.sm,
                padding: `${T.space.sm}px 0`, borderTop: `1px solid ${C.border1}`,
              },
            },
              h('span', {
                style: {
                  flexShrink: 0, width: 42, paddingTop: 1,
                  fontFamily: FONT_MONO, fontSize: fs(T.font.mono), color: C.caption,
                },
              }, RadarClock(item.added_at) || '—'),
              h('div', { style: { flex: 1, minWidth: 0 } },
                h('button', {
                  type: 'button',
                  title: item.title || '',
                  onClick: () => onOpenItem(item),
                  style: {
                    appearance: 'none', border: 'none', background: 'none', padding: 0, margin: 0,
                    cursor: 'pointer', font: 'inherit', textAlign: 'left',
                    fontSize: fs(T.font.body), color: C.label1, lineHeight: T.line.tight,
                    overflowWrap: 'anywhere',
                  },
                  onMouseEnter: (e) => { e.currentTarget.style.color = C.accent; },
                  onMouseLeave: (e) => { e.currentTarget.style.color = C.label1; },
                }, item.title || '(无标题)'),
                (item.venue || item.year)
                  ? h('div', { style: { fontSize: fs(T.font.hint), color: C.caption, marginTop: T.space.micro } },
                    [item.venue, item.year].filter(Boolean).join(' · '))
                  : null),
              h('div', { style: tagsStyle },
                h(Chip, { tone: FRESH_STATUS_TONE[item.status] }, statusText(item.status)),
                RadarSourceTags(item.sources).map((label) => h(Chip, { key: label }, label))))),
            ),
        items.length
          ? h('div', { style: { marginTop: T.space.sm, display: 'flex', alignItems: 'center', gap: T.space.sm } },
            h('span', { style: caption }, `共 ${fresh.total} 条`),
            h('div', { style: { flex: 1 } }),
            h(Button, { size: 'sm', onClick: onOpenAll }, '查看全部'))
          : null);
    }

    const RECORD_FILTERS = [
      { key: 'all', label: '全部', status: 'all' },
      { key: 'queue', label: '候选', status: 'new,analyzing,failed,parked' },
      { key: 'filtered', label: '过滤', status: 'filtered' },
      { key: 'excluded', label: '排除', status: 'excluded' },
      { key: 'library', label: '已入库', status: 'owned,admitted,promoted' },
      { key: 'dropped', label: '已丢弃', status: 'dropped' },
    ];
    const RECORD_PAGE_SIZE = 20;
    const RECORD_RANGES = [
      { key: 'today', label: '今天' },
      { key: '7', label: '近 7 天' },
      { key: '30', label: '近 30 天' },
      { key: 'custom', label: '自定义' },
    ];

    function recordYmd(value) {
      return new Date(value).toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' });
    }

    function recordRange(key, applied) {
      if (key === 'custom') return { since: applied.since, until: applied.until, label: '自定义' };
      const days = key === 'today' ? 1 : key === '30' ? 30 : 7;
      const now = Date.now();
      const since = recordYmd(now - (days - 1) * 86400000);
      const until = recordYmd(now);
      return { since, until, label: key === 'today' ? '今天' : `近 ${days} 天` };
    }

    /** 采集记录弹窗：时间范围 + 状态筛选 + 搜索 + 滚动到底自动加载下一批。 */
    function RadarRecordsDrawer({ onClose, onOpenItem }) {
      const [filter, setFilter] = useState(RECORD_FILTERS[0]);
      const [rangeKey, setRangeKey] = useState('7');
      const [customSince, setCustomSince] = useState(() => recordRange('7', {}).since);
      const [customUntil, setCustomUntil] = useState(() => recordRange('7', {}).until);
      const [appliedCustom, setAppliedCustom] = useState(() => ({ since: recordRange('7', {}).since, until: recordRange('7', {}).until }));
      const [query, setQuery] = useState('');
      const [needle, setNeedle] = useState('');
      const [items, setItems] = useState([]);
      const [total, setTotal] = useState(0);
      const [counts, setCounts] = useState({});
      const [loading, setLoading] = useState(true);
      const [loadingMore, setLoadingMore] = useState(false);
      const [hasMore, setHasMore] = useState(false);
      const [error, setError] = useState(null);
      const caption = { fontSize: fs(T.font.hint), color: C.caption };
      const range = recordRange(rangeKey, appliedCustom);
      const buildParams = (offset) => {
        const params = new URLSearchParams({
          status: filter.status,
          sort: 'newest',
          limit: String(RECORD_PAGE_SIZE),
          offset: String(offset),
          since: range.since,
          until: range.until,
        });
        if (needle) params.set('q', needle);
        return params;
      };

      useEffect(() => {
        const timer = setTimeout(() => setNeedle(query.trim()), 250);
        return () => clearTimeout(timer);
      }, [query]);
      useEffect(() => {
        let alive = true;
        setLoading(true);
        setError(null);
        setItems([]);
        api(`${R.candidates}?${buildParams(0).toString()}`)
          .then((result) => {
            if (!alive) return;
            const next = Array.isArray(result.items) ? result.items : [];
            setItems(next);
            setTotal(Number(result.total) || 0);
            setCounts(result.counts || {});
            setHasMore(next.length < (Number(result.total) || 0));
            setLoading(false);
          })
          .catch((err) => {
            if (!alive) return;
            setError(String(err?.message || err));
            setLoading(false);
          });
        return () => { alive = false; };
      }, [filter.status, needle, range.since, range.until]);
      useEffect(() => {
        if (typeof document === 'undefined' || !document.addEventListener) return undefined;
        const onKey = (event) => { if (event.key === 'Escape') onClose(); };
        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
      }, [onClose]);

      const countFor = (item) => (item.key === 'all'
        ? Object.values(counts).reduce((sum, value) => sum + (Number(value) || 0), 0)
        : item.status.split(',').reduce((sum, status) => sum + (Number(counts[status]) || 0), 0));

      const loadMore = async () => {
        if (loading || loadingMore || !hasMore) return;
        setLoadingMore(true);
        try {
          const result = await api(`${R.candidates}?${buildParams(items.length).toString()}`);
          const next = Array.isArray(result.items) ? result.items : [];
          setItems((current) => [...current, ...next]);
          setTotal(Number(result.total) || 0);
          setCounts(result.counts || {});
          setHasMore(items.length + next.length < (Number(result.total) || 0));
        } catch (err) {
          setError(String(err?.message || err));
        } finally {
          setLoadingMore(false);
        }
      };

      const onListScroll = (event) => {
        const el = event.currentTarget;
        if (el.scrollHeight - el.scrollTop - el.clientHeight < 180) loadMore();
      };

      return h('div', {
        style: {
          position: 'fixed', inset: 0, zIndex: 960, background: 'rgba(0,0,0,.36)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: T.space.lg,
        },
        onMouseDown: (event) => { if (event.target === event.currentTarget) onClose(); },
      },
        h('div', {
          role: 'dialog', 'aria-modal': 'true', 'aria-label': '采集记录',
          style: {
            width: 'min(760px, calc(100vw - 40px))',
            height: 'min(760px, 82vh)',
            background: C.bg1, border: `1px solid ${C.border2}`,
            borderRadius: T.radius.md, boxShadow: '0 24px 64px rgba(0,0,0,.28)',
            display: 'flex', flexDirection: 'column', overflow: 'hidden',
          },
        },
          h('div', {
            style: {
              padding: '14px 18px', borderBottom: `1px solid ${C.border1}`,
              display: 'flex', alignItems: 'center', gap: T.space.sm,
            },
          },
            h('div', { style: { flex: 1, minWidth: 0 } },
              h('div', { style: { fontSize: fs(16), fontWeight: 600, color: C.label1 } }, '采集记录'),
              h('div', { style: caption }, `${range.label} · 当前筛选 ${total} 条`)),
            h('button', {
              type: 'button', 'aria-label': '关闭采集记录', onClick: onClose,
              style: {
                appearance: 'none', border: 'none', background: 'none', cursor: 'pointer',
                color: C.label3, fontSize: fs(19), lineHeight: 1, padding: 2,
              },
            }, '×')),
          h('div', { style: { padding: '10px 18px 0', display: 'flex', gap: T.space.xs, flexWrap: 'wrap', alignItems: 'center' } },
            h('span', { style: { ...caption, marginRight: 2 } }, '时间'),
            RECORD_RANGES.map((item) => h(Button, {
              key: item.key, size: 'sm', primary: rangeKey === item.key,
              onClick: () => setRangeKey(item.key),
            }, item.label)),
            rangeKey === 'custom'
              ? h('span', { style: { display: 'inline-flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' } },
                h(TextInput, {
                  type: 'date', value: customSince, width: 132,
                  label: '开始日期', onChange: setCustomSince,
                }),
                h('span', { style: caption }, '至'),
                h(TextInput, {
                  type: 'date', value: customUntil, width: 132,
                  label: '结束日期', onChange: setCustomUntil,
                }),
                h(Button, {
                  size: 'sm', primary: true,
                  onClick: () => {
                    if (customSince && customUntil && customSince <= customUntil) {
                      setAppliedCustom({ since: customSince, until: customUntil });
                    }
                  },
                }, '应用'))
              : null),
          h('div', { style: { padding: '10px 18px 0', display: 'flex', gap: T.space.xs, flexWrap: 'wrap' } },
            RECORD_FILTERS.map((item) => h(Button, {
              key: item.key, size: 'sm', primary: filter.key === item.key,
              onClick: () => setFilter(item),
            }, `${item.label} ${countFor(item)}`))),
          h('div', { style: { padding: '10px 18px 8px' } },
            h(TextInput, { value: query, placeholder: '按标题 / 摘要搜索', onChange: setQuery })),
          h('div', {
            style: { flex: 1, minHeight: 0, overflowY: 'auto', padding: '0 18px' },
            onScroll: onListScroll,
          },
            loading
              ? h('div', { style: { ...caption, padding: `${T.space.md}px 0` } }, '读取中…')
              : error && !items.length
                ? h(Notice, { kind: 'error' }, `读取失败：${error}`)
                : items.length
                  ? h('div', null,
                    items.map((item) => h('div', {
                      key: item.id,
                      style: {
                        padding: `${T.space.sm}px 0`, borderTop: `1px solid ${C.border1}`,
                        display: 'flex', alignItems: 'flex-start', gap: T.space.sm,
                      },
                    },
                      h('span', {
                        style: { ...caption, width: 44, flex: 'none', fontFamily: FONT_MONO, paddingTop: 1 },
                      }, RadarClock(item.added_at) || '—'),
                      h('div', { style: { flex: 1, minWidth: 0 } },
                        h('button', {
                          type: 'button', onClick: () => onOpenItem(item),
                          style: {
                            appearance: 'none', border: 'none', background: 'none', padding: 0, margin: 0,
                            cursor: 'pointer', font: 'inherit', textAlign: 'left', display: 'block', width: '100%',
                            fontSize: fs(T.font.body), color: C.label1, lineHeight: T.line.tight,
                            overflowWrap: 'anywhere',
                          },
                        }, item.title || '(无标题)'),
                        (item.venue || item.year)
                          ? h('div', { style: { ...caption, marginTop: 2 } },
                            [item.venue, item.year].filter(Boolean).join(' · '))
                          : null),
                      h('div', {
                        style: {
                          display: 'flex', gap: T.space.xs, flexWrap: 'wrap',
                          justifyContent: 'flex-end', alignItems: 'center',
                          maxWidth: 210, flexShrink: 0,
                        },
                      },
                        h(Chip, { tone: FRESH_STATUS_TONE[item.status] }, candidateStatusLabel(item.status)),
                        RadarSourceTags(item.sources).map((label) => h(Chip, { key: label }, label))))),
                    error ? h(Notice, { kind: 'error' }, `加载更多失败：${error}`) : null)
                  : h(EmptyState, {
                    title: '没有匹配的采集记录',
                    desc: `${range.label} 内换个状态或搜索词试试`,
                  })),
          h('div', {
            style: {
              borderTop: `1px solid ${C.border1}`, padding: '10px 18px',
              display: 'flex', alignItems: 'center', gap: T.space.sm,
            },
          },
            h('span', { style: caption }, `已加载 ${items.length} / 共 ${total} 条`),
            h('div', { style: { flex: 1 } }),
            h('span', { style: caption }, loadingMore ? '加载中…' : hasMore ? '继续向下滚动' : '已经到底了'))));
    }

    /**
     * 来源记录（合并进渠道卡片，不再单独占一张「来源健康」卡）：
     * 一行一个源；失败在前，再按最近成功时间倒序。点行打开详情抽屉。
     */
    function RadarSourceRows({ state, channels, isEnabled, onOpen, prefixes }) {
      const wanted = prefixes ? (Array.isArray(prefixes) ? prefixes : [prefixes]) : null;
      const entries = Object.entries(state?.sources || {})
        .filter(([key]) => !wanted || wanted.some((prefix) => key.startsWith(prefix)));
      const counts = RadarWeekCounts(state);
      const runStats = RadarRunStats(state);
      const rows = [...entries].sort((a, b) => {
        const failA = a[1]?.last_error ? 1 : 0;
        const failB = b[1]?.last_error ? 1 : 0;
        if (failA !== failB) return failB - failA;
        const parsedA = Date.parse(a[1]?.last_ok_at || '');
        const parsedB = Date.parse(b[1]?.last_ok_at || '');
        const okA = Number.isFinite(parsedA) ? parsedA : 0;
        const okB = Number.isFinite(parsedB) ? parsedB : 0;
        return okB - okA || a[0].localeCompare(b[0]);
      });
      if (!rows.length) {
        return h('div', { style: { fontSize: fs(T.font.hint), color: C.label3, marginTop: 2 } },
          '还没有采集记录');
      }
      return h('div', null, rows.map(([key, value]) => {
        const failed = Boolean(value?.last_error);
        const ran = Boolean(value?.last_ok_at);
        const name = RadarSourceName(key, channels);
        const channel = sourceChannel(key);
        const enabled = channel && typeof isEnabled === 'function' ? Boolean(isEnabled(key)) : null;
        const stats = runStats[key] || null;
        return h('div', {
          key,
          onClick: () => onOpen(key),
          onMouseEnter: (e) => { e.currentTarget.style.background = C.hover; },
          onMouseLeave: (e) => { e.currentTarget.style.background = 'transparent'; },
          style: {
            display: 'flex', alignItems: 'center', gap: T.space.sm, flexWrap: 'wrap',
            padding: `${T.space.xs}px ${T.space.xs}px`, borderTop: `1px solid ${C.border1}`,
            cursor: 'pointer', borderRadius: T.radius.xs,
          },
        },
          h(RadarDot, { failed, ran }),
          h('span', {
            style: { fontSize: fs(T.font.body), fontWeight: 600, color: C.label1, flex: 1, minWidth: 120, overflowWrap: 'anywhere' },
          }, name),
          h(Chip, { tone: failed ? C.error : ran ? C.success : C.label3 },
            failed ? '失败' : ran ? '正常' : '未运行'),
          value?.last_ok_at
            ? h('span', { style: { fontSize: fs(T.font.hint), color: C.label3 } },
              `${failed ? '上次成功' : '上次'} ${sourceAgo(value.last_ok_at)}`)
            : (failed ? h('span', { style: { fontSize: fs(T.font.hint), color: C.label3 } }, '尚未成功') : null),
          h('span', { style: { fontSize: fs(T.font.hint), color: C.label3 } }, `近 7 天 ${counts[key] || 0} 条`),
          stats?.truncated ? h(Chip, { tone: C.warn }, '补跑已截断') : null,
          failed && Number(value?.consecutive_failures) > 1
            ? h('span', { style: { fontSize: fs(T.font.hint), color: C.error } },
              `连续失败 ${value.consecutive_failures} 次`)
            : null,
          failed
            ? h('div', {
              style: {
                flexBasis: '100%', marginTop: T.micro || T.space.micro, fontSize: fs(T.font.hint),
                color: C.error, lineHeight: T.line.body, overflowWrap: 'anywhere',
              },
            }, sourceErrorText(value.last_error))
            : null);
      }));
    }

    /** 源详情抽屉：右侧滑出，Esc / 点遮罩关闭；含该源最近候选、错误全文与动作。 */
    function RadarSourceDrawer({
      sourceKey, name, value, weekCount, channel,
      enabled, canToggle, canRun, busy, refreshKey, note,
      onRun, onToggle, onOpenConfig, onOpenCandidate, onClose,
    }) {
      const [fresh, setFresh] = useState({ items: [], loading: true, error: null });

      const load = useCallback(async () => {
        if (!sourceKey) return;
        setFresh((current) => ({ ...current, loading: true, error: null }));
        try {
          const data = await api(`${R.candidates}?source=${encodeURIComponent(sourceKey)}&limit=5`);
          setFresh({ items: Array.isArray(data.items) ? data.items : [], loading: false, error: null });
        } catch (error) {
          setFresh({ items: [], loading: false, error: String(error?.message || error) });
        }
      }, [sourceKey]);

      useEffect(() => { load(); }, [load, refreshKey]);
      useEffect(() => {
        if (typeof document === 'undefined' || !document.addEventListener) return undefined;
        const onKey = (e) => { if (e.key === 'Escape') onClose(); };
        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
      }, [onClose]);

      if (!sourceKey) return null;
      const failed = Boolean(value?.last_error);
      const ran = Boolean(value?.last_ok_at);
      const items = Array.isArray(fresh?.items) ? fresh.items : [];
      const caption = { fontSize: fs(T.font.hint), color: C.caption };

      return h('div', {
        style: {
          position: 'fixed', inset: 0, zIndex: 960, background: 'rgba(0,0,0,.28)',
          display: 'flex', justifyContent: 'flex-end',
        },
        onMouseDown: (e) => { if (e.target === e.currentTarget) onClose(); },
      },
        h('div', {
          role: 'dialog', 'aria-modal': 'true', 'aria-label': `${name} 详情`,
          style: {
            width: 'min(400px, 100vw)', height: '100%', background: C.bg1,
            borderLeft: `1px solid ${C.border2}`, boxShadow: '-8px 0 32px rgba(0,0,0,.24)',
            display: 'flex', flexDirection: 'column',
          },
        },
          h('div', {
            style: {
              padding: '14px 18px', borderBottom: `1px solid ${C.border1}`,
              display: 'flex', alignItems: 'center', gap: T.space.sm,
            },
          },
            h(RadarDot, { failed, ran }),
            h('div', { style: { flex: 1, minWidth: 0 } },
              h('div', { style: { fontSize: fs(16), fontWeight: 600, color: C.label1, overflowWrap: 'anywhere' } }, name),
              h('div', {
                style: {
                  fontFamily: FONT_MONO, fontSize: fs(T.font.mono), color: C.caption,
                  marginTop: T.space.micro, overflowWrap: 'anywhere',
                },
              }, sourceKey)),
            h('button', {
              type: 'button', 'aria-label': '关闭来源详情', onClick: onClose,
              style: {
                appearance: 'none', border: 'none', background: 'none', cursor: 'pointer',
                color: C.label3, fontSize: fs(19), lineHeight: 1, padding: 2,
              },
            }, '×')),
          h('div', { style: { flex: 1, minHeight: 0, overflowY: 'auto', padding: '14px 18px 18px' } },
            note ? h(Notice, { kind: note.kind }, note.text) : null,
            h('div', { style: { display: 'flex', gap: T.space.sm, flexWrap: 'wrap', marginBottom: T.space.md } },
              h(Chip, { tone: failed ? C.error : ran ? C.success : C.label3 },
                failed ? '失败' : ran ? '正常' : '未运行'),
              h(Chip, null, `近 7 天 ${weekCount} 条`),
              value?.last_ok_at ? h(Chip, null, `上次成功 ${sourceAgo(value.last_ok_at)}`) : null,
              Number(value?.consecutive_failures) > 1
                ? h(Chip, { tone: C.error }, `连续失败 ${value.consecutive_failures} 次`)
                : null,
              value?.last_count != null ? h(Chip, null, `上次 ${value.last_count} 条`) : null,
              value?.unchanged ? h(Chip, null, '内容没有更新') : null),
            failed
              ? h('div', { style: { marginBottom: T.space.md } },
                h('div', { style: { ...caption, marginBottom: T.space.xs } },
                  `最近一次错误${value?.last_failed_at ? ` · ${sourceAgo(value.last_failed_at)}` : ''}`),
                h('div', { style: { fontSize: fs(T.font.meta), color: C.error, lineHeight: T.line.body, marginBottom: T.space.xs } },
                  sourceErrorText(value.last_error)),
                h('div', {
                  style: {
                    padding: T.space.sm, borderRadius: T.radius.sm, background: C.bg2,
                    fontFamily: FONT_MONO, fontSize: fs(T.font.mono), lineHeight: T.line.mono,
                    color: C.label2, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                  },
                }, String(value.last_error)))
              : null,
            h('div', { style: { display: 'flex', gap: T.space.sm, flexWrap: 'wrap', alignItems: 'center' } },
              h(Button, { primary: true, disabled: Boolean(busy) || !canRun, onClick: onRun },
                busy ? '采集中…' : '补跑该源'),
              channel ? h(Button, { size: 'sm', onClick: onOpenConfig }, '查看渠道配置') : null),
            !canRun
              ? h('div', { style: { ...caption, marginTop: T.space.xs } },
                '该渠道没启用或被隐藏，先打开开关再补跑')
              : null,
            canToggle
              ? h('div', {
                style: {
                  display: 'flex', alignItems: 'center', gap: T.space.sm,
                  marginTop: T.space.md, paddingBottom: T.space.md,
                  borderBottom: `1px solid ${C.border1}`,
                },
              },
                h(Switch, { checked: Boolean(enabled), onChange: onToggle, label: enabled ? '已启用' : '已停用' }),
                h('span', { style: caption }, '开关改动自动保存，按渠道生效'))
              : null,
            h('div', { style: { marginTop: T.space.md } },
              h('div', { style: { display: 'flex', alignItems: 'baseline', gap: T.space.sm, marginBottom: T.space.xs } },
                h('div', { style: { flex: 1, fontSize: fs(T.font.body), fontWeight: 600, color: C.label1 } },
                  '这个源最近的条目'),
                h(Button, { size: 'sm', disabled: Boolean(fresh?.loading), onClick: load },
                  fresh?.loading ? '读取中…' : '刷新')),
              fresh?.error
                ? h('div', null,
                  h(Notice, { kind: 'error' }, `读取失败：${fresh.error}`),
                  h(Button, { size: 'sm', onClick: load }, '重试'))
                : !items.length
                  ? h('div', { style: caption }, fresh?.loading ? '读取中…' : '最近没有从这个源进入待办的条目')
                  : h('div', null, items.map((item) => h('div', {
                    key: item.id,
                    style: { padding: `${T.space.sm}px 0`, borderTop: `1px solid ${C.border1}` },
                  },
                    h('div', { style: { display: 'flex', gap: T.space.sm, alignItems: 'baseline' } },
                      h('span', {
                        style: { fontFamily: FONT_MONO, fontSize: fs(T.font.mono), color: C.caption, flexShrink: 0 },
                      }, RadarClock(item.added_at) || '—'),
                      h('button', {
                        type: 'button',
                        onClick: () => onOpenCandidate(item),
                        style: {
                          appearance: 'none', border: 'none', background: 'none', padding: 0, margin: 0,
                          cursor: 'pointer', font: 'inherit', textAlign: 'left',
                          fontSize: fs(T.font.body), color: C.label1, lineHeight: T.line.tight,
                          overflowWrap: 'anywhere',
                        },
                        onMouseEnter: (e) => { e.currentTarget.style.color = C.accent; },
                        onMouseLeave: (e) => { e.currentTarget.style.color = C.label1; },
                      }, item.title || '(无标题)')),
                    (item.venue || item.year)
                      ? h('div', {
                        style: { ...caption, marginTop: T.space.micro, marginLeft: 52 },
                      }, [item.venue, item.year].filter(Boolean).join(' · '))
                      : null)))))));
    }

    function Radar({ state, config, saveConfig, runDiscover, reload, navigate, setTab, refreshTick = 0 }) {
      const [channels, setChannels] = useState(() => JSON.parse(JSON.stringify(config?.sources || {})));
      const [dirty, setDirty] = useState(false);
      const [savedAt, setSavedAt] = useState(null);
      const [harvests, setHarvests] = useState([]);
      const [jobs, setJobs] = useState([]);
      const [msg, setMsg] = useState(null);
      const [localBusy, setLocalBusy] = useState(false);
      const [addOpen, setAddOpen] = useState(false);
      const [saving, setSaving] = useState(false);
      const [query, setQuery] = useState('');
      const [yearFrom, setYearFrom] = useState(2015);
      const [yearTo, setYearTo] = useState(new Date().getFullYear());
      const [seedMode, setSeedMode] = useState('recent');
      const [collection, setCollection] = useState('');
      const [seedDois, setSeedDois] = useState('');
      // 渠道配置卡：默认全部收起，只显示标题行；点「配置」按需展开。
      const [openCfg, setOpenCfg] = useState({});
      // 源详情抽屉：null 表示关闭。
      const [drawerKey, setDrawerKey] = useState(null);
      // 候选详情：点「刚扫到什么」的标题直接看这一条，不用先跳到待办再找。
      const [preview, setPreview] = useState(null);
      // 「采集记录」：全状态候选 + 贡献数字；失败也要在卡片里可见。
      const [fresh, setFresh] = useState({ items: [], total: 0, loading: true, error: null });
      // 完整采集记录抽屉。
      const [recordsOpen, setRecordsOpen] = useState(false);
      // 每跑完一轮就 +1，抽屉里的候选列表据此刷新。
      const [freshRev, setFreshRev] = useState(0);
      // 编辑版本号：保存返回时用来判断「期间是否又有新改动」，避免旧请求把新草稿标成已保存。
      const [editState] = useState(() => ({ rev: 0 }));

      // 外部 config 更新不得覆盖未保存草稿。
      useEffect(() => {
        if (dirty) return;
        setChannels(JSON.parse(JSON.stringify(config?.sources || {})));
      }, [config, dirty]);

      const load = useCallback(async () => {
        try {
          const [hv, j] = await Promise.all([api(R.harvest), api(R.jobs)]);
          setHarvests(hv.harvests || []);
          setJobs(j.jobs || []);
        } catch (e) {
          setMsg({ kind: 'error', text: `读取采集状态失败：${e?.message || e}` });
        }
      }, []);

      useEffect(() => { load(); }, [load]);
      useEffect(() => {
        const timer = setInterval(load, 10000);
        if (typeof timer?.unref === 'function') timer.unref();
        return () => clearInterval(timer);
      }, [load]);

      /** 采集记录：全状态按最近采集排序；失败可见，不拖累页面其他数据。 */
      const loadFresh = useCallback(async () => {
        setFresh((current) => ({ ...current, loading: true, error: null }));
        try {
          const data = await api(`${R.candidates}?status=all&sort=newest&limit=5`);
          const items = Array.isArray(data.items) ? data.items : [];
          items.sort((a, b) => String(b?.added_at || '').localeCompare(String(a?.added_at || '')));
          setFresh({ items, total: Number(data.total) || items.length, loading: false, error: null });
          setFreshRev((n) => n + 1);
        } catch (error) {
          setFresh({ items: [], total: 0, loading: false, error: String(error?.message || error) });
        }
      }, []);
      useEffect(() => { loadFresh(); }, [loadFresh, refreshTick]);

      const post = async (url, body) => {
        const res = await fetch(url, {
          method: 'POST', credentials: 'same-origin',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body || {}),
        });
        return res.json();
      };

      const patchSource = (key, fn) => {
        editState.rev += 1;
        setChannels((current) => {
          const next = JSON.parse(JSON.stringify(current || {}));
          next[key] = next[key] || {};
          fn(next[key]);
          return next;
        });
        setDirty(true);
      };

      const patchFlag = (key, value) => {
        editState.rev += 1;
        setChannels((current) => ({ ...JSON.parse(JSON.stringify(current || {})), [key]: value }));
        setDirty(true);
      };

      const patchRss = (fn) => {
        editState.rev += 1;
        setChannels((current) => {
          const next = JSON.parse(JSON.stringify(current || {}));
          next.rss = Array.isArray(next.rss) ? next.rss : [];
          fn(next.rss);
          return next;
        });
        setDirty(true);
      };

      const saveChannels = async () => {
        const rev = editState.rev;
        setSaving(true);
        try {
          const ok = await saveConfig({ sources: channels });
          if (!ok) {
            setMsg({ kind: 'error', text: '渠道配置保存失败：改动还在页面上，可点「保存渠道配置」重试' });
            return false;
          }
          if (editState.rev === rev) { setDirty(false); setSavedAt(Date.now()); }
          return true;
        } finally { setSaving(false); }
      };

      // 回执只在保存成功后短暂出现，避免「已保存」常驻占位。
      useEffect(() => {
        if (!savedAt) return undefined;
        const timer = setTimeout(() => setSavedAt(null), 4000);
        return () => clearTimeout(timer);
      }, [savedAt]);

      // 700ms 防抖自动保存；失败可见，且不清 dirty（改动留在页面上）。
      useEffect(() => {
        if (!dirty) return undefined;
        const timer = setTimeout(saveChannels, 700);
        return () => clearTimeout(timer);
      }, [channels, dirty]);

      const rssFeeds = Array.isArray(channels.rss) ? channels.rss : [];
      const incremental = channels.arxiv || {};
      const mail = channels.mail || {};
      const pubmed = channels.pubmed || {};
      const dblp = channels.dblp || {};
      const preprint = channels.preprint || {};
      const searchCfg = channels.search || {};
      const interestTerms = config?.interest_terms || [];

      /** 渠道是否启用：健康块、补跑与「立即采集全部」共用同一口径。 */
      const channelEnabled = (id) => {
        if (id === 'email') return mail.enabled === true;
        if (id === 'rss') return channels.rssEnabled !== false && rssFeeds.some((feed) => feed.enabled !== false);
        if (id === 'pubmed') return pubmed.enabled === true;
        if (id === 'dblp') return dblp.enabled === true;
        if (id === 'preprint') return preprint.enabled === true;
        return channels[id]?.enabled !== false;
      };

      /** 源 key 是否启用：RSS 看单条订阅，其余归到渠道。 */
      const sourceEnabled = (key) => {
        const text = String(key || '');
        if (text.startsWith('rss:')) {
          const feed = rssFeeds.find((item) => item.id === text.slice(4));
          return Boolean(feed) && feed.enabled !== false;
        }
        const channel = sourceChannel(text);
        return channel ? channelEnabled(channel) : false;
      };

      /** 源开关：RSS 改单条订阅，其余改渠道 enabled；走渠道草稿的防抖与脏标记。 */
      const toggleSourceEnabled = (key, value) => {
        const text = String(key || '');
        if (text.startsWith('rss:')) {
          const id = text.slice(4);
          patchRss((list) => {
            const feed = list.find((item) => item.id === id);
            if (feed) feed.enabled = value;
          });
          return;
        }
        const channel = sourceChannel(text);
        if (!channel) return;
        if (channel === 'email') patchSource('mail', (x) => { x.enabled = value; });
        else patchSource(channel, (x) => { x.enabled = value; });
      };

      const radarCfg = config?.radar || {};
      const layoutOrder = Array.isArray(radarCfg.order) && radarCfg.order.length
        ? radarCfg.order.filter((id) => RADAR_DEFAULT_ORDER.includes(id))
        : RADAR_DEFAULT_ORDER;
      const hiddenLayout = new Set(Array.isArray(radarCfg.hidden) ? radarCfg.hidden : []);
      // 隐藏能力已移除；历史配置里的 radar.hidden 不再生效，所有渠道始终显示。
      const showWidget = () => true;
      const saveLayout = (order, hidden) => saveConfig({ radar: { order, hidden } });
      const toggleWidget = (id, visible) => {
        const hidden = new Set(hiddenLayout);
        if (visible) hidden.delete(id); else hidden.add(id);
        saveLayout(layoutOrder, [...hidden]);
      };
      const moveWidget = (id, delta) => {
        const index = layoutOrder.indexOf(id);
        const next = [...layoutOrder];
        const target = index + delta;
        if (index < 0 || target < 0 || target >= next.length) return;
        [next[index], next[target]] = [next[target], next[index]];
        saveLayout(next, [...hiddenLayout]);
      };

      /** 一个渠道在 state.sources 里的健康汇总：只统计属于它的源。 */
      const channelHealth = (prefixes) => {
        const list = Array.isArray(prefixes) ? prefixes : [prefixes];
        const entries = Object.entries(state?.sources || {})
          .filter(([key]) => list.some((prefix) => key.startsWith(prefix)));
        const failed = entries.filter(([, value]) => value?.last_error);
        const total = entries.reduce((sum, [, value]) => sum + (Number(value?.last_count) || 0), 0);
        const latestOk = entries.map(([, value]) => value?.last_ok_at).filter(Boolean).sort().pop() || null;
        return { entries: entries.length, failed: failed.length, total, latestOk };
      };

      /** 渠道是否缺必填配置；规则与 lib/config.js、lib/discover.js 的跳过条件对齐。 */
      const channelMissing = (id) => {
        if (id === 'arxiv') {
          const categories = Array.isArray(incremental.categories) ? incremental.categories.filter(Boolean) : [];
          const queries = Array.isArray(incremental.queries) ? incremental.queries.filter(Boolean) : [];
          return categories.length || queries.length ? null : '缺分类';
        }
        if (id === 'rss') {
          const feeds = rssFeeds.filter((feed) => feed && feed.url);
          if (!feeds.length) return '缺订阅源';
          return feeds.some((feed) => feed.enabled !== false) ? null : '订阅全部停用';
        }
        if (id === 'search' || id === 'pubmed' || id === 'dblp') {
          const cfg = id === 'search' ? searchCfg : id === 'pubmed' ? pubmed : dblp;
          const queries = Array.isArray(cfg?.queries) ? cfg.queries : [];
          const hasQuery = queries.some((item) => String(typeof item === 'string' ? item : item?.text || '').trim());
          return hasQuery || interestTerms.length ? null : '缺研究兴趣词';
        }
        return null;
      };

      /** 行内状态：已停用 / 未配置 / 失败 / 正常 / 未运行，按优先级命中即止。 */
      const channelStatus = (id) => {
        const enabled = channelEnabled(id);
        const health = channelHealth(CHANNEL_SOURCES[id] || [id]);
        const masterOff = id === 'rss' && channels.rssEnabled === false;
        if (masterOff || (id !== 'rss' && !enabled)) {
          return {
            tone: 'off',
            text: health.latestOk ? `已停用 · 上次成功 ${sourceAgo(health.latestOk)}` : '已停用',
          };
        }
        const missing = channelMissing(id);
        if (missing) return { tone: 'missing', text: `未配置 · ${missing}` };
        if (health.failed) {
          const facts = health.latestOk ? `上次成功 ${sourceAgo(health.latestOk)}` : '尚未成功';
          return { tone: 'fail', text: `失败 ${health.failed}/${health.entries} · ${facts}` };
        }
        if (health.latestOk) {
          return { tone: 'ok', text: `正常 · 上次 ${sourceAgo(health.latestOk)} · ${health.total} 条` };
        }
        return { tone: 'idle', text: '未运行' };
      };

      // 行、摘要、组头统一从这份表取数，保证数字与行内状态一致。
      const channelStatuses = {};
      CHANNEL_IDS.forEach((id) => { channelStatuses[id] = channelStatus(id); });
      const visibleChannelIds = layoutOrder.filter((id) => CHANNEL_IDS.includes(id));
      const enabledRowCount = visibleChannelIds.filter((id) => channelEnabled(id)).length;
      const failedRowCount = visibleChannelIds.filter((id) => channelStatuses[id].tone === 'fail').length;
      const missingRowCount = visibleChannelIds.filter((id) => channelStatuses[id].tone === 'missing').length;

      // 采集记录的数字口径：近 7 天按 run 的每源 count 汇总；候选池用服务端 counts。
      const poolCounts = state?.summary?.counts || {};
      const weekMap = RadarWeekCounts(state);
      const weekFetched = Object.values(weekMap).reduce((sum, n) => sum + (Number(n) || 0), 0);
      const weekByChannel = {};
      Object.entries(weekMap).forEach(([key, n]) => {
        const channel = sourceChannel(key);
        if (!channel) return;
        weekByChannel[channel] = (weekByChannel[channel] || 0) + (Number(n) || 0);
      });
      const freshStats = {
        weekFetched,
        pool: {
          total: Object.values(poolCounts).reduce((sum, n) => sum + (Number(n) || 0), 0),
          new: Number(poolCounts.new) || 0,
          parked: Number(poolCounts.parked) || 0,
          filtered: Number(poolCounts.filtered) || 0,
          excluded: Number(poolCounts.excluded) || 0,
          owned: Number(poolCounts.owned) || 0,
          admitted: (Number(poolCounts.admitted) || 0) + (Number(poolCounts.promoted) || 0),
          dropped: Number(poolCounts.dropped) || 0,
        },
        channels: CHANNEL_IDS
          .map((id) => ({ id, count: weekByChannel[id] || 0 }))
          .filter((item) => item.count > 0)
          .sort((a, b) => b.count - a.count),
      };

      const go = (id, opts) => (navigate ? navigate(id, opts) : setTab?.(id));

      const noRunnableReason = () => {
        const enabledIds = CHANNEL_IDS.filter((id) => channelEnabled(id));
        if (!enabledIds.length) return '没有启用的渠道：先到渠道配置里启用一个';
        if (!enabledIds.some((id) => showWidget(id))) return '已启用的渠道被隐藏了：先在渠道配置里显示';
        if (enabledIds.length === 1 && enabledIds[0] === 'search' && interestTerms.length === 0) {
          return '跨库检索还没有研究兴趣词：先在研究兴趣里填关键词';
        }
        return '没有可采集的渠道：检查渠道配置';
      };

      const runOnly = async (key) => {
        if (localBusy) return;
        const keys = key ? (Array.isArray(key) ? key : [key]) : null;
        const active = ['arxiv', 'rss', 'search', 'pubmed', 'dblp', 'preprint'].filter((id) => showWidget(id));
        const emailEnabled = showWidget('email') && channelEnabled('email');
        let targets;
        if (keys) {
          targets = keys;
          const disabled = targets.find((item) => !channelEnabled(item));
          if (disabled) {
            setMsg({ kind: 'warn', text: `「${disabled}」未启用，请先打开开关` });
            return;
          }
          if (targets.includes('search') && interestTerms.length === 0) {
            setMsg({ kind: 'warn', text: '跨库检索需要先在「研究兴趣」里填纯文本关键词' });
            return;
          }
        } else {
          targets = active.filter((id) => channelEnabled(id));
          if (targets.includes('search') && interestTerms.length === 0) {
            targets = targets.filter((id) => id !== 'search');
          }
        }
        // 「立即采集」= 所有已启用的渠道；邮件走自己的只读流程，也一起跑。
        const includeEmail = !keys && emailEnabled;
        if (!targets.length && !includeEmail) {
          setMsg({ kind: 'warn', text: noRunnableReason() });
          return;
        }
        setLocalBusy(true);
        setMsg(null);
        try {
          const ok = await saveChannels();
          if (!ok) return;
          let added = 0;
          let merged = 0;
          let emails = 0;
          let emailAdded = 0;
          const errors = [];
          let failed = false;
          if (targets.length) {
            const r = await runDiscover(targets);
            if (!r?.ok) {
              failed = true;
              errors.push(r?.error || '采集失败');
            }
            added = Number(r?.added) || 0;
            merged = Number(r?.merged) || 0;
          }
          if (includeEmail) {
            const r = await post(R.email, {});
            if (!r?.ok) {
              failed = true;
              errors.push(r?.error || '邮件处理失败');
            }
            emails = Number(r?.emails) || 0;
            emailAdded = Number(r?.added) || 0;
            if (Array.isArray(r?.errors) && r.errors.length) {
              errors.push(...r.errors);
              if (emails === 0) failed = true;
            }
          }
          const parts = [];
          if (targets.length) parts.push(`新增 ${added} 条，合并 ${merged} 条`);
          if (includeEmail) parts.push(`邮件 ${emails} 封，新增 ${emailAdded} 条`);
          const detail = errors.length ? emailErrorText(errors[0]) : '';
          if (failed) {
            setMsg({
              kind: 'error',
              text: includeEmail && emails === 0 && !targets.length
                ? `邮件没有读成：${detail}`
                : `采集失败：${parts.join('；') || '没有完成'}${detail ? `；${detail}` : ''}`,
            });
          } else if (errors.length) {
            setMsg({
              kind: 'warn',
              text: `采集完成：${parts.join('；')}；有 ${errors.length} 处失败${detail ? `（${detail}）` : ''}`,
            });
          } else {
            setMsg({ kind: 'success', text: `采集完成：${parts.join('；')}` });
          }
          await reload();
          await load();
          await loadFresh();
        } catch (error) {
          setMsg({ kind: 'error', text: String(error?.message || error) });
        } finally { setLocalBusy(false); }
      };

      const doHarvest = async (kind) => {
        if (localBusy) return;
        setLocalBusy(true);
        setMsg(null);
        try {
          let spec;
          if (kind === 'year') {
            if (!query.trim()) {
              setMsg({ kind: 'error', text: '先填关键词' });
              return;
            }
            spec = { query, yearFrom, yearTo, maxItems: 200 };
          } else if (seedMode === 'collection') {
            if (!collection.trim()) { setMsg({ kind: 'error', text: '请输入 Zotero 分类名或 key' }); return; }
            spec = { direction: 'both', zotero: { collection: collection.trim() }, maxSeeds: 10, maxItems: 200 };
          } else if (seedMode === 'doi') {
            const dois = seedDois.split(/[\s,;]+/).map((x) => x.trim()).filter(Boolean);
            if (!dois.length) { setMsg({ kind: 'error', text: '请输入至少一个 DOI' }); return; }
            spec = { direction: 'both', seeds: dois.map((doi) => ({ doi })), maxSeeds: 10, maxItems: 200 };
          } else {
            spec = { direction: 'both', zotero: { recent: true }, maxSeeds: 10, maxItems: 200 };
          }
          const r = await post(R.harvest, { kind, spec });
          setMsg(r?.ok
            ? { kind: 'success', text: `已提交${kind === 'year' ? '按年份采集' : '引文扩展'}；完成后刷新查看` }
            : { kind: 'error', text: r?.error || '启动失败' });
          await load();
        } catch (error) {
          setMsg({ kind: 'error', text: String(error?.message || error) });
        } finally { setLocalBusy(false); }
      };

      const doEmail = async () => {
        setLocalBusy(true);
        setMsg(null);
        try {
          const ok = await saveChannels();
          if (!ok) return;
          const r = await post(R.email, {});
          const emailErrors = Array.isArray(r?.errors) ? r.errors : [];
          const detail = emailErrors.length ? emailErrorText(emailErrors[0]) : '';
          if (!r?.ok) {
            setMsg({ kind: 'error', text: r?.error || '邮件处理失败' });
          } else if (!r.emails && emailErrors.length) {
            setMsg({ kind: 'error', text: `邮件没有读成：${detail}` });
          } else if (emailErrors.length) {
            setMsg({
              kind: 'warn',
              text: `邮件 ${r.emails || 0} 封，解析 ${r.parsed || 0} 条，新增 ${r.added || 0}；有 ${emailErrors.length} 处失败（${detail}）`,
            });
          } else {
            setMsg({ kind: 'success', text: `邮件 ${r.emails || 0} 封，解析 ${r.parsed || 0} 条，新增 ${r.added || 0}` });
          }
          await reload();
          await load();
          await loadFresh();
        } catch (error) {
          setMsg({ kind: 'error', text: String(error?.message || error) });
        } finally { setLocalBusy(false); }
      };

      const cancelJob = async (id) => {
        try {
          await postJson(R.jobsCancel, { id });
          await load();
        } catch (error) {
          setMsg({ kind: 'error', text: `取消任务失败：${error?.message || error}` });
        }
      };

      /**
       * 打开某一条候选：复用待办的同一个详情弹窗，避免两处详情各说各话。
       * 万一那个组件不在（旧 Host / 改名），退回待办，但至少还能继续操作。
       */
      const openCandidateItem = (item) => {
        if (!item?.id) return;
        if (typeof CandidatePreviewDialog !== 'function') {
          setMsg({ kind: 'warn', text: '这个版本没有条目详情：已跳到待办' });
          go('pipeline', { status: 'new' });
          return;
        }
        setPreview(item);
      };

      const candidateAction = async (id, action) => {
        try {
          await postJson(R.candidateAction, { id, action });
          setMsg({ kind: 'success', text: action === 'drop' ? '已排除这条' : '已重新加入待判读' });
        } catch (error) {
          setMsg({ kind: 'error', text: `操作失败：${error?.message || error}` });
        }
        await reload();
        await loadFresh();
      };

      /** 从来源页直接判读一条候选：起后台任务，结果回待办看。 */
      const analyzeCandidate = async (id) => {
        try {
          await postJson(R.analyze, { ids: [id], limit: 1 });
          setMsg({ kind: 'success', text: '已提交判读；完成后在待办查看结果' });
        } catch (error) {
          setMsg({ kind: 'error', text: `判读失败：${error?.message || error}` });
        }
        await reload();
        await loadFresh();
      };

      /** 展开某个渠道的长卡片；收起态只有一行标题。 */
      const expandCfg = (id) => setOpenCfg((current) => ({ ...current, [id]: true }));
      const collapseCfg = (id) => setOpenCfg((current) => ({ ...current, [id]: false }));
      const toggleCfg = (id) => (openCfg[id] ? collapseCfg(id) : expandCfg(id));

      /** 源抽屉的「查看渠道配置」：展开对应卡片并滚过去（被隐藏的渠道顺手放出来）。 */
      const openChannelConfig = (channel) => {
        if (!channel) return;
        if (!showWidget(channel)) toggleWidget(channel, true);
        expandCfg(channel);
        setDrawerKey(null);
        const target = typeof document !== 'undefined' ? document.getElementById(`radar-source-${channel}`) : null;
        if (target?.scrollIntoView) {
          setTimeout(() => target.scrollIntoView({ behavior: 'smooth', block: 'center' }), 80);
        }
      };

      /** 渠道行：一行一渠道；箭头在原行下方展开配置与逐源记录。 */
      const widget = ({ id, title, hint, meta, enabled, onToggle, onRun, runLabel, status, children, collapsed, onExpand, sourcePrefixes }) => {
        const prefixes = sourcePrefixes || CHANNEL_SOURCES[id] || [id];
        const statusColor = status.tone === 'fail' ? C.error
          : status.tone === 'missing' ? C.warn
            : C.caption;
        return h('div', {
          id: `radar-source-${id}`,
          style: { scrollMarginTop: 80, borderTop: `1px solid ${C.border1}` },
        },
          h('div', {
            style: {
              display: 'flex', alignItems: 'center', gap: T.space.sm, flexWrap: 'wrap',
              padding: `${T.space.sm + 1}px ${T.space.lg + 2}px`, minHeight: 44, boxSizing: 'border-box',
            },
          },
            h(RadarDot, { tone: status.tone }),
            h('div', {
              style: {
                flex: '0 1 210px', minWidth: 120, fontSize: fs(T.font.body), fontWeight: 600,
                color: enabled ? C.label1 : C.label2,
              },
            }, title),
            h('div', {
              title: status.text,
              style: {
                flex: '1 1 160px', minWidth: 160, fontSize: fs(T.font.hint), color: statusColor,
                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
              },
            }, status.text),
            onToggle
              ? h(Switch, {
                checked: Boolean(id === 'rss' ? channels.rssEnabled !== false : enabled),
                onChange: onToggle,
                ariaLabel: `${(id === 'rss' ? channels.rssEnabled !== false : enabled) ? '停用' : '启用'} ${title}`,
              })
              : h('span', { 'aria-hidden': 'true', style: { width: 32, height: 18, flexShrink: 0 } }),
            h(IconButton, {
              label: collapsed ? `展开 ${title} 配置` : `收起 ${title} 配置`,
              expanded: !collapsed,
              active: !collapsed,
              subtle: true,
              onClick: onExpand,
            }, h(ChevronIcon, { open: !collapsed }))),
          collapsed
            ? null
            : h('div', {
              style: {
                borderLeft: `2px solid ${tint(C.accent, 45)}`,
                background: C.bg2,
                padding: `${T.space.sm + 2}px ${T.space.lg + 2}px ${T.space.md + 2}px`,
              },
            },
              meta
                ? h('div', { style: { display: 'flex', gap: T.space.xs, flexWrap: 'wrap' } },
                  String(meta).split(' · ').filter(Boolean).map((text) => h(Chip, { key: text }, text)))
                : null,
              hint
                ? h('div', { style: { fontSize: fs(T.font.hint), color: C.label3, lineHeight: T.line.body, marginTop: T.space.xs } }, hint)
                : null,
              children
                ? h('div', {
                  style: {
                    borderTop: `1px solid ${C.border1}`,
                    marginTop: T.space.sm, paddingTop: T.space.sm,
                  },
                },
                  h('div', { style: { fontSize: fs(T.font.meta), fontWeight: 600, color: C.label2, marginBottom: T.space.micro } }, '配置'),
                  h('div', { style: { maxWidth: 720 } }, children))
                : null));
      };

      /** W：按布局隐藏；渠道行默认收起。 */
      const W = (id, props) => {
        if (!showWidget(id)) return null;
        return widget({
          ...props,
          id,
          enabled: channelEnabled(id),
          status: channelStatuses[id],
          sourcePrefixes: props.sourcePrefixes || CHANNEL_SOURCES[id] || [id],
          collapsed: !openCfg[id],
          onExpand: () => toggleCfg(id),
        });
      };

      /** 配置里的「兴趣词」只读行：说明这条渠道实际在查什么，改词去上方的研究兴趣卡。 */
      const interestRow = (hint) => h(ConfigRow, {
        label: '兴趣词',
        hint: interestTerms.length ? hint : undefined,
        control: h(ChipList, {
          items: interestTerms,
          empty: '还没填研究兴趣词：先在上方「研究兴趣」里填核心词',
        }),
      });

      const fold = (title, hint, children) => h('details', {
        style: {
          marginTop: T.space.md, border: `1px solid ${C.border2}`, borderRadius: T.radius.sm,
          background: C.bg1, padding: `${T.space.sm + 2}px ${T.space.md + 2}px`,
        },
      },
        h('summary', { style: { cursor: 'pointer', fontSize: fs(T.font.body), fontWeight: 600, color: C.label1 } },
          title,
          h('span', { style: { marginLeft: T.space.sm, fontSize: fs(T.font.hint), color: C.caption, fontWeight: 400 } }, hint)),
        h('div', { style: { marginTop: T.space.sm } }, children));

      const enabledCount = ['arxiv', 'rss', 'search', 'email', 'pubmed', 'dblp', 'preprint']
        .filter((id) => channelEnabled(id)).length;
      const runningJobs = (jobs || []).filter((job) => job.status === 'running');

      // 渠道行按 RADAR 顺序渲染；每组 props 只在这里定义一次。
      const channelNodes = {
        arxiv: W('arxiv', {
            title: 'arXiv',
            hint: '按分类或查询式增量；漏跑会自动补跑',
            meta: [
              (incremental.categories || []).length ? `${incremental.categories.length} 个分类` : null,
              (incremental.queries || []).filter(Boolean).length
                ? `${(incremental.queries || []).filter(Boolean).length} 条查询式` : null,
            ].filter(Boolean).join(' · ') || '分类未配置',
            onToggle: (v) => patchSource('arxiv', (x) => { x.enabled = v; }),
            onRun: () => runOnly('arxiv'),
            runLabel: '立即采集',
            children: h('div', null,
              h(ConfigRow, {
                first: true,
                label: '分类',
                hint: '回车添加，如 cs.RO / eess.SY',
                control: h('div', { style: { flex: '1 1 240px', minWidth: 0 } },
                  h(Chips, {
                    items: incremental.categories || [], placeholder: '输入分类，回车添加',
                    onChange: (v) => patchSource('arxiv', (x) => { x.categories = v; }),
                  })),
              }),
              h(Field, {
                label: '查询式',
                count: (incremental.queries || []).length,
                hint: '有查询式时优先于分类；留空则只按分类采集',
                right: h(Button, {
                  size: 'sm',
                  onClick: () => patchSource('arxiv', (x) => {
                    const list = Array.isArray(x.queries) ? x.queries : [];
                    x.queries = [...list, ''];
                  }),
                }, '添加一条'),
              },
                (incremental.queries || []).length
                  ? (incremental.queries || []).map((q, i) => h(ListRow, {
                    key: i,
                    first: i === 0,
                    removeLabel: `删除第 ${i + 1} 条查询式`,
                    onRemove: () => patchSource('arxiv', (x) => { x.queries.splice(i, 1); }),
                  },
                    h('div', { style: { flex: '1 1 260px', minWidth: 0 } },
                      h(TextInput, {
                        value: q || '',
                        placeholder: 'abs:"magnetic localization" OR abs:"magnetic tracking"',
                        mono: true,
                        label: `第 ${i + 1} 条 arXiv 查询式`,
                        onChange: (v) => patchSource('arxiv', (x) => { x.queries[i] = v; }),
                      }))))
                  : h(ConfigEmpty, null, '还没有查询式：留空就只按分类采集。'))),
          }),

        rss: W('rss', {
            title: 'RSS 订阅',
            onToggle: (v) => patchFlag('rssEnabled', v),
            hint: '汇总订阅的 RSS / Atom 源',
            meta: rssFeeds.length
              ? `${rssFeeds.length} 个订阅 · ${rssFeeds.filter((f) => f.enabled !== false).length} 个启用`
              : '尚未添加订阅',
            onRun: () => runOnly('rss'),
            runLabel: '立即采集',
            children: h(Field, {
              label: '订阅列表',
              count: rssFeeds.length,
              right: h(Button, {
                size: 'sm',
                onClick: () => patchRss((list) => list.push({
                  id: `feed-${Date.now()}`, name: '新订阅', url: '', enabled: true,
                })),
              }, '+ 添加'),
            },
              rssFeeds.length
                ? rssFeeds.map((feed, index) => h(ListRow, {
                  key: feed.id || index,
                  first: index === 0,
                  leading: h(Switch, {
                    checked: feed.enabled !== false,
                    onChange: (v) => patchRss((list) => { list[index].enabled = v; }),
                    ariaLabel: `${feed.name || `第 ${index + 1} 个订阅`}的启用开关`,
                  }),
                  removeLabel: `删除第 ${index + 1} 个订阅`,
                  onRemove: () => patchRss((list) => { list.splice(index, 1); }),
                },
                  h('div', { style: { width: 240, flexShrink: 0 } },
                    h(TextInput, {
                      value: feed.name || '', placeholder: '名称',
                      label: `第 ${index + 1} 个订阅名称`,
                      onChange: (v) => patchRss((list) => { list[index].name = v; }),
                    })),
                  h('div', { style: { flex: '1 1 220px', minWidth: 0 } },
                    h(TextInput, {
                      value: feed.url || '', placeholder: 'https://example.com/feed.xml', mono: true,
                      label: `第 ${index + 1} 个订阅地址`,
                      onChange: (v) => patchRss((list) => { list[index].url = v; }),
                    }))))
                : h(ConfigEmpty, null, '还没有订阅源：点右上角「+ 添加」，RSSHub 地址也能直接填。')),
          }),

        search: W('search', {
            title: '跨库检索',
            hint: '用研究兴趣自动查 OpenAlex / Crossref / S2；不用手填',
            onToggle: (v) => patchSource('search', (x) => { x.enabled = v; }),
            onRun: () => runOnly('search'),
            runLabel: '立即采集',
            meta: `${(Array.isArray(searchCfg.sources) && searchCfg.sources.length
              ? searchCfg.sources
              : ['arxiv', 'openalex', 'crossref']).length} 个检索库 · 兴趣词 ${interestTerms.length} 条`,
            children: h('div', null,
              h(ConfigRow, {
                first: true,
                label: '检索库',
                control: h('div', {
                  style: { display: 'flex', flexWrap: 'wrap', gap: `${T.space.xs}px ${T.space.lg}px` },
                }, ['arxiv', 'openalex', 'crossref', 's2'].map((key) => {
                  const current = Array.isArray(searchCfg.sources)
                    ? searchCfg.sources
                    : ['arxiv', 'openalex', 'crossref'];
                  return h(Switch, {
                    key,
                    checked: current.includes(key),
                    onChange: (v) => patchSource('search', (x) => {
                      const set = new Set(Array.isArray(x.sources) ? x.sources : current);
                      if (v) set.add(key); else set.delete(key);
                      x.sources = [...set];
                    }),
                    label: sourceLabel(key),
                    ariaLabel: `${sourceLabel(key)} 参与跨库检索`,
                  });
                })),
              }),
              interestRow('自动取研究兴趣里的纯文本词；下面的检索式会覆盖它'),
              h(Field, {
                label: '自定义检索式',
                count: (Array.isArray(searchCfg.queries) ? searchCfg.queries : []).length,
                hint: '留空就用上面的兴趣词自动查',
                right: h(Button, {
                  size: 'sm',
                  onClick: () => patchSource('search', (x) => {
                    const list = Array.isArray(x.queries) ? x.queries : [];
                    x.queries = [...list, { id: `q-${Date.now()}`, text: '', sinceDays: 30 }];
                  }),
                }, '添加一条'),
              },
                (Array.isArray(searchCfg.queries) ? searchCfg.queries : []).length
                  ? (searchCfg.queries || []).map((q, i) => h(ListRow, {
                    key: q.id || i,
                    first: i === 0,
                    removeLabel: `删除第 ${i + 1} 条检索式`,
                    onRemove: () => patchSource('search', (x) => { x.queries.splice(i, 1); }),
                  },
                    h('div', { style: { flex: '1 1 220px', minWidth: 0 } },
                      h(TextInput, {
                        value: q.text || '', placeholder: '例如 abs:"topic phrase"', mono: true,
                        label: `第 ${i + 1} 条检索式`,
                        onChange: (v) => patchSource('search', (x) => { x.queries[i].text = v; }),
                      })),
                    h('div', { style: { display: 'flex', alignItems: 'center', gap: T.space.xs } },
                      h(NumberInput, {
                        value: q.sinceDays ?? 30, min: 1, max: 365, width: 64,
                        label: `第 ${i + 1} 条检索式的天数`,
                        onChange: (v) => patchSource('search', (x) => { x.queries[i].sinceDays = v; }),
                      }),
                      h('span', { style: { fontSize: fs(T.font.hint), color: C.label2 } }, '天内'))))
                  : h(ConfigEmpty, null, '还没加检索式：留空就按研究兴趣自动检索。')),
            ),
          }),

        email: W('email', {
            title: '邮件快讯',
            hint: 'Google 学术快讯 → 候选；只读',
            onToggle: (v) => patchSource('mail', (x) => { x.enabled = v; }),
            onRun: doEmail,
            runLabel: '读一次邮件',
            meta: `${(mail.senders || []).length} 个发件人 · 每轮最多 ${mail.maxBodiesPerRun ?? 12} 封`,
            children: h('div', null,
              h(ConfigRow, {
                first: true,
                label: '账号',
                hint: '留空用默认账号',
                control: h('div', { style: { width: 260, maxWidth: '100%' } },
                  h(TextInput, {
                    value: mail.account || '', placeholder: 'default', mono: true,
                    label: 'dsh-email 账号名',
                    onChange: (v) => patchSource('mail', (x) => { x.account = v.trim(); }),
                  })),
              }),
              h(ConfigRow, {
                label: '发件人',
                hint: '只读这些地址的推送；回车添加',
                control: h('div', { style: { flex: '1 1 240px', minWidth: 0 } },
                  h(Chips, {
                    items: mail.senders || [], placeholder: '输入发件人地址，回车添加',
                    onChange: (v) => patchSource('mail', (x) => { x.senders = v; }),
                  })),
              }),
              h(ConfigRow, {
                label: '每轮最多',
                hint: '读到这么多封就停',
                control: h('div', { style: { display: 'flex', alignItems: 'center', gap: T.space.xs } },
                  h(NumberInput, {
                    value: mail.maxBodiesPerRun ?? 12, min: 1, max: 50, width: 64,
                    label: '每轮最多读几封',
                    onChange: (v) => patchSource('mail', (x) => { x.maxBodiesPerRun = v; }),
                  }),
                  h('span', { style: { fontSize: fs(T.font.hint), color: C.label2 } }, '封')),
              }),
              h(ConfigRow, {
                label: '读完标已读',
                hint: '只对判定为论文推送的邮件生效',
                control: h(Switch, {
                  checked: mail.markRead === true,
                  onChange: (v) => patchSource('mail', (x) => { x.markRead = v; }),
                  label: mail.markRead ? '会标已读' : '不动邮箱',
                  ariaLabel: '读完标已读',
                }),
              }),
            ),
          }),

        pubmed: W('pubmed', {
            title: 'PubMed / Europe PMC',
            hint: '医学、器械、临床文献',
            onToggle: (v) => patchSource('pubmed', (x) => { x.enabled = v; }),
            onRun: () => runOnly('pubmed'),
            runLabel: '立即采集',
            children: h('div', null,
              interestRow('自动拼成检索式，不在这里手写'),
              h(ConfigRow, {
                label: '回看天数',
                hint: '查得越久越慢',
                control: h('div', { style: { display: 'flex', alignItems: 'center', gap: T.space.xs } },
                  h(NumberInput, {
                    value: pubmed.sinceDays ?? 30, min: 1, max: 3650, width: 64,
                    label: 'PubMed 回看天数',
                    onChange: (v) => patchSource('pubmed', (x) => { x.sinceDays = v; }),
                  }),
                  h('span', { style: { fontSize: fs(T.font.hint), color: C.label2 } }, '天')),
              }),
              h(ConfigRow, {
                label: '每轮上限',
                control: h('div', { style: { display: 'flex', alignItems: 'center', gap: T.space.xs } },
                  h(NumberInput, {
                    value: pubmed.limit ?? 50, min: 1, max: 100, width: 64,
                    label: 'PubMed 每轮上限',
                    onChange: (v) => patchSource('pubmed', (x) => { x.limit = v; }),
                  }),
                  h('span', { style: { fontSize: fs(T.font.hint), color: C.label2 } }, '条')),
              }),
            ),
          }),

        dblp: W('dblp', {
            title: 'DBLP',
            hint: 'CS / 机器人会议与期刊（无摘要）',
            onToggle: (v) => patchSource('dblp', (x) => { x.enabled = v; }),
            onRun: () => runOnly('dblp'),
            runLabel: '立即采集',
            children: h('div', null,
              interestRow('自动拼成检索式，不在这里手写'),
              h(ConfigRow, {
                label: '发表年份',
                hint: '按会议/期刊年份筛',
                control: h('div', { style: { display: 'flex', alignItems: 'center', gap: T.space.xs } },
                  h('span', { style: { fontSize: fs(T.font.hint), color: C.label2 } }, '近'),
                  h(NumberInput, {
                    value: dblp.sinceYears ?? 2, min: 0, max: 30, width: 64,
                    label: 'DBLP 近几年',
                    onChange: (v) => patchSource('dblp', (x) => { x.sinceYears = v; }),
                  }),
                  h('span', { style: { fontSize: fs(T.font.hint), color: C.label2 } }, '年')),
              }),
            ),
          }),

        preprint: W('preprint', {
            title: 'bioRxiv / medRxiv',
            hint: '预印本；按日期分块',
            onToggle: (v) => patchSource('preprint', (x) => { x.enabled = v; }),
            onRun: () => runOnly('preprint'),
            runLabel: '立即采集',
            children: h('div', null,
              h(ConfigRow, {
                first: true,
                label: '回看天数',
                hint: '按日期取，关键词在入池时过滤',
                control: h('div', { style: { display: 'flex', alignItems: 'center', gap: T.space.xs } },
                  h(NumberInput, {
                    value: preprint.sinceDays ?? 3, min: 1, max: 30, width: 64,
                    label: '预印本回看天数',
                    onChange: (v) => patchSource('preprint', (x) => { x.sinceDays = v; }),
                  }),
                  h('span', { style: { fontSize: fs(T.font.hint), color: C.label2 } }, '天')),
              }),
              h(ConfigRow, {
                label: '每轮上限',
                control: h('div', { style: { display: 'flex', alignItems: 'center', gap: T.space.xs } },
                  h(NumberInput, {
                    value: preprint.limit ?? 50, min: 1, max: 200, width: 64,
                    label: '预印本每轮上限',
                    onChange: (v) => patchSource('preprint', (x) => { x.limit = v; }),
                  }),
                  h('span', { style: { fontSize: fs(T.font.hint), color: C.label2 } }, '条')),
              }),
            ),
          }),
      };

      // 顺序：先概况，再采集，再配置（兴趣/渠道），最后记录与历史。
      // 高级的「历史补齐 / 布局编辑」不再放在页面上。
      return h('div', null,
        h(RadarOverviewCard, {
          state,
          onOpenRecord: () => {
            if (typeof document === 'undefined') return;
            const target = document.getElementById('radar-fresh');
            if (target && typeof target.scrollIntoView === 'function') target.scrollIntoView({ block: 'start' });
          },
        }),
        h(RadarScanBar, {
          config,
          saveConfig,
          enabledCount,
          localBusy,
          onRunAll: () => runOnly(null),
          onAddPaper: () => setAddOpen(true),
        }),
        addOpen
          ? h(AddPaperDialog, {
            onClose: () => setAddOpen(false),
            onAdded: async () => { await reload?.(); },
          })
          : null,
        msg ? h(Notice, { kind: msg.kind }, msg.text) : null,
        h(InterestCard, { config, saveConfig }),
        h(Card, { style: { padding: 0, marginBottom: T.space.md, overflow: 'hidden' } },
          h('div', { style: { padding: `${T.space.lg}px ${T.space.lg + 2}px ${T.space.md}px` } },
            h(SectionTitle, {
              hint: h('span', null,
                `${visibleChannelIds.length} 个渠道 · ${enabledRowCount} 个启用`,
                failedRowCount
                  ? h('span', { style: { color: C.error } }, ` · ${failedRowCount} 个失败`)
                  : null,
                missingRowCount
                  ? h('span', { style: { color: C.warn } }, ` · ${missingRowCount} 个未配置`)
                  : null),
              right: saving
                ? h('span', { style: { fontSize: fs(T.font.hint), color: C.caption } }, '保存中…')
                : dirty
                  ? h(Button, { primary: true, size: 'sm', onClick: saveChannels }, '保存渠道配置')
                  : savedAt
                    ? h('span', {
                      role: 'status', 'aria-live': 'polite',
                      style: { fontSize: fs(T.font.hint), color: C.caption },
                    }, `已保存 ${new Date(savedAt).toLocaleTimeString()}`)
                    : null,
            }, '渠道配置')),
          visibleChannelIds.map((id) => channelNodes[id])),
        h('div', { id: 'radar-fresh' },
          h(RadarFreshCard, {
            fresh,
            stats: freshStats,
            onRetry: loadFresh,
            onOpenAll: () => setRecordsOpen(true),
            onOpenItem: openCandidateItem,
          })),
        h(RadarHistoryCard, { state }),
        recordsOpen
          ? h(RadarRecordsDrawer, {
            onClose: () => setRecordsOpen(false),
            onOpenItem: (item) => { setRecordsOpen(false); openCandidateItem(item); },
          })
          : null,
        drawerKey
          ? h(RadarSourceDrawer, {
            sourceKey: drawerKey,
            name: RadarSourceName(drawerKey, channels),
            value: (state?.sources || {})[drawerKey] || {},
            weekCount: RadarWeekCounts(state)[drawerKey] || 0,
            channel: sourceChannel(drawerKey),
            enabled: sourceEnabled(drawerKey),
            canToggle: Boolean(sourceChannel(drawerKey)),
            canRun: (() => {
              const channel = sourceChannel(drawerKey);
              if (!channel) return false;
              if (channel === 'email') return true;
              return channelEnabled(channel) && showWidget(channel);
            })(),
            busy: localBusy,
            refreshKey: freshRev,
            note: msg,
            onRun: () => {
              const channel = sourceChannel(drawerKey);
              if (channel === 'email') { doEmail(); return; }
              runOnly(channel);
            },
            onToggle: (value) => toggleSourceEnabled(drawerKey, value),
            onOpenConfig: () => openChannelConfig(sourceChannel(drawerKey)),
            onOpenCandidate: (item) => { setDrawerKey(null); openCandidateItem(item); },
            onClose: () => setDrawerKey(null),
          })
          : null,

        // 候选详情复用待办的同一个弹窗：判读、重跑、丢弃都在这里，关掉就回来源页。
        typeof CandidatePreviewDialog === 'function' && preview
          ? h(CandidatePreviewDialog, {
            candidate: preview,
            onClose: () => setPreview(null),
            onAnalyze: () => analyzeCandidate(preview.id),
            onRerun: () => candidateAction(preview.id, 'rerun'),
            onDrop: () => candidateAction(preview.id, 'drop'),
          })
          : null,
      );
    }
    // ── 总览 ──────────────────────────────────────────────────
    // 用户视角：今天值得读什么 / 需要处理什么 / 会不会漏论文。

    /** 下次自动运行的时间戳：插件固定按 Asia/Shanghai（UTC+8，无夏令时）解释 schedule.time。 */
    function overviewNextRunAt(schedule, now = Date.now()) {
      if (!schedule?.enabled) return null;
      const [rawHour, rawMinute] = String(schedule.time || '07:00').split(':').map((x) => Number(x));
      const hour = Number.isFinite(rawHour) ? Math.min(23, Math.max(0, rawHour)) : 7;
      const minute = Number.isFinite(rawMinute) ? Math.min(59, Math.max(0, rawMinute)) : 0;
      const local = new Date(now + 8 * 3600 * 1000);
      let target = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate(), hour, minute, 0)
        - 8 * 3600 * 1000;
      if (target <= now) target += 86400000;
      return target;
    }

    /** 回执里的时刻：解析不出来就留空，不把 Invalid Date 摆到界面上。 */
    function overviewClock(iso) {
      const time = Date.parse(iso || '');
      if (!Number.isFinite(time)) return '';
      return new Date(time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }

    /** 下次运行说成「今天/明天 HH:MM」，跨昼夜时才不会只看到 05:00 而不知道哪天。 */
    function overviewRunLabel(ts, now = Date.now()) {
      if (!Number.isFinite(ts)) return '';
      const local = new Date(ts + 8 * 3600 * 1000);
      const todayLocal = new Date(now + 8 * 3600 * 1000);
      const clock = `${String(local.getUTCHours()).padStart(2, '0')}:${String(local.getUTCMinutes()).padStart(2, '0')}`;
      const sameDay = local.toISOString().slice(0, 10) === todayLocal.toISOString().slice(0, 10);
      return `${sameDay ? '今天' : '明天'} ${clock}`;
    }

    /** 上次成功到现在多久：给人读的相对时间。 */
    function overviewAgo(iso) {
      const time = Date.parse(iso || '');
      if (!Number.isFinite(time)) return '';
      const seconds = Math.max(0, Math.round((Date.now() - time) / 1000));
      if (seconds < 90) return '刚刚';
      if (seconds < 3600) return `${Math.round(seconds / 60)} 分钟前`;
      if (seconds < 86400) return `${Math.round(seconds / 3600)} 小时前`;
      return `${Math.round(seconds / 86400)} 天前`;
    }

    /**
     * 摘要分组标签是配置里的正则（如 `topic phrase|topic`）。
     * 原样印出来像乱码：这里取第一条分支、剥掉字符集与量词，得到人能读的词。
     */
    function overviewKeywordLabel(word) {
      const clean = (text) => String(text || '').replace(/^\^|\$$/g, '').replace(/\\(.)/g, '$1');
      let text = String(word || '').trim().replace(/\(\?[a-z]+\)/gi, '');
      // 先处理分组与字符集，再拆顶层 `|`，否则 `endoscop(y|e)` 会被拆坏
      text = text.replace(/\(([^)]*)\)/g, (_, inner) => clean(String(inner).split('|')[0]));
      text = text.replace(/\[([^\]]*)\]/g, (_, inner) => {
        const body = String(inner).replace(/^\^/, '');
        return body.includes('-') ? '-' : (body.match(/[0-9a-z]/i) || [''])[0];
      });
      text = clean(String(text).split('|')[0]);
      text = text.replace(/[?*+{}]/g, '').replace(/\s+/g, ' ').trim();
      return text || String(word || '').trim();
    }

    // ── 总览 ──────────────────────────────────────────────────
    // 这一页先给「你现在该点哪」，再给「已经有什么」和「它替你做了什么」。
    // 数据只有几篇时也不能是三个空框：存量四格负责托底；采集运行日志放在来源页。

    function Overview({ state, config, busy, runDiscover, openPaper, openPaperCard, onOpenPdf, onMarkRead, onRerun, onTranslate, onOpenUrl, navigate, analysisStats, onDismiss }) {
      const summary = state.summary || {};
      const stages = summary.stages || {};
      const counts = summary.counts || {};
      const date = state.date || '';
      const papers = Array.isArray(state.papers) ? state.papers : [];
      const runs = Array.isArray(state.runs) ? state.runs : [];
      const canGo = typeof navigate === 'function';
      const go = (tab, opts) => { if (canGo) navigate(tab, opts); };
      const canDiscover = typeof runDiscover === 'function';
      const canOpen = typeof openPaper === 'function';
      const canOpenCard = typeof openPaperCard === 'function';

      // 阅读队列：不按天分。新论文一直进队列，标已读即离开；后端只存 read_at。
      const [queueAll, setQueueAll] = useState(false);
      const [readOpen, setReadOpen] = useState(false);
      const [reviewOpen, setReviewOpen] = useState(() => new Set());
      const [abstractOpen, setAbstractOpen] = useState(() => new Set());
      const [onboardDismissed, setOnboardDismissed] = useState(false);
      const canMarkRead = typeof onMarkRead === 'function';
      const gradeRank = { S: 0, A: 1, B: 2, C: 3, D: 4 };
      // 阅读队列只收“已经过 L3 评价、且有本地原文”的论文；不再看 L1/L2 评级。
      // 队列先给一句结论，长文折叠；第一句足够判断要不要展开。
      const reviewShort = (text) => {
        const full = String(text || '').replace(/\s+/g, ' ').trim();
        const first = full.split(/(?<=[。！？.!?])\s*/)[0] || full;
        return first.length > 120 ? `${first.slice(0, 120)}…` : first;
      };
      const readable = (p) => Boolean(p.l3) && Boolean(p.has_pdf);
      const unreadPapers = papers
        .filter((p) => !p.read_at && p.stage !== 'dropped' && readable(p))
        .sort((a, b) => (gradeRank[a.grade] ?? 9) - (gradeRank[b.grade] ?? 9)
          || String(b.first_seen || '').localeCompare(String(a.first_seen || '')));
      const readPapers = papers
        .filter((p) => p.read_at && p.stage !== 'dropped' && readable(p))
        .sort((a, b) => String(b.read_at || '').localeCompare(String(a.read_at || '')));
      // 还在流水线里、暂时不够格的：在空态里提一句有多少，别让人以为漏了
      const waitingPapers = papers.filter((p) => !p.read_at && p.stage !== 'dropped' && !readable(p));
      // ── 待办：按篇去重 ─────────────────────────────────────
      // 一篇论文只出现一次；优先级 = 缺原文 > 低置信 > 摘要没取到 > 待初筛/精读/等 AI。
      // 「摘要没取到」只对还没走完流水线的论文成立，已完成的不该再报这个问题。
      const hasFlag = (p, flag) => (Array.isArray(p.review_flags) ? p.review_flags : []).includes(flag);
      const pendingPapers = papers.filter((p) => ['L1', 'L2', 'L3'].includes(p.stage));
      const paperTodoKey = (p) => {
        if (hasFlag(p, 'needs_pdf')) return 'needs_pdf';
        if (hasFlag(p, 'low_confidence')) return 'low_confidence';
        if (p.abstract_lookup && p.abstract_lookup.has_abstract === false) return 'no_abstract';
        if (p.stage === 'L1') return 'waiting';
        return `stage_${p.stage}`;
      };
      const paperBuckets = new Map();
      for (const paper of pendingPapers) {
        const key = paperTodoKey(paper);
        if (!paperBuckets.has(key)) paperBuckets.set(key, []);
        paperBuckets.get(key).push(paper);
      }
      const countPapers = (key) => (paperBuckets.get(key) || []).length;
      const candidateParked = Number(counts.parked || 0);
      const candidateFailed = Number(counts.failed || 0);

      // 每个分项都能直接落到对应的处理位置；缺原文 / 摘要没取到直接打开那篇抽屉
      const todoSegment = (key, label, count, target) => (count ? { key, label, count, target } : null);
      const firstPaperOf = (key) => (paperBuckets.get(key) || [])[0] || null;
      const openTodoSegment = (segment) => {
        const paper = segment.target.paper;
        if (paper && canOpen) { openPaper(paper.id); return; }
        go(segment.target.go, segment.target.opts);
      };
      // 只列「需要人动手」的：待确认、失败、缺原文、低置信。
      // 待判读 / 待初筛 / 待精读是 AI 的队列，属于待办，不在总览当人的待办。
      const todoSegments = [
        todoSegment('parked', '待确认', candidateParked, { go: 'pipeline', opts: { group: 'decide' } }),
        todoSegment('failed', '判读失败', candidateFailed, { go: 'pipeline', opts: { group: 'ai' } }),
        todoSegment('needs_pdf', '缺原文', countPapers('needs_pdf'), { go: 'pipeline', opts: { group: 'material' }, paper: firstPaperOf('needs_pdf') }),
        todoSegment('low_confidence', '低置信', countPapers('low_confidence'), { go: 'pipeline', opts: { group: 'material' } }),
      ].filter(Boolean);
      const todoTotal = todoSegments.reduce((sum, item) => sum + item.count, 0);

      // ── 存量：四格都能点，4 篇论文时也有「已有」可看 ────────
      // 存量四格只放读者关心的：待读 / 已读 / 精读卡片 / 已入 Zotero。
      // 待看摘要、待初筛是 AI 的活，放在待办，不占首页。
      const cardCount = papers.filter((p) => p.l3?.card_markdown).length;
      const libraryCount = Number(summary.library || 0);
      const stockTiles = [
        { key: 'unread', label: '待读', value: unreadPapers.length, onClick: canGo ? () => go('reading', { reading: 'unread' }) : undefined },
        { key: 'read', label: '已读', value: readPapers.length, onClick: canGo ? () => go('reading', { reading: 'read' }) : undefined },
        { key: 'cards', label: '精读卡片', value: cardCount, onClick: canGo ? () => go('reading', { reading: 'cards' }) : null },
        { key: 'library', label: '已入 Zotero', value: libraryCount, onClick: canGo ? () => go('reading', { reading: 'cards' }) : null },
      ];

      // ── 需要你留意：只有会让人漏论文 / 卡住流程的事才出现 ──
      const sources = Object.entries(state.sources || {});
      const failedSources = sources.filter(([, value]) => value?.last_error);
      const stats = analysisStats || null;
      const limits = stats?.limits || null;
      const usage = stats?.usage || null;
      // 额度按档说：哪一档用完说哪一档，别笼统说「判读额度用完」
      const quotaStages = limits ? [
        { key: 'l1', label: '待看摘要', limit: Number(limits.l1) || 0, used: Number(usage?.l1) || 0 },
        { key: 'l2', label: '初筛', limit: Number(limits.l2) || 0, used: Number(usage?.l2) || 0 },
        { key: 'l3', label: '精读', limit: Number(limits.l3) || 0, used: Number(usage?.l3) || 0 },
      ] : [];
      const quotaOut = quotaStages.filter((item) => item.limit > 0 && item.used >= item.limit);
      const quotaOpen = quotaStages.filter((item) => item.limit <= 0 || item.used < item.limit);
      const quotaText = quotaOut.length
        ? `${quotaOut.map((item) => `${item.label}额度已用完（${item.used}/${item.limit}）`).join('、')}`
          + (quotaOpen.length ? `，${quotaOpen.map((item) => item.label).join('与')}仍可用` : '，只能等明天')
        : '';
      const scheduleOn = config?.schedule?.enabled === true;
      const aiOn = config?.analysis?.enabled !== false;
      const issues = [];
      if (failedSources.length) issues.push({
        key: 'sources',
        tone: C.error,
        text: `${failedSources.map(([key]) => {
          const channel = typeof sourceChannel === 'function' ? sourceChannel(key) : null;
          return channel ? (RADAR_LABELS[channel] || channel) : key;
        }).slice(0, 3).join('、')} 采集失败，今天可能漏了新论文`,
        action: ['去排查', () => go('sources')],
      });
      if (!aiOn) issues.push({
        key: 'ai', tone: C.warn, text: 'AI 判读已关闭，新论文不会自动过筛', action: ['去打开', () => go('settings')],
      });
      if (quotaOut.length) issues.push({
        key: 'quota', tone: C.warn, text: quotaText, action: ['去调额度', () => go('settings')],
      });
      if (!scheduleOn) issues.push({
        key: 'schedule', tone: C.caption, text: '自动采集没开，只能手动点「立即采集」', action: ['去开启', () => go('sources')],
      });

      // ── 首启三步：没设兴趣词 / 什么都还没有时，页面最顶部就是上手路径 ──
      const noKeywords = Boolean(config)
        && !(config?.relevance?.keywords || []).length
        && !(config?.relevance?.contextKeywords || []).length;
      const nothingYet = !papers.length && Object.values(counts).every((value) => !Number(value));
      const showOnboarding = !onboardDismissed && (noKeywords || nothingYet);
      const onboardingSteps = [
        { key: 'interest', title: '设置研究兴趣（至少 3 个关键词）', action: ['去设置', () => go('settings')] },
        { key: 'source', title: '启用至少一个来源（arXiv / 邮件快讯）', action: ['去来源', () => go('sources')] },
        { key: 'todo', title: '查看待处理论文', action: canDiscover ? ['立即采集', () => runDiscover()] : null },
      ];


      return h('div', null,
        // 0) 首启三步卡（最高优先级，出现时它就是首屏）
        showOnboarding
          ? h(Card, { style: { marginBottom: T.space.md } },
            h('div', { style: { display: 'flex', gap: T.space.md, alignItems: 'flex-start' } },
              h('div', { style: { flex: 1, minWidth: 0 } },
                h('div', { style: { fontSize: fs(T.font.section), fontWeight: 600, color: C.label1 } }, '开始使用'),
                h('div', { style: { fontSize: fs(T.font.hint), color: C.caption, marginTop: T.space.xs, lineHeight: T.line.body } },
                  '完成以下三步后，采集与判读将自动运行。')),
              typeof onDismiss === 'function'
                ? h(Button, { size: 'sm', onClick: () => { setOnboardDismissed(true); onDismiss(); } }, '跳过')
                : null),
            h('div', { style: { marginTop: T.space.md } },
              onboardingSteps.map((step, index) => h('div', {
                key: step.key,
                style: {
                  display: 'flex', gap: T.space.md, alignItems: 'center',
                  padding: `${T.space.sm}px 0`, borderTop: index === 0 ? 'none' : `1px solid ${C.border1}`,
                },
              },
                h('span', { style: { fontSize: fs(T.font.hint), color: C.caption, flexShrink: 0 } }, ['①', '②', '③'][index] || `${index + 1}.`),
                h('span', { style: { flex: 1, minWidth: 0, fontSize: fs(T.font.body), color: C.label1 } }, step.title),
                step.action ? h(Button, { size: 'sm', onClick: step.action[1] }, step.action[0]) : null))))
          : null,

        // 1) 待办在前：一行结论 + 一个主按钮；每一项都能直接点到落点
        h(Card, { style: { marginBottom: T.space.md } },
          h('div', { style: { display: 'flex', alignItems: 'center', gap: T.space.md, flexWrap: 'wrap' } },
            h('div', { style: { flex: 1, minWidth: 200 } },
              todoTotal
                ? h('div', { style: { display: 'flex', alignItems: 'baseline', gap: T.space.xs, flexWrap: 'wrap' } },
                  h('span', { style: { fontSize: fs(T.font.body), fontWeight: 600, color: C.label1 } }, `待处理 ${todoTotal} 件`),
                  todoSegments.flatMap((segment, index) => [
                    index
                      ? h('span', { key: `${segment.key}-sep`, style: { fontSize: fs(T.font.hint), color: C.caption } }, '·')
                      : null,
                    h('button', {
                      key: segment.key,
                      type: 'button',
                      onClick: () => openTodoSegment(segment),
                      title: `打开${segment.label}`,
                      ...FOCUS_RING,
                      style: {
                        appearance: 'none', border: 'none', background: 'transparent', padding: 0,
                        fontFamily: 'inherit', fontSize: fs(T.font.hint), color: C.accent, cursor: 'pointer',
                      },
                    }, `${segment.label} ${segment.count}`),
                  ]))
                : h('div', { style: { fontSize: fs(T.font.body), fontWeight: 600, color: C.label1 } },
                  '当前没有待处理事项')),
            todoTotal
              ? h(Button, { primary: true, size: 'sm', onClick: () => go('pipeline') }, '查看待处理')
              : canDiscover
                ? h(Button, { primary: true, size: 'sm', onClick: () => runDiscover(), disabled: busy }, '立即采集')
                : null)),

        // 1.5) 存量四格：先给一眼可知的存量，再进入具体列表
        h(Card, { style: { marginBottom: T.space.md } },
          h('div', { style: { display: 'flex', gap: T.space.sm, flexWrap: 'wrap' } },
            stockTiles.map((tile) => h(StatTile, {
              key: tile.key, label: tile.label, value: tile.value, onClick: tile.onClick || undefined,
            })))),

        // 2) 阅读队列：一条持续更新的队列，不按天分，也不再有「看昨天」
        h(Card, { id: 'reading-queue', style: { marginBottom: T.space.md } },
          h(SectionTitle, {
            hint: '仅列出已精读且有原文的论文；完整列表在「阅读」页',
            right: h('div', { style: { display: 'flex', gap: T.space.xs, alignItems: 'center' } },
              h('span', { style: { fontSize: fs(T.font.hint), color: C.caption } }, `未读 ${unreadPapers.length} 篇`),
              unreadPapers.length > 6 && !queueAll
                ? h(Button, { size: 'sm', onClick: () => go('reading', { reading: 'unread' }) }, '查看全部')
                : null),
          }, '阅读队列'),
          unreadPapers.length
            ? h('div', null,
              (queueAll ? unreadPapers : unreadPapers.slice(0, 6)).map((p) => h(ReadingQueueRow, { key: p.id, p, openPaper, openPaperCard, onOpenPdf, onMarkRead, onRerun, onTranslate, onOpenUrl })),
              unreadPapers.length > 6 && !queueAll
                ? h('div', { style: { marginTop: T.space.sm } },
                  h(Button, { size: 'sm', onClick: () => go('reading', { reading: 'unread' }) }, `查看全部 ${unreadPapers.length} 篇`))
                : null)
            : h(EmptyState, {
              title: '暂无待读论文',
              desc: waitingPapers.length
                ? `另有 ${waitingPapers.length} 篇未完成精读或缺少原文，两项满足后进入队列`
                : '论文完成精读并取得原文后进入队列',
              actions: [
                canGo ? h(Button, { size: 'sm', primary: true, onClick: () => go('pipeline') }, '去待办') : null,
                canDiscover ? h(Button, { size: 'sm', onClick: () => runDiscover(), disabled: busy }, '立即采集') : null,
              ],
            }),
          readPapers.length || readOpen
            ? h('div', { style: { marginTop: T.space.sm } },
              h(Button, {
                size: 'sm',
                onClick: () => setReadOpen((value) => !value),
              }, readOpen ? `收起已读（${readPapers.length}）` : `已读 ${readPapers.length} 篇`),
              readOpen
                ? h('div', null,
                  readPapers.length
                    ? readPapers.slice(0, 50).map((p) => h(ReadingQueueRow, { key: p.id, p, openPaper, openPaperCard, onOpenPdf, onMarkRead, onRerun, onTranslate, onOpenUrl }))
                    : h('div', { style: { fontSize: fs(T.font.hint), color: C.caption, padding: '6px 0' } }, '还没有已读论文；用「标为已读」把读过的论文移到这里。'))
                : null)
            : null),

        // 4) 需要注意：会漏论文 / 卡住流程的事
        issues.length
          ? h(Card, { style: { marginBottom: T.space.md } },
            h(SectionTitle, { hint: '这些会影响今天能否正常收到论文' }, '需要注意'),
            issues.map((issue) => h('div', {
              key: issue.key,
              style: {
                display: 'flex', gap: T.space.md, alignItems: 'center',
                padding: `${T.space.sm}px 0`, borderTop: `1px solid ${C.border1}`,
              },
            },
              h('span', {
                style: { width: 6, height: 6, borderRadius: '50%', background: issue.tone, flexShrink: 0 },
              }),
              h('span', { style: { flex: 1, fontSize: fs(T.font.body), color: C.label2 } }, issue.text),
              h(Button, { size: 'sm', onClick: issue.action[1] }, issue.action[0]))))
          : null,

      );
    }
    // ── 队列概况表（页首唯一计数来源）─────────────────────────
    // 数据全部来自 pipelineBoard()，这张卡不自己数字；口径见 03-board.js。
    const BOARD_GRID = {
      display: 'grid',
      gridTemplateColumns: 'minmax(200px, 1.4fr) 56px 100px 124px 100px minmax(120px, 1fr)',
      columnGap: 12,
      alignItems: 'center',
    };
    const BOARD_TH = {
      fontSize: fs(12.5), color: C.caption, paddingBottom: 2,
    };
    const BOARD_STAGE_NAME = { fontSize: fs(13.5), fontWeight: 600, color: C.label1, lineHeight: 1.35 };
    const BOARD_STAGE_DESC = { fontSize: fs(12), color: C.caption, lineHeight: 1.4 };
    const BOARD_NUM = { fontSize: fs(15), fontWeight: 600, fontVariantNumeric: 'tabular-nums', lineHeight: 1.2 };
    const BOARD_NUM_ZERO = { ...BOARD_NUM, color: C.caption, fontWeight: 500 };
    const BOARD_QUOTA = { fontSize: fs(13.5), fontWeight: 500, color: C.label2, fontVariantNumeric: 'tabular-nums' };
    const BOARD_ROW = { ...BOARD_GRID, minHeight: 36, padding: '4px 0', borderTop: `1px solid ${C.border1}` };
    const BOARD_NOTE = { fontSize: fs(12.5), lineHeight: 1.6, color: C.caption };

    /** 处理方：三种取值对应人工、自动、混合；空行为不计。 */
    function boardOwnerChip(owner) {
      if (owner === 'auto') return h(Chip, { tone: C.accent }, '自动');
      if (owner === 'human') return h(Chip, { tone: C.warn }, '人工');
      if (owner === 'both') return h(Chip, null, '人工 + 自动');
      return h('span', { style: { fontSize: fs(12), color: C.caption } }, '—');
    }

    /** 积压分布：4px 双色条，人工占比在前；没有条目时不画。 */
    function boardBar(row) {
      const total = row.queued || 0;
      if (!total) return h('span', { style: { display: 'block', height: 4 } });
      const human = row.queued ? Math.min(1, row.human / row.queued) : 0;
      const width = (ratio) => `${Math.max(ratio > 0 ? 2 : 0, Math.round(ratio * 100))}%`;
      return h('span', {
        style: {
          display: 'flex', height: 4, borderRadius: 2, overflow: 'hidden', background: C.bg2,
        },
        title: `人工 ${row.human} · 自动 ${row.auto} · 排队 ${row.queued}`,
      },
        human > 0 ? h('i', { style: { display: 'block', height: '100%', width: width(human), background: C.warn } }) : null,
        row.auto > 0 ? h('i', { style: { display: 'block', height: '100%', width: width(1 - human), background: C.accent } }) : null);
    }

    /** 计数口径：默认折叠，避免占掉首屏。 */
    const BOARD_METHOD = [
      '待判读为候选尚未得到结论；待确认为 AI 建议暂缓；待初筛、待精读为论文当前阶段；待推进为旧版阶段。',
      '需要人处理是排队的子集：缺摘要、缺原文、原文解析失败、判读失败、低置信、待确认与旧版阶段。',
      '一条只计一行，也只进一个框；两个框的条目数之和等于合计。',
      '暂停中、已完成、已排除与已过滤不计入；候选转为论文后只按论文计。',
      '搜索、排序与点击表格数字只影响两个框的可见行；上表始终为全量。',
    ];

    /**
     * 概况表：阶段 / 排队 / 需要人处理 / 今日额度 / 处理方 / 积压分布。
     * 数字只读（下钻在第三步接入）；table 之外的旧结构保持不动。
     */
    function QueueBoardCard({ board, auto, onDownload, onToggleAuto, downloadBusy, onFocusRow, onLoadMore, loadMoreBusy }) {
      const nextRun = board?.nextRun;
      const statusText = !auto
        ? '自动处理已关闭 · 需手动运行'
        : nextRun && nextRun.text !== '时间未设置'
          ? `自动处理已开启 · 下次运行 ${nextRun.text}`
          : '自动处理已开启 · 时间未设置';
      const total = board?.total || { queued: 0, human: 0, auto: 0, truncated: false };
      const paused = Number(board?.paused) || 0;
      const rows = board?.rows || [];
      const quotaPdf = board?.pdfQuota || null;

      const notes = [
        '合计 = 需要人处理 + AI 队列；两个框的条目数与此一致，一条只落一行。',
        paused ? `排队不含暂停中的 ${paused} 条，暂停到期后自动回到队列。` : null,
        quotaPdf ? `原文下载 今日 ${quotaPdf.used} / ${quotaPdf.limit || '不限'} · 下载可用原文` : null,
        total.truncated ? `统计范围：已加载 ${total.loaded} / 共 ${total.queued} 条` : null,
      ].filter(Boolean);

      return h(Card, { id: 'queue-board', style: { marginBottom: T.space.md } },
        h('div', { style: { display: 'flex', alignItems: 'center', gap: T.space.xs, flexWrap: 'wrap', minHeight: 26 } },
          h('span', { style: { fontSize: fs(16), fontWeight: 600, color: C.label1 } }, '队列概况'),
          h('span', { style: { fontSize: fs(12.5), color: C.caption } }, statusText),
          h('div', { style: { marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: T.space.xs } },
            h(Menu, {
              label: '⋯',
              items: [
                { key: 'dl', label: downloadBusy ? '正在下载原文…' : '下载可用原文', disabled: downloadBusy, onClick: onDownload },
                { key: 'auto', label: `自动判读：${auto ? '已开启' : '已关闭'}`, active: auto, onClick: onToggleAuto },
              ],
            }))),

        h('div', { style: { ...BOARD_GRID, marginTop: 10 } },
          h('div', { style: BOARD_TH }, '阶段'),
          h('div', { style: { ...BOARD_TH, textAlign: 'right' } }, '排队'),
          h('div', { style: { ...BOARD_TH, textAlign: 'right' } }, '需要人处理'),
          h('div', { style: { ...BOARD_TH, textAlign: 'right' } }, '今日额度'),
          h('div', { style: BOARD_TH }, '处理方'),
          h('div', { style: BOARD_TH }, '积压分布')),

        rows.map((row) => h('div', { key: row.key, style: BOARD_ROW },
          h('div', { style: { display: 'flex', flexDirection: 'column', gap: 1 } },
            h('span', { style: BOARD_STAGE_NAME }, row.label),
            h('span', { style: BOARD_STAGE_DESC }, row.desc)),
          h('div', {
            style: { textAlign: 'right' },
            role: typeof onFocusRow === 'function' ? 'button' : undefined,
            tabIndex: typeof onFocusRow === 'function' ? 0 : undefined,
            title: typeof onFocusRow === 'function' ? `只看${row.label}` : undefined,
            onClick: typeof onFocusRow === 'function' ? () => onFocusRow(row.key) : undefined,
            onKeyDown: typeof onFocusRow === 'function'
              ? (e) => { if (e.key === 'Enter') { e.preventDefault(); onFocusRow(row.key); } }
              : undefined,
          },
            h('span', { style: row.queued ? BOARD_NUM : BOARD_NUM_ZERO }, `${row.queued}${row.truncated ? '+' : ''}`)),
          h('div', {
            style: { textAlign: 'right' },
            role: typeof onFocusRow === 'function' ? 'button' : undefined,
            tabIndex: typeof onFocusRow === 'function' ? 0 : undefined,
            title: typeof onFocusRow === 'function' ? `只看${row.label}` : undefined,
            onClick: typeof onFocusRow === 'function' ? () => onFocusRow(row.key) : undefined,
            onKeyDown: typeof onFocusRow === 'function'
              ? (e) => { if (e.key === 'Enter') { e.preventDefault(); onFocusRow(row.key); } }
              : undefined,
          },
            h('span', {
              style: row.human ? { ...BOARD_NUM, color: C.warn } : BOARD_NUM_ZERO,
            }, `${row.human}${row.truncated ? '+' : ''}`)),
          h('div', { style: { textAlign: 'right' } },
            row.quota
              ? h('span', {
                style: row.quota.tone === 'error' ? { ...BOARD_QUOTA, color: C.error } : row.quota.tone === 'off' ? { ...BOARD_QUOTA, color: C.caption } : BOARD_QUOTA,
              }, row.quota.text)
              : h('span', { style: { ...BOARD_QUOTA, color: C.caption } }, '—')),
          h('div', null, boardOwnerChip(row.owner)),
          h('div', null, boardBar(row)))),

        h('div', { style: { ...BOARD_GRID, minHeight: 34, borderTop: `1px solid ${C.border2}`, background: C.bg2, margin: '0 -18px', padding: '0 18px' } },
          h('div', { style: { fontSize: fs(13), fontWeight: 600 } }, '合计'),
          h('div', { style: { fontSize: fs(14), fontWeight: 600, textAlign: 'right', fontVariantNumeric: 'tabular-nums' } }, `${total.queued}${total.truncated ? '+' : ''}`),
          h('div', { style: { fontSize: fs(14), fontWeight: 600, textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: total.human ? C.warn : C.caption } }, `${total.human}${total.truncated ? '+' : ''}`),
          h('div', { style: { fontSize: fs(13), fontWeight: 600, textAlign: 'right', color: C.caption } }, '—'),
          h('div', { style: { fontSize: fs(13), fontWeight: 500, color: C.label2 } }, `人工 ${total.human} · 自动 ${total.auto}`),
          h('div', null)),

        h('div', { style: { marginTop: 10, display: 'flex', flexDirection: 'column', gap: 1 } },
          notes.map((note, index) => h('div', { key: `note-${index}`, style: BOARD_NOTE }, note)),
          total.truncated && typeof onLoadMore === 'function'
            ? h('div', { style: { marginTop: 2 } }, h(Button, {
              size: 'sm',
              disabled: Boolean(loadMoreBusy),
              onClick: onLoadMore,
            }, loadMoreBusy ? '正在加载…' : '加载更多'))
            : null,
          h('details', { style: { ...BOARD_NOTE, marginTop: 1 } },
            h('summary', { style: { cursor: 'pointer', color: C.label2 } }, '计数口径'),
            BOARD_METHOD.map((line, index) => h('div', { key: `method-${index}`, style: { paddingLeft: 2 } }, line)))));
    }
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
    // ── 成果 ──────────────────────────────────────────────────
    /** 导出 Markdown：Blob + a[download]，不依赖宿主 API；长卡片不做嵌套滚动。 */
    function libraryDownloadMarkdown(fileName, text) {
      const blob = new Blob([String(text || '')], { type: 'text/markdown;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    /** 收起态也要能看出这篇讲了什么：精读总结优先，退回摘要判断的增量；压成一行，截到 ~60 字。 */
    function libraryConclusion(p) {
      const raw = String(p?.l3?.summary || p?.l1?.increment || '').replace(/\s+/g, ' ').trim();
      if (!raw) return '';
      return raw.length > 60 ? `${raw.slice(0, 60)}…` : raw;
    }

    function Library({ state, config, loadMore, busy, onOverride, onRerun, openPaper, navigate, part = 'all' }) {
      const st = state || {};
      const [resultQ, setResultQ] = useState('');
      const [msg, setMsg] = useState(null);
      // 展开态：null = 默认只展开第一张；用户点过之后变成显式的 id 列表，可以多张同时展开
      const [openIds, setOpenIds] = useState(null);
      const papers = Array.isArray(st.papers) ? st.papers : [];
      const total = Number(st.total) || papers.length;
      const needle = resultQ.trim().toLowerCase();
      const match = (p) => !needle || `${p.title || ''} ${p.doi || ''} ${p.arxiv_id || ''}`.toLowerCase().includes(needle);
      const canGo = typeof navigate === 'function';
      const showCards = part !== 'zotero';
      const showZotero = part !== 'cards';
      const canOpen = typeof openPaper === 'function';
      const go = (tab, opts) => { if (canGo) navigate(tab, opts); };
      const gradeRank = { S: 0, A: 1, B: 2, C: 3, D: 4 };
      // 卡片按 S/A/B 优先排；已丢弃的旧卡片不再展示，没有等级的排最后
      const cards = papers
        .filter((p) => p.l3?.card_markdown && p.stage !== 'dropped' && match(p))
        .sort((a, b) => (gradeRank[a.grade] ?? 9) - (gradeRank[b.grade] ?? 9)
          || String(a.title || '').localeCompare(String(b.title || '')));
      const inLib = papers
        .filter((p) => p.zotero_key && match(p))
        .sort((a, b) => String(b.zotero_import?.at || '').localeCompare(String(a.zotero_import?.at || '')));
      const lastImport = inLib.map((p) => p.zotero_import?.at).filter(Boolean).sort().pop();
      const lastImportAt = Date.parse(lastImport || '');

      // 存量四格：done / 等级 / 入库数取 /state 的汇总（全量），卡片数只能算已加载的这一页
      const summary = st.summary || {};
      const doneCount = Number(summary.stages?.done) || 0;
      const byGrade = summary.byGrade || {};
      const aPlusCount = (Number(byGrade.S) || 0) + (Number(byGrade.A) || 0);
      const libCount = Number(summary.library);
      const zoteroCount = Number.isFinite(libCount) ? libCount : inLib.length;

      // 入库空态按原因分支：先看 Zotero 能不能写，再看自动入库开没开（读不到配置就当作没开）
      const zoteroStatus = st.zotero && typeof st.zotero === 'object' ? st.zotero : null;
      const zoteroCfg = config?.integrations?.zotero || null;
      const zoteroLocal = zoteroCfg?.mode === 'local';
      const zoteroConnected = Boolean(zoteroStatus?.fetched_at);
      // 本机模式写入要 Zotero 10+ 授权；账号模式看不到 key，只能按「已连接」算
      const zoteroWritable = !zoteroLocal || zoteroStatus?.localAuthorized !== false;
      const zoteroProblem = !zoteroConnected || !zoteroWritable;
      const autoImportOn = zoteroCfg?.autoImport?.enabled === true;

      const exportName = (p) => `${String(p.title || p.id || 'paper')
        .replace(/[^a-zA-Z0-9\u4e00-\u9fa5._-]+/g, '_').slice(0, 80) || 'paper'}.md`;
      const exportOne = (p) => {
        try {
          const name = exportName(p);
          libraryDownloadMarkdown(name, p.l3?.card_markdown);
          setMsg({ kind: 'success', text: `已导出 ${name}` });
        } catch (error) {
          setMsg({ kind: 'error', text: `导出失败：${String(error?.message || error)}` });
        }
      };
      const exportAll = () => {
        if (!cards.length) return;
        const failed = [];
        for (const p of cards) {
          try { libraryDownloadMarkdown(exportName(p), p.l3?.card_markdown); }
          catch (error) { failed.push(`${p.title || p.id}：${String(error?.message || error)}`); }
        }
        setMsg(failed.length
          ? { kind: 'error', text: `${cards.length - failed.length} 张已导出，${failed.length} 张失败：${failed.slice(0, 3).join('；')}` }
          : { kind: 'success', text: `已导出 ${cards.length} 张卡片` });
      };
      const cardOpen = (p, i) => (openIds === null ? i === 0 : openIds.includes(p.id));
      const toggleCard = (p) => (e) => {
        const opening = Boolean(e?.currentTarget?.open);
        const base = openIds === null ? (cards[0] ? [cards[0].id] : []) : openIds;
        setOpenIds(opening
          ? Array.from(new Set([...base, p.id]))
          : base.filter((id) => id !== p.id));
      };
      /** 一张精读卡片：summary 收着也能看出结论与状态，动作留在卡片头。 */
      const renderCard = (p, i) => {
        const conclusion = libraryConclusion(p);
        return h('details', {
          key: p.id,
          open: cardOpen(p, i),
          onToggle: toggleCard(p),
          style: { borderTop: `1px solid ${C.border1}`, padding: `${T.space.sm}px 0` },
        },
          h('summary', {
            style: { cursor: 'pointer', fontSize: fs(T.font.body), color: C.label1, lineHeight: T.line.body },
          },
            h('div', { style: { display: 'flex', gap: T.space.sm, alignItems: 'center', flexWrap: 'wrap' } },
              h(GradeBadge, { grade: p.grade || p.l3?.final_grade }),
              h('span', { style: { flex: '1 1 160px', minWidth: 0 } }, p.title || '(无题名)'),
              h('span', { style: { fontSize: fs(T.font.hint), color: C.caption } },
                [
                  STAGE_LABEL[p.stage] || p.stage || '—',
                  p.l3?.confidence
                    ? `置信度${CONFIDENCE_LABEL[p.l3.confidence] || p.l3.confidence}`
                    : null,
                ].filter(Boolean).join(' · ')),
              canOpen
                ? h(Button, {
                  size: 'sm',
                  // 卡片头在 <summary> 里：拦掉默认行为，点动作不要把卡片折叠了
                  onClick: (e) => { e.preventDefault(); e.stopPropagation(); openPaper(p.id); },
                }, '看判断')
                : null,
              h(Button, {
                size: 'sm',
                onClick: (e) => { e.preventDefault(); e.stopPropagation(); exportOne(p); },
              }, '导出 Markdown')),
            conclusion
              ? h('div', {
                style: { fontSize: fs(T.font.hint), color: C.caption, lineHeight: T.line.body, marginTop: T.space.micro },
              }, conclusion)
              : null),
          h('div', {
            style: {
              display: 'flex', gap: T.space.sm, alignItems: 'center',
              flexWrap: 'wrap', margin: `${T.space.sm}px 0`,
            },
          },
            h('span', { style: { fontSize: fs(T.font.hint), color: C.caption } },
              `最终等级 ${p.grade || p.l3?.final_grade || '—'} · 依据${BASIS_LABEL[p.grade_basis] || p.grade_basis || '—'}`),
            p.zotero_key ? h(Chip, { tone: C.accent }, '已入 Zotero') : null,
            p.translated ? h(Chip, { tone: C.success }, '有译文') : null),
          h('div', {
            style: {
              background: C.bg2, borderRadius: T.radius.sm,
              padding: `${T.space.md}px ${T.space.lg}px`, overflowWrap: 'anywhere',
            },
          }, h(MarkdownBlock, { text: p.l3.card_markdown })));
      };

      return h('div', null,
        // 存量四格：数据少的时候也要有「已经有什么」可看；能跳的只给一个落点
        h('div', {
          style: { display: 'flex', gap: T.space.sm, flexWrap: 'wrap', marginBottom: T.space.lg },
        },
          h(StatTile, {
            label: '读过',
            value: doneCount,
            hint: '已完成精读',
            onClick: canGo ? () => go('pipeline', { stage: 'done' }) : undefined,
          }),
          h(StatTile, { label: 'A 级及以上', value: aPlusCount, hint: '精读评级 S / A' }),
          h(StatTile, { label: '精读卡片', value: cards.length, hint: '可导出 Markdown' }),
          h(StatTile, { label: '已入 Zotero', value: zoteroCount, hint: '精读达到等级后入库' })),

        h('div', {
          style: {
            display: 'flex', gap: T.space.md, alignItems: 'center',
            flexWrap: 'wrap', marginBottom: T.space.lg,
          },
        },
          h('div', { style: { flex: '1 1 220px', maxWidth: 320 } }, h(TextInput, {
            value: resultQ, placeholder: '搜索标题 / DOI / arXiv', label: '搜索成果', onChange: setResultQ,
          })),
          h('span', { style: { fontSize: fs(T.font.meta), color: C.caption } },
            needle ? `仅搜索已加载 ${papers.length}/${total} 篇` : `已加载 ${papers.length}/${total} 篇`),
          needle
            ? h(Button, { size: 'sm', onClick: () => setResultQ('') }, '清空搜索')
            : null,
          cards.length && showCards
            ? h(Button, { size: 'sm', onClick: exportAll }, `导出全部 Markdown（${cards.length}）`)
            : null),
        msg ? h(Notice, { kind: msg.kind }, msg.text) : null,

        showCards ? h('div', null,
        h(SectionTitle, {
          hint: '精读完成后写入；展开看全文，导出为单篇 Markdown',
          right: h('span', { style: { fontSize: fs(T.font.meta), color: C.caption } }, `${cards.length} 张`),
        }, '精读成果'),
        cards.length
          ? h(Card, { style: { marginBottom: T.space.lg } }, cards.map(renderCard))
          : h(EmptyState, {
            title: needle ? '没有匹配的精读卡片' : '暂无精读卡片',
            desc: needle
              ? '换个标题 / DOI / arXiv 关键词试试'
              : '论文精读完成后会写进这里；卡片能展开阅读，也能导出 Markdown',
            actions: !needle && canGo
              ? [h(Button, { size: 'sm', onClick: () => go('pipeline', { stage: 'L3' }) }, '去待办')]
              : null,
          }),

        ) : null,

        showZotero ? h('div', null,
        h(SectionTitle, {
          hint: Number.isFinite(lastImportAt)
            ? `最近入库 ${new Date(lastImportAt).toLocaleString()}；点标题打开判断层`
            : '需在设置里开启自动入库，或在抽屉里手动入库',
          right: h('span', { style: { fontSize: fs(T.font.meta), color: C.caption } }, `${inLib.length} 篇`),
        }, 'Zotero 入库'),
        h(Card, null,
          inLib.length
            ? h('div', null, inLib.map((p) => h(PaperRow, {
              key: p.id, p, onOverride, onRerun, onOpen: openPaper,
            })))
            : needle
              ? h(EmptyState, {
                title: '没有匹配的入库论文',
                desc: '换个标题 / DOI / arXiv 关键词试试',
              })
              : h(EmptyState, zoteroProblem
                ? {
                  title: '未连接 Zotero',
                  desc: '连上 Zotero 才能把精读结果写进文库；读库分析研究兴趣也要用它',
                  actions: canGo ? [h(Button, { size: 'sm', onClick: () => go('settings') }, '去设置')] : null,
                }
                : !autoImportOn
                  ? {
                    title: '自动入库没开',
                    desc: '达到等级的论文不会自动写进 Zotero；可在设置里打开自动入库，或在论文抽屉里手动入库',
                    actions: canGo ? [h(Button, { size: 'sm', onClick: () => go('settings') }, '去设置')] : null,
                  }
                  : {
                    title: '暂无入库论文',
                    desc: '读完并达到等级的论文会出现在这里',
                    actions: canGo ? [h(Button, { size: 'sm', onClick: () => go('pipeline', { stage: 'L3' }) }, '去精读')] : null,
                  })),

        ) : null,

        total > papers.length
          ? h('div', { style: { marginTop: T.space.md } },
            h(Button, { onClick: loadMore, disabled: busy }, `加载更多（已 ${papers.length}/${total}）`))
          : null,
      );
    }
    // ── 阅读页：独立于总览的待读/已读队列 ─────────────────────
    const READING_SOURCE_LABEL = {
      'scholar-alert': '邮件', arxiv: 'arXiv', openalex: 'OpenAlex', crossref: 'Crossref', s2: 'S2', manual: '手动',
    };

    function readingEligible(p) {
      return Boolean(p.l3) && Boolean(p.has_pdf);
    }

    function ReadingQueueRow({ p, openPaper, openPaperCard, onOpenPdf, onMarkRead, onRerun, onTranslate, onOpenUrl }) {
      const [abstractOpen, setAbstractOpen] = useState(false);
      const [showZh, setShowZh] = useState(false);
      const [translating, setTranslating] = useState(false);
      const [translateError, setTranslateError] = useState(null);
      const [reviewOpen, setReviewOpen] = useState(false);
      const [zoom, setZoom] = useState(false);
      const grade = p.l3?.final_grade || p.grade;
      const tier = p.venue_tier?.label || '';
      const web = homePageUrl(p);
      const figures = Array.isArray(p.l3?.figures) ? p.l3.figures : [];
      const sources = (p.sources || []).map((x) => READING_SOURCE_LABEL[x] || x).join(' / ');
      const authors = (p.authors || []).slice(0, 2).join(', ');
      const authorMore = (p.authors || []).length > 2;
      // 推荐语是这一行唯一的决策句，不截断；摘要按长度决定要不要给「展开」
      const whyFull = p.l3?.why_read || '';
      const zh = p.translations?.zh;
      const displayTitle = showZh && zh?.title ? zh.title : p.title;
      const displayAbstract = showZh && zh?.abstract ? zh.abstract : p.abstract;
      const translateAction = async () => {
        if (!onTranslate || translating) return;
        setTranslateError(null);
        if (zh) { setShowZh((v) => !v); return; }
        setTranslating(true);
        try { await onTranslate(p.id, false); setShowZh(true); }
        catch (e) { setTranslateError(String(e?.message || e)); }
        finally { setTranslating(false); }
      };

      useEffect(() => {
        if (!zoom || typeof document === 'undefined' || !document.addEventListener) return undefined;
        const onKey = (event) => { if (event.key === 'Escape') setZoom(false); };
        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
      }, [zoom]);

      const menuItems = [
        onTranslate
          ? {
            key: 'translate',
            label: translating ? '翻译中…' : zh ? (showZh ? '显示原文' : '显示译文') : '翻译',
            disabled: translating,
            onClick: translateAction,
          }
          : null,
        web ? { key: 'web', label: '打开网页', onClick: () => (typeof onOpenUrl === 'function' ? onOpenUrl(p.id) : window.open(web, '_blank', 'noopener')) } : null,
        onRerun && p.l3 ? { key: 're-l3', label: '重新精读', onClick: () => onRerun(p.id, 'L3') } : null,
        p.zotero_key ? { key: 'zotero', label: '在 Zotero 打开', onClick: () => window.open(`zotero://select/library/items/${p.zotero_key}`) } : null,
      ].filter(Boolean);

      const abstractText = displayAbstract || '';
      const abstractLong = abstractText.length > 170;
      const metaLine = [authors ? `${authors}${authorMore ? ' 等' : ''}` : null, p.venue, p.year]
        .filter(Boolean).join(' · ');
      const fig = figures[0] || null;
      const figSrc = fig
        ? `${R.figure}?paper=${encodeURIComponent(p.id)}&file=${encodeURIComponent(fig.file || '')}`
        : '';

      return h('div', {
        style: {
          padding: `${T.space.sm}px 0`, borderTop: `1px solid ${C.border1}`,
          display: 'grid', gridTemplateColumns: '22px minmax(0, 1fr) 220px',
          columnGap: T.space.md, alignItems: 'start',
        },
      },
        h(GradeBadge, { grade }),
        h('div', { style: { minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 } },
          h('div', { style: { display: 'flex', gap: T.space.sm, alignItems: 'flex-start', flexWrap: 'nowrap' } },
            h('div', {
              role: 'button', tabIndex: 0,
              onClick: () => openPaper(p.id),
              onKeyDown: (e) => { if (e.key === 'Enter') { e.preventDefault(); openPaper(p.id); } },
              style: {
                flex: 1, minWidth: 0,
                fontSize: fs(15), fontWeight: 500, color: C.label1, cursor: 'pointer',
                display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
                overflow: 'hidden', lineHeight: 1.4, overflowWrap: 'anywhere',
              },
            }, displayTitle || '(无题名)'),
            h('div', { style: { display: 'flex', gap: T.space.xs, alignItems: 'center', flexShrink: 0 } },
              openPaperCard && p.l3?.card_markdown
                ? h(Button, { size: 'sm', primary: true, onClick: () => openPaperCard(p.id) }, '精读卡片')
                : null,
              p.has_pdf && onOpenPdf
                ? h(Button, { size: 'sm', onClick: () => onOpenPdf(p.id) }, '原文 PDF')
                : h(Button, { size: 'sm', onClick: () => openPaper(p.id) }, '补 PDF'),
              onMarkRead
                ? h(Button, {
                  size: 'sm',
                  onClick: () => onMarkRead(p.id, !p.read_at),
                }, p.read_at ? '标为未读' : '标为已读')
                : null,
              menuItems.length ? h(Menu, { label: '⋯', items: menuItems }) : null)),
          metaLine || tier || (p.l3?.confidence && CONFIDENCE_LABEL[p.l3.confidence] !== '高')
            ? h('div', { style: { display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', fontSize: fs(12.5), color: C.caption, marginTop: 2 } },
              metaLine ? h('span', null, metaLine) : null,
              tier ? h(Chip, { tone: C.accent }, tier) : null,
              p.l3?.confidence && CONFIDENCE_LABEL[p.l3.confidence] !== '高'
                ? h('span', null, `置信 ${CONFIDENCE_LABEL[p.l3.confidence] || p.l3.confidence}`)
                : null)
            : null,
          h('div', { style: { marginTop: 8 } },
            h('div', { style: { display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', fontSize: fs(12.5), fontWeight: 600, color: C.label1 } },
              '推荐理由',
              // 优先摘要判读的结论；没有 L1（如手动添加）时用精读给出的同口径判断
              (p.l1?.domain || p.l3?.domain)
                ? h(Chip, { tone: C.accent }, DOMAIN_LABEL[p.l1?.domain || p.l3?.domain] || (p.l1?.domain || p.l3?.domain))
                : h(Chip, { title: '还没有摘要判读或精读结论，因此没有领域/用途标签' }, '未判读'),
              (p.l1?.use || p.l3?.use)
                ? h(Chip, null, USE_LABEL[p.l1?.use || p.l3?.use] || (p.l1?.use || p.l3?.use))
                : null,
              !whyFull && onRerun
                ? h(Button, { size: 'sm', onClick: () => onRerun(p.id, 'L3') }, '重跑精读')
                : null),
            h('div', { style: { fontSize: fs(14), color: C.label2, lineHeight: T.line.body, marginTop: 2, overflowWrap: 'anywhere' } },
              whyFull || 'AI 没有给出推荐语')),
          translateError
            ? h('div', { style: { fontSize: fs(13), color: C.error, marginTop: 2 } }, `翻译失败：${translateError}`)
            : null,
          h('div', { style: { display: 'flex', gap: 6, alignItems: 'flex-start', marginTop: 6 } },
            h('div', {
              role: p.abstract ? 'button' : undefined,
              tabIndex: p.abstract ? 0 : undefined,
              'aria-expanded': p.abstract ? abstractOpen : undefined,
              onClick: p.abstract ? () => setAbstractOpen((v) => !v) : undefined,
              onKeyDown: p.abstract
                ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setAbstractOpen((v) => !v); } }
                : undefined,
              style: {
                flex: 1, minWidth: 0,
                fontSize: fs(13), color: C.label2, lineHeight: T.line.body,
                display: '-webkit-box', WebkitLineClamp: abstractOpen ? 'unset' : 2,
                WebkitBoxOrient: 'vertical', overflow: 'hidden',
                cursor: p.abstract ? 'pointer' : 'default',
              },
            },
              h('span', { style: { color: C.caption } },
                p.abstract_source === 'l3-summary' ? '摘要（AI 提炼）' : '摘要'),
              h('span', { style: { color: C.caption } }, ' · '),
              abstractText || '未获取（可在详情里重取摘要）'),
            p.abstract && abstractLong
              ? h('button', {
                type: 'button',
                onClick: () => setAbstractOpen((v) => !v),
                style: {
                  appearance: 'none', border: 0, background: 'none', color: C.accent,
                  cursor: 'pointer', padding: 0, font: 'inherit', fontSize: fs(12.5), flex: 'none',
                },
              }, abstractOpen ? '收起' : '展开')
              : null)),
        fig
          ? h('div', { style: { width: 220 } },
            h('button', {
              type: 'button',
              title: '点击放大',
              onClick: () => setZoom(true),
              style: {
                display: 'block', width: '100%', padding: 4, cursor: 'zoom-in',
                background: C.bg2, border: `1px solid ${C.border2}`,
                borderRadius: T.radius.sm, overflow: 'hidden',
              },
            }, h('img', {
              src: figSrc,
              alt: fig.caption || `第 ${fig.page} 页关键图`,
              loading: 'lazy',
              style: { display: 'block', width: '100%', aspectRatio: '4 / 3', height: 'auto', objectFit: 'contain' },
            })),
            h('div', { style: { fontSize: fs(12), color: C.caption, marginTop: 4, textAlign: 'center' } },
              `第 ${fig.page} 页`))
          : h('div', {
            style: {
              width: 220, minHeight: 165, display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: C.bg2, border: `1px dashed ${C.border2}`, borderRadius: T.radius.sm,
              fontSize: fs(12), color: C.caption,
            },
          }, '无关键图'),
        zoom && fig
          ? h('div', {
            role: 'dialog', 'aria-modal': true, 'aria-label': '关键图预览',
            onClick: () => setZoom(false),
            style: {
              position: 'fixed', top: 0, right: 0, bottom: 0, left: 0, zIndex: 200,
              background: 'rgba(17, 24, 39, .78)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
              cursor: 'zoom-out',
            },
          },
            h('img', {
              src: figSrc,
              alt: fig.caption || '关键图',
              style: {
                maxWidth: '92vw', maxHeight: '86vh', objectFit: 'contain',
                background: C.bg1, borderRadius: T.radius.sm,
              },
            }),
            h('button', {
              type: 'button',
              'aria-label': '关闭预览',
              onClick: (e) => { e.stopPropagation(); setZoom(false); },
              style: {
                position: 'absolute', top: 18, right: 22, width: 32, height: 32,
                border: 0, borderRadius: 16, background: 'rgba(255,255,255,.14)',
                color: '#fff', fontSize: 18, cursor: 'pointer', lineHeight: 1,
              },
            }, '×'))
          : null,
      );
    }

    function ReadingPage({ onOpenUrl,
      state, config, loadMore, busy, onOverride, onRerun, openPaper, openPaperCard, onOpenPdf, onMarkRead, onTranslate, navigate, initial = 'unread',
    }) {
      const [mode, setMode] = useState(initial);
      useEffect(() => { setMode(initial); }, [initial]);
      const papers = Array.isArray(state?.papers) ? state.papers : [];
      const gradeRank = { S: 0, A: 1, B: 2, C: 3, D: 4 };
      const eligible = papers
        .filter((p) => p.stage !== 'dropped' && readingEligible(p))
        .sort((a, b) => Number(b.priority === 'next') - Number(a.priority === 'next')
          || (gradeRank[a.grade] ?? 9) - (gradeRank[b.grade] ?? 9)
          || String(b.first_seen || '').localeCompare(String(a.first_seen || '')));
      const unread = eligible.filter((p) => !p.read_at);
      const read = eligible.filter((p) => p.read_at)
        .sort((a, b) => String(b.read_at || '').localeCompare(String(a.read_at || '')));
      const cards = papers.filter((p) => p.l3?.card_markdown && p.stage !== 'dropped');
      const inLib = papers.filter((p) => p.zotero_key);
      // 粗读：AI 初筛给的是 skim/skip，直接 done、没有精读卡片；单独列出来，
      // 否则它们只在历史里，用户会以为丢了。
      const skims = papers
        .filter((p) => p.stage === 'done' && !p.l3)
        .sort((a, b) => String(b.updated_at || b.first_seen || '').localeCompare(String(a.updated_at || a.first_seen || '')));
      const isQueue = mode === 'unread' || mode === 'read' || mode === 'skim';
      const list = mode === 'read' ? read : mode === 'skim' ? skims : unread;

      return h('div', null,
        h(SectionTitle, {
          hint: '阅读、精读卡片与 Zotero 入库都在这里',
          right: h('div', { style: { display: 'flex', gap: T.space.xs, flexWrap: 'wrap' } },
            h(Button, { size: 'sm', primary: mode === 'unread', onClick: () => setMode('unread') }, `待读 ${unread.length}`),
            h(Button, { size: 'sm', primary: mode === 'read', onClick: () => setMode('read') }, `已读 ${read.length}`),
            h(Button, { size: 'sm', primary: mode === 'skim', onClick: () => setMode('skim') }, `粗读 ${skims.length}`),
            h(Button, { size: 'sm', primary: mode === 'cards', onClick: () => setMode('cards') }, `精读卡片 ${cards.length}`),
            h(Button, { size: 'sm', primary: mode === 'zotero', onClick: () => setMode('zotero') }, `Zotero ${inLib.length}`)),
        }, '阅读'),
        isQueue
          ? h(Card, null,
            list.length
              ? list.map((p) => h(ReadingQueueRow, { key: p.id, p, openPaper, openPaperCard, onOpenPdf, onMarkRead, onRerun, onTranslate, onOpenUrl }))
              : h(Empty, null,
                mode === 'read'
                  ? '还没有已读论文；在读队列里点「标为已读」后移到这里。'
                  : mode === 'skim'
                    ? '还没有粗读论文；AI 初筛判为「建议粗读/建议跳过」的论文会列在这里。'
                    : '还没有待读论文；完成精读并取得原文后进入这里。'))
          : h(Library, {
            state,
            config,
            loadMore,
            busy,
            onOverride,
            onRerun,
            openPaper,
            navigate,
            part: mode,
          }));
    }
    // ── 设置（可编辑）────────────────────────────────────────
    // 自动采集的时间开关在来源页的扫描卡里（SourceScanBar），这里不再重复。
    // InterestCard 定义在本文件，由 70-sources.js 直接调用；名称与 props 是对外契约，不要改。

    function InterestCard({ config, saveConfig, defaultOpen }) {
      const [draft, setDraft] = useState(() => JSON.parse(JSON.stringify(config?.relevance || {})));
      // 默认折叠：概览行已经写清填了多少，需要编辑时再展开
      const [open, setOpen] = useState(() => defaultOpen === true);
      const [busy, setBusy] = useState(false);
      const [saving, setSaving] = useState(false);
      const [msg, setMsg] = useState(null);
      const [clearedSnapshot, setClearedSnapshot] = useState(null);
      const [confirmClear, setConfirmClear] = useState(false);

      useEffect(() => {
        setDraft(JSON.parse(JSON.stringify(config?.relevance || {})));
        setClearedSnapshot(null);
      }, [config]);

      const patch = (fn) => setDraft((current) => {
        const next = JSON.parse(JSON.stringify(current || {}));
        fn(next);
        return next;
      });

      // 保存关键词后自动按新配置重算候选：关键词变了，池子里的旧分数就过期了
      const save = async () => {
        setSaving(true);
        setMsg(null);
        const ok = await saveConfig({ relevance: draft });
        if (!ok) { setSaving(false); setMsg({ kind: 'error', text: '保存失败' }); return; }
        setClearedSnapshot(null);
        try {
          const d = await postJson(R.candidatesRescore, {});
          setMsg({ kind: 'success', text: `研究兴趣已保存；重算 ${d.scanned} 条：回到待判读 ${d.revived}、仍被过滤 ${d.filtered}、排除 ${d.excluded}` });
        } catch (error) {
          setMsg({ kind: 'warn', text: `研究兴趣已保存；重算失败：${String(error?.message || error)}` });
        } finally { setSaving(false); }
      };

      const runAi = async () => {
        setBusy(true);
        setMsg(null);
        try {
          const res = await fetch(R.suggest, {
            method: 'POST', credentials: 'same-origin',
            headers: { 'content-type': 'application/json' }, body: '{}',
          });
          const data = await res.json();
          if (!data?.ok) { setMsg({ kind: 'error', text: data?.error || 'AI 分析失败' }); return; }
          const suggestion = data.suggestion;
          const calibration = data.calibration;
          patch((next) => {
            next.keywords = suggestion.keywords;
            next.contextKeywords = suggestion.contextKeywords;
            next.excludeKeywords = suggestion.excludeKeywords;
            // 阈值也由库校准决定：能覆盖大部分库里评过 A/B 的论文
            if (Number.isFinite(suggestion.minScore)) next.minScore = suggestion.minScore;
          });
          setClearedSnapshot(null);
          const added = (data.added || []).length;
          const coverage = calibration ? Math.round((calibration.coverage || 0) * 100) : null;
          const meets = Boolean(calibration?.meetsTarget);
          const served = calibration
            ? `；按 Zotero 库校准最低分 ${suggestion.minScore}，覆盖 ${coverage}%（${calibration.items} 篇）`
            : '';
          const addedHint = added ? `，补词 ${added} 个` : '';
          const excludedHint = calibration?.excluded
            ? `；排除词命中 ${calibration.excluded} 篇库内论文，可检查排除词`
            : '';
          const gapHint = calibration && !meets
            ? `。覆盖不到目标 ${Math.round((calibration.target || 0.85) * 100)}%：再点一次会继续补词，或放宽排除词`
            : '';
          setMsg({
            kind: meets || !calibration ? 'success' : 'warn',
            text: `已填入 AI 建议（${data.provider}/${data.model}）：核心 ${suggestion.keywords.length} 条、辅助 ${suggestion.contextKeywords.length} 条${addedHint}${served}${excludedHint}${gapHint}，检查后保存`,
          });
        } catch (error) {
          setMsg({ kind: 'error', text: String(error?.message || error) });
        } finally { setBusy(false); }
      };

      const rel = draft || {};
      const countOf = (key) => (rel[key] || []).length;
      const summaryItems = [
        ['核心', countOf('keywords')], ['辅助', countOf('contextKeywords')], ['排除', countOf('excludeKeywords')],
        ['期刊', countOf('venues')], ['作者', countOf('authors')], ['分类', countOf('categories')],
        ['最低分', rel.minScore ?? 5],
      ];
      const dirty = JSON.stringify(draft || {}) !== JSON.stringify(config?.relevance || {});
      const groupGrid = { display: 'grid', gap: T.space.lg, gridTemplateColumns: 'repeat(auto-fit, minmax(min(240px, 100%), 1fr))' };
      const listKeys = ['keywords', 'contextKeywords', 'excludeKeywords', 'venues', 'authors', 'categories'];
      const listCount = listKeys.reduce((sum, key) => sum + countOf(key), 0);
      const syncList = (key) => (v) => { setClearedSnapshot(null); patch((next) => { next[key] = v; }); };
      const clearLists = () => {
        const snapshot = {};
        listKeys.forEach((key) => { snapshot[key] = rel[key] || []; });
        setClearedSnapshot(snapshot);
        patch((next) => { listKeys.forEach((key) => { next[key] = []; }); });
        setConfirmClear(false);
      };
      const undoClear = () => {
        if (!clearedSnapshot) return;
        patch((next) => { Object.assign(next, clearedSnapshot); });
        setClearedSnapshot(null);
      };

      return h(Card, { style: { marginBottom: T.space.lg, borderRadius: T.radius.md, padding: '18px 20px' } },
        h('div', { style: { display: 'flex', alignItems: 'flex-start', gap: T.space.md, flexWrap: 'wrap' } },
          h('div', { style: { flex: 1, minWidth: 220 } },
            h('div', { style: { display: 'flex', alignItems: 'center', gap: T.space.sm, flexWrap: 'wrap' } },
              h('div', { style: { fontSize: fs(T.font.section), fontWeight: 600, color: C.label1, letterSpacing: '.01em' } },
                '研究兴趣', dirty ? h(Chip, { tone: C.warn }, '未保存') : null)),
            // 摘要行常驻：收起时是唯一概览，展开后也是「填了多少」的即时回显。
            h('div', {
              style: {
                display: 'flex', flexWrap: 'wrap', alignItems: 'baseline',
                marginTop: 5, fontSize: fs(T.font.hint), color: C.caption,
              },
            },
              summaryItems.map(([label, value], index) => h('span', {
                key: label,
                style: { display: 'inline-flex', alignItems: 'baseline', gap: 4, whiteSpace: 'nowrap' },
              },
                h('span', null, label),
                h('b', {
                  style: {
                    fontWeight: 600, fontVariantNumeric: 'tabular-nums',
                    color: Number(value) ? C.label1 : C.label3,
                  },
                }, String(value)),
                index < summaryItems.length - 1
                  ? h('span', { 'aria-hidden': 'true', style: { opacity: 0.45, margin: '0 6px' } }, '·')
                  : null))),
            open
              ? h('div', { style: { fontSize: fs(T.font.hint), color: C.caption, marginTop: T.space.micro } },
                '自动检索与 T0 评分共用；PubMed/DBLP 自动取纯文本关键词')
              : null),
          h('div', { style: { display: 'flex', gap: T.space.xs, alignItems: 'center', flexShrink: 0 } },
            h(Button, { size: 'sm', onClick: () => setOpen((v) => !v) }, open ? '收起' : '展开'),
            h(Button, { size: 'sm', disabled: busy || saving, onClick: runAi }, busy ? '分析中…' : 'AI 分析 Zotero')),
        ),
        open ? h('div', { style: { marginTop: T.space.md, paddingTop: T.space.md, borderTop: `1px solid ${C.border1}` } },
          h(Field, {
            label: '核心关键词', count: countOf('keywords'),
            hint: '命中 +3 分，匹配即优先级最高；支持 locali[sz]ation 这类正则写法，纯文本词同时用于数据库检索',
          },
            h(Chips, {
              items: rel.keywords || [], tone: 'accent', placeholder: '输入英文词后回车',
              onChange: syncList('keywords'),
            })),
          h('div', { style: groupGrid },
            h(Field, { label: '辅助关键词', count: (rel.contextKeywords || []).length, hint: '命中 +1 分，把相关论文排到前面' },
              h(Chips, {
                items: rel.contextKeywords || [], placeholder: '输入英文词后回车',
                onChange: syncList('contextKeywords'),
              })),
            h(Field, { label: '排除关键词', count: (rel.excludeKeywords || []).length, hint: '命中直接丢弃，用于勘误、撤稿、社论' },
              h(Chips, {
                items: rel.excludeKeywords || [], tone: 'danger', placeholder: '输入要排除的词后回车',
                onChange: syncList('excludeKeywords'),
              }))),
          h('div', {
            style: {
              display: 'flex', alignItems: 'center', gap: T.space.sm, flexWrap: 'wrap',
              marginBottom: T.space.md,
            },
          },
            h('span', { style: { fontSize: fs(13), fontWeight: 600, color: C.label1 } }, '最低入队分数'),
            h(NumberInput, {
              value: rel.minScore ?? 3, min: 0, max: 50, label: '最低入队分数',
              onChange: (v) => patch((next) => { next.minScore = v; }),
            }),
            h('span', { style: { fontSize: fs(T.font.hint), color: C.caption } }, '分'),
            h('span', { style: { fontSize: fs(T.font.hint), color: C.caption } },
              '低于该分数的不进入待判读 · 权重：核心词 3、辅助词 1、期刊 4、作者 3、标签 2（3 分＝命中 1 个核心词）')),
          h('details', { style: { marginBottom: T.space.lg } },
            h('summary', {
              style: { cursor: 'pointer', fontSize: fs(T.font.hint), fontWeight: 600, color: C.label2 },
            }, '高级匹配：期刊 / 作者 / 学科分类'),
            h('div', { style: { ...groupGrid, marginTop: T.space.md } },
              h(Field, { label: '关注期刊 / 会议', count: countOf('venues'), hint: '命中 +4 分' },
                h(Chips, {
                  items: rel.venues || [], placeholder: '期刊或会议名后回车',
                  onChange: syncList('venues'),
                })),
              h(Field, { label: '关注作者', count: countOf('authors'), hint: '命中 +3 分' },
                h(Chips, {
                  items: rel.authors || [], placeholder: '作者名后回车',
                  onChange: syncList('authors'),
                })),
              h(Field, { label: '学科分类 / MeSH', count: countOf('categories'), hint: '命中 +2 分，如 arXiv 分类 cs.RO' },
                h(Chips, {
                  items: rel.categories || [], placeholder: 'cs.RO / eess.SY / MeSH 词',
                  onChange: syncList('categories'),
                })))),
          msg ? h(Notice, { kind: msg.kind }, msg.text) : null,
          h('div', {
            style: {
              display: 'flex', alignItems: 'center', gap: T.space.md, flexWrap: 'wrap',
              borderTop: `1px solid ${C.border1}`, paddingTop: T.space.md, marginTop: T.space.xs,
            },
          },
            h(Button, { primary: true, disabled: saving || busy || !dirty, onClick: save }, saving ? '保存中…' : '保存研究兴趣'),
            h('span', {
              role: 'status', 'aria-live': 'polite',
              style: { flex: '1 1 180px', fontSize: fs(T.font.hint), lineHeight: T.line.body, color: C.caption },
            }, dirty ? '有未保存的改动，保存后重算候选分数' : '保存后会自动重算候选分数'),
            listCount
              ? h(Button, { size: 'sm', danger: true, disabled: saving, onClick: () => setConfirmClear(true) }, '清空全部')
              : clearedSnapshot
                ? h(Button, { size: 'sm', disabled: saving, onClick: undoClear }, '撤销')
                : null),
          confirmClear
            ? h(ConfirmDialog, {
              title: '清空匹配条件',
              text: '会清空核心、辅助、排除关键词与期刊、作者、学科分类；保存前可撤销。',
              confirmLabel: '清空', danger: true,
              onClose: () => setConfirmClear(false),
              onConfirm: clearLists,
            })
            : null,
        ) : null,
      );
    }

    // ── 设置页：左分区导航 + 草稿 + sticky 保存栏 ──────────────
    // 这里只做分区，不新增或删除任何配置项。
    /** 设置页窄屏判断：只切换子导航方向（左栏 ↔ 横向 tab），不做别的响应式。 */
    function useSettingsNarrow() {
      const readWidth = () => (typeof window !== 'undefined' && typeof window.innerWidth === 'number'
        ? window.innerWidth < 720
        : false);
      const [narrow, setNarrow] = useState(readWidth);
      useEffect(() => {
        if (typeof window === 'undefined' || !window.addEventListener) return undefined;
        const onResize = () => setNarrow(readWidth());
        window.addEventListener('resize', onResize);
        return () => window.removeEventListener('resize', onResize);
      }, []);
      return narrow;
    }

    /** 提示词长文本：受控 textarea。放在顶层，避免每次渲染换组件类型导致丢焦点。 */
    function SettingsPromptBox({ value, rows, mono, placeholder, onChange }) {
      return h('textarea', {
        value: value || '', rows, placeholder: placeholder || '',
        'aria-label': placeholder || '提示词',
        onChange: (e) => onChange(e.target.value),
        style: {
          width: '100%', fontSize: fs(T.font.body),
          lineHeight: mono ? T.line.mono : T.line.body,
          fontFamily: mono ? FONT_MONO : 'inherit',
          padding: `${T.space.xs + 2}px ${T.space.sm}px`, borderRadius: T.radius.xs,
          border: `1px solid ${C.border2}`, background: C.bg1, color: C.label1,
          boxSizing: 'border-box',
        },
      });
    }

    const SETTINGS_SECTIONS = [
      { id: 'analysis', label: '判读' },
      { id: 'fetch', label: '原文' },
      { id: 'integrations', label: '集成' },
      { id: 'system', label: '系统' },
    ];

    const SETTINGS_SELECT_STYLE = {
      fontSize: fs(T.font.body), padding: `${T.space.xs}px ${T.space.sm}px`,
      borderRadius: T.radius.xs, border: `1px solid ${C.border2}`,
      background: C.bg1, color: C.label1, width: '100%',
    };

    const ANALYSIS_STAGES = [
      { id: 'l1', label: '看摘要' },
      { id: 'l2', label: '初筛' },
      { id: 'l3', label: '精读' },
    ];

    /** 'a.b.c' + 值 → { a: { b: { c: 值 } } }：只提交本页拥有的子树，避免覆盖别页改动。 */
    function settingsPatchPath(path, value) {
      const parts = String(path || '').split('.').filter(Boolean);
      const root = {};
      let cursor = root;
      parts.forEach((key, index) => {
        if (index === parts.length - 1) cursor[key] = value;
        else {
          cursor[key] = {};
          cursor = cursor[key];
        }
      });
      return root;
    }

    /**
     * 设置页：改了就存（长文本 650ms 防抖），右上角显示「已保存」。
     * 只提交本页拥有的字段，别的页面维护的键（relevance、sources、analysis.auto 等）一律不碰。
     */
    function Settings({ config, saveConfig, saveCredential, saveEasyScholarKey, saveInstitutionalCookie, testAccess, hasApiKey, hasEasyScholarKey, hasInstitutionalCookie, zoteroStatus, error, reload, navigate, refreshTick = 0 }) {
      const [section, setSection] = useState('analysis');
      const [saving, setSaving] = useState(false);
      const [savedAt, setSavedAt] = useState(null);
      const [msg, setMsg] = useState(null);
      const [apiKeyDraft, setApiKeyDraft] = useState('');
      const [easyKeyDraft, setEasyKeyDraft] = useState('');
      const [keyBusy, setKeyBusy] = useState(false);
      const [cookieDraft, setCookieDraft] = useState('');
      const [cookieBusy, setCookieBusy] = useState(false);
      const [hostsDraft, setHostsDraft] = useState(null);
      const [accessUrl, setAccessUrl] = useState('');
      const [accessResult, setAccessResult] = useState(null);
      const [accessBusy, setAccessBusy] = useState(false);
      const [promptDefaults, setPromptDefaults] = useState({});
      const [showAdvanced, setShowAdvanced] = useState(false);
      const [fullPrompts, setFullPrompts] = useState(false);
      const [modelData, setModelData] = useState(null);
      const [modelError, setModelError] = useState(null);
      // 「还差什么」里两项缺口的就地编辑入口：兴趣关键词、来源开关。
      const [setupInterest, setSetupInterest] = useState(false);
      const [setupChannels, setSetupChannels] = useState(false);
      const loadModels = useCallback(async () => {
        try {
          setModelData(await api(R.llmModels));
          setModelError(null);
        } catch (e) {
          setModelError(String(e?.message || e));
        }
      }, []);
      const narrow = useSettingsNarrow();
      const timers = useState(() => ({ id: null }))[0];

      useEffect(() => {
        api(R.analysisPrompts)
          .then((d) => setPromptDefaults(d.defaults || {}))
          .catch((e) => setMsg({ kind: 'error', text: `读取默认提示词失败：${e?.message || e}` }));
      }, []);
      useEffect(() => { loadModels(); }, [loadModels, refreshTick]);
      useEffect(() => () => { if (timers.id) clearTimeout(timers.id); }, [timers]);

      if (!config) {
        return error
          ? h('div', null,
            h(Notice, { kind: 'error' }, `读取配置失败：${error}`),
            h(Button, { onClick: reload }, '重试'))
          : h(Empty, null, '读取配置中…');
      }

      const analysis = config.analysis || {};
      const digest = config.digest || {};
      const download = config.download || {};
      const bridge = config.bridge || {};
      const zotero = config.integrations?.zotero || {};
      const zoteroAuto = zotero.autoImport || {};
      const network = config.network || {};
      const ui = config.ui || {};
      const corpus = config.corpus || {};

      const commit = (payload, { debounce = false } = {}) => {
        const run = async () => {
          setSaving(true);
          setMsg(null);
          const ok = await saveConfig(payload);
          setSaving(false);
          if (ok) setSavedAt(Date.now());
          else setMsg({ kind: 'error', text: '保存失败' });
        };
        if (!debounce) { run(); return; }
        if (timers.id) clearTimeout(timers.id);
        timers.id = setTimeout(run, 650);
      };
      const set = (path, value, options) => commit(settingsPatchPath(path, value), options);
      const bounded = (value, min, max, fallback) => {
        const n = Number(value);
        if (!Number.isFinite(n)) return fallback;
        return Math.min(max, Math.max(min, n));
      };

      const NumberRow = ({ label, path, value, min, max, unit, hint }) => h(Field, { label, hint },
        h('div', { style: { display: 'flex', alignItems: 'center', gap: T.space.sm } },
          h('div', { style: { width: 120 } },
            h(NumberInput, {
              value: value ?? min, min, max, label,
              onChange: (v) => set(path, bounded(v, min ?? 0, max ?? 100000, value ?? min), { debounce: true }),
            })),
          unit ? h('span', { style: { fontSize: fs(T.font.hint), color: C.caption } }, unit) : null));

      const SwitchRow = ({ label, path, checked, hint, onLabel = '开', offLabel = '关' }, key) => h(Field, { key, label, hint },
        h(Switch, {
          checked: Boolean(checked),
          onChange: (v) => set(path, v),
          label: checked ? onLabel : offLabel,
        }));

      const TextRow = ({ label, path, value, placeholder, hint, mono, type }) => h(Field, { label, hint },
        h('div', { style: { maxWidth: 360 } },
          h(TextInput, {
            value: value || '', placeholder, mono, type, label,
            onChange: (v) => set(path, v, { debounce: true }),
          })));

      const SelectRow = ({ label, path, value, options, hint }) => h(Field, { label, hint },
        h('select', {
          value, 'aria-label': label,
          onChange: (e) => set(path, e.target.value),
          style: {
            fontSize: fs(T.font.body), padding: `${T.space.xs}px ${T.space.sm}px`,
            borderRadius: T.radius.xs, border: `1px solid ${C.border2}`,
            background: C.bg1, color: C.label1,
          },
        }, options.map(([v, text]) => h('option', { key: v, value: v }, text))));

      // ── 行式布局：标签在左、控件在右、提示挂在标签下，避免三行堆叠 ──
      const Row = ({ label, hint, control, first }) => h('div', {
        style: {
          display: 'grid',
          gridTemplateColumns: narrow ? 'minmax(0, 1fr)' : '220px minmax(0, 1fr)',
          columnGap: narrow ? 0 : T.space.lg,
          rowGap: narrow ? T.space.xs : 0,
          alignItems: 'start',
          padding: `${T.space.sm}px 0`,
          borderTop: first ? 'none' : `1px solid ${C.border1}`,
        },
      },
        h('div', { style: { minWidth: 0, paddingTop: 2 } },
          h('div', { style: { fontSize: fs(T.font.body), color: C.label1 } }, label)),
        h('div', { style: { minWidth: 0, display: 'grid', gap: 4, justifyItems: 'start' } },
          h('div', {
            style: {
              minWidth: 0, display: 'flex', gap: T.space.sm,
              alignItems: 'center', justifyContent: 'flex-start', flexWrap: 'wrap',
            },
          }, control),
          hint ? h('div', {
            style: {
              fontSize: fs(T.font.hint), color: C.caption, lineHeight: T.line.body,
              maxWidth: '100%',
            },
          }, hint) : null));

      const CardHead = ({ title, hint, right }) => h('div', {
        style: { display: 'flex', alignItems: 'flex-start', gap: T.space.md, marginBottom: T.space.xs },
      },
        h('div', { style: { flex: 1, minWidth: 0 } },
          h('div', { style: { fontSize: fs(T.font.section), fontWeight: 600, color: C.label1 } }, title),
          hint ? h('div', { style: { fontSize: fs(T.font.hint), color: C.caption, marginTop: 2 } }, hint) : null),
        right || null);

      const ago = (iso) => {
        if (!iso) return null;
        const stamp = new Date(iso).getTime();
        if (!Number.isFinite(stamp)) return null;
        const seconds = Math.max(0, Math.round((Date.now() - stamp) / 1000));
        if (seconds < 60) return `${seconds} 秒前`;
        if (seconds < 3600) return `${Math.round(seconds / 60)} 分钟前`;
        if (seconds < 86400) return `${Math.round(seconds / 3600)} 小时前`;
        return `${Math.round(seconds / 86400)} 天前`;
      };

      const switchFor = (path, checked, onLabel = '开', offLabel = '关') => h(Switch, {
        checked: Boolean(checked),
        onChange: (v) => set(path, v),
        label: checked ? onLabel : offLabel,
      });

      const numberBox = (path, value, min, max, width = 120, stepper = false) => h('div', { style: { width: stepper ? 'auto' : width } },
        h(NumberInput, {
          value: value ?? min, min, max, width, stepper,
          label: path,
          onChange: (v) => set(path, bounded(v, min, max, value ?? min), { debounce: true }),
        }));

      const textBox = (path, value, placeholder, width = 320, mono) => h('div', { style: { width, maxWidth: '100%' } },
        h(TextInput, {
          value: value || '', placeholder, mono, label: placeholder,
          onChange: (v) => set(path, v, { debounce: true }),
        }));

      const selectBox = (path, value, options, label, width = 220) => h('div', { style: { width, maxWidth: '100%' } },
        h('select', {
          value, 'aria-label': label,
          onChange: (e) => set(path, e.target.value),
          style: SETTINGS_SELECT_STYLE,
        }, options.map(([v, text]) => h('option', { key: v, value: v }, text))));

      /**
       * easyScholar key 保存 / 清除：无论成功、失败还是接口不存在，都要给回执，
       * 并把按钮从「保存中…」里放出来——之前必崩就是因为异常没人接。
       */
      const saveEasyKey = async (value, okText, failText) => {
        setKeyBusy(true);
        setMsg(null);
        try {
          if (typeof saveEasyScholarKey !== 'function') {
            throw new Error('当前版本不支持保存 easyScholar key，完全退出 DSH 再打开后重试');
          }
          const ok = await saveEasyScholarKey(String(value || '').trim());
          if (ok) {
            setEasyKeyDraft('');
            setMsg({ kind: 'success', text: okText });
          } else {
            setMsg({ kind: 'error', text: failText });
          }
        } catch (e) {
          setMsg({ kind: 'error', text: `${failText}：${e?.message || e}` });
        } finally {
          setKeyBusy(false);
        }
      };

      // ── 判读 ────────────────────────────────────────────────
      const renderAnalysis = () => h('div', { style: { display: 'flex', flexDirection: 'column', gap: T.space.lg } },
        h(Card, null,
          h(CardHead, {
            title: 'AI 判读',
            hint: '总开关关掉后，定时任务与「运行这一段」都不会调用模型',
            right: analysis.enabled === false ? h(Chip, null, '已关闭') : h(Chip, { tone: C.success }, '已启用'),
          }),
          h(Row, {
            first: true,
            label: '启用 AI 判读',
            hint: '自动判读开关在「AI 分析」页「队列概况」的「⋯」菜单里',
            control: switchFor('analysis.enabled', analysis.enabled !== false, '已启用', '已关闭'),
          })),
        h(Card, null,
          h(CardHead, { title: '每日额度', hint: '按上海自然日；0 表示不做这一级' }),
          ANALYSIS_STAGES.map((stage, index) => h(Row, {
            key: stage.id,
            first: index === 0,
            label: stage.label,
            hint: stage.id === 'l1' ? '读摘要' : stage.id === 'l2' ? '读引言末段 / 结论 / 主图' : '读全文',
            control: [
              numberBox(`analysis.daily.${stage.id}`, analysis.daily?.[stage.id], 0, stage.id === 'l3' ? 50 : 500, 96, true),
              h('span', { key: 'u', style: { fontSize: fs(T.font.hint), color: C.caption } }, '篇 / 天'),
            ],
          }))),
        h(Card, null,
          h(CardHead, {
            title: '期刊/会议等级',
            hint: 'CCF 2026 + SJR 2025 已内置；中科院/新锐/JCR 可选配置自己的 easyScholar',
          }),
          h(Row, {
            first: true,
            label: '基础数据',
            hint: '不需要账号，不消耗额度',
            control: [h(Chip, { key: 'ccf', tone: C.success }, 'CCF 682'), h(Chip, { key: 'sjr', tone: C.success }, 'SJR 30412')],
          }),
          h(Row, {
            label: 'easyScholar',
            hint: hasEasyScholarKey ? 'key 已保存在 Host 凭据，不回传' : '未配置时只显示 CCF/SJR；配置后才能查中科院/新锐/JCR',
            control: [
              hasEasyScholarKey ? h(Chip, { key: 'on', tone: C.success }, '已配置') : h(Chip, { key: 'off' }, '未配置'),
              h('div', { key: 'input', style: { width: 260, maxWidth: '100%' } },
                h(TextInput, {
                  type: 'password', value: easyKeyDraft, mono: true,
                  placeholder: hasEasyScholarKey ? '输入新 key 覆盖' : '粘贴 easyScholar secretKey',
                  onChange: setEasyKeyDraft,
                })),
              h(Button, {
                key: 'save', size: 'sm', primary: true, disabled: keyBusy,
                onClick: () => saveEasyKey(easyKeyDraft, 'easyScholar key 已保存', 'easyScholar key 保存失败'),
              }, keyBusy ? '保存中…' : '保存 key'),
              hasEasyScholarKey ? h(Button, {
                key: 'clear', size: 'sm',
                onClick: () => saveEasyKey('', 'easyScholar key 已清除', '清除 easyScholar key 失败'),
              }, '清除') : null,
            ],
          })),
        h(Card, null,
          h(CardHead, {
            title: '每日摘要',
            hint: '总览页的「今天值得读」按这里的分组与范围生成；不发送邮件',
          }),
          h(Row, {
            first: true,
            label: '每组最多几条',
            control: [
              numberBox('digest.maxPerGroup', digest.maxPerGroup ?? 2, 1, 5),
              h('span', { key: 'u', style: { fontSize: fs(T.font.hint), color: C.caption } }, '条'),
            ],
          }),
          h(Row, {
            label: '包含 B 级',
            hint: '打开后 B 级也会进摘要',
            control: switchFor('digest.includeB', digest.includeB === true),
          }),
          h(Row, {
            label: '按关注词分组',
            hint: '分组依据是「设置 → 研究兴趣」里的核心关键词，不在本页重复配置',
            control: h(Chip, null, '跟随「研究兴趣」'),
          })),
        h(Card, null,
          h(CardHead, {
            title: '判读模型',
            hint: '默认跟随 DSH；更换模型需先在 DSH 中添加模型来源',
          }),
          modelError
            ? h('div', null,
              h(Notice, { kind: 'error' },
                `读取模型列表失败：${modelError}`
                + (/404/.test(modelError)
                  ? '　如果刚更新过插件，需要完全退出 DSH 再打开——只刷新页面不会加载新的 Host 代码。'
                  : '')),
              h('div', {
                style: { fontSize: fs(T.font.hint), color: C.caption, lineHeight: T.line.body, marginBottom: T.space.sm },
              },
                '当前配置：',
                ANALYSIS_STAGES.map((stage) => {
                  const spec = analysis.models?.[stage.id] || {};
                  return `${stage.label} ${spec.provider || spec.model ? `${spec.provider || '默认'} / ${spec.model || '默认'}` : '跟随 DSH'}`;
                }).join(' · ')),
              h(Button, { size: 'sm', onClick: loadModels }, '重试'))
            : !modelData
              ? h(Empty, null, '读取可用模型…')
              : ANALYSIS_STAGES.map((stage, index) => {
                const spec = analysis.models?.[stage.id] || {};
                const fallback = modelData.defaults?.[stage.id] || {};
                const chosenProvider = spec.provider || '';
                const effectiveProvider = chosenProvider || fallback.provider || '自动';
                const providerEntry = (modelData.providers || []).find((p) => p.id === effectiveProvider);
                const models = (providerEntry && providerEntry.models) || [];
                const effectiveModel = spec.model || fallback.model || '自动';
                return h(Row, {
                  key: stage.id,
                  first: index === 0,
                  label: stage.label,
                  hint: `当前生效：${effectiveProvider} / ${effectiveModel}`,
                  control: [
                    h('div', { key: 'p', style: { width: 168, maxWidth: '100%' } }, h('select', {
                      value: chosenProvider,
                      'aria-label': `${stage.label} provider`,
                      onChange: (e) => commit(settingsPatchPath(`analysis.models.${stage.id}`, {
                        provider: e.target.value, model: '',
                      })),
                      style: SETTINGS_SELECT_STYLE,
                    }, [
                      h('option', { key: '', value: '' }, `跟随 DSH（默认）`),
                      ...(modelData.providers || []).map((p) => h('option', { key: p.id, value: p.id }, p.name || p.id)),
                    ])),
                    h('div', { key: 'm', style: { width: 210, maxWidth: '100%' } }, h('select', {
                      value: spec.model || '',
                      'aria-label': `${stage.label} model`,
                      onChange: (e) => commit(settingsPatchPath(`analysis.models.${stage.id}`, {
                        provider: chosenProvider, model: e.target.value,
                      })),
                      style: SETTINGS_SELECT_STYLE,
                    }, [
                      h('option', { key: '', value: '' }, `跟随 DSH（默认）`),
                      ...models.map((m) => h('option', { key: m.id, value: m.id }, m.name || m.id)),
                    ])),
                  ],
                });
              })),
        h(Card, null,
          h(CardHead, { title: '评级规则', hint: '模型自报低置信、以及 C 级论文怎么处理' }),
          h(Row, {
            first: true,
            label: '低置信时',
            hint: '模型自报 low confidence',
            control: selectBox('analysis.lowConfidence', analysis.lowConfidence || 'park',
              [['park', '先搁置，等待复核（推荐）'], ['drop', '直接丢弃']], '低置信时'),
          }),
          h(Row, {
            label: 'C 级论文',
            hint: 'D 级无论怎么设都会丢弃',
            control: selectBox('analysis.lowGrade', analysis.lowGrade || 'drop',
              [['drop', '直接丢弃（默认）'], ['park', '先搁置，等待复核']], 'C 级论文'),
          })),
        h(Card, null,
          h(CardHead, {
            title: '提示词',
            hint: '全局共用；留空用内置默认，补充标准会追加到默认提示词',
            right: h(Button, { size: 'sm', onClick: () => setFullPrompts((v) => !v) },
              fullPrompts ? '收起完整提示词' : '编辑完整提示词'),
          }),
          ANALYSIS_STAGES.map((stage, index) => h('details', {
            key: stage.id,
            style: {
              borderTop: index === 0 ? 'none' : `1px solid ${C.border1}`,
              padding: `${T.space.xs}px 0`,
            },
          },
            h('summary', { style: { cursor: 'pointer', fontSize: fs(T.font.body), color: C.label1 } }, stage.label),
            h('div', { style: { marginTop: T.space.xs } },
              h('div', { style: { fontSize: fs(T.font.hint), color: C.caption, marginBottom: 3 } }, '补充判定标准'),
              h(SettingsPromptBox, {
                value: analysis.prompts?.[stage.id]?.extra || '',
                rows: 3,
                placeholder: '例如：更看重实验是否包含真实硬件验证；纯仿真降一级',
                onChange: (v) => set(`analysis.prompts.${stage.id}.extra`, v, { debounce: true }),
              }),
              fullPrompts
                ? h('div', { style: { marginTop: T.space.sm } },
                  h('div', { style: { display: 'flex', gap: T.space.sm, alignItems: 'center', marginBottom: 3 } },
                    h('span', { style: { fontSize: fs(T.font.hint), color: C.caption } }, '完整系统提示词'),
                    h(Button, { size: 'sm', onClick: () => set(`analysis.prompts.${stage.id}.system`, promptDefaults[stage.id] || '') }, '载入默认'),
                    h(Button, { size: 'sm', onClick: () => set(`analysis.prompts.${stage.id}.system`, '') }, '清空')),
                  h(SettingsPromptBox, {
                    value: analysis.prompts?.[stage.id]?.system || '',
                    rows: 8,
                    mono: true,
                    placeholder: '留空使用默认提示词；编辑后请保留输出格式要求',
                    onChange: (v) => set(`analysis.prompts.${stage.id}.system`, v, { debounce: true }),
                  }))
                : null)))),
        h(Card, null,
          h(CardHead, {
            title: '高级设置',
            hint: '一般不需要修改，默认收起',
            right: h(Button, { size: 'sm', onClick: () => setShowAdvanced((v) => !v) }, showAdvanced ? '收起' : '展开'),
          }),
          showAdvanced
            ? h('div', null,
              ANALYSIS_STAGES.map((stage, index) => h(Row, {
                key: stage.id,
                first: index === 0,
                label: `${stage.label} 输出上限`,
                control: [numberBox(`analysis.maxTokens.${stage.id}`, analysis.maxTokens?.[stage.id], 200, 32000), h('span', { key: 'u', style: { fontSize: fs(T.font.hint), color: C.caption } }, '单位')],
              })),
              h(Row, {
                label: 'PDF 解析上限',
                control: [numberBox('analysis.pdf.maxMb', analysis.pdf?.maxMb, 1, 200), h('span', { key: 'u', style: { fontSize: fs(T.font.hint), color: C.caption } }, 'MB')],
              }))
            : h('div', { style: { fontSize: fs(T.font.hint), color: C.caption } }, '输出长度上限、PDF 解析上限等；一般不用改。')));

      // ── 机构访问 ────────────────────────────────────────────
      const access = download.access || {};
      const accessMode = access.mode || 'none';
      const institutionalHosts = Array.isArray(access.institutionalHosts) ? access.institutionalHosts : [];
      const hostsText = hostsDraft !== null ? hostsDraft : institutionalHosts.join(', ');
      const commitHosts = () => {
        const list = hostsText.split(/[,，\s]+/).map((item) => item.trim()).filter(Boolean);
        setHostsDraft(null);
        set('download.access.institutionalHosts', [...new Set(list)]);
      };
      const cookieRow = hasInstitutionalCookie
        ? h(Chip, { tone: C.accent }, '会话已保存')
        : null;

      const renderInstitutional = () => h(Card, null,
        h(CardHead, {
          title: '机构访问',
          hint: '用你自己学校的订阅权限取全文；不配置时只走开放获取',
          right: h('div', { style: { display: 'flex', gap: T.space.xs, flexWrap: 'wrap' } },
            accessMode === 'none' ? h(Chip, null, '未启用') : h(Chip, { tone: C.success }, '已启用'),
            cookieRow),
        }),
        h(Row, {
          first: true,
          label: '方式',
          hint: 'EZproxy 按模板改写；WebVPN 用各校自己的正则；CARSI 登录后只带 Cookie',
          control: selectBox('download.access.mode', accessMode,
            [['none', '关闭'], ['ezproxy', 'EZproxy'], ['webvpn', 'WebVPN'], ['direct', 'CARSI / 仅带 Cookie']], '机构访问方式', 240),
        }),
        accessMode === 'ezproxy'
          ? h(Row, {
            label: 'EZproxy 登录地址',
            hint: '把 {url} 放在学校给的登录地址里，其余部分原样保留',
            control: textBox('download.access.ezproxy.template', access.ezproxy?.template, 'https://ezproxy.example.edu/login?url={url}', 400, true),
          })
          : null,
        accessMode === 'webvpn'
          ? h('div', null,
            h(Row, {
              label: 'WebVPN 改写规则',
              hint: '正则；匹配到的部分替换成下一行的写法',
              control: textBox('download.access.webvpn.pattern', access.webvpn?.pattern, 'https://www\\.example\\.com/', 400, true),
            }),
            h(Row, {
              label: '替换为',
              hint: '可含 $1 引用捕获组',
              control: textBox('download.access.webvpn.replacement', access.webvpn?.replacement, 'https://www-example-com.webvpn.example.edu/', 400, true),
            }))
          : null,
        h(Row, {
          label: '机构域名',
          hint: '逗号分隔；会话 Cookie 只会发给这些域名，不会发给无关站点',
          control: h('div', { style: { width: 420, maxWidth: '100%' } },
            h(TextInput, {
              value: hostsText,
              placeholder: 'sciencedirect.com, ieeexplore.ieee.org',
              mono: true,
              label: '机构域名',
              onChange: setHostsDraft,
              onBlur: commitHosts,
            })),
        }),
        accessMode === 'none'
          ? null
          : h(Row, {
            label: '会话 Cookie',
            hint: hasInstitutionalCookie
              ? '已保存在本机凭据服务；输入新值覆盖，清空后保存即删除'
              : '在浏览器登录学校后，从开发者工具的网络请求里复制 Cookie 请求头粘贴到这里',
            control: [
              h('div', { key: 'c', style: { width: 340, maxWidth: '100%' } },
                h(TextInput, {
                  type: 'password',
                  value: cookieDraft,
                  placeholder: hasInstitutionalCookie ? '已保存（输入新值覆盖）' : '粘贴 Cookie',
                  mono: true,
                  label: '机构会话 Cookie',
                  onChange: setCookieDraft,
                })),
              h(Button, {
                key: 'save',
                size: 'sm',
                disabled: cookieBusy || (typeof saveInstitutionalCookie !== 'function') || (!cookieDraft.trim() && !hasInstitutionalCookie),
                onClick: async () => {
                  setCookieBusy(true);
                  setMsg(null);
                  const clearing = !cookieDraft.trim();
                  const ok = await saveInstitutionalCookie(cookieDraft.trim());
                  setCookieBusy(false);
                  if (ok) {
                    setCookieDraft('');
                    setMsg({ kind: 'success', text: clearing ? '会话已清除' : '会话已保存到本机凭据服务' });
                  } else {
                    setMsg({ kind: 'error', text: '会话保存失败' });
                  }
                },
              }, cookieBusy ? '保存中…' : (cookieDraft.trim() ? '保存会话' : '清除会话')),
            ],
          }),
        h(Row, {
          label: '自检',
          hint: '拿一个文章页或 PDF 地址真试一次；只探测，不写入任何状态',
          control: [
            h('div', { key: 'u', style: { width: 360, maxWidth: '100%' } },
              h(TextInput, {
                value: accessUrl,
                placeholder: 'https://…/article/…',
                mono: true,
                label: '自检链接',
                onChange: setAccessUrl,
              })),
            h(Button, {
              key: 't',
              size: 'sm',
              disabled: accessBusy || (typeof testAccess !== 'function') || !accessUrl.trim(),
              onClick: async () => {
                setAccessBusy(true);
                setAccessResult(null);
                setMsg(null);
                try {
                  setAccessResult(await testAccess(accessUrl.trim()));
                } catch (e) {
                  setMsg({ kind: 'error', text: '自检失败：' + String(e?.message || e) });
                } finally {
                  setAccessBusy(false);
                }
              },
            }, accessBusy ? '测试中…' : '测试'),
          ],
        }),
        accessResult
          ? h('div', {
            style: {
              borderTop: '1px solid ' + C.border1, marginTop: T.space.xs, paddingTop: T.space.sm,
              fontSize: fs(T.font.hint), color: accessResult.isPdf ? C.success : C.caption, lineHeight: T.line.body,
            },
          }, accessResult.isPdf
            ? '能取到 PDF：' + Math.max(1, Math.round(accessResult.bytes / 1024)) + ' KB'
              + (accessResult.truncated ? '（文件尾不完整）' : '')
              + '，' + accessResult.hops + ' 跳，' + accessResult.ms + ' ms'
            : '没取到：' + String(accessResult.hint || accessResult.code || ''))
          : null,
        accessMode !== 'none' && !institutionalHosts.length
          ? h('div', { style: { fontSize: fs(T.font.hint), color: C.caption, lineHeight: T.line.body } },
            '机构域名还空着，Cookie 不会被发送；填上学校订阅的出版社域名再试。')
          : null);

      // ── 原文 ────────────────────────────────────────────────
      const renderFetch = () => h('div', { style: { display: 'flex', flexDirection: 'column', gap: T.space.lg } },
        h(Card, null,
          h(CardHead, { title: '下载', hint: '先取开放获取原文；拿不到时留给人补' }),
          h(Row, {
            first: true,
            label: '每日下载上限',
            hint: '按成功下载数统计；0 表示当天不自动下载',
            control: [numberBox('download.maxPerDay', download.maxPerDay, 0, 100, 96, true), h('span', { key: 'u', style: { fontSize: fs(T.font.hint), color: C.caption } }, '篇 / 天')],
          }),
          h(Row, {
            label: 'Crossref 直链',
            hint: '只请求 Crossref 披露的 PDF 链接；不改写、不带 Cookie，与下面的机构访问无关',
            control: switchFor('download.institutionalDirect', download.institutionalDirect === true),
          }),
          h(Row, {
            label: '监听下载目录',
            hint: '浏览器扩展或手动下载的 PDF 落到这里，自动按 DOI / 标题匹配导入',
            control: switchFor('download.watchImport', download.watchImport !== false),
          }),
          h(Row, {
            label: '下载目录',
            hint: '扩展选项里的目录要和这里一致',
            control: textBox('download.watchDir', download.watchDir || '~/Downloads/论文', '~/Downloads/论文'),
          })),
        renderInstitutional(),

        h(Card, null,
          h(CardHead, {
            title: '浏览器扩展',
            hint: '浏览器扩展把下载到的 PDF 直接发给插件；目录监听作备用',
            right: h('div', { style: { display: 'flex', gap: T.space.xs, flexWrap: 'wrap' } },
              bridge.enabled === false ? h(Chip, null, '服务已关闭') : h(Chip, { tone: C.success }, '服务运行中'),
              h(Chip, null, '仅接受扩展来源')),
          }),
          h(Row, {
            first: true,
            label: '扩展端口',
            hint: `地址 http://127.0.0.1:${bridge.port ?? 27888}/import；改完需完全退出 DSH 再打开`,
            control: numberBox('bridge.port', bridge.port ?? 27888, 1024, 65535, 120),
          })),
        h('div', { style: { fontSize: fs(T.font.hint), color: C.caption, lineHeight: T.line.body } },
          '自动通道：arXiv / OpenAlex / Europe PMC / Unpaywall / Semantic Scholar 的开放链接，出版商官方模板，'
          + '以及上面配置的机构访问。被反爬拦下的页面用浏览器扩展抓取，或在「AI 分析」里手动「补 PDF」。'));

      // ── 集成 ────────────────────────────────────────────────
      const renderIntegrations = () => h('div', { style: { display: 'flex', flexDirection: 'column', gap: T.space.lg } },
        h(Card, null,
          h(CardHead, {
            title: 'Zotero',
            hint: '读库分析关键词；入库需要写权限',
            right: h('div', { style: { display: 'flex', gap: T.space.xs, flexWrap: 'wrap' } },
              zotero.enabled ? h(Chip, { tone: C.success }, '已启用') : h(Chip, null, '未启用'),
              h(Chip, null, zotero.mode === 'local' ? '本机 Zotero' : 'Zotero 账号'),
              zoteroStatus?.fetched_at ? h(Chip, { tone: C.accent }, `同步于 ${ago(zoteroStatus.fetched_at)}`) : null),
          }),
          h(Row, {
            first: true,
            label: '启用',
            hint: '关闭后只读取本地数据，不再访问 Zotero',
            control: switchFor('integrations.zotero.enabled', zotero.enabled === true, '已启用', '未启用'),
          }),
          h(Row, {
            label: '连接方式',
            hint: '本机 Zotero 只读；写入需要 Zotero 10+ 授权（在对话里运行 authorize）',
            control: switchFor('integrations.zotero.mode', zotero.mode === 'local', '本机 Zotero', 'Zotero 账号'),
          }),
          zotero.mode === 'local'
            ? h(Row, {
              label: '本机端口',
              hint: 'Zotero 默认 23119',
              control: numberBox('integrations.zotero.localPort', zotero.localPort ?? 23119, 1, 65535, 120),
            })
            : h('div', null,
              h(Row, {
                label: 'User ID',
                hint: 'zotero.org/settings/keys 右上角的数字 ID',
                control: textBox('integrations.zotero.userId', zotero.userId, '例如 1234567', 220, true),
              }),
              h(Row, {
                label: 'Group ID（可选）',
                hint: '留空读个人库',
                control: textBox('integrations.zotero.groupId', zotero.groupId, '群组 ID', 220, true),
              })),
          zoteroStatus?.fetched_at
            ? h('div', {
              style: {
                borderTop: `1px solid ${C.border1}`, marginTop: T.space.xs, paddingTop: T.space.sm,
                fontSize: fs(T.font.hint), color: C.caption,
              },
            }, `已同步 ${zoteroStatus.cached || 0} 条 · ${ago(zoteroStatus.fetched_at)}${zoteroStatus.stale ? '（已过期，下次读取会刷新）' : ''}`)
            : h('div', {
              style: {
                borderTop: `1px solid ${C.border1}`, marginTop: T.space.xs, paddingTop: T.space.sm,
                fontSize: fs(T.font.hint), color: C.caption,
              },
            }, '还没有同步过 Zotero 库')),
        h(Card, null,
          h(CardHead, {
            title: '凭据',
            hint: '只存在 DSH 凭据服务里，不写配置文件、不进日志',
            right: hasApiKey ? h(Chip, { tone: C.success }, 'Key 已保存') : h(Chip, null, '无 Key'),
          }),
          h(Row, {
            first: true,
            label: 'Zotero API Key',
            hint: '只读 key 够分析关键词；入库需要写权限',
            control: [
              h('div', { key: 'k', style: { width: 320, maxWidth: '100%' } },
                h(TextInput, {
                  type: 'password', value: apiKeyDraft,
                  placeholder: hasApiKey ? '已保存（输入新 key 覆盖）' : '粘贴 Zotero API Key',
                  mono: true, label: 'Zotero API Key',
                  onChange: setApiKeyDraft,
                })),
              h(Button, {
                key: 'save',
                size: 'sm',
                disabled: !apiKeyDraft.trim() || keyBusy,
                onClick: async () => {
                  setKeyBusy(true);
                  setMsg(null);
                  const ok = await saveCredential(apiKeyDraft.trim());
                  setKeyBusy(false);
                  if (ok) {
                    setApiKeyDraft('');
                    setSavedAt(Date.now());
                    setMsg({ kind: 'success', text: 'Key 已保存到本机凭据服务' });
                  } else {
                    setMsg({ kind: 'error', text: 'Key 保存失败' });
                  }
                },
              }, keyBusy ? '保存中…' : '保存密钥'),
            ],
          })),
        h(Card, null,
          h(CardHead, {
            title: '自动入库',
            hint: '评级达标后自动写入 Zotero；失败只记录，不影响评级',
            right: zoteroAuto.enabled === true ? h(Chip, { tone: C.success }, '已开启') : h(Chip, null, '未开启'),
          }),
          h(Row, {
            first: true,
            label: '自动入库',
            control: switchFor('integrations.zotero.autoImport.enabled', zoteroAuto.enabled === true),
          }),
          h(Row, {
            label: '最低等级',
            hint: '达到该等级才自动写入',
            control: selectBox('integrations.zotero.autoImport.minGrade', zoteroAuto.minGrade || 'B',
              [['S', 'S'], ['A', 'A'], ['B', 'B'], ['C', 'C'], ['D', 'D']], '自动入库最低等级', 120),
          }),
          h(Row, {
            label: '需要有原文',
            control: switchFor('integrations.zotero.autoImport.requirePdf', zoteroAuto.requirePdf === true),
          })));

      // ── 系统 ────────────────────────────────────────────────
      const renderSystem = () => h('div', { style: { display: 'flex', flexDirection: 'column', gap: T.space.lg } },
        h(Card, null,
          h(CardHead, { title: '界面', hint: '只放大文字，不改变间距与布局' }),
          h(Row, {
            first: true,
            label: '字号',
            control: selectBox('ui.fontScale', String(ui.fontScale ?? 1), [
              ['0.95', '小'], ['1', '标准'], ['1.1', '大'], ['1.2', '特大'],
            ], '界面字号', 140),
          })),
        h(Card, null,
          h(CardHead, { title: '网络', hint: '一般不用改；超时调小更容易失败' }),
          h(Row, { first: true, label: '请求超时', control: [numberBox('network.timeoutMs', network.timeoutMs ?? 20000, 3000, 120000), h('span', { key: 'u', style: { fontSize: fs(T.font.hint), color: C.caption } }, 'ms')] }),
          h(Row, { label: '失败重试', control: [numberBox('network.retries', network.retries ?? 2, 0, 5, 90), h('span', { key: 'u', style: { fontSize: fs(T.font.hint), color: C.caption } }, '次')] }),
          h(Row, { label: 'RSS 抓取间隔', control: [numberBox('network.rssIntervalMs', network.rssIntervalMs ?? 1000, 0, 10000), h('span', { key: 'u', style: { fontSize: fs(T.font.hint), color: C.caption } }, 'ms')] }),
          h(Row, { label: 'arXiv 请求间隔', control: [numberBox('network.arxivIntervalMs', network.arxivIntervalMs ?? 3000, 0, 30000), h('span', { key: 'u', style: { fontSize: fs(T.font.hint), color: C.caption } }, 'ms')] }),
          h(Row, { label: 'arXiv 每次最多取几页', control: [numberBox('network.arxivMaxPages', network.arxivMaxPages ?? 20, 1, 100, 90), h('span', { key: 'u', style: { fontSize: fs(T.font.hint), color: C.caption } }, '页')] })),
        h(Card, null,
          h(CardHead, { title: '补抓历史', hint: '按年份或引文扩展时，单次任务的候选上限' }),
          h(Row, {
            first: true,
            label: '单任务候选上限',
            control: [numberBox('corpus.maxItems', corpus.maxItems ?? 500, 50, 2000), h('span', { key: 'u', style: { fontSize: fs(T.font.hint), color: C.caption } }, '条')],
          })),
        h(Card, null,
          h(CardHead, { title: '诊断', hint: '只读信息，便于排查' }),
          h('div', {
            style: {
              display: 'grid', gap: `${T.space.xs}px ${T.space.lg}px`,
              gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
              fontSize: fs(T.font.hint), color: C.label2, lineHeight: T.line.body,
            },
          },
            h('div', null, `数据版本 ${config.schema ?? '—'}`),
            h('div', null, `定时任务 ${config.schedule?.time || '—'} · 时区 ${config.schedule?.timezone || 'Asia/Shanghai'}`),
            h('div', null, `扩展服务 ${bridge.enabled === false ? '关闭' : '启用'} · 端口 ${bridge.port ?? 27888}`),
            h('div', null, `Zotero ${zotero.enabled ? (zotero.mode === 'local' ? '本机 Zotero' : 'Zotero 账号') : '未启用'} · ${hasApiKey ? 'key 已保存' : '未设置 key'}`))));


      const sectionBody = {
        analysis: renderAnalysis,
        fetch: renderFetch,
        integrations: renderIntegrations,
        system: renderSystem,
      }[section] || renderAnalysis;

      // ── 首屏「还差什么」：四项缺口 + 就地操作 ────────────────
      // 兴趣与来源归「来源」页，但跨页跳转需要宿主暴露路由；这里直接给就地开关，
      // 缺什么点一下就能补上，改完立即保存（与设置页其他项同一套 commit）。
      const SETUP_CHANNELS = [
        ['arxiv', 'arXiv'], ['search', '跨库检索'], ['email', '邮件快讯'],
        ['pubmed', 'PubMed'], ['dblp', 'DBLP'], ['preprint', '预印本'],
      ];
      const channelOn = (id) => {
        const sources = config.sources || {};
        if (id === 'rss') return (Array.isArray(sources.rss) ? sources.rss : []).some((feed) => feed.enabled !== false);
        if (id === 'email') return sources.mail?.enabled === true;
        if (id === 'arxiv') return sources.arxiv?.enabled !== false;
        return sources[id]?.enabled === true;
      };
      const setupChannelCount = ['arxiv', 'rss', 'search', 'email', 'pubmed', 'dblp', 'preprint']
        .filter((id) => channelOn(id)).length;
      const toggleSetupChannel = (id, on) => {
        const key = id === 'email' ? 'mail' : id;
        const sources = { ...(config.sources || {}) };
        sources[key] = { ...(sources[key] || {}), enabled: on };
        commit({ sources });
      };
      const interestTermCount = (config.relevance?.keywords || []).length
        + (config.relevance?.contextKeywords || []).length;
      const zoteroReady = Boolean(zotero.enabled
        && (zotero.mode === 'local' ? zoteroStatus?.fetched_at : hasApiKey));
      const autoImportOn = zoteroAuto.enabled === true;
      const modelReady = Boolean((modelData?.providers || []).length);
      const setupDone = interestTermCount > 0 && setupChannelCount > 0 && zoteroReady && autoImportOn && modelReady;
      // 宿主如果给 Settings 传了 navigate，就真的跳到「来源」页；没传则就地展开。
      const goSources = () => (typeof navigate === 'function' ? navigate('sources') : false);
      const setupRow = ({ label, done, detail, action, onClick }) => h('div', {
        style: {
          display: 'flex', alignItems: 'center', gap: T.space.sm,
          padding: `${T.space.xs + 1}px 0`, flexWrap: 'wrap',
          borderTop: `1px solid ${C.border1}`,
        },
      },
        h('span', { style: { width: 150, flexShrink: 0, fontSize: fs(T.font.body), color: C.label1 } }, label),
        h(Chip, { tone: done ? C.success : undefined }, done ? '已配置' : '未配置'),
        h('span', {
          style: { flex: 1, minWidth: 140, fontSize: fs(T.font.hint), color: C.caption, lineHeight: T.line.body },
        }, detail),
        h(Button, { size: 'sm', primary: !done, onClick }, action));
      const setupChecklist = h(Card, { style: { marginBottom: T.space.lg } },
        h(CardHead, {
          title: '配置检查',
          hint: '完成以下四项后，采集、判读与入库将自动运行',
        }),
        setupDone
          ? h('div', { style: { fontSize: fs(T.font.hint), color: C.caption } }, '配置完整')
          : h('div', null,
            setupRow({
              label: '研究兴趣',
              done: interestTermCount > 0,
              detail: interestTermCount > 0
                ? `已填 ${interestTermCount} 个关键词`
                : '未设置关键词，抓取到的论文会全部进入候选池',
              action: setupInterest ? '收起' : '设置关键词',
              onClick: () => { if (!goSources()) setSetupInterest((v) => !v); },
            }),
            setupRow({
              label: '渠道',
              done: setupChannelCount > 0,
              detail: setupChannelCount > 0
                ? `已开启 ${setupChannelCount} 个来源`
                : '未启用来源，无法自动采集',
              action: setupChannels ? '收起' : '启用来源',
              onClick: () => { if (!goSources()) setSetupChannels((v) => !v); },
            }),
            setupRow({
              label: 'Zotero 授权 + 自动入库',
              done: autoImportOn && zoteroReady,
              detail: !zoteroReady
                ? '未授权；可在「集成」填写 key，或启动本机 Zotero'
                : autoImportOn
                  ? `达标自动入库 · 最低 ${zoteroAuto.minGrade || 'B'} 级`
                  : '已授权，自动入库未启用',
              action: '前往集成',
              onClick: () => setSection('integrations'),
            }),
            setupRow({
              label: '模型 key',
              done: modelReady,
              detail: modelReady
                ? `可用模型 ${modelData.providers.length} 家`
                : (modelError ? `模型列表读取失败：${modelError}` : '无可用模型，无法执行判读'),
              action: '配置模型',
              onClick: () => setSection('analysis'),
            }),
            setupInterest
              ? h('div', { style: { marginTop: T.space.sm } }, h(InterestCard, { config, saveConfig, defaultOpen: true }))
              : null,
            setupChannels
              ? h('div', { style: { marginTop: T.space.sm, display: 'grid', gap: T.space.xs } },
                SETUP_CHANNELS.map(([id, label]) => h('div', {
                  key: id, style: { display: 'flex', alignItems: 'center', gap: T.space.sm, flexWrap: 'wrap' },
                },
                  h(Switch, { checked: channelOn(id), onChange: (v) => toggleSetupChannel(id, v), label }),
                  h('span', { style: { fontSize: fs(T.font.hint), color: C.caption } },
                    '开关立即保存；地址、发件人等配置位于「来源」页'))))
              : null));

      return h('div', null,
        // 页名由外壳页头统一渲染，这里只留保存状态，避免出现两个「设置」
        h('div', {
          style: {
            display: 'flex', alignItems: 'center', justifyContent: 'flex-end',
            gap: T.space.md, marginBottom: T.space.sm, flexWrap: 'wrap',
          },
        },
          h('span', {
            role: 'status', 'aria-live': 'polite',
            style: { fontSize: fs(T.font.hint), color: saving || msg?.kind === 'error' ? C.warn : C.caption },
          }, saving ? '保存中…' : (savedAt ? `已保存 ${new Date(savedAt).toLocaleTimeString()}` : '改动即时生效'))),
        setupChecklist,
        msg ? h(Notice, { kind: msg.kind }, msg.text) : null,
        h('div', {
          style: {
            display: 'flex', gap: T.space.lg, alignItems: 'flex-start',
            flexDirection: narrow ? 'column' : 'row',
          },
        },
          h('nav', {
            'aria-label': '设置分区',
            style: narrow
              ? { display: 'flex', flexWrap: 'wrap', gap: T.space.xs, width: '100%' }
              : {
                display: 'flex', flexDirection: 'column', gap: T.space.micro,
                width: 132, flexShrink: 0, position: 'sticky', top: 0,
              },
          },
            SETTINGS_SECTIONS.map((s) => {
              const on = s.id === section;
              return h('button', {
                key: s.id, type: 'button',
                'aria-current': on ? 'true' : undefined,
                onClick: () => setSection(s.id),
                style: {
                  appearance: 'none', cursor: 'pointer', fontFamily: 'inherit',
                  textAlign: 'left', fontSize: fs(T.font.body),
                  fontWeight: on ? 600 : 400,
                  color: on ? C.accent : C.label2,
                  background: on ? C.bg2 : 'transparent',
                  border: 'none', borderRadius: T.radius.xs,
                  boxShadow: on ? `inset 2px 0 0 ${C.accent}` : 'none',
                  padding: `${T.space.xs + 2}px ${T.space.sm}px`,
                  transition: 'background .15s, color .15s',
                },
              }, s.label);
            })),
          h('div', { style: { flex: 1, minWidth: 0, width: '100%' } }, sectionBody())),
      );
    }
    // ── 工作台 ────────────────────────────────────────────────
    /** 页头的相对时间：自己算，不依赖总览页的同名函数。 */
    function headerAgo(iso, now = Date.now()) {
      const time = Date.parse(iso || '');
      if (!Number.isFinite(time)) return '';
      const seconds = Math.max(0, Math.round((now - time) / 1000));
      if (seconds < 90) return '刚刚';
      if (seconds < 3600) return `${Math.round(seconds / 60)} 分钟前`;
      if (seconds < 86400) return `${Math.round(seconds / 3600)} 小时前`;
      return `${Math.round(seconds / 86400)} 天前`;
    }


    function Workbench() {
      const api = useApi();
      const [tab, setTab] = useState('overview');
      // 待办只有三个段：待处理 / 已完成 / 已丢弃；默认落在待处理，首屏一定有内容
      const [queueSeg, setQueueSeg] = useState('todo');
      // 页头「刷新」＝重拉 state/config + 通知当前页重取自己的数据
      const [refreshTick, setRefreshTick] = useState(0);
      const [queuePref, setQueuePref] = useState(null);
      const [readingPref, setReadingPref] = useState('unread');
      const [, setLocaleRev] = useState(0);
      const [analysisStats, setAnalysisStats] = useState(null);
      useEffect(() => {
        if (!localeFace?.subscribe) return undefined;
        return localeFace.subscribe(() => setLocaleRev((n) => n + 1));
      }, []);
      const [actionMsg, setActionMsg] = useState(null);
      const [toast, setToast] = useState(null);
      const [openPaper, setOpenPaper] = useState(null);
      const [openPaperTab, setOpenPaperTab] = useState('judge');
      const openPaperAt = (id, initialTab = 'judge') => { setOpenPaperTab(initialTab); setOpenPaper(id); };
      const openPdf = async (id) => {
        try {
          await postJson(R.openPdf, { id });
          setActionMsg({ kind: 'success', text: '已用系统阅读器打开 PDF' });
        } catch (e) {
          setActionMsg({ kind: 'error', text: `打开 PDF 失败：${e?.message || e}` });
        }
      };
      const openUrl = async (id) => {
        try {
          const r = await postJson(R.openUrl, { id });
          setActionMsg({ kind: 'success', text: r?.url ? `已在浏览器打开：${r.url}` : '已在浏览器打开网页' });
        } catch (e) {
          setActionMsg({ kind: 'error', text: `打开网页失败：${e?.message || e}` });
        }
      };
      const uploadPaperPdf = async (id, file) => {
        const form = new FormData();
        form.append('file', file);
        form.append('paperId', id);
        try {
          await api(R.upload, { method: 'POST', body: form });
          setActionMsg({ kind: 'success', text: `已补 PDF：${id}` });
          await reload();
        } catch (e) {
          setActionMsg({ kind: 'error', text: `补 PDF 失败：${e?.message || e}` });
        }
      };
      const { state, config, error, busy, reload, loadMore, hasApiKey, hasEasyScholarKey, hasInstitutionalCookie, saveCredential, saveEasyScholarKey, saveInstitutionalCookie, testAccess, overridePaper } = api;
      const onJobFinish = useCallback((job) => {
        const done = job.status === 'done';
        const requested = Number(job?.result?.requested);
        // 任务跑完却一条没处理，多半是条目不在当前层或额度为 0：如实报，不显示「已完成」
        const empty = done && Number.isFinite(requested) && requested === 0;
        const text = !done
          ? `${job.name || job.id} 失败：${job.error || '原因未知，可到运行日志查看'}`
          : empty
            ? `${job.name || job.id} 未运行：没有可处理条目`
            : `${job.name || job.id} 已完成`;
        setToast({ kind: !done ? 'error' : empty ? 'warn' : 'success', text });
        // 任务结束后主动重拉一次状态 + 通知各页重取数据：
        // 抽屉里的「重跑/重新精读」只在开跑后 1.5 秒刷一次，跑完不刷新会一直停在中间态
        reload();
        setRefreshTick((n) => n + 1);
      }, [reload, setRefreshTick]);
      const { running: runningJobs } = useJobs(onJobFinish);
      const cancelJob = async (id) => {
        try { await postJson(R.jobsCancel, { id }); }
        catch (e) { setActionMsg({ kind: 'error', text: `取消失败：${e?.message || e}` }); }
      };
      // 额度统计：今日页的「额度用尽」与待办共用同一份数据
      useEffect(() => {
        let alive = true;
        fetchJson(R.analysisStats)
          .then((d) => { if (alive) setAnalysisStats(d.stats || null); })
          .catch((e) => { if (alive) setToast({ kind: 'error', text: `额度统计读取失败：${e?.message || e}` }); });
        return () => { alive = false; };
      }, [state?.updated_at]);
      const rerunPaper = async (id, stage) => {
        const label = stage === 'L3' ? '精读' : '初筛';
        setActionMsg({ kind: 'warn', text: `已提交${label}：${id}` });
        try {
          await postJson(R.paperRerun, { id, stage });
          // 进度不在这里报：AI 分析队列会把这条标成「分析中」并排到第一条
          setActionMsg({ kind: 'success', text: `已提交${label}：${id}（进度见「AI 分析」队列）` });
          setTimeout(reload, 1500);
        } catch (e) {
          setActionMsg({ kind: 'error', text: `重跑失败（/paper/rerun）：${e?.message || e}` });
        }
      };

      const noKeywords = !(config?.relevance?.keywords || []).length
        && !(config?.relevance?.contextKeywords || []).length;

      // 页面间跳转：今日的四数卡可以带筛选跳到待办
      const navigate = (id, opts) => {
        if (id === 'reading') setReadingPref(['read', 'cards', 'zotero'].includes(opts?.reading) ? opts.reading : 'unread');
        if (opts) setQueuePref(opts);
        setTab(id);
      };

      // 页头状态行：任何页面都能看到「有多少活、上次什么时候采到的」。
      // 计数与待办页段按钮共用 queueCounts，避免同屏出现两个数字。
      const headerTotals = queueCounts(state);
      const headerLastOk = Object.values(state?.sources || {})
        .map((item) => item?.last_ok_at).filter(Boolean).sort().pop() || null;
      const headerStatus = state
        ? [
          `待处理 ${headerTotals.todo} 件`,
          headerTotals.paused ? `暂停 ${headerTotals.paused} 条` : null,
          `已完成 ${headerTotals.done} 篇`,
          headerLastOk ? `上次采集 ${headerAgo(headerLastOk)}` : '还没采集过',
        ].filter(Boolean).join(' · ')
        : '正在读取状态…';

      // 页签顺序按流程排：采集（雷达）→ 处理（待办）→ 阅读 → 设置；总览是入口
      const tabs = [
        { id: 'overview', label: t('tab.overview', '总览') },
        { id: 'sources', label: t('tab.sources', '雷达') },
        {
          id: 'pipeline',
          label: t('tab.pipeline', 'AI 分析'),
          // 徽标 = 待处理段里真实会看到的条数（候选未判读 + 三档论文），不含被过滤的噪音
          count: headerTotals.todo,
        },
        { id: 'reading', label: t('tab.reading', '阅读') },
        { id: 'settings', label: t('tab.settings', '设置') },
      ];

      let body;
      if (error && !state) body = h(Notice, { kind: 'error' }, `连不上插件服务：${error}（确认 DSH 在运行，然后重试）`);
      else if (!state) body = h(PageSkeleton);
      else if (tab === 'sources') body = h(Radar, {
        state, config, saveConfig: api.saveConfig, runDiscover: api.runDiscover, reload, navigate, setTab, refreshTick,
      });
      else if (tab === 'pipeline') body = h(Queue, {
        state,
        reload,
        loadMore,
        busy,
        config,
        saveConfig: api.saveConfig,
        onOverride: overridePaper,
        onRerun: rerunPaper,
        onOpenUrl: openUrl,
        openPaper: (id) => openPaperAt(id, 'judge'),
        openPaperCard: (id) => openPaperAt(id, 'card'),
        seg: queueSeg,
        setSeg: setQueueSeg,
        pref: queuePref,
        navigate,
      });
      else if (tab === 'reading') body = h(ReadingPage, {
        state,
        config,
        loadMore,
        busy,
        onOverride: overridePaper,
        onRerun: rerunPaper,
        onOpenUrl: openUrl,
        openPaper: (id) => openPaperAt(id, 'judge'),
        openPaperCard: (id) => openPaperAt(id, 'card'),
        onOpenPdf: openPdf,
        onMarkRead: api.markPaperRead,
        onTranslate: api.translatePaper,
        initial: readingPref,
        navigate,
      });
      else if (tab === 'settings') body = h(Settings, {
        config,
        error,
        reload,
        busy,
        saveConfig: api.saveConfig,
        saveCredential,
        saveEasyScholarKey,
        saveInstitutionalCookie,
        testAccess,
        hasApiKey,
        hasEasyScholarKey,
        hasInstitutionalCookie,
        runDiscover: api.runDiscover,
        zoteroStatus: state?.zotero || null,
        navigate,
        refreshTick,
      });
      else body = h(Overview, {
        state,
        config,
        busy,
        runDiscover: api.runDiscover,
        openPaper: (id) => openPaperAt(id, 'judge'),
        openPaperCard: (id) => openPaperAt(id, 'card'),
        onOpenPdf: openPdf,
        onMarkRead: api.markPaperRead,
        onTranslate: api.translatePaper,
        onRerun: rerunPaper,
        onOpenUrl: openUrl,
        navigate,
        analysisStats,
      });

      const fontScale = Number(config?.ui?.fontScale) || 1;
      return h('div', {
        style: {
          '--lab-font-scale': fontScale,
          height: '100%', minHeight: 0, display: 'flex', flexDirection: 'column',
          overflow: 'hidden',
          color: C.label1, fontSize: fs(15), lineHeight: 1.6,
        },
      },
        h('div', {
          style: {
            flex: 'none', boxSizing: 'border-box',
            padding: 'clamp(14px, 3vw, 22px) clamp(14px, 3vw, 28px) 0',
          },
        }, h('div', { style: { maxWidth: 1200, margin: '0 auto' } },
          h(PageHeader, {
            title: '文献实验室',
            status: headerStatus,
            actions: [
              // 页头只放全局动作：任务状态与刷新。添加论文属于采集，放在雷达页的采集栏。
              h(JobBadge, { key: 'jobs', running: runningJobs, onCancel: cancelJob }),
              h(Button, {
                key: 'reload',
                size: 'sm',
                onClick: () => { setRefreshTick((n) => n + 1); reload(); },
                disabled: busy,
              }, '刷新'),
            ],
          }),
          error && state ? h(Notice, { kind: 'error' }, error) : null,
          // 服务端代码在 DSH 启动时加载：改了 lib/ 后刷新页面不会生效，必须完全重启
          state?.build?.stale
            ? h(Notice, { kind: 'warn' }, '服务端代码已更新：完全退出并重新打开 DSH 后生效（刷新页面不会重载服务端）。')
            : null,
          actionMsg ? h(Notice, { kind: actionMsg.kind }, actionMsg.text) : null,
          config && noKeywords && tab !== 'overview'
            ? h(Notice, { kind: 'warn' },
              h('div', { style: { display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' } },
                h('span', null, '还没有设置关注关键词：现在会把抓到的条目全部放进候选池。'),
                h(Button, { size: 'sm', onClick: () => navigate('sources') }, '去设置研究兴趣')))
            : null,
          // 点页签直接进队列＝清掉跳转意图，队列按默认视图（待处理）打开
          h(TabBar, {
            tabs, active: tab, onChange: (next) => { setQueuePref(null); setTab(next); },
          }))),
        h('div', {
          style: {
            flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'hidden',
            boxSizing: 'border-box',
            padding: '0 clamp(14px, 3vw, 28px) 40px',
          },
        }, h('div', { style: { maxWidth: 1200, margin: '0 auto' } },
          body,
          h(Toast, { toast, onClose: () => setToast(null) }))),
        openPaper
          ? h(PaperDrawer, {
            paperId: openPaper,
            initialTab: openPaperTab,
            onClose: () => setOpenPaper(null),
            onOverride: overridePaper,
            onRerun: rerunPaper,
            onUpload: uploadPaperPdf,
            onOpenPdf: openPdf,
            onChanged: reload,
          })
          : null,
      );
    }

    function TabBar({ tabs, active, onChange }) {
      // 窄屏时横向滚动而不是换行；方向键在页签间移动（焦点跟随）
      const move = (delta, event) => {
        const index = tabs.findIndex((t) => t.id === active);
        if (index < 0) return;
        event.preventDefault();
        onChange(tabs[(index + delta + tabs.length) % tabs.length].id);
      };
      return h('div', {
        role: 'tablist',
        style: {
          display: 'flex', gap: 28, alignItems: 'flex-end',
          borderBottom: `1px solid ${C.border2}`, marginBottom: 24, paddingLeft: 2,
          overflowX: 'auto', overflowY: 'hidden', flexWrap: 'nowrap',
        },
      }, tabs.map((t) => {
        const on = t.id === active;
        return h('button', {
          key: t.id, type: 'button', onClick: () => onChange(t.id),
          role: 'tab', 'aria-selected': on,
          onKeyDown: (e) => {
            if (e.key === 'ArrowRight') move(1, e);
            if (e.key === 'ArrowLeft') move(-1, e);
          },
          style: {
            appearance: 'none', background: 'none', border: 'none',
            borderBottom: on ? `2px solid ${C.accent}` : '2px solid transparent',
            marginBottom: -1, padding: '0 2px 10px', cursor: 'pointer',
            fontSize: fs(15), fontFamily: 'inherit',
            color: on ? C.accent : C.label3, fontWeight: on ? 500 : 400,
            transition: 'color .15s',
          },
          onMouseEnter: (e) => { if (!on) e.currentTarget.style.color = C.label2; },
          onMouseLeave: (e) => { if (!on) e.currentTarget.style.color = C.label3; },
          'aria-current': on ? 'page' : undefined,
        }, t.label, t.count > 0
          ? h('span', {
            style: {
              marginLeft: 6, fontSize: fs(12), padding: '1px 5px', borderRadius: 8,
              background: C.border1, color: C.label2, fontWeight: 400,
            },
          }, t.count) : null);
      }));
    }

    return {
      inject: ['slots'],
      // 口径纯函数的测试出口：不经过渲染也能验收（test/pipeline-board.test.mjs）。
      // 宿主只用 inject / apply，多一个键不会改变插件契约。
      board: { classifyQueueEntry, pipelineBoard, formatQuota, nextRunLabel, sortHumanEntries, sortAiEntries },
      apply(ctx) {
        // 1) 先注册入口：无论后面发生什么，侧栏与主面板都必须存在。
        // 注册失败会让插件在侧栏"悄悄消失"，所以失败必须留痕（桌面端日志会收 console）。
        try {
          ctx.slots.inject('main', () => ctx.slots.register(
            { name: 'main', key: PLUGIN_ID, inject: () => ({ workbench: true }) },
            function LiteratureLabPanel() { return h(ErrorBoundary, null, h(Workbench)); },
          ));
          ctx.slots.inject('sidebar.panellist', () => ctx.slots.register(
            { name: 'sidebar.panellist', id: PLUGIN_ID, order: 30, label: '文献实验室' },
            function LitLabIcon({ size }) { return h(LabIcon, { size }); },
          ));
        } catch (error) {
          console.error('[literature-lab] 客户端入口注册失败：', error);
          throw error;
        }
        // 2) 再装本地化：这一步失败只意味着界面保持中文，绝不能影响入口
        try {
          const disposeLocale = installLocale(ctx);
          if (disposeLocale && typeof ctx.effect === 'function') {
            ctx.effect(() => disposeLocale);
          }
        } catch {
          // 宿主没有 locale 服务或版本不兼容，保持中文即可
        }
      },
    };
  },
});
