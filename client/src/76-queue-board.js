    // ── 队列概况表（页首唯一计数来源）─────────────────────────
    // 数据全部来自 pipelineBoard()，这张卡不自己数字；口径见 03-board.js。
    const BOARD_GRID = {
      display: 'grid',
      gridTemplateColumns: 'minmax(200px, 1.4fr) 56px 100px 124px 100px minmax(120px, 1fr)',
      columnGap: 12,
      alignItems: 'center',
    };
    const BOARD_TH = {
      fontSize: fs(12.5), color: C.caption, paddingBottom: 2,
    };
    const BOARD_STAGE_NAME = { fontSize: fs(13.5), fontWeight: 600, color: C.label1, lineHeight: 1.35 };
    const BOARD_STAGE_DESC = { fontSize: fs(12), color: C.caption, lineHeight: 1.4 };
    const BOARD_NUM = { fontSize: fs(15), fontWeight: 600, fontVariantNumeric: 'tabular-nums', lineHeight: 1.2 };
    const BOARD_NUM_ZERO = { ...BOARD_NUM, color: C.caption, fontWeight: 500 };
    const BOARD_QUOTA = { fontSize: fs(13.5), fontWeight: 500, color: C.label2, fontVariantNumeric: 'tabular-nums' };
    const BOARD_ROW = { ...BOARD_GRID, minHeight: 36, padding: '4px 0', borderTop: `1px solid ${C.border1}` };
    const BOARD_NOTE = { fontSize: fs(12.5), lineHeight: 1.6, color: C.caption };

    /** 处理方：三种取值对应人工、自动、混合；空行为不计。 */
    function boardOwnerChip(owner) {
      if (owner === 'auto') return h(Chip, { tone: C.accent }, '自动');
      if (owner === 'human') return h(Chip, { tone: C.warn }, '人工');
      if (owner === 'both') return h(Chip, null, '人工 + 自动');
      return h('span', { style: { fontSize: fs(12), color: C.caption } }, '—');
    }

    /** 积压分布：4px 双色条，人工占比在前；没有条目时不画。 */
    function boardBar(row) {
      const total = row.queued || 0;
      if (!total) return h('span', { style: { display: 'block', height: 4 } });
      const human = row.queued ? Math.min(1, row.human / row.queued) : 0;
      const width = (ratio) => `${Math.max(ratio > 0 ? 2 : 0, Math.round(ratio * 100))}%`;
      return h('span', {
        style: {
          display: 'flex', height: 4, borderRadius: 2, overflow: 'hidden', background: C.bg2,
        },
        title: `人工 ${row.human} · 自动 ${row.auto} · 排队 ${row.queued}`,
      },
        human > 0 ? h('i', { style: { display: 'block', height: '100%', width: width(human), background: C.warn } }) : null,
        row.auto > 0 ? h('i', { style: { display: 'block', height: '100%', width: width(1 - human), background: C.accent } }) : null);
    }

    /** 计数口径：默认折叠，避免占掉首屏。 */
    const BOARD_METHOD = [
      '待判读为候选尚未得到结论；待确认为 AI 建议暂缓；待初筛、待精读为论文当前阶段；待推进为旧版阶段。',
      '需要人处理是排队的子集：缺摘要、缺原文、原文解析失败、判读失败、低置信、待确认与旧版阶段。',
      '一条只计一行，也只进一个框；两个框的条目数之和等于合计。',
      '暂停中、已完成、已排除与已过滤不计入；候选转为论文后只按论文计。',
      '搜索、排序与点击表格数字只影响两个框的可见行；上表始终为全量。',
    ];

    /**
     * 概况表：阶段 / 排队 / 需要人处理 / 今日额度 / 处理方 / 积压分布。
     * 数字只读（下钻在第三步接入）；table 之外的旧结构保持不动。
     */
    function QueueBoardCard({ board, auto, onDownload, onToggleAuto, downloadBusy, onFocusRow, onLoadMore, loadMoreBusy }) {
      const nextRun = board?.nextRun;
      const statusText = !auto
        ? '自动处理已关闭 · 需手动运行'
        : nextRun && nextRun.text !== '时间未设置'
          ? `自动处理已开启 · 下次运行 ${nextRun.text}`
          : '自动处理已开启 · 时间未设置';
      const total = board?.total || { queued: 0, human: 0, auto: 0, truncated: false };
      const paused = Number(board?.paused) || 0;
      const rows = board?.rows || [];
      const quotaPdf = board?.pdfQuota || null;

      const notes = [
        '合计 = 需要人处理 + AI 队列；两个框的条目数与此一致，一条只落一行。',
        paused ? `排队不含暂停中的 ${paused} 条，暂停到期后自动回到队列。` : null,
        quotaPdf ? `原文下载 今日 ${quotaPdf.used} / ${quotaPdf.limit || '不限'} · 下载可用原文` : null,
        total.truncated ? `统计范围：已加载 ${total.loaded} / 共 ${total.queued} 条` : null,
      ].filter(Boolean);

      return h(Card, { id: 'queue-board', style: { marginBottom: T.space.md } },
        h('div', { style: { display: 'flex', alignItems: 'center', gap: T.space.xs, flexWrap: 'wrap', minHeight: 26 } },
          h('span', { style: { fontSize: fs(16), fontWeight: 600, color: C.label1 } }, '队列概况'),
          h('span', { style: { fontSize: fs(12.5), color: C.caption } }, statusText),
          h('div', { style: { marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: T.space.xs } },
            h(Menu, {
              label: '⋯',
              items: [
                { key: 'dl', label: downloadBusy ? '正在下载原文…' : '下载可用原文', disabled: downloadBusy, onClick: onDownload },
                { key: 'auto', label: `自动判读：${auto ? '已开启' : '已关闭'}`, active: auto, onClick: onToggleAuto },
              ],
            }))),

        h('div', { style: { ...BOARD_GRID, marginTop: 10 } },
          h('div', { style: BOARD_TH }, '阶段'),
          h('div', { style: { ...BOARD_TH, textAlign: 'right' } }, '排队'),
          h('div', { style: { ...BOARD_TH, textAlign: 'right' } }, '需要人处理'),
          h('div', { style: { ...BOARD_TH, textAlign: 'right' } }, '今日额度'),
          h('div', { style: BOARD_TH }, '处理方'),
          h('div', { style: BOARD_TH }, '积压分布')),

        rows.map((row) => h('div', { key: row.key, style: BOARD_ROW },
          h('div', { style: { display: 'flex', flexDirection: 'column', gap: 1 } },
            h('span', { style: BOARD_STAGE_NAME }, row.label),
            h('span', { style: BOARD_STAGE_DESC }, row.desc)),
          h('div', {
            style: { textAlign: 'right' },
            role: typeof onFocusRow === 'function' ? 'button' : undefined,
            tabIndex: typeof onFocusRow === 'function' ? 0 : undefined,
            title: typeof onFocusRow === 'function' ? `只看${row.label}` : undefined,
            onClick: typeof onFocusRow === 'function' ? () => onFocusRow(row.key) : undefined,
            onKeyDown: typeof onFocusRow === 'function'
              ? (e) => { if (e.key === 'Enter') { e.preventDefault(); onFocusRow(row.key); } }
              : undefined,
          },
            h('span', { style: row.queued ? BOARD_NUM : BOARD_NUM_ZERO }, `${row.queued}${row.truncated ? '+' : ''}`)),
          h('div', {
            style: { textAlign: 'right' },
            role: typeof onFocusRow === 'function' ? 'button' : undefined,
            tabIndex: typeof onFocusRow === 'function' ? 0 : undefined,
            title: typeof onFocusRow === 'function' ? `只看${row.label}` : undefined,
            onClick: typeof onFocusRow === 'function' ? () => onFocusRow(row.key) : undefined,
            onKeyDown: typeof onFocusRow === 'function'
              ? (e) => { if (e.key === 'Enter') { e.preventDefault(); onFocusRow(row.key); } }
              : undefined,
          },
            h('span', {
              style: row.human ? { ...BOARD_NUM, color: C.warn } : BOARD_NUM_ZERO,
            }, `${row.human}${row.truncated ? '+' : ''}`)),
          h('div', { style: { textAlign: 'right' } },
            row.quota
              ? h('span', {
                style: row.quota.tone === 'error' ? { ...BOARD_QUOTA, color: C.error } : row.quota.tone === 'off' ? { ...BOARD_QUOTA, color: C.caption } : BOARD_QUOTA,
              }, row.quota.text)
              : h('span', { style: { ...BOARD_QUOTA, color: C.caption } }, '—')),
          h('div', null, boardOwnerChip(row.owner)),
          h('div', null, boardBar(row)))),

        h('div', { style: { ...BOARD_GRID, minHeight: 34, borderTop: `1px solid ${C.border2}`, background: C.bg2, margin: '0 -18px', padding: '0 18px' } },
          h('div', { style: { fontSize: fs(13), fontWeight: 600 } }, '合计'),
          h('div', { style: { fontSize: fs(14), fontWeight: 600, textAlign: 'right', fontVariantNumeric: 'tabular-nums' } }, `${total.queued}${total.truncated ? '+' : ''}`),
          h('div', { style: { fontSize: fs(14), fontWeight: 600, textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: total.human ? C.warn : C.caption } }, `${total.human}${total.truncated ? '+' : ''}`),
          h('div', { style: { fontSize: fs(13), fontWeight: 600, textAlign: 'right', color: C.caption } }, '—'),
          h('div', { style: { fontSize: fs(13), fontWeight: 500, color: C.label2 } }, `人工 ${total.human} · 自动 ${total.auto}`),
          h('div', null)),

        h('div', { style: { marginTop: 10, display: 'flex', flexDirection: 'column', gap: 1 } },
          notes.map((note, index) => h('div', { key: `note-${index}`, style: BOARD_NOTE }, note)),
          total.truncated && typeof onLoadMore === 'function'
            ? h('div', { style: { marginTop: 2 } }, h(Button, {
              size: 'sm',
              disabled: Boolean(loadMoreBusy),
              onClick: onLoadMore,
            }, loadMoreBusy ? '正在加载…' : '加载更多'))
            : null,
          h('details', { style: { ...BOARD_NOTE, marginTop: 1 } },
            h('summary', { style: { cursor: 'pointer', color: C.label2 } }, '计数口径'),
            BOARD_METHOD.map((line, index) => h('div', { key: `method-${index}`, style: { paddingLeft: 2 } }, line)))));
    }
