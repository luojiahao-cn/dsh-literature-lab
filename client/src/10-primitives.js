    // ── 通用控件（自己实现，不依赖 host 内部组件）──────────────
    /**
     * 图标按钮：方形、只有图标，名字必须通过 aria-label + title 保留，
     * 否则读屏与悬停都拿不到这按钮是干什么的。
     */
    function IconButton({ children, label, onClick, active, disabled, expanded, subtle }) {
      const [hover, setHover] = useState(false);
      return h('button', {
        type: 'button',
        'aria-label': label,
        'aria-pressed': expanded !== undefined
          ? undefined
          : (active === undefined ? undefined : Boolean(active)),
        'aria-expanded': expanded === undefined ? undefined : Boolean(expanded),
        title: label,
        disabled: Boolean(disabled),
        onClick: disabled ? undefined : onClick,
        onMouseEnter: () => setHover(true),
        onMouseLeave: () => setHover(false),
        ...FOCUS_RING,
        style: {
          appearance: 'none', display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          width: 26, height: 26, padding: 0, borderRadius: 6, flexShrink: 0,
          cursor: disabled ? 'not-allowed' : 'pointer',
          border: `1px solid ${subtle ? 'transparent' : (active ? C.accent : C.border2)}`,
          background: hover && !disabled ? C.hover : 'transparent',
          color: active ? (subtle ? C.label1 : C.accent) : (subtle ? C.label3 : C.label2),
          opacity: disabled ? 0.5 : 1,
          transition: 'background .15s, color .15s',
        },
      }, children);
    }

    /** 焦点环：键盘可见；用 outline 避免改布局。 */
    const FOCUS_RING = {
      onFocus: (e) => { e.currentTarget.style.outline = `2px solid ${C.accent}`; e.currentTarget.style.outlineOffset = '1px'; },
      onBlur: (e) => { e.currentTarget.style.outline = 'none'; },
    };

    function Button({ children, onClick, primary, danger, disabled, size = 'md', label }) {
      const [hover, setHover] = useState(false);
      // 破坏性主按钮：实心红；其余 danger 仍是红字按钮（与现有删除入口一致）。
      const filledDanger = Boolean(primary && danger);
      const base = {
        appearance: 'none', cursor: disabled ? 'not-allowed' : 'pointer',
        fontFamily: 'inherit', fontWeight: 500,
        fontSize: fs(size === 'sm' ? 12 : 13),
        padding: size === 'sm' ? '3px 9px' : '6px 13px',
        borderRadius: 6,
        border: `1px solid ${primary ? 'transparent' : C.border2}`,
        background: primary ? (danger ? C.error : C.accent) : (hover && !disabled ? C.hover : 'transparent'),
        color: primary ? C.onColor : (danger ? C.error : C.label2),
        filter: filledDanger && hover && !disabled ? 'brightness(.92)' : 'none',
        opacity: disabled ? 0.5 : 1,
        transition: 'background .15s, color .15s, filter .15s',
      };
      return h('button', {
        type: 'button', onClick: disabled ? undefined : onClick, style: base,
        'aria-label': label || undefined,
        disabled: Boolean(disabled),
        onMouseEnter: () => setHover(true),
        onMouseLeave: () => setHover(false),
        ...FOCUS_RING,
      }, children);
    }

    function TextInput({ value, onChange, placeholder, mono, width, type = 'text', label, inputId, onBlur, onKeyDown }) {
      return h('input', {
        type, value: value || '', placeholder: placeholder || '',
        id: inputId || undefined,
        'aria-label': label || placeholder || undefined,
        onChange: (e) => onChange(e.target.value),
        onKeyDown,
        ...FOCUS_RING,
        // 展开必须在前面，再叠加调用方自己的处理器，否则会被 FOCUS_RING 覆盖
        onFocus: (e) => FOCUS_RING.onFocus(e),
        onBlur: (e) => { FOCUS_RING.onBlur(e); if (typeof onBlur === 'function') onBlur(e); },
        style: {
          fontFamily: mono ? FONT_MONO : 'inherit', fontSize: fs(13.5),
          padding: '5px 9px', borderRadius: 5,
          border: `1px solid ${C.border2}`, background: C.bg1,
          color: C.label1, outline: 'none', width: width || '100%',
          boxSizing: 'border-box',
        },
      });
    }

    /**
     * 数字输入：编辑期用草稿文本，失焦或回车才提交。
     * 原生 number 清空会立刻变成 0，导致「删不掉、只能一位位加」；
     * 需要时给 −/+ 步进，比小箭头好点。
     */
    function NumberInput({ value, onChange, min, max, width = 76, label, stepper = false, step = 1 }) {
      const clampValue = (n) => {
        let next = n;
        if (Number.isFinite(Number(min))) next = Math.max(Number(min), next);
        if (Number.isFinite(Number(max))) next = Math.min(Number(max), next);
        return next;
      };
      const [draft, setDraft] = useState(String(value ?? 0));
      const [focused, setFocused] = useState(false);
      useEffect(() => {
        if (!focused) setDraft(String(value ?? 0));
      }, [value, focused]);
      const commit = (raw) => {
        const parsed = Number(String(raw).trim());
        const next = Number.isFinite(parsed) ? clampValue(parsed) : (Number(value) || 0);
        setDraft(String(next));
        if (next !== value) onChange(next);
      };
      const bump = (delta) => {
        const base = Number(draft);
        const next = clampValue((Number.isFinite(base) ? base : 0) + delta);
        setDraft(String(next));
        onChange(next);
      };
      const input = h('input', {
        type: 'text', inputMode: 'numeric', value: draft,
        'aria-label': label || undefined,
        onFocus: () => setFocused(true),
        onBlur: () => { setFocused(false); commit(draft); },
        onChange: (e) => setDraft(e.target.value),
        onKeyDown: (e) => {
          if (e.key === 'Enter') { e.preventDefault(); e.currentTarget?.blur?.(); }
          if (e.key === 'ArrowUp') { e.preventDefault(); bump(step); }
          if (e.key === 'ArrowDown') { e.preventDefault(); bump(-step); }
        },
        ...FOCUS_RING,
        style: {
          fontFamily: FONT_MONO, fontSize: fs(13.5), padding: '5px 8px',
          borderRadius: 5, border: `1px solid ${C.border2}`,
          background: C.bg1, color: C.label1, outline: 'none',
          width, boxSizing: 'border-box', textAlign: 'center',
        },
      });
      if (!stepper) return input;
      return h('div', { style: { display: 'inline-flex', alignItems: 'center', gap: T.space.xs } },
        h(Button, { size: 'sm', label: `${label || '数值'}减一`, onClick: () => bump(-step) }, '−'),
        input,
        h(Button, { size: 'sm', label: `${label || '数值'}加一`, onClick: () => bump(step) }, '+'));
    }

    function Switch({ checked, onChange, label, ariaLabel }) {
      return h('label', {
        style: { display: 'inline-flex', alignItems: 'center', gap: 7, cursor: 'pointer', fontSize: fs(13.5) },
      },
        h('button', {
          type: 'button', role: 'switch', 'aria-checked': Boolean(checked),
          'aria-label': ariaLabel || undefined,
          title: ariaLabel || undefined,
          onClick: () => onChange(!checked),
          style: {
            appearance: 'none', cursor: 'pointer',
            width: 32, height: 18, borderRadius: 9, padding: 0,
            border: `1px solid ${checked ? C.accent : C.border2}`,
            background: checked ? C.accent : C.border1,
            position: 'relative', transition: 'background .15s',
          },
        },
          h('span', {
            style: {
              position: 'absolute', top: 1.5, left: checked ? 15 : 1.5,
              width: 13, height: 13, borderRadius: '50%',
              background: C.onColor, transition: 'left .15s',
            },
          }),
        ),
        label ? h('span', { style: { color: C.label2 } }, label) : null,
      );
    }

    /**
     * 下拉菜单：一个按钮 + 浮层条目。点条目或点浮层外关闭。
     * 条目 = { key, label, active, disabled, onClick }。
     * 工具条上的低频动作收进这里，避免一排并列按钮把页面压满。
     */
    function Menu({ label, items, primary, disabled }) {
      const [open, setOpen] = useState(false);
      useEffect(() => {
        if (!open) return undefined;
        if (typeof document === 'undefined' || !document.addEventListener) return undefined;
        const onDown = (event) => {
          const target = event?.target;
          if (target && typeof target.closest === 'function' && target.closest('[data-litlab-menu]')) return;
          setOpen(false);
        };
        document.addEventListener('mousedown', onDown);
        return () => document.removeEventListener('mousedown', onDown);
      }, [open]);
      const list = (items || []).filter(Boolean);
      return h('div', { 'data-litlab-menu': '1', style: { position: 'relative', display: 'inline-flex' } },
        h(Button, {
          size: 'sm',
          primary,
          disabled,
          label: typeof label === 'string' ? label : undefined,
          onClick: () => setOpen((value) => !value),
        }, label),
        open
          ? h('div', {
            role: 'menu',
            style: {
              position: 'absolute', top: 'calc(100% + 4px)', left: 0, zIndex: 950,
              minWidth: 176, padding: 4, display: 'grid', gap: 2,
              background: C.bg1, border: `1px solid ${C.border2}`, borderRadius: T.radius.sm,
              boxShadow: '0 8px 24px rgba(0,0,0,.22)',
            },
          }, list.map((item) => h('button', {
            key: item.key || item.label,
            type: 'button',
            role: 'menuitem',
            disabled: Boolean(item.disabled),
            onClick: () => {
              if (item.disabled) return;
              setOpen(false);
              if (typeof item.onClick === 'function') item.onClick();
            },
            style: {
              appearance: 'none', textAlign: 'left',
              cursor: item.disabled ? 'not-allowed' : 'pointer',
              fontFamily: 'inherit', fontSize: fs(T.font.hint),
              padding: '5px 8px', borderRadius: 4, border: 'none',
              background: item.active ? C.hover : 'transparent',
              color: item.disabled ? C.caption : (item.active ? C.accent : C.label2),
              opacity: item.disabled ? 0.55 : 1,
            },
          }, item.label)))
          : null);
    }

    /** 关键词列表：chips + 回车添加；tone 只改底色（accent 核心 / danger 排除）。 */
    function Chips({ items, onChange, placeholder, tone }) {
      const [draft, setDraft] = useState('');
      const [focused, setFocused] = useState(false);
      const [hovered, setHovered] = useState(null);
      const list = items || [];
      const accent = tone === 'accent' ? C.accent : tone === 'danger' ? C.error : null;
      const chipBg = accent ? tint(accent, 8) : tint(C.label1, 5);
      const chipBorder = accent ? tint(accent, 22) : tint(C.label1, 8);
      const chipBorderHover = accent ? tint(accent, 40) : tint(C.label1, 20);
      const add = () => {
        const v = draft.trim();
        if (!v || list.includes(v)) { setDraft(''); return; }
        onChange([...list, v]);
        setDraft('');
      };
      return h('div', {
        onMouseLeave: () => setHovered(null),
        onFocus: () => setFocused(true),
        onBlur: (e) => {
          const next = e?.relatedTarget;
          const box = e?.currentTarget;
          if (next && box && typeof box.contains === 'function' && box.contains(next)) return;
          setFocused(false);
        },
        style: {
          display: 'flex', flexWrap: 'wrap', gap: 5, alignItems: 'center', alignContent: 'center',
          padding: '7px 9px', borderRadius: T.radius.sm, minHeight: 42,
          border: `1px solid ${focused ? (accent || C.accent) : C.border2}`,
          background: tint(C.label1, 4),
          boxShadow: focused ? `0 0 0 3px ${tint(accent || C.accent, 14)}` : 'none',
          transition: 'border-color .15s, box-shadow .15s',
          cursor: 'text',
        },
      },
        list.map((it) => h('span', {
          key: it,
          onMouseEnter: () => setHovered(it),
          style: {
            display: 'inline-flex', alignItems: 'center', gap: 1,
            fontSize: fs(12.5), lineHeight: '18px', padding: '2px 2px 2px 8px', borderRadius: 6,
            background: chipBg, border: `1px solid ${hovered === it ? chipBorderHover : chipBorder}`,
            color: tone === 'danger' ? C.label2 : C.label1, fontFamily: FONT_MONO, whiteSpace: 'nowrap',
            transition: 'border-color .12s, background .12s',
          },
        },
          it,
          h('button', {
            type: 'button', onClick: () => onChange(list.filter((x) => x !== it)),
            'aria-label': `移除 ${it}`,
            style: {
              appearance: 'none', border: 'none', cursor: 'pointer', flexShrink: 0,
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              width: 16, height: 16, padding: 0, borderRadius: 4,
              background: hovered === it ? tint(C.error, 14) : 'transparent',
              color: hovered === it ? C.error : C.label3,
              fontSize: fs(12), lineHeight: 1,
              transition: 'background .12s, color .12s',
            },
          }, '×'),
        )),
        h('input', {
          type: 'text', value: draft,
          placeholder: placeholder || '',
          onChange: (e) => setDraft(e.target.value),
          onKeyDown: (e) => {
            if (e.key === 'Enter') { e.preventDefault(); add(); }
            if (e.key === 'Backspace' && !draft && list.length) onChange(list.slice(0, -1));
          },
          onBlur: add,
          style: {
            flex: 1, minWidth: 120, border: 'none', outline: 'none',
            background: 'transparent', color: C.label1,
            fontSize: fs(13), fontFamily: FONT_MONO, padding: '3px 0',
          },
        }),
      );
    }

    /** 字段：标签 + 可选计数 + 说明 + 控件，计数用等宽数字。 */
    function Field({ label, hint, children, count, right }) {
      return h('div', { style: { marginBottom: T.space.lg } },
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 6, marginBottom: 5, minHeight: 20 } },
          h('div', { style: { fontSize: fs(13), color: C.label1, fontWeight: 600 } }, label),
          count === undefined || count === null
            ? null
            : h('span', {
              style: {
                fontSize: fs(11.5), lineHeight: '16px', padding: '0 6px', borderRadius: 9,
                color: count ? C.label2 : C.label3, background: tint(C.label1, 5),
                fontVariantNumeric: 'tabular-nums',
              },
            }, String(count)),
          right ? h('div', { style: { marginLeft: 'auto' } }, right) : null),
        hint ? h('div', { style: { fontSize: fs(T.font.hint), color: C.caption, marginBottom: 6, lineHeight: T.line.body } }, hint) : null,
        children,
      );
    }

    /**
     * 配置行：标签在左、控件在右，容器变窄时整行折成上下两行。
     * 折行只靠 flex-basis，不读 window.innerWidth——弹窗、预览、分栏里都按容器宽度响应。
     * 标签用主文字色（字段名是正文）；说明挂在控件下方、占满控件宽度，不挤在标签列里。
     */
    function ConfigRow({ label, hint, control, first }) {
      return h('div', {
        style: {
          display: 'flex', alignItems: 'flex-start', flexWrap: 'wrap',
          gap: `${T.space.xs}px ${T.space.lg}px`,
          padding: `${T.space.sm}px 0`,
          borderTop: first ? 'none' : `1px solid ${C.border1}`,
        },
      },
        h('div', { style: { flex: '0 0 128px', minWidth: 96, paddingTop: 2 } },
          h('div', { style: { fontSize: fs(T.font.body), color: C.label1, lineHeight: T.line.tight } }, label)),
        h('div', { style: { flex: '1 1 260px', minWidth: 0 } },
          h('div', {
            style: {
              minHeight: 28, display: 'flex', alignItems: 'center',
              flexWrap: 'wrap', gap: T.space.sm,
            },
          }, control || null),
          hint
            ? h('div', {
              style: {
                fontSize: fs(T.font.hint), color: C.caption, marginTop: T.space.micro, lineHeight: T.line.body,
              },
            }, hint)
            : null));
    }

    /** 可编辑列表的一行：行间细线 + 可选行首开关 + 尾部删除；窄屏自然折行。 */
    function ListRow({ leading, children, onRemove, removeLabel, first }) {
      return h('div', {
        style: {
          display: 'flex', alignItems: 'center', flexWrap: 'wrap',
          gap: T.space.sm, padding: `${T.space.xs + 2}px 0`,
          borderTop: first ? 'none' : `1px solid ${C.border1}`,
        },
      },
        leading || null,
        h('div', {
          style: {
            flex: '1 1 240px', minWidth: 0,
            display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: T.space.sm,
          },
        }, children),
        onRemove
          ? h(Button, { size: 'sm', danger: true, label: removeLabel, onClick: onRemove }, '删除')
          : null);
    }

    /** 只读标签串：把「自动使用研究兴趣词……」从一句灰话变成可核对的词。 */
    function ChipList({ items, empty }) {
      const list = Array.isArray(items) ? items.filter(Boolean) : [];
      if (!list.length) {
        return h('div', {
          style: { fontSize: fs(T.font.hint), color: C.caption, lineHeight: T.line.body },
        }, empty || '暂无');
      }
      return h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: T.space.xs } },
        list.map((text) => h(Chip, { key: text }, text)));
    }

    /** 配置里的空态：一行说明，不放大块虚线框。 */
    function ConfigEmpty({ children }) {
      return h('div', {
        style: {
          fontSize: fs(T.font.hint), color: C.caption,
          lineHeight: T.line.body, padding: `${T.space.xs}px 0`,
        },
      }, children);
    }

    function Card({ children, style }) {
      return h('div', {
        style: {
          border: `1px solid ${C.border2}`, borderRadius: 8,
          background: C.bg1, padding: '16px 18px', ...style,
        },
      }, children);
    }

    function SectionTitle({ children, hint, right }) {
      return h('div', {
        style: { marginBottom: 14, display: 'flex', alignItems: 'flex-start', gap: 10 },
      },
        h('div', { style: { flex: 1 } },
          h('div', { style: { fontSize: fs(16), fontWeight: 600, color: C.label1 } }, children),
          hint ? h('div', { style: { fontSize: fs(13), color: C.caption, marginTop: 4 } }, hint) : null,
        ),
        right || null,
      );
    }

    /**
     * 空态：标题 + 说明 + 1–2 个主行动。数据少的时候它就是页面主体，
     * 所以文字权重要比旧 Empty 高，并且必须给出下一步。
     */
    function EmptyState({ title, desc, hint, actions }) {
      return h('div', {
        style: {
          padding: `${T.space.xl}px ${T.space.lg}px`, textAlign: 'center',
          border: `1px dashed ${C.border2}`, borderRadius: T.radius.sm, background: C.bg1,
        },
      },
        h('div', { style: { fontSize: fs(T.font.body), fontWeight: 600, color: C.label2 } }, title),
        desc
          ? h('div', {
            style: {
              fontSize: fs(T.font.hint), color: C.caption, marginTop: T.space.xs,
              lineHeight: T.line.body, maxWidth: 460, marginLeft: 'auto', marginRight: 'auto',
            },
          }, desc)
          : null,
        hint ? h('div', { style: { fontSize: fs(T.font.hint), color: C.caption, marginTop: T.space.xs } }, hint) : null,
        actions && actions.filter(Boolean).length
          ? h('div', { style: { display: 'flex', gap: T.space.sm, justifyContent: 'center', flexWrap: 'wrap', marginTop: T.space.md } },
            actions.filter(Boolean))
          : null);
    }

    /** 统计格：一个数字 + 名字，可选可点。用来给低数据量页面一个「存量」可看。 */
    function StatTile({ label, value, hint, onClick }) {
      const clickable = typeof onClick === 'function';
      const [hover, setHover] = useState(false);
      return h(clickable ? 'button' : 'div', {
        type: clickable ? 'button' : undefined,
        onClick: clickable ? onClick : undefined,
        onMouseEnter: () => setHover(true),
        onMouseLeave: () => setHover(false),
        ...(clickable ? { ...FOCUS_RING, 'aria-label': `${label} ${value}` } : {}),
        style: {
          appearance: 'none', textAlign: 'left', fontFamily: 'inherit',
          flex: '1 1 120px', minWidth: 96,
          padding: `${T.space.sm}px ${T.space.md}px`, borderRadius: T.radius.sm,
          border: `1px solid ${clickable && hover ? C.borderStrong : C.border2}`,
          background: clickable && hover ? C.hover : 'transparent',
          cursor: clickable ? 'pointer' : 'default',
        },
      },
        h('div', { style: { fontSize: fs(T.font.metric), fontWeight: 600, color: C.label1, lineHeight: T.line.tight } }, String(value)),
        h('div', { style: { fontSize: fs(T.font.hint), color: C.caption, marginTop: 2 } }, label),
        hint ? h('div', { style: { fontSize: fs(T.font.hint), color: C.label3, marginTop: 1 } }, hint) : null);
    }

    /** 页头：一个页名 + 一行状态 + 本页动作。页面正文不再重复页名。 */
    function PageHeader({ title, status, actions }) {
      return h('div', {
        style: {
          display: 'flex', alignItems: 'flex-start', gap: T.space.md,
          flexWrap: 'wrap', marginBottom: T.space.lg,
        },
      },
        h('div', { style: { flex: 1, minWidth: 220 } },
          h('div', { style: { fontSize: fs(T.font.title), fontWeight: 600, color: C.label1 } }, title),
          status
            ? h('div', { style: { fontSize: fs(T.font.hint), color: C.caption, marginTop: 3, lineHeight: T.line.body } }, status)
            : null),
        h('div', { style: { display: 'flex', gap: T.space.xs, alignItems: 'center', flexWrap: 'wrap' } },
          (actions || []).filter(Boolean)));
    }

    function Empty({ children }) {
      return h('div', {
        style: {
          padding: '28px 20px', textAlign: 'center', color: C.caption,
          fontSize: fs(14), border: `1px dashed ${C.border2}`, borderRadius: 8,
        },
      }, children);
    }

    // ── 只读 Markdown 渲染（零依赖，不做 HTML 注入）──────────
    // 卡片是给人在界面上读的；直接把 Markdown 源码丢进 <pre> 会有 # 和 - 的噪音，
    // 而且行宽会拉满整页。这里只实现卡片实际用到的语法子集。
    const MD = {
      h1: { fontSize: fs(19), fontWeight: 600, color: C.label1, margin: '20px 0 10px', lineHeight: T.line.tight },
      h2: { fontSize: fs(16.5), fontWeight: 600, color: C.label1, margin: '18px 0 8px', lineHeight: T.line.tight },
      h3: { fontSize: fs(15), fontWeight: 600, color: C.label1, margin: '14px 0 6px', lineHeight: T.line.tight },
      p: { margin: '0 0 10px', color: C.label1, lineHeight: 1.85, overflowWrap: 'anywhere' },
      li: { margin: '0 0 5px', color: C.label1, lineHeight: 1.8, overflowWrap: 'anywhere' },
      list: { margin: '0 0 10px', paddingLeft: 22 },
      quote: {
        margin: '0 0 10px', paddingLeft: 12, borderLeft: `3px solid ${C.borderStrong}`,
        color: C.label2, lineHeight: 1.8,
      },
      strong: { fontWeight: 600, color: C.label1 },
      em: { fontStyle: 'italic' },
      link: { color: C.accent, textDecoration: 'none', borderBottom: `1px solid ${C.accent}` },
      code: {
        fontFamily: FONT_MONO, fontSize: fs(12.5), background: C.bg2, color: C.label1,
        padding: '1px 5px', borderRadius: 4,
      },
      pre: {
        fontFamily: FONT_MONO, fontSize: fs(12.5), background: C.bg2, color: C.label1,
        padding: T.space.md, borderRadius: T.radius.sm, overflowX: 'auto',
        lineHeight: T.line.mono, margin: '0 0 12px', whiteSpace: 'pre',
      },
      hr: { border: 'none', borderTop: `1px solid ${C.border1}`, margin: '14px 0' },
    };

    /** 行内标记：`code` / **bold** / *italic* / [文字](链接)。 */
    function inlineMarkdown(text, keyPrefix) {
      const out = [];
      const re = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*|\[[^\]]+\]\([^)]+\))/g;
      let last = 0;
      let hit;
      let index = 0;
      while ((hit = re.exec(text)) !== null) {
        if (hit.index > last) out.push(text.slice(last, hit.index));
        const token = hit[0];
        const key = `${keyPrefix}-i${index += 1}`;
        if (token.startsWith('`')) out.push(h('code', { key, style: MD.code }, token.slice(1, -1)));
        else if (token.startsWith('**')) out.push(h('strong', { key, style: MD.strong }, token.slice(2, -2)));
        else if (token.startsWith('*')) out.push(h('em', { key, style: MD.em }, token.slice(1, -1)));
        else {
          const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(token);
          out.push(h('a', {
            key, href: link ? link[2] : '#', target: '_blank', rel: 'noreferrer', style: MD.link,
          }, link ? link[1] : token));
        }
        last = hit.index + token.length;
      }
      if (last < text.length) out.push(text.slice(last));
      return out;
    }

    /** 卡片 Markdown → React 节点。只认标题/列表/引用/代码块/分隔线/段落。 */
    function MarkdownBlock({ text, maxWidth = 760 }) {
      const lines = String(text || '').replace(/\r\n?/g, '\n').split('\n');
      const blocks = [];
      let i = 0;
      let key = 0;
      const nextKey = () => `md-${key += 1}`;
      while (i < lines.length) {
        const line = lines[i];
        if (!line.trim()) { i += 1; continue; }

        const fence = /^\s*```/.exec(line);
        if (fence) {
          const body = [];
          i += 1;
          while (i < lines.length && !/^\s*```/.test(lines[i])) { body.push(lines[i]); i += 1; }
          i += 1;
          blocks.push(h('pre', { key: nextKey(), style: MD.pre }, body.join('\n')));
          continue;
        }

        const heading = /^(#{1,4})\s+(.*)$/.exec(line);
        if (heading) {
          const level = heading[1].length;
          const style = level === 1 ? MD.h1 : level === 2 ? MD.h2 : MD.h3;
          const tag = level === 1 ? 'h1' : level === 2 ? 'h2' : 'h3';
          blocks.push(h(tag, { key: nextKey(), style }, inlineMarkdown(heading[2], `h${key}`)));
          i += 1;
          continue;
        }

        if (/^\s*(?:---|\*\*\*|___)\s*$/.test(line)) {
          blocks.push(h('hr', { key: nextKey(), style: MD.hr }));
          i += 1;
          continue;
        }

        if (/^\s*>\s?/.test(line)) {
          const body = [];
          while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
            body.push(lines[i].replace(/^\s*>\s?/, ''));
            i += 1;
          }
          blocks.push(h('div', { key: nextKey(), style: MD.quote }, inlineMarkdown(body.join(' '), `q${key}`)));
          continue;
        }

        if (/^\s*(?:[-*+]|\d+\.)\s+/.test(line)) {
          const ordered = /^\s*\d+\.\s+/.test(line);
          const items = [];
          while (i < lines.length && /^\s*(?:[-*+]|\d+\.)\s+/.test(lines[i])) {
            const raw = lines[i].replace(/^\s*(?:[-*+]|\d+\.)\s+/, '');
            items.push(h('li', { key: nextKey(), style: MD.li }, inlineMarkdown(raw, `l${key}`)));
            i += 1;
          }
          blocks.push(h(ordered ? 'ol' : 'ul', { key: nextKey(), style: MD.list }, items));
          continue;
        }

        const para = [];
        while (i < lines.length && lines[i].trim()
          && !/^(#{1,4})\s+/.test(lines[i])
          && !/^\s*(?:[-*+]|\d+\.)\s+/.test(lines[i])
          && !/^\s*>\s?/.test(lines[i])
          && !/^\s*```/.test(lines[i])) {
          para.push(lines[i].trim());
          i += 1;
        }
        if (!para.length) { i += 1; continue; }
        blocks.push(h('p', { key: nextKey(), style: MD.p }, inlineMarkdown(para.join(' '), `p${key}`)));
      }
      return h('div', {
        style: { maxWidth, color: C.label1, fontSize: fs(T.font.body), lineHeight: 1.85 },
      }, blocks);
    }

    /** 骨架屏：首屏加载占位。aria-hidden，避免读屏把占位当内容。 */
    function Skeleton({ height = 44, width = '100%' }) {
      return h('div', {
        'aria-hidden': 'true',
        style: {
          height, width, borderRadius: T.radius.sm, background: C.border1,
          marginBottom: T.space.sm, opacity: 0.7,
        },
      });
    }

    function Notice({ kind, children }) {
      const tone = kind === 'error' ? C.error : kind === 'success' ? C.success : C.warn;
      return h('div', {
        role: 'status', 'aria-live': 'polite',
        style: {
          padding: '9px 13px', marginBottom: 14, borderRadius: 6, fontSize: fs(13.5),
          border: `1px solid ${tone}`, color: tone, lineHeight: 1.6,
        },
      }, children);
    }

    function GradeBadge({ grade }) {
      // 没有等级时也占同样的 22px 槽位：否则「—」比字母徽章窄，列表里标题会左右错开
      if (!grade) {
        return h('span', {
          style: {
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            width: 22, height: 22, flexShrink: 0, color: C.caption, fontSize: fs(12),
          },
        }, '—');
      }
      const tone = { S: C.accent, A: C.accent, B: C.success, C: C.label3, D: C.caption }[grade] || C.label3;
      return h('span', {
        style: {
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          width: 22, height: 22, borderRadius: 6, border: `1px solid ${tone}`,
          background: C.bg2, color: tone, fontSize: fs(12), fontWeight: 700,
          fontFamily: FONT_MONO, flexShrink: 0,
        },
      }, grade);
    }

    // L1 三问与评级依据的展示文案（与 lib/judge.js 的枚举一一对应）
    const DOMAIN_LABEL = {
      get core() { return t('domain.core', '本领域核心'); },
      get edge() { return t('domain.edge', '相关领域'); },
      get transferable() { return t('domain.transferable', '方法可借鉴'); },
      get irrelevant() { return t('domain.irrelevant', '无关'); },
    };
    const USE_LABEL = {
      get method() { return t('use.method', '改进方法'); },
      get baseline() { return t('use.baseline', '当对比基线'); },
      get citation() { return t('use.citation', '写作引用'); },
      get landscape() { return t('use.landscape', '了解现状'); },
    };
    function Chip({ children, tone, title }) {
      return h('span', {
        title: title || undefined,
        style: {
          fontSize: fs(11.5), padding: '1px 6px', borderRadius: 9,
          border: `1px solid ${C.border2}`, color: tone || C.label2, whiteSpace: 'nowrap',
        },
      }, children);
    }

    /** 渲染异常兜底：整页白屏降级为一块可重试的错误提示。 */
