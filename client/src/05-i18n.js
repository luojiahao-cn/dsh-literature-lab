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
