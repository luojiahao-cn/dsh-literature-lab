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

