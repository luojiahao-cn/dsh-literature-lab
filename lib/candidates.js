/**
 * 候选池：回溯采集的条目先进这里，T0 规则过滤、T1 模型粗筛，再决定是否提升到 papers(L1)。
 * 与 papers 分离，避免历史语料直接淹没阅读队列。
 */
import * as store from './store.js';
import { workId, aliasesOf } from './dedup.js';
import { scorePaper, minScoreOf } from './config.js';
import { readState, updateSeen, updateStateAndSeen, advance, today } from './state.js';
import { readZoteroCache } from './zotero.js';
import { withJournal } from './journal.js';

const MAX_CANDIDATES = 20000;

function candidatesFile(baseDir) {
  return store.statePaths(baseDir).candidates;
}

async function prune(db) {
  const entries = Object.entries(db.items || {});
  if (entries.length <= MAX_CANDIDATES) return db;
  entries.sort((a, b) => String(b[1]?.added_at || '').localeCompare(String(a[1]?.added_at || '')));
  const keep = new Set(entries.slice(0, MAX_CANDIDATES).map(([id]) => id));
  for (const id of Object.keys(db.items)) if (!keep.has(id)) delete db.items[id];
  return db;
}

export async function readCandidates(baseDir) {
  const db = await store.readJson(candidatesFile(baseDir), { items: {} });
  return db.items && typeof db.items === 'object' ? db.items : {};
}

export async function updateCandidates(baseDir, fn) {
  return store.updateJson('candidates', candidatesFile(baseDir), { items: {} }, (db) => {
    db.items = db.items || {};
    const next = fn(db.items);
    if (next && next !== db.items) db.items = next;
    return prune(db);
  });
}

/** Zotero 库里的 DOI/arXiv，用于标 owned。 */
async function ownedKeys(baseDir) {
  const cache = await readZoteroCache(baseDir);
  const dois = new Set();
  const arxivs = new Set();
  for (const item of cache?.items || []) {
    if (item.doi) dois.add(String(item.doi).toLowerCase());
    if (item.archiveId) {
      const match = String(item.archiveId).match(/(\d{4}\.\d{4,5})/);
      if (match) arxivs.add(match[1]);
    }
  }
  return { dois, arxivs };
}

/**
 * 吸收一批候选。去重、T0 过滤、Zotero owned 判断都在这里。
 * @param {object} config
 * @param {Array} items
 * @param {{source:string}} options
 */
/** 记录已扫描过的条目，避免下一轮重复处理。 */
async function recordSeen(baseDir, items, source) {
  const now = new Date().toISOString();
  const patch = {};
  for (const item of items || []) {
    const id = workId({ doi: item?.doi, arxivId: item?.arxivId, title: item?.title });
    if (!id) continue;
    patch[id] = { t: now, s: source, title: item.title, a: Array.isArray(item.authors) ? 1 : 0 };
  }
  if (!Object.keys(patch).length) return 0;
  await updateSeen(baseDir, (seen) => {
    for (const [id, entry] of Object.entries(patch)) {
      if (!seen[id]) seen[id] = entry;
    }
  });
  return Object.keys(patch).length;
}

export async function absorbCandidates(baseDir, config, items, { source = 'harvest', passThrough = false } = {}) {
  const papers = await readState(baseDir);
  // 手动导入有通行权：不按 Zotero/关键词/排除词拦，直接进 new。
  const owned = passThrough ? { dois: new Set(), arxivs: new Set() } : await ownedKeys(baseDir);
  const minScore = minScoreOf(config);
  const now = new Date().toISOString();

  const stats = { scanned: 0, added: 0, merged: 0, filtered: 0, excluded: 0, owned: 0, known: 0 };
  const added = [];

  // 同一篇可能以 DOI / arXiv / 题名三种 id 到达：papers 与 candidates 都要按别名命中，
  // 不能只比较 workId 的精确值，否则同一篇会入池两次、之后还会变成两条论文。
  const paperAlias = new Map();
  for (const [pid, paper] of Object.entries(papers.papers || {})) {
    paperAlias.set(pid, pid);
    for (const alias of aliasesOf({ doi: paper.doi, arxivId: paper.arxiv_id, title: paper.title })) {
      if (!paperAlias.has(alias)) paperAlias.set(alias, pid);
    }
  }

  await updateCandidates(baseDir, (db) => {
    const candidateAlias = new Map();
    // updateCandidates 的入参是 items 映射本身，不是 { items } 外壳。
    for (const [cid, row] of Object.entries(db || {})) {
      candidateAlias.set(cid, cid);
      for (const alias of aliasesOf({ doi: row?.doi, arxivId: row?.arxiv_id, title: row?.title })) {
        if (!candidateAlias.has(alias)) candidateAlias.set(alias, cid);
      }
    }
    for (const item of items || []) {
      const title = String(item?.title || '').trim();
      if (!title) continue;
      const id = workId({ doi: item.doi, arxivId: item.arxivId, title });
      if (!id) continue;
      stats.scanned += 1;
      const incomingAliases = aliasesOf({ doi: item.doi, arxivId: item.arxivId, title });

      const paperHit = incomingAliases.map((alias) => paperAlias.get(alias)).find(Boolean);
      if (paperHit) {
        stats.known += 1;
        continue;
      }
      const existingId = incomingAliases.map((alias) => candidateAlias.get(alias)).find(Boolean);
      const existing = existingId ? db[existingId] : db[id];
      if (existing) {
        existing.sources = [...new Set([...(existing.sources || []), source])];
        const incomingCanonical = item.abstractSource === 'canonical';
        if (incomingCanonical && String(item.abstract || '').length > String(existing.abstract || '').length) {
          existing.abstract = item.abstract;
          existing.abstract_source = 'canonical';
        } else if (!existing.abstract && item.abstract) {
          existing.abstract = item.abstract;
          existing.abstract_source = item.abstractSource || existing.abstract_source || null;
        }
        if (!existing.doi && item.doi) existing.doi = item.doi;
        if (!existing.arxiv_id && item.arxivId) existing.arxiv_id = item.arxivId;
        existing.last_seen_at = now;
        if (passThrough) {
          existing.status = 'new';
          existing.manual = true;
          existing.priority = true;
          existing.t0 = { ...(existing.t0 || {}), bypass: true };
        }
        stats.merged += 1;
        continue;
      }

      const doi = String(item.doi || '').toLowerCase();
      const arxiv = String(item.arxivId || '');
      const ownedHere = (doi && owned.dois.has(doi)) || (arxiv && owned.arxivs.has(arxiv));
      const score = scorePaper(item, config);

      let status = 'new';
      if (passThrough) { stats.added += 1; }
      else if (ownedHere) { status = 'owned'; stats.owned += 1; }
      else if (score.excluded) { status = 'excluded'; stats.excluded += 1; }
      else if (score.filtered && score.score < minScore) { status = 'filtered'; stats.filtered += 1; }
      else { stats.added += 1; }

      db[id] = {
        id,
        title,
        year: item.year || (item.publishedAt ? String(item.publishedAt).slice(0, 4) : null),
        venue: item.venue || null,
        doi: item.doi || null,
        arxiv_id: item.arxivId || null,
        url: item.url || null,
        authors: Array.isArray(item.authors) ? item.authors : [],
        abstract: item.abstract || item.summary || '',
        abstract_source: item.abstractSource || null,
        sources: [source],
        t0: {
          score: score.score, hits: score.hits, excluded: score.excluded, signals: score.signals,
          ...(passThrough ? { bypass: true } : {}),
        },
        ...(passThrough ? { manual: true, priority: true } : {}),
        t1: null,
        status,
        added_at: now,
        last_seen_at: now,
      };
      if (status === 'new') added.push({ id, title: db[id].title });
    }
    return db;
  });

  await recordSeen(baseDir, items, source);
  return { ...stats, candidates: added };
}

/** 把候选提升成论文。默认进初筛（L2）：候选已经过摘要判读，论文 L1 只是没有入口的中间态。 */
export async function promoteCandidate(baseDir, id, { stage = 'L2', journal = true } = {}) {
  if (journal) {
    return withJournal(baseDir, 'promote', { candidateId: id, stage }, () =>
      promoteCandidate(baseDir, id, { stage, journal: false }));
  }
  const candidates = await readCandidates(baseDir);
  const candidate = candidates[id];
  if (!candidate) throw new Error(`未知候选：${id}`);
  if (candidate.status === 'promoted') {
    const state = await readState(baseDir);
    if (state.papers?.[id]) return { ok: true, id, skipped: 'already-promoted' };
  }

  const outcome = await updateStateAndSeen(baseDir, (state, seen) => {
    if (state.papers?.[id]) return { ok: true, id, skipped: 'already-paper' };
    const now = new Date().toISOString();
    const paper = {
      title: candidate.title,
      doi: candidate.doi || null,
      arxiv_id: candidate.arxiv_id || null,
      url: candidate.url || null,
      first_seen: today(),
      last_seen: today(),
      published_at: candidate.year ? `${candidate.year}-01-01` : null,
      sources: candidate.sources || ['candidate'],
      authors: Array.isArray(candidate.authors) ? candidate.authors : [],
      meta: {
        venue: candidate.venue || null,
        year: candidate.year || null,
        source: (candidate.sources || [])[0] || 'candidate',
      },
      summary: candidate.abstract ? String(candidate.abstract).slice(0, 1000) : null,
      abstract: candidate.abstract || null,
      abstract_lookup: candidate.abstract
        ? { at: now, matched: true, has_abstract: true, via: 'candidate', reason: null }
        : null,
      relevance: candidate.t0?.hits?.length
        ? { score: candidate.t0.score, hits: candidate.t0.hits }
        : null,
      stage,
      grade: null,
      grade_history: [],
      candidate_id: id,
    };
    advance(paper, stage);
    state.papers[id] = paper;
    seen[id] = { t: now, s: 'candidate', title: paper.title, a: 1, score: candidate.t0?.score ?? null };
    return { ok: true, id };
  });

  await updateCandidates(baseDir, (db) => {
    if (db[id]) {
      db[id].status = 'promoted';
      db[id].promoted_at = new Date().toISOString();
    }
    return db;
  });
  return outcome;
}

/**
 * 按当前关键词配置重算候选的 T0 分数。
 * 只重算「还没进流程」的候选（new/filtered/excluded/owned），
 * parked/admitted/dropped/promoted 一律不动 —— 那些已经是人的决定或已有论文。
 */
export async function rescoreCandidates(baseDir, config) {
  const minScore = minScoreOf(config);
  const stats = { scanned: 0, revived: 0, filtered: 0, excluded: 0, kept: 0 };
  await updateCandidates(baseDir, (db) => {
    for (const item of Object.values(db)) {
      if (!['new', 'filtered', 'excluded', 'owned'].includes(item.status)) { stats.kept += 1; continue; }
      stats.scanned += 1;
      const score = scorePaper(item, config);
      item.t0 = { score: score.score, hits: score.hits, excluded: score.excluded, signals: score.signals };
      if (score.excluded) { item.status = 'excluded'; stats.excluded += 1; }
      else if (score.filtered && score.score < minScore) { item.status = 'filtered'; stats.filtered += 1; }
      else { item.status = 'new'; stats.revived += 1; }
    }
    return db;
  });
  return { ok: true, ...stats };
}

/** 候选排序：分数/最新/年份/题名。 */
export const CANDIDATE_SORTS = ['score', 'newest', 'year', 'title'];

export function normalizeCandidateSort(sort) {
  return CANDIDATE_SORTS.includes(sort) ? sort : 'score';
}

export function sortCandidates(items, sort = 'score') {
  const key = normalizeCandidateSort(sort);
  const byNewest = (a, b) => String(b.added_at || '').localeCompare(String(a.added_at || ''));
  const sorters = {
    score: (a, b) => (Number(b.t0?.score) || 0) - (Number(a.t0?.score) || 0) || byNewest(a, b),
    newest: byNewest,
    year: (a, b) => (Number(b.year) || 0) - (Number(a.year) || 0) || byNewest(a, b),
    title: (a, b) => String(a.title || '').localeCompare(String(b.title || '')),
  };
  return { key, rows: [...items].sort(sorters[key]) };
}

/**
 * 按状态/来源/关键词查候选。
 *
 * status 支持逗号分隔的多个状态（`new,parked,failed`）：处理队列的「待处理」
 * 与「被过滤」都是跨状态的集合，一个状态一个请求会把列表拆碎。
 */
export async function queryCandidates(baseDir, { status = 'new', q = '', source = '', since = '', until = '', limit = 20, offset = 0, sort = 'score' } = {}) {
  const items = Object.values(await readCandidates(baseDir));
  const sinceMs = /^\d{4}-\d{2}-\d{2}$/.test(String(since || '')) ? Date.parse(`${since}T00:00:00+08:00`) : null;
  const untilMs = /^\d{4}-\d{2}-\d{2}$/.test(String(until || '')) ? Date.parse(`${until}T23:59:59.999+08:00`) : null;
  const timeHit = (item) => {
    if (sinceMs === null && untilMs === null) return true;
    const raw = item.added_at || item.first_seen_at || '';
    const at = Date.parse(raw);
    if (!Number.isFinite(at)) return false;
    if (sinceMs !== null && at < sinceMs) return false;
    if (untilMs !== null && at > untilMs) return false;
    return true;
  };
  const windowItems = items.filter(timeHit);
  const needle = String(q || '').trim().toLowerCase();
  const wanted = String(status || 'new').split(',').map((s) => s.trim()).filter(Boolean);
  const everyStatus = wanted.includes('all') || wanted.length === 0;
  // 来源过滤：候选的 sources 里存的是 rss:feed-x / arxiv / search:auto 这类键；
  // 传 rss: 前缀时按前缀匹配（一个订阅失败不该让整个 RSS 渠道都查不到）。
  const wantedSource = String(source || '').trim();
  const sourceHit = (item) => {
    if (!wantedSource) return true;
    const list = Array.isArray(item.sources) ? item.sources : [];
    if (wantedSource.endsWith(':')) return list.some((s) => String(s).startsWith(wantedSource));
    return list.includes(wantedSource);
  };
  const filtered = windowItems
    .filter((item) => everyStatus || wanted.includes(item.status))
    .filter((item) => !needle
      || `${item.title} ${item.abstract} ${(item.authors || []).join(' ')}`.toLowerCase().includes(needle))
    .filter(sourceHit);
  const { key: sortKey, rows } = sortCandidates(filtered, sort);

  const start = Math.max(0, Math.trunc(Number(offset)) || 0);
  const size = Math.min(100, Math.max(1, Number(limit) || 20));
  return {
    total: rows.length,
    offset: start,
    limit: size,
    sort: sortKey,
    items: rows.slice(start, start + size).map((item) => ({
      ...item,
      abstract: item.abstract ? String(item.abstract).slice(0, 800) : null,
    })),
    window: {
      since: sinceMs === null ? null : String(since),
      until: untilMs === null ? null : String(until),
      timezone: 'Asia/Shanghai',
    },
    counts: windowItems.reduce((acc, item) => {
      acc[item.status] = (acc[item.status] || 0) + 1;
      return acc;
    }, {}),
  };
}
