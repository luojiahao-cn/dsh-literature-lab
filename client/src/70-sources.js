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
