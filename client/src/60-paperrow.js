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

