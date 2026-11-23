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

