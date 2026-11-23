/**
 * 文献实验室的状态层：state/papers.json 与 state/seen.json 的读写。
 *
 * P0 起所有文件读写都经 lib/store.js：
 * - 同一个文件的「读-改-写」在进程内排队，避免并发覆盖
 * - 原子写 + schema 迁移集中在一处
 *
 * 设计原则：
 * - 一张表管所有论文，每篇一个 stage 决定它在流水线的哪一层
 * - 等级可被后续层级修正，每次修正写入 grade_history 并保留理由
 * - 状态里只存事实与判断结果，不存"待办"这类可由 stage 推导的东西
 */
import * as store from './store.js';
import { BASES } from './judge.js';

export const SCHEMA_VERSION = 2;

export const STAGES = ['L0', 'L1', 'L2', 'L3', 'done', 'dropped'];
export const GRADES = ['S', 'A', 'B', 'C', 'D'];

/** 新状态的骨架。 */
export function emptyState() {
  return {
    schema: SCHEMA_VERSION,
    updated_at: new Date().toISOString(),
    quota: { date: null, analysis_used: 0, translation_used: 0 },
    runs: [],
    analysis_runs: [],
    papers: {},
    sources: {},
    last_success_at: null,
  };
}

/** 旧状态迁移：只补字段，不改已有判断。 */
export function migrateState(raw) {
  if (!raw || typeof raw !== 'object' || !raw.papers || typeof raw.papers !== 'object') {
    return emptyState();
  }
  const state = raw;
  state.sources = state.sources && typeof state.sources === 'object' ? state.sources : {};
  state.runs = Array.isArray(state.runs) ? state.runs : [];
  state.analysis_runs = Array.isArray(state.analysis_runs) ? state.analysis_runs : [];
  state.last_success_at = state.last_success_at || null;
  state.quota = state.quota && typeof state.quota === 'object'
    ? state.quota
    : { date: null, analysis_used: 0, translation_used: 0 };
  if (!Number.isFinite(state.schema) || state.schema < SCHEMA_VERSION) state.schema = SCHEMA_VERSION;
  return state;
}

/** 读状态；不存在或损坏时返回空状态（不抛错，UI 永远能渲染）。 */
export async function readState(baseDir) {
  const paths = store.statePaths(baseDir);
  return migrateState(await store.readJson(paths.papers, emptyState()));
}

/** 原子写状态（锁内）。调用方通常应优先用 updateState。 */
export async function writeState(baseDir, state) {
  const paths = store.statePaths(baseDir);
  return store.withLock('data', async () => {
    const next = migrateState({ ...state, schema: SCHEMA_VERSION, updated_at: new Date().toISOString() });
    await store.writeJsonAtomic(paths.papers, next);
    return next;
  });
}

/**
 * 锁内读-改-写。fn 收到最新状态，可修改它并返回结果。
 * 网络请求不要放进 fn，否则会长时间占锁。
 * @template T
 * @param {string} baseDir
 * @param {(state: object) => Promise<T>|T} fn
 * @returns {Promise<T>}
 */
export async function updateState(baseDir, fn) {
  const paths = store.statePaths(baseDir);
  return store.withLock('data', async () => {
    const state = migrateState(await store.readJson(paths.papers, emptyState()));
    const result = await fn(state);
    const next = migrateState({ ...state, schema: SCHEMA_VERSION, updated_at: new Date().toISOString() });
    await store.writeJsonAtomic(paths.papers, next);
    return result;
  });
}

/** seen 索引：所有抓到的条目（含被过滤掉的），独立文件。 */
const SEEN_LIMIT = 50000;

function pruneSeen(seen) {
  const entries = Object.entries(seen || {});
  if (entries.length <= SEEN_LIMIT) return seen;
  entries.sort((a, b) => String(b[1]?.t || '').localeCompare(String(a[1]?.t || '')));
  const keep = new Set(entries.slice(0, SEEN_LIMIT).map(([key]) => key));
  for (const key of Object.keys(seen)) if (!keep.has(key)) delete seen[key];
  return seen;
}

export async function readSeen(baseDir) {
  const paths = store.statePaths(baseDir);
  const value = await store.readJson(paths.seen, {});
  return value && typeof value === 'object' ? value : {};
}

export async function writeSeen(baseDir, seen) {
  const paths = store.statePaths(baseDir);
  return store.withLock('data', async () => {
    await store.writeJsonAtomic(paths.seen, pruneSeen(seen));
    return seen;
  });
}

/** 锁内更新 seen；fn 收到最新 seen，可直接改。 */
export async function updateSeen(baseDir, fn) {
  const paths = store.statePaths(baseDir);
  return store.withLock('data', async () => {
    const seen = await store.readJson(paths.seen, {});
    const result = await fn(seen);
    await store.writeJsonAtomic(paths.seen, pruneSeen(seen));
    return result;
  });
}

/**
 * 论文与 seen 一起读-改-写，供 discover/ingest 用。
 * 网络请求在调用之前完成；fn 内只做内存合并与状态更新。
 */
export async function updateStateAndSeen(baseDir, fn) {
  const paths = store.statePaths(baseDir);
  return store.withLock('data', async () => {
    const state = migrateState(await store.readJson(paths.papers, emptyState()));
    const seen = await store.readJson(paths.seen, {});
    const result = await fn(state, seen);
    const next = migrateState({ ...state, schema: SCHEMA_VERSION, updated_at: new Date().toISOString() });
    await store.writeJsonAtomic(paths.papers, next);
    await store.writeJsonAtomic(paths.seen, pruneSeen(seen));
    return result;
  });
}

/** 今日（Asia/Shanghai）日期串。 */
export function today() {
  const d = new Date(Date.now() + 8 * 3600 * 1000);
  return d.toISOString().slice(0, 10);
}

/**
 * 记录一次等级判断或改判。
 * basis 只记录这次评级依据的是什么证据，不影响等级本身。
 */
export function applyGrade(paper, grade, { stage, reason, basis, l1, at } = {}) {
  if (!GRADES.includes(grade)) throw new Error(`invalid grade: ${grade}`);
  const when = at || new Date().toISOString();
  const finalBasis = basis || 'abstract';
  if (!BASES.includes(finalBasis)) throw new Error(`invalid basis: ${finalBasis}`);
  paper.grade = grade;
  paper.grade_basis = finalBasis;
  paper.grade_history = paper.grade_history || [];
  const entry = { stage, grade, reason: reason || '', basis: finalBasis, at: when };
  if (l1) {
    entry.l1 = {
      domain: l1.domain,
      increment: l1.increment,
      use: l1.use,
      ...(l1.note ? { note: l1.note } : {}),
    };
  }
  paper.grade_history.push(entry);
  return paper;
}

/** 写入三问答案（不含评级）。 */
export function setL1(paper, l1, at) {
  paper.l1 = {
    domain: l1.domain,
    increment: l1.increment,
    use: l1.use,
    note: l1.note || '',
    at: at || new Date().toISOString(),
  };
  paper.updated_at = paper.l1.at;
  return paper;
}

/** 记录一次摘要检索的结果；取不到也要记。 */
export function recordLookup(paper, { matched, hasAbstract, via, reason, at } = {}) {
  paper.abstract_lookup = {
    at: at || new Date().toISOString(),
    matched: Boolean(matched),
    has_abstract: Boolean(hasAbstract),
    via: via || null,
    reason: reason || null,
  };
  return paper;
}

/** 暂停（snooze）是否仍在生效：到期后自动失效，不需要清理字段。 */
export function isSnoozed(paper, now = Date.now()) {
  const until = paper?.snooze?.until;
  if (!until) return false;
  const stamp = Date.parse(until);
  return Number.isFinite(stamp) && stamp > now;
}

/** 推进阶段（只允许向前，或显式 dropped）。 */
export function advance(paper, stage) {
  if (!STAGES.includes(stage)) throw new Error(`invalid stage: ${stage}`);
  paper.stage = stage;
  paper.updated_at = new Date().toISOString();
  return paper;
}

/** 汇总统计，供 UI 顶部卡片使用。 */
export function summarize(state) {
  const papers = Object.values(state.papers || {});
  const count = (fn) => papers.filter(fn).length;
  const byGrade = {};
  for (const g of GRADES) byGrade[g] = count((p) => p.grade === g && p.stage !== 'dropped');
  return {
    total: papers.length,
    stages: {
      L0: count((p) => p.stage === 'L0'),
      L1: count((p) => p.stage === 'L1'),
      L2: count((p) => p.stage === 'L2'),
      L3: count((p) => p.stage === 'L3'),
      done: count((p) => p.stage === 'done'),
      dropped: count((p) => p.stage === 'dropped'),
    },
    byGrade,
    library: count((p) => p.zotero_key),
    pdf: count((p) => Boolean(p.pdf)),
    translated: count((p) => p.translated && p.translated.mono),
    today_run: (state.runs || [])[0] || null,
  };
}

/** 单篇的视图模型；UI 与 agent 工具共用。 */
export function paperView(id, p, { fullHistory = false } = {}) {
  const history = p.grade_history || [];
  return {
    id,
    title: p.title || '',
    url: p.url || null,
    doi: p.doi || null,
    arxiv_id: p.arxiv_id || null,
    stage: p.stage || 'L0',
    grade: p.grade || null,
    grade_basis: p.grade_basis || null,
    grade_history: fullHistory ? history : history.slice(-8),
    first_seen: p.first_seen || null,
    sources: p.sources || [],
    snooze: p.snooze || null,
    l1: p.l1
      ? {
        domain: p.l1.domain || null,
        increment: p.l1.increment || '',
        use: p.l1.use || null,
        note: p.l1.note || '',
        at: p.l1.at || null,
      }
      : null,
    abstract: p.abstract ? String(p.abstract) : null,
    abstract_lookup: p.abstract_lookup || null,
    authors: Array.isArray(p.meta?.authors) ? p.meta.authors : (Array.isArray(p.authors) ? p.authors : []),
    venue: p.meta?.venue || null,
    venue_tier: p.venue_tier || null,
    year: p.meta?.year || null,
    meta_source: p.meta?.source || null,
    l2_reason: p.l2?.reason || null,
    l2: p.l2
      ? {
        verdict: p.l2.verdict || null,
        confidence: p.l2.confidence || null,
        confidence_reasons: p.l2.confidence_reasons || [],
        reason: p.l2.reason || null,
        usage: p.l2.usage || null,
        at: p.l2.at || null,
      }
      : null,
    l3: p.l3
      ? {
        final_grade: p.l3.final_grade || null,
        confidence: p.l3.confidence || null,
        why_read: p.l3.why_read || '',
        summary: p.l3.summary || '',
        method: p.l3.method || '',
        limitations: p.l3.limitations || [],
        card_markdown: p.l3.card_markdown || '',
        // 关键图：抽屉的画廊靠这两个字段；漏掉会让图永远不显示
        figures: Array.isArray(p.l3.figures) ? p.l3.figures : [],
        figure_count: Number(p.l3.figure_count) || (Array.isArray(p.l3.figures) ? p.l3.figures.length : 0),
        usage: p.l3.usage || null,
        at: p.l3.at || null,
      }
      : null,
    zotero_key: p.zotero_key || null,
    zotero_import: p.zotero_import || null,
    review_flags: Array.isArray(p.review_flags) ? p.review_flags : [],
    // 阅读队列用：标已读后离开队列，不再按天分组
    read_at: p.read_at || null,
    manual_override: Boolean(p.manual_override),
    candidate_id: p.candidate_id || null,
    priority: p.priority === 'next' ? 'next' : (p.priority ? 'next' : null),
    manual: Boolean(p.manual),
    has_pdf: Boolean(p.pdf),
    pdf: p.pdf || null,
    pdf_bytes: p.pdf_bytes || null,
    download_reason: p.download?.reason || null,
    translated: Boolean(p.translated?.mono),
    translations: p.translations || null,
  };
}

/**
 * 生成视图模型（按首次发现倒序，保证分页稳定）。
 * 不传 limit 时返回全部，保持旧行为；传了就只返回一页并带 total/offset。
 */
export function viewOf(state, { stage, q, limit, offset } = {}) {
  let papers = Object.entries(state.papers || {})
    .map(([id, p]) => paperView(id, p))
    .sort((a, b) => Number(b.priority === 'next') - Number(a.priority === 'next')
      || String(b.first_seen || '').localeCompare(String(a.first_seen || ''))
      || a.id.localeCompare(b.id));

  if (stage) papers = papers.filter((p) => p.stage === stage);
  const needle = q ? String(q).trim().toLowerCase() : '';
  if (needle) {
    papers = papers.filter((p) => `${p.title} ${p.abstract || ''} ${p.l1?.increment || ''}`.toLowerCase().includes(needle));
  }

  const total = papers.length;
  const start = Math.max(0, Math.trunc(Number(offset)) || 0);
  const requested = Math.trunc(Number(limit));
  const size = requested > 0 ? Math.min(200, requested) : total;
  const page = papers.slice(start, start + size);

  return {
    updated_at: state.updated_at,
    quota: state.quota || null,
    summary: summarize(state),
    sources: state.sources || {},
    last_success_at: state.last_success_at || null,
    total,
    offset: start,
    limit: size,
    papers: page,
    runs: (state.runs || []).slice(0, 30),
  };
}
