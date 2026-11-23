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
