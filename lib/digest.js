/**
 * 每日摘要（不做邮件）：按「资格 / 分组 / 排序 / 时间边界 / 空态」五个要素算一份今日摘要。
 *
 * 资格：当天新进、或当天刚判完的 S/A 论文（B 级可在设置里打开）
 * 分组：按关注词分组，每篇只进第一个命中的词；都没命中进「其他」
 * 排序：组内 等级 → 命中词数 → 时间新
 * 边界：按 Asia/Shanghai 自然日切分
 */
import { readState, today } from './state.js';
import { paperView } from './state.js';

/** 上海时区的某个 ISO 时刻属于哪一天。 */
function localDay(iso) {
  const time = Date.parse(iso || '');
  return Number.isFinite(time) ? new Date(time + 8 * 3600 * 1000).toISOString().slice(0, 10) : null;
}

/** 关注词匹配：纯文本（忽略大小写），配置里写成正则也兼容。 */
function matcher(keyword) {
  const raw = String(keyword || '').trim();
  if (!raw) return null;
  try {
    const re = new RegExp(raw, 'i');
    return (text) => re.test(text);
  } catch {
    const needle = raw.toLowerCase();
    return (text) => text.toLowerCase().includes(needle);
  }
}

const GRADE_ORDER = { S: 0, A: 1, B: 2, C: 3, D: 4 };

/**
 * @param {string} baseDir
 * @param {object} config
 * @param {{ date?: string, keywords?: string[] }} options
 */
export function buildDigest(state, config, { date, keywords } = {}) {
  const day = date || today();
  const digestCfg = config?.digest || {};
  const groupsCfg = Number.isFinite(Number(digestCfg.maxPerGroup)) ? Number(digestCfg.maxPerGroup) : 2;
  const allowedGrades = digestCfg.includeB === true ? ['S', 'A', 'B'] : ['S', 'A'];
  const words = (keywords && keywords.length ? keywords : (config?.relevance?.keywords || []))
    .map((w) => String(w || '').trim())
    .filter(Boolean);

  const papers = state.papers || {};
  const judgedToday = (p) => localDay(p?.l2?.at) === day || localDay(p?.l3?.at) === day;
  const candidates = Object.entries(papers)
    .filter(([, p]) => p && p.stage !== 'dropped' && p.grade && allowedGrades.includes(p.grade))
    .filter(([, p]) => p.first_seen === day || judgedToday(p));

  const matchers = words.map((w) => ({ word: w, test: matcher(w) })).filter((x) => x.test);
  const buckets = new Map();
  const others = [];
  let hitsTotal = 0;
  for (const [id, paper] of candidates) {
    const text = `${paper.title || ''} ${paper.abstract || ''}`;
    const hit = matchers.filter((m) => m.test(text));
    hitsTotal += hit.length;
    const item = { ...paperView(id, paper), hits: hit.length };
    if (hit.length === 0) others.push(item);
    else {
      const primary = hit[0].word;
      if (!buckets.has(primary)) buckets.set(primary, []);
      buckets.get(primary).push(item);
    }
  }

  const byRank = (a, b) => (GRADE_ORDER[a.grade] ?? 9) - (GRADE_ORDER[b.grade] ?? 9)
    || (b.hits || 0) - (a.hits || 0)
    || String(b.first_seen || '').localeCompare(String(a.first_seen || ''));

  const groups = [...buckets.entries()]
    .map(([word, items]) => ({
      keyword: word,
      total: items.length,
      items: [...items].sort(byRank).slice(0, Math.max(1, groupsCfg)),
    }))
    .sort((a, b) => b.total - a.total || a.keyword.localeCompare(b.keyword));

  const all = [...candidates.map(([id, p]) => paperView(id, p))];
  const stats = {
    date: day,
    graded: all.length,
    s: all.filter((p) => p.grade === 'S').length,
    a: all.filter((p) => p.grade === 'A').length,
    b: all.filter((p) => p.grade === 'B').length,
    latestJudgedAt: all.map((p) => p.l2?.at || p.l3?.at || p.l1?.at).filter(Boolean).sort().pop() || null,
  };

  return {
    date: day,
    window: { from: `${day}T00:00:00+08:00`, to: `${day}T24:00:00+08:00` },
    groups,
    others: others.sort(byRank).slice(0, Math.max(1, groupsCfg)),
    stats,
    keywords: words,
    options: { includeB: digestCfg.includeB === true, maxPerGroup: groupsCfg },
  };
}

export async function digestFor(baseDir, config, options = {}) {
  const state = await readState(baseDir);
  return buildDigest(state, config, options);
}
