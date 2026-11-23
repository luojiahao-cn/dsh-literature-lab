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
