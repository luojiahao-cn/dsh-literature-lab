/**
 * Zotero 只读联动：给 AI 分析关键词用。
 *
 * 为什么不是「自动入库」：Zotero 入库是显式决定。这里只读库里的标题/摘要/标签/分类，
 * 在本地做词频与标签统计，把「你的库大概在关心什么」交给 AI 判断，再由 AI 写关键词。
 *
 * 能力：
 * - Web API（users 或 groups），只读 key 即可；分页拉取、限速、缓存到 state/zotero.json
 * - 本地统计：标签频次、题名+摘要的 unigram/bigram 文档频次、分类计数
 * - 样本：最近 N 条（可选带摘要），给 AI 直接读
 *
 * 凭据只存在本机 state/config.json（已 gitignore），不写日志、不出现在工具返回值里。
 */
import { randomBytes } from 'node:crypto';
import { politeFetch } from './http.js';
import { updateState } from './state.js';
import * as store from './store.js';

const API = 'https://api.zotero.org';
const MAX_ITEMS = 2000;
const PAGE = 100;
const CACHE_TTL_MS = 24 * 3600 * 1000;

const STOPWORDS = new Set(`
a about above after again against all also am an and any are as at be because been before
being below between both but by can could did do does doing down during each few for from
further had has have having he her here hers herself him himself his how i if in into is it
its itself just me more most my myself no nor not now of off on once only or other our ours
ourselves out over own same she should so some such than that the their theirs them
themselves then there these they this those through to too under until up very was we were
what when where which while who whom why will with would you your yours yourself yourselves
however therefore thus although though using used uses use based paper results method methods
approach approaches study studies analysis experimental experiment proposed propose present
presents show shows shown significant significantly high low higher lower new novel different
two three one first second also may can could well within without across along toward towards
this that these those than into onto via per among between during under over
`.split(/\s+/).filter(Boolean));

/** 读取已保存的本地写授权（Zotero 10+）。 */
export async function readLocalKey(baseDir) {
  const paths = store.statePaths(baseDir);
  const parsed = await store.readJson(paths.zoteroKey, null);
  return parsed && parsed.key ? parsed : null;
}

async function writeLocalKey(baseDir, record) {
  const paths = store.statePaths(baseDir);
  return store.withLock('zotero-key', async () => {
    // 本地写 key 等同于库的写权限：只给当前用户读
    await store.writeJsonAtomic(paths.zoteroKey, record, { mode: 0o600 });
    return record;
  });
}

/** 本机 API 的 Server-ID：写请求（含 authorize）必须带它。 */
async function localServerId(zotero) {
  const res = await politeFetch(`${apiBase(zotero)}/items?limit=1&format=json`, {
    headers: apiHeaders(zotero),
    timeoutMs: 8000,
    retries: 0,
    minIntervalMs: 0,
    as: 'text',
  });
  const serverId = res.headers.get('Zotero-Server-ID');
  if (!serverId) throw new Error('本机 API 没有返回 Zotero-Server-ID（需要 Zotero 10+）');
  return serverId;
}

/**
 * 申请本地写权限：Zotero 会弹窗（Allow / Always Allow / Deny）。
 * 只有 Always Allow 会记住 key；其余只在当次有效。
 */
export async function authorizeLocalWrites(baseDir, config, { appName = 'DeepSeek Harness 文献实验室' } = {}) {
  const zotero = zoteroConfig(config);
  if (!zotero.enabled) throw new Error('Zotero 未启用：在「设置 → Zotero」里打开');
  if (zotero.mode !== 'local') throw new Error('当前不是本机模式：请先切到「本机 API」');
  const serverId = await localServerId(zotero);
  const res = await politeFetch(`${apiRoot(zotero)}/local/authorize`, {
    method: 'POST',
    as: 'text',
    headers: {
      ...apiHeaders(zotero),
      'content-type': 'application/json',
      'Zotero-Server-ID': serverId,
    },
    body: JSON.stringify({ appName }),
    // 弹窗要等人点，给足时间
    timeoutMs: 120000,
    retries: 0,
    minIntervalMs: 0,
  });
  const data = JSON.parse(res.body);
  const key = data?.key;
  if (!key) throw new Error('Zotero 没有返回本地 key（可能被拒绝）');
  const remember = Boolean(data.remember);
  if (remember) {
    await writeLocalKey(baseDir, {
      serverId, key, remember: true, appName, at: new Date().toISOString(),
    });
  }
  return { serverId, remember, appName };
}

/** 取一个可用的本地写凭据；没有授权时给出可执行的提示。 */
async function localWriteCredentials(baseDir, zotero) {
  let serverId = '';
  try {
    serverId = await localServerId(zotero);
  } catch (error) {
    const cached = await readLocalKey(baseDir);
    if (cached?.serverId) serverId = cached.serverId;
    else throw error;
  }
  const saved = await readLocalKey(baseDir);
  if (!saved || saved.serverId !== serverId) {
    throw new Error('本机写未授权：调用 literature-lab_zotero {action:"authorize"}，在 Zotero 弹窗里选「Always Allow」');
  }
  return { serverId, key: saved.key };
}

export async function readZoteroCache(baseDir) {
  const paths = store.statePaths(baseDir);
  const parsed = await store.readJson(paths.zotero, null);
  return parsed && Array.isArray(parsed.items) ? parsed : null;
}

async function writeZoteroCache(baseDir, cache) {
  const paths = store.statePaths(baseDir);
  return store.withLock('zotero', () => store.writeJsonAtomic(paths.zotero, cache));
}

function zoteroConfig(config) {
  const zotero = config?.integrations?.zotero || {};
  return {
    enabled: zotero.enabled !== false,
    mode: zotero.mode === 'local' ? 'local' : 'web',
    localPort: Number(zotero.localPort) || 23119,
    userId: String(zotero.userId || '').trim(),
    groupId: String(zotero.groupId || '').trim(),
    apiKey: String(zotero.apiKey || '').trim(),
  };
}

/** web 走 api.zotero.org；local 走 Zotero 桌面本地 API（免 key，需在 Zotero 设置里允许本机访问）。 */
function apiBase(zotero) {
  if (zotero.mode === 'local') return `http://127.0.0.1:${zotero.localPort}/api/users/0`;
  return zotero.groupId ? `${API}/groups/${zotero.groupId}` : `${API}/users/${zotero.userId}`;
}

/** 本地 API 的根（授权端点在 /api/local/authorize，不在 users/0 下）。 */
function apiRoot(zotero) {
  return zotero.mode === 'local' ? `http://127.0.0.1:${zotero.localPort}/api` : API;
}

function apiHeaders(zotero) {
  const headers = { 'Zotero-API-Version': '3', accept: 'application/json' };
  if (zotero.mode === 'web') headers['Zotero-API-Key'] = zotero.apiKey;
  return headers;
}

function compactItem(entry) {
  const data = entry?.data || {};
  const abstract = String(data.abstractNote || '').replace(/\s+/g, ' ').trim();
  return {
    key: entry.key,
    itemType: data.itemType || '',
    title: String(data.title || '').replace(/\s+/g, ' ').trim(),
    abstract: abstract.slice(0, 1500),
    doi: data.DOI || '',
    archiveId: data.archiveID || '',
    year: String(data.date || '').slice(0, 4),
    venue: data.publicationTitle || data.conferenceName || data.bookTitle || '',
    tags: (data.tags || []).map((tag) => tag.tag).filter(Boolean),
    collections: Array.isArray(data.collections) ? data.collections : [],
    dateModified: entry?.data?.dateModified || null,
  };
}

async function fetchAll(zotero, { maxItems = MAX_ITEMS } = {}) {
  const base = apiBase(zotero);
  const headers = apiHeaders(zotero);
  const items = [];
  let total = null;
  let truncated = false;

  for (let start = 0; start < maxItems; start += PAGE) {
    const res = await politeFetch(
      `${base}/items?format=json&limit=${PAGE}&start=${start}&sort=dateModified&direction=desc`,
      { headers, timeoutMs: 30000, retries: 2, minIntervalMs: 1000 },
    );
    if (total === null) {
      const headerTotal = Number(res.headers.get('total-results'));
      total = Number.isFinite(headerTotal) ? headerTotal : null;
    }
    const page = JSON.parse(res.body);
    if (!Array.isArray(page) || !page.length) break;
    for (const entry of page) {
      const item = compactItem(entry);
      if (!item.title) continue;
      if (['attachment', 'note', 'annotation'].includes(item.itemType)) continue;
      items.push(item);
    }
    if (page.length < PAGE) break;
    if (start + PAGE >= maxItems) truncated = true;
  }

  // 分类名（失败不影响主流程，只是没有名字）
  let collections = [];
  try {
    const res = await politeFetch(`${base}/collections?format=json&limit=100`, {
      headers, timeoutMs: 20000, retries: 1, minIntervalMs: 1000,
    });
    const page = JSON.parse(res.body);
    if (Array.isArray(page)) {
      collections = page
        .map((entry) => ({ key: entry.key, name: entry.data?.name || '' }))
        .filter((c) => c.name);
    }
  } catch { /* 忽略 */ }

  return { total, items, collections, truncated };
}

/**
 * 取库：缓存 24h，refresh=true 强制刷新。
 * @returns {Promise<object>} cache
 */
export async function syncZotero(baseDir, config, { refresh = false, maxItems = MAX_ITEMS } = {}) {
  const zotero = zoteroConfig(config);
  if (!zotero.enabled) throw new Error('Zotero 未启用：在「设置 → Zotero」里打开');
  if (zotero.mode === 'web' && (!zotero.userId || !zotero.apiKey)) {
    throw new Error('Zotero 未配置：web 模式需要 userId 与只读 API key（设置 → Zotero）；或改用本机模式');
  }

  const cache = await readZoteroCache(baseDir);
  const sameSource = cache?.source?.mode === zotero.mode
    && (cache?.source?.userId || '') === zotero.userId
    && (cache?.source?.groupId || '') === zotero.groupId
    && (cache?.source?.localPort || 0) === (zotero.mode === 'local' ? zotero.localPort : 0);
  const fresh = cache && Date.parse(cache.fetched_at) > Date.now() - CACHE_TTL_MS;
  if (!refresh && cache && sameSource && fresh) return cache;

  const fetched = await fetchAll(zotero, { maxItems });
  const next = {
    fetched_at: new Date().toISOString(),
    source: {
      mode: zotero.mode,
      userId: zotero.userId,
      groupId: zotero.groupId,
      localPort: zotero.mode === 'local' ? zotero.localPort : 0,
    },
    total: fetched.total,
    truncated: fetched.truncated,
    items: fetched.items,
    collections: fetched.collections,
  };
  await writeZoteroCache(baseDir, next);
  return next;
}

function tokenize(text) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFKC')
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter((token) => token.length >= 3 && token.length <= 30
      && !/^\d+$/.test(token) && !STOPWORDS.has(token));
}

/** 本地统计：标签频次 + unigram/bigram 文档频次（一篇论文只计一次）。 */
export function termStats(items) {
  const tagCounts = new Map();
  const uni = new Map();
  const bi = new Map();
  for (const item of items) {
    for (const tag of item.tags || []) tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
    const tokens = tokenize(`${item.title || ''} ${item.abstract || ''}`);
    const uniSeen = new Set(tokens);
    const biSeen = new Set();
    for (let i = 0; i < tokens.length - 1; i += 1) biSeen.add(`${tokens[i]} ${tokens[i + 1]}`);
    for (const token of uniSeen) uni.set(token, (uni.get(token) || 0) + 1);
    for (const gram of biSeen) bi.set(gram, (bi.get(gram) || 0) + 1);
  }
  const top = (map, limit) => [...map.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([term, df]) => ({ term, df }));
  const topTags = [...tagCounts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 30)
    .map(([tag, count]) => ({ tag, count }));
  return {
    topTags,
    unigrams: top(uni, 40),
    bigrams: top(bi, 40),
  };
}

/**
 * 生成给 AI 的关键词分析档案。
 * 不返回 apiKey；样本默认带摘要，便于 AI 判断领域。
 */
export function buildProfile(cache, { limit = 30, withAbstracts = true, collection = '' } = {}) {
  const all = cache.items || [];
  const collections = (cache.collections || []).map((col) => ({
    ...col,
    count: all.filter((item) => (item.collections || []).includes(col.key)).length,
  }));

  let scoped = all;
  if (collection) {
    const match = collections.find((col) => col.key === collection || col.name === collection);
    if (!match) throw new Error(`没有找到分类：${collection}`);
    scoped = all.filter((item) => (item.collections || []).includes(match.key));
  }

  const stats = termStats(scoped);
  const sample = scoped.slice(0, Math.min(100, Math.max(1, Number(limit) || 30))).map((item) => ({
    title: item.title,
    year: item.year || null,
    venue: item.venue || null,
    doi: item.doi || null,
    tags: item.tags || [],
    ...(withAbstracts && item.abstract ? { abstract: item.abstract } : {}),
  }));

  return {
    library: {
      total: cache.total,
      cached: all.length,
      fetched_at: cache.fetched_at,
      truncated: Boolean(cache.truncated),
      scope: collection || 'all',
    },
    collections,
    topTags: stats.topTags,
    terms: { unigrams: stats.unigrams, bigrams: stats.bigrams },
    sample,
  };
}

/**
 * 在缓存的库里检索（不联网）；给后续阶段（查重、找卡、相关文献）用。
 * q 匹配标题/摘要/标签；tag 精确匹配标签；collection 可给 key 或名字。
 */
export function queryLibrary(cache, { q = '', tag = '', collection = '', yearFrom = 0, limit = 20 } = {}) {
  const needle = String(q || '').trim().toLowerCase();
  const tagNeedle = String(tag || '').trim().toLowerCase();
  const year = Number(yearFrom) || 0;
  let scoped = cache.items || [];

  if (collection) {
    const match = (cache.collections || []).find((col) => col.key === collection || col.name === collection);
    if (!match) throw new Error(`没有找到分类：${collection}`);
    scoped = scoped.filter((item) => (item.collections || []).includes(match.key));
  }

  const rows = scoped.filter((item) => {
    if (year && Number(item.year) && Number(item.year) < year) return false;
    if (tagNeedle && !(item.tags || []).some((t) => t.toLowerCase() === tagNeedle)) return false;
    if (!needle) return true;
    return `${item.title} ${item.abstract} ${(item.tags || []).join(' ')}`.toLowerCase().includes(needle);
  });

  return {
    total: rows.length,
    items: rows.slice(0, Math.min(100, Math.max(1, Number(limit) || 20))).map((item) => ({
      key: item.key,
      title: item.title,
      year: item.year || null,
      venue: item.venue || null,
      doi: item.doi || null,
      tags: item.tags || [],
      abstract: item.abstract ? item.abstract.slice(0, 600) : null,
    })),
  };
}

/** 按 Zotero key 或 DOI 找一条（给去重/入库核对用）。 */
export function findItem(cache, { key = '', doi = '' } = {}) {
  const byKey = key ? (cache.items || []).find((item) => item.key === key) : null;
  if (byKey) return byKey;
  const needle = String(doi || '').trim().toLowerCase();
  if (!needle) return null;
  return (cache.items || []).find((item) => (item.doi || '').toLowerCase() === needle) || null;
}

const GRADE_ORDER = { S: 0, A: 1, B: 2, C: 3, D: 4 };

/** 自动入库策略：默认关闭；开启后只对达到等级的论文入库。 */
export function shouldAutoImport(config, paper) {
  const zotero = config?.integrations?.zotero || {};
  const policy = zotero.autoImport || {};
  if (zotero.enabled === false || policy.enabled !== true) return false;
  if (!paper?.grade || paper.zotero_key) return false;
  if (GRADE_ORDER[paper.grade] > GRADE_ORDER[policy.minGrade || 'B']) return false;
  if (policy.requirePdf && !paper.pdf) return false;
  return true;
}

function creatorOf(name) {
  const value = String(name || '').trim();
  if (!value) return null;
  if (/\s/.test(value)) {
    const parts = value.split(/\s+/);
    return { creatorType: 'author', firstName: parts.slice(0, -1).join(' '), lastName: parts[parts.length - 1] };
  }
  return { creatorType: 'author', name: value };
}

/** 把一条文献映射成 Zotero item（preprint / journalArticle）。 */
export function zoteroItemOf(paper, { collectionKey = '' } = {}) {
  const authors = (paper.meta?.authors || []).map(creatorOf).filter(Boolean);
  const itemType = paper.arxiv_id ? 'preprint' : 'journalArticle';
  const year = paper.meta?.year || (paper.published_at ? String(paper.published_at).slice(0, 4) : '');
  const item = {
    itemType,
    title: paper.title,
    creators: authors,
    abstractNote: paper.abstract || paper.summary || '',
    date: year ? String(year) : '',
    DOI: paper.doi || '',
    url: paper.url || (paper.arxiv_id ? `https://arxiv.org/abs/${paper.arxiv_id}` : ''),
    tags: [
      { tag: 'dsh-literature-lab' },
      ...(paper.l1?.domain ? [{ tag: `L1:${paper.l1.domain}` }] : []),
    ],
  };
  if (itemType === 'preprint') {
    item.repository = paper.meta?.venue || 'arXiv';
    item.archiveID = paper.arxiv_id ? `arXiv:${paper.arxiv_id}` : '';
  } else if (paper.meta?.venue) {
    item.publicationTitle = paper.meta.venue;
  }
  if (collectionKey) item.collections = [collectionKey];
  return item;
}

function collectionKeyOf(cache, name) {
  if (!name) return '';
  const match = (cache?.collections || []).find((col) => col.key === name || col.name === name);
  if (!match) throw new Error(`Zotero 里没有分类「${name}」`);
  return match.key;
}

function cachedCopyOf(cache, paper) {
  if (!cache) return null;
  const doi = String(paper.doi || '').toLowerCase();
  const archive = paper.arxiv_id ? `arXiv:${paper.arxiv_id}` : '';
  return (cache.items || []).find((item) => (doi && (item.doi || '').toLowerCase() === doi)
    || (archive && item.archiveId === archive)) || null;
}

/**
 * 把论文写入 Zotero。需要 web 模式 + 写权限的 key；本地 API 只读。
 * 已入库（paper.zotero_key）或库里已有同 DOI/arXiv 的，跳过并回填 key。
 */
export async function importPapers(baseDir, config, state, papers, { collection = '', dryRun = false } = {}) {
  const zotero = zoteroConfig(config);
  if (!zotero.enabled) throw new Error('Zotero 未启用：在「设置 → Zotero」里打开');
  let localAuth = null;
  if (zotero.mode === 'web') {
    if (!zotero.userId || !zotero.apiKey) throw new Error('入库需要 Zotero userId 与有写权限的 API key');
  } else {
    localAuth = await localWriteCredentials(baseDir, zotero);
  }

  const cache = await readZoteroCache(baseDir);
  const collectionKey = collectionKeyOf(cache, collection);
  const base = apiBase(zotero);
  const headers = {
    ...apiHeaders(zotero),
    ...(localAuth ? { 'Zotero-API-Key': localAuth.key, 'Zotero-Server-ID': localAuth.serverId } : {}),
  };
  const results = [];
  const patches = {};

  for (const paper of papers) {
    const id = paper.__id
      || Object.keys(state?.papers || {}).find((key) => state.papers[key] === paper)
      || paper.title;
    if (paper.zotero_key) {
      results.push({ id, ok: true, skipped: 'already-imported', key: paper.zotero_key });
      continue;
    }
    const cached = cachedCopyOf(cache, paper);
    if (cached) {
      patches[id] = {
        zotero_key: cached.key,
        zotero_import: { at: new Date().toISOString(), ok: true, key: cached.key, via: 'library-match' },
      };
      results.push({ id, ok: true, skipped: 'already-in-zotero', key: cached.key });
      continue;
    }

    const item = zoteroItemOf(paper, { collectionKey });
    if (dryRun) {
      results.push({ id, ok: true, dryRun: true, item });
      continue;
    }

    try {
      const res = await politeFetch(`${base}/items`, {
        method: 'POST',
        as: 'text',
        headers: {
          ...headers,
          'content-type': 'application/json',
          // 同一 token 的重试不会产生重复条目
          'Zotero-Write-Token': randomBytes(16).toString('hex'),
        },
        body: JSON.stringify(item),
        timeoutMs: 30000,
        retries: 1,
        minIntervalMs: 1000,
      });
      const created = JSON.parse(res.body);
      const key = created?.key;
      if (!key) throw new Error('Zotero 没有返回 key');
      patches[id] = {
        zotero_key: key,
        zotero_import: { at: new Date().toISOString(), ok: true, key },
      };
      results.push({ id, ok: true, key });
    } catch (error) {
      const message = String(error?.message || error);
      patches[id] = {
        zotero_import: { at: new Date().toISOString(), ok: false, error: message },
      };
      results.push({ id, ok: false, error: message });
    }
  }

  for (const paper of papers) delete paper.__id;
  if (!dryRun && Object.keys(patches).length) {
    // 让调用方手上的快照也能看到结果；持久化仍以磁盘最新状态为准
    for (const [id, patch] of Object.entries(patches)) {
      if (state?.papers?.[id]) Object.assign(state.papers[id], patch);
    }
    await updateState(baseDir, (latest) => {
      for (const [id, patch] of Object.entries(patches)) {
        const paper = latest.papers?.[id];
        if (!paper) continue;
        Object.assign(paper, patch);
        paper.updated_at = patch.zotero_import?.at || new Date().toISOString();
      }
    });
  }
  return { ok: true, dryRun, collection: collectionKey || null, results };
}

/** 给 /state 用的轻量摘要（不含样本与凭据）。 */
export async function zoteroSummary(baseDir) {
  const cache = await readZoteroCache(baseDir);
  const localKey = await readLocalKey(baseDir);
  if (!cache) {
    return localKey ? { localAuthorized: true } : null;
  }
  const ageMs = Date.now() - Date.parse(cache.fetched_at);
  return {
    total: cache.total,
    cached: cache.items.length,
    fetched_at: cache.fetched_at,
    stale: ageMs > CACHE_TTL_MS,
    localAuthorized: Boolean(localKey),
  };
}
