    // ── 队列口径（纯函数）────────────────────────────────────
    // 一条只落一行一组；表格、两个框与徽标都从这里取数，渲染层不再补算。
    // 行 = 在流水线的哪一步排队；组 = 这一步为什么轮到人。
    const BOARD_ROWS = [
      { key: 'new', label: '待判读', desc: '候选 · 读摘要，给评级与三问', quota: 'l1' },
      { key: 'confirm', label: '待确认', desc: '候选 · AI 结论待确认', quota: null },
      { key: 'l2', label: '待初筛', desc: '论文 · 读引言末段、结论与图注', quota: 'l2' },
      { key: 'l3', label: '待精读', desc: '论文 · 读全文，出卡片与关键图', quota: 'l3' },
      { key: 'legacy', label: '待推进', desc: '论文 · 旧版阶段，需人工进入初筛', quota: null },
    ];
    const BOARD_GROUPS = [
      { key: 'material', label: '材料不全', note: '系统缺少摘要或原文，无法继续。' },
      { key: 'failed', label: '判读失败', note: '上一轮运行失败，可重试。' },
      { key: 'confirm', label: '待确认', note: 'AI 已给结论，需要确认去向。' },
      { key: 'lowconf', label: '低置信', note: 'AI 置信度低，需要人工定级。' },
      { key: 'legacy', label: '旧版阶段', note: '旧版阶段不由自动流程推进。' },
    ];

    /** 条目网页：与服务端 lib/links.js 同规则（url → DOI → arXiv → 题名检索）。 */
    function homePageUrl(item) {
      const raw = String(item?.url || '').trim();
      if (/^https?:\/\//i.test(raw)) return raw;
      const doi = String(item?.doi || '').trim().replace(/^https?:\/\/(dx\.)?doi\.org\//i, '');
      if (doi && /^10\.\d{4,9}\/\S+$/.test(doi)) return `https://doi.org/${doi}`;
      const arxiv = String(item?.arxiv_id || '').trim();
      if (/^\d{4}\.\d{4,5}(v\d+)?$/.test(arxiv)) return `https://arxiv.org/abs/${arxiv}`;
      const title = String(item?.title || '').trim();
      if (title.length >= 8) return `https://search.crossref.org/?q=${encodeURIComponent(title)}`;
      return null;
    }

    /**
     * 材料不全只看「现在有没有摘要」：analysis.confidence_reasons 是上一次判读的快照，
     * 补摘要成功后不会重算，拿它分类会把已经补齐的候选永远钉在材料不全里。
     */
    function candidateLacksMaterial(c) {
      return !String(c?.abstract || '').trim();
    }

    /**
     * 单条分类：返回 { row, group, side, primary, reason }，不属于队列时返回 null。
     * 优先级固定为 旧版 > 材料 > 失败 > 确认 > 低置信 > 自动，保证一条只进一个组。
     */
    function classifyQueueEntry(entry, now = Date.now()) {
      if (!entry || !entry.kind || !entry.item) return null;
      const item = entry.item;
      if (entry.kind === 'candidate') {
        const status = item.status;
        if (!['new', 'analyzing', 'failed', 'parked'].includes(status)) return null;
        const material = candidateLacksMaterial(item);
        const group = material ? 'material'
          : status === 'failed' ? 'failed'
            : status === 'parked' ? 'confirm'
              : null;
        const row = status === 'parked' ? 'confirm' : 'new';
        return {
          kind: 'candidate',
          item,
          row,
          group,
          side: group ? 'human' : 'ai',
          primary: candidatePrimary(item, group),
          reason: candidateReason(item, group),
        };
      }
      if (entry.kind === 'paper') {
        const stage = item.stage;
        if (!stage || stage === 'done' || stage === 'dropped') return null;
        if (snoozeIsActive(item, now)) return null;
        const flags = Array.isArray(item.review_flags) ? item.review_flags : [];
        let group = null;
        if (stage === 'L0' || stage === 'L1') group = 'legacy';
        // 只有「尝试过且失败」才归人工：needs_pdf 由下载失败或额度不足后的重试写入；
        // 还没试过的缺原文条目留在 AI 队列，等自动路径去取。
        else if (flags.includes('needs_pdf') || flags.includes('pdf_error')) group = 'material';
        else if (flags.includes('analysis_failed')) group = 'failed';
        else if (flags.includes('low_confidence')) group = 'lowconf';
        const row = stage === 'L0' || stage === 'L1' ? 'legacy'
          : stage === 'L2' ? 'l2' : 'l3';
        return {
          kind: 'paper',
          item,
          row,
          group,
          side: group ? 'human' : 'ai',
          primary: paperPrimary(item, group),
          reason: paperReason(item, group),
        };
      }
      return null;
    }

    function candidatePrimary(c, group) {
      if (group === 'material') return '补全摘要';
      if (group === 'failed') return '重试判读';
      if (group === 'confirm') return '加入初筛';
      return null;
    }

    function paperPrimary(p, group) {
      if (group === 'material') return (p.review_flags || []).includes('pdf_error') ? '更换 PDF' : '补 PDF';
      if (group === 'failed') return p.stage === 'L3' ? '重跑精读' : '重跑初筛';
      if (group === 'lowconf') return '改判';
      if (group === 'legacy') return '进入初筛';
      return null;
    }

    function candidateReason(c, group) {
      if (group === 'material') return '来源未提供摘要，判读无法进行。';
      if (group === 'failed') {
        const detail = String(c?.analysis?.error || '').trim();
        return detail ? `上一轮判读失败：${detail}` : '上一轮判读失败，可重试。';
      }
      if (group === 'confirm') return 'AI 建议暂缓，需要确认去向。';
      return null;
    }

    function paperReason(p, group) {
      const flags = p.review_flags || [];
      if (group === 'material') {
        if (flags.includes('pdf_error')) return '已存 PDF 无法提取文本，需更换文件。';
        if (p.pdf_failure?.hint) return `未取得本地 PDF：${p.pdf_failure.hint}`;
        if (p.pdf_failure?.reason) return `未取得本地 PDF：${p.pdf_failure.reason}`;
        return '未取得本地 PDF，初筛与精读需要原文。';
      }
      if (group === 'failed') return '上一轮分析失败，可重试。';
      if (group === 'lowconf') return 'AI 置信度低，需要人工定级。';
      if (group === 'legacy') return '不由自动流程推进，需人工进入初筛。';
      return null;
    }

    /** AI 队列的行序：能立刻处理的先出现，要等原文的靠后；同档再按所选排序。 */
    const AI_ROW_ORDER = { new: 0, l2: 1, l3: 2 };
    function sortAiEntries(entries, { sort = 'score', runningIds = [], runningPhases = {} } = {}) {
      const running = new Set(Array.isArray(runningIds) ? runningIds : []);
      const keyOf = (entry) => {
        const item = entry?.item || {};
        // 用户置顶 → 正在处理/排队 → 置顶候选 → 已有原文 → 阶段
        const pinned = entry?.kind === 'paper' && item.priority === 'next' ? -1 : 0;
        const active = (runningPhases?.[item.id] || running.has(item.id)) ? -1 : 0;
        const analyzing = entry?.kind === 'candidate' && item.status === 'analyzing' ? -1 : 0;
        const needsFetch = entry?.kind === 'paper' && !item.has_pdf ? 1 : 0;
        return [pinned, active, analyzing, needsFetch, AI_ROW_ORDER[entry?.row] ?? 9];
      };
      const byNewest = (a, b) => String(b?.item?.first_seen || '').localeCompare(String(a?.item?.first_seen || ''));
      const tie = (a, b) => {
        if (sort === 'title') return String(a?.item?.title || '').localeCompare(String(b?.item?.title || ''));
        if (sort === 'year') return (Number(b?.item?.year) || 0) - (Number(a?.item?.year) || 0) || byNewest(a, b);
        if (sort === 'newest') return byNewest(a, b);
        return (Number(b?.item?.t0?.score) || 0) - (Number(a?.item?.t0?.score) || 0) || byNewest(a, b);
      };
      return [...(entries || [])].sort((a, b) => {
        const ka = keyOf(a);
        const kb = keyOf(b);
        for (let i = 0; i < ka.length; i += 1) if (ka[i] !== kb[i]) return ka[i] - kb[i];
        return tie(a, b);
      });
    }

    /** 人工框的行序：先按分组，再按等级（S→D），无等级排最后，同档按兴趣分。 */
    const BOARD_GRADE_RANK = { S: 0, A: 1, B: 2, C: 3, D: 4 };
    function entryGrade(entry) {
      return entry?.kind === 'candidate' ? entry.item?.analysis?.grade : entry?.item?.grade;
    }
    function sortHumanEntries(entries) {
      return [...(entries || [])].sort((a, b) => (
        String(a?.group || '').localeCompare(String(b?.group || ''))
        || (BOARD_GRADE_RANK[entryGrade(a)] ?? 9) - (BOARD_GRADE_RANK[entryGrade(b)] ?? 9)
        || (Number(b?.item?.t0?.score) || 0) - (Number(a?.item?.t0?.score) || 0)
      ));
    }

    /** 今日额度：limit 为 0 表示这一级不做（服务端 remainingQuota 按 0 处理）。 */
    function formatQuota(used, limit) {
      const n = Number(limit) || 0;
      const u = Math.max(0, Number(used) || 0);
      if (n <= 0) return { text: '不做', tone: 'off' };
      if (u >= n) return { text: `已用完 · ${u} / ${n}`, tone: 'error' };
      // 显示「剩余」而不是「已用」：4 / 6 容易被读成还剩 4，实际只剩 2
      return { text: `剩 ${n - u} / ${n}`, tone: 'normal' };
    }

    /** 下次自动运行：关闭返回 null，时间非法返回「时间未设置」。 */
    function nextRunLabel(now, schedule) {
      if (!schedule || schedule.enabled === false) return null;
      const raw = String(schedule.time || '').trim();
      const match = /^(\d{1,2}):(\d{2})$/.exec(raw);
      if (!match) return { text: '时间未设置', at: null };
      const hour = Number(match[1]);
      const minute = Number(match[2]);
      if (hour > 23 || minute > 59) return { text: '时间未设置', at: null };
      const at = new Date(now);
      at.setHours(hour, minute, 0, 0);
      const tomorrow = at.getTime() <= now;
      if (tomorrow) at.setDate(at.getDate() + 1);
      return { text: `${tomorrow ? '明天' : '今天'} ${match[1].padStart(2, '0')}:${match[2]}`, at: at.getTime() };
    }

    /**
     * 队列看板：把论文、候选、额度与调度合成一张表 + 两个框的数据。
     * queued 用服务端全量计数（候选 counts、论文 stages），human/auto 用已加载条目的分类结果；
     * 已加载少于排队数时标 truncated，界面必须写明统计范围，不能声称全量。
     */
    function pipelineBoard({ papers = [], candidates = [], summary = {}, stats = null, schedule = null, now = Date.now() } = {}) {
      const stages = summary?.stages || {};
      const counts = summary?.counts || {};
      const limits = stats?.limits || {};
      const usage = stats?.usage || {};

      const paperEntries = papers.map((p) => classifyQueueEntry({ kind: 'paper', item: p }, now)).filter(Boolean);
      const candidateEntries = candidates.map((c) => classifyQueueEntry({ kind: 'candidate', item: c }, now)).filter(Boolean);
      const entries = [...candidateEntries, ...paperEntries];

      const snoozedByStage = { L0: 0, L1: 0, L2: 0, L3: 0 };
      for (const p of papers) {
        if (!snoozeIsActive(p, now)) continue;
        if (p.stage in snoozedByStage) snoozedByStage[p.stage] += 1;
      }
      const exact = {
        new: (Number(counts.new) || 0) + (Number(counts.analyzing) || 0) + (Number(counts.failed) || 0),
        confirm: Number(counts.parked) || 0,
        l2: Math.max(0, (Number(stages.L2) || 0) - snoozedByStage.L2),
        l3: Math.max(0, (Number(stages.L3) || 0) - snoozedByStage.L3),
        legacy: Math.max(0, (Number(stages.L0) || 0) + (Number(stages.L1) || 0) - snoozedByStage.L0 - snoozedByStage.L1),
      };

      const rows = BOARD_ROWS.map((row) => {
        const list = entries.filter((entry) => entry.row === row.key);
        const human = list.filter((entry) => entry.side === 'human').length;
        const auto = list.length - human;
        // 计数以服务端为准，但服务端摘要可能落后于列表：排队数不允许小于已加载数，
        // 否则会出现「排队 0、需要人处理 1」这种自相矛盾。
        const queued = Number.isFinite(exact[row.key])
          ? Math.max(exact[row.key], list.length)
          : list.length;
        const quotaUsed = row.quota ? usage[row.quota] : null;
        const quotaLimit = row.quota ? limits[row.quota] : null;
        return {
          ...row,
          queued,
          loaded: list.length,
          human,
          auto,
          truncated: Number.isFinite(exact[row.key]) ? list.length < exact[row.key] : false,
          quota: row.quota ? formatQuota(quotaUsed, quotaLimit) : null,
          owner: human && auto ? 'both' : human ? 'human' : auto ? 'auto' : 'none',
        };
      });

      const sum = (key) => rows.reduce((total, row) => total + row[key], 0);
      const groups = BOARD_GROUPS
        .map((group) => ({
          ...group,
          items: entries.filter((entry) => entry.group === group.key).map((entry) => entry.item),
        }))
        .filter((group) => group.items.length);

      return {
        rows,
        groups,
        aiItems: entries.filter((entry) => entry.side === 'ai').map((entry) => entry.item),
        humanItems: entries.filter((entry) => entry.side === 'human').map((entry) => entry.item),
        total: {
          queued: sum('queued'),
          loaded: sum('loaded'),
          human: sum('human'),
          auto: sum('auto'),
          truncated: rows.some((row) => row.truncated),
        },
        paused: Object.values(snoozedByStage).reduce((a, b) => a + b, 0),
        pdfQuota: Number.isFinite(Number(limits.pdf))
          ? { used: Number(usage.pdf) || 0, limit: Number(limits.pdf) || 0 }
          : null,
        nextRun: nextRunLabel(now, schedule),
      };
    }
