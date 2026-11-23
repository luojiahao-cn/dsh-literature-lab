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
