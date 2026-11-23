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
