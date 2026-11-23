    /** 遮罩对话框：Esc 关闭、点遮罩关闭、role=dialog。 */
    function Dialog({ title, children, footer, onClose, width = 460 }) {
      useEffect(() => {
        if (typeof document === 'undefined' || !document.addEventListener) return undefined;
        const onKey = (e) => { if (e.key === 'Escape') onClose(); };
        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
      }, [onClose]);
      return h('div', {
        style: {
          position: 'fixed', inset: 0, zIndex: 1000, display: 'flex',
          alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,.32)',
        },
        onMouseDown: (e) => { if (e.target === e.currentTarget) onClose(); },
      }, h('div', {
        role: 'dialog', 'aria-modal': 'true', 'aria-label': title,
        style: {
          width, maxWidth: 'calc(100vw - 32px)', maxHeight: 'calc(100vh - 48px)', overflowY: 'auto',
          background: C.bg1, border: `1px solid ${C.border2}`, borderRadius: 12,
          padding: '18px 20px', boxShadow: '0 12px 40px rgba(0,0,0,.28)',
        },
      },
        h('div', { style: { display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 12 } },
          h('div', { style: { flex: 1, fontSize: fs(16), fontWeight: 600, color: C.label1 } }, title),
          h('button', {
            type: 'button', 'aria-label': '关闭', onClick: onClose,
            style: {
              appearance: 'none', border: 'none', background: 'none', cursor: 'pointer',
              color: C.label3, fontSize: fs(19), lineHeight: 1, padding: 2,
            },
          }, '×')),
        children,
        footer ? h('div', { style: { display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 18 } }, footer) : null,
      ));
    }

    /** 二次确认对话框。 */
    function ConfirmDialog({ title, text, confirmLabel = '确定', danger, onClose, onConfirm }) {
      return h(Dialog, {
        title, onClose,
        footer: [
          h(Button, { key: 'cancel', onClick: onClose }, '取消'),
          h(Button, { key: 'ok', primary: true, danger, onClick: onConfirm }, confirmLabel),
        ],
      }, h('div', { style: { fontSize: fs(14), color: C.label2, lineHeight: 1.7 } }, text));
    }

    /** 改判：等级 + 阶段 + 必填依据；前端先做等级/同域性自洽校验。 */
    function OverrideDialog({ paper, onClose, onSubmit }) {
      const [grade, setGrade] = useState(paper.grade || 'B');
      const [stage, setStage] = useState(paper.stage || 'L2');
      const [reason, setReason] = useState('');
      const [busy, setBusy] = useState(false);
      const [error, setError] = useState(null);
      const domain = paper.l1?.domain || null;
      const conflict = (() => {
        if (!domain) return null;
        if (grade === 'S' && domain !== 'core') return 'S 只能给「本领域核心」';
        if (grade === 'A' && domain !== 'core' && domain !== 'edge') return 'A 只能给「本领域核心」或「相关领域」';
        if (domain === 'irrelevant' && grade !== 'D') return '「无关」的论文只能给 D';
        return null;
      })();
      const tooShort = reason.trim().length < 6;
      const disabled = busy || tooShort || Boolean(conflict);
      const submit = async () => {
        if (disabled) return;
        setBusy(true);
        setError(null);
        try {
          await onSubmit({ grade, stage, reason: reason.trim() });
          onClose();
        } catch (e) {
          setError(String(e?.message || e));
        } finally { setBusy(false); }
      };
      return h(Dialog, {
        title: '改判', onClose, width: 540,
        footer: [
          h(Button, { key: 'cancel', onClick: onClose }, '取消'),
          h(Button, { key: 'ok', primary: true, disabled, onClick: submit }, busy ? '提交中…' : '确定'),
        ],
      },
        h('div', { style: { fontSize: fs(13), color: C.caption, marginBottom: 12 } },
          `当前：${paper.stage || '—'} · 等级 ${paper.grade || '—'}${domain ? ` · 领域 ${DOMAIN_LABEL[domain] || domain}` : ''}`),
        h(Field, { label: '新等级' },
          h('div', { style: { display: 'flex', gap: 6, alignItems: 'center' } },
            ['S', 'A', 'B', 'C', 'D'].map((g) => h(Button, {
              key: g, size: 'sm', primary: grade === g, onClick: () => setGrade(g),
            }, `${g} ${g === 'S' ? '必读' : g === 'A' ? '重要' : g === 'B' ? '有用' : g === 'C' ? '背景' : '无增量'}`)))),
        h(Field, { label: '新阶段' },
          h('select', {
            value: stage, 'aria-label': '新阶段',
            onChange: (e) => setStage(e.target.value),
            style: {
              fontSize: fs(13.5), padding: '5px 9px', borderRadius: 5,
              border: `1px solid ${C.border2}`, background: C.bg1, color: C.label1,
            },
          }, ['L1', 'L2', 'L3', 'done', 'dropped'].map((st) => h('option', { key: st, value: st }, STAGE_NAME[st] || st)))),
        h(Field, {
          label: '依据（必填，≥6 字）',
          hint: conflict || (tooShort && reason ? '再多写几个字，说明相对什么证据' : '写清是基于摘要、初筛还是全文的什么证据'),
        },
          h('textarea', {
            value: reason, rows: 3,
            'aria-label': '改判依据',
            'aria-invalid': Boolean(conflict || (tooShort && reason.length > 0)),
            onChange: (e) => setReason(e.target.value),
            style: {
              width: '100%', fontSize: fs(13.5), padding: 8, borderRadius: 5,
              border: `1px solid ${conflict ? C.error : C.border2}`, background: C.bg1,
              color: C.label1, boxSizing: 'border-box', fontFamily: 'inherit',
            },
          })),
        error ? h(Notice, { kind: 'error' }, error) : null,
      );
    }

