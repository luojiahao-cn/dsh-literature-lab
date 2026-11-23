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
