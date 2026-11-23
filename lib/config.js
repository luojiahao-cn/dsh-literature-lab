/**
 * 配置层：config/default.json 提供出厂默认，state/config.json 保存用户修改。
 *
 * P0 起用户配置的写入经 lib/store.js（锁 + 原子写）。
 * 默认配置不含任何具体研究方向的词——插件要能被任何领域的用户直接用。
 */
import path from 'node:path';
import * as store from './store.js';

const CONFIG_VERSION = 1;

function defaultsPath(baseDir) {
  return path.join(baseDir, 'config', 'default.json');
}

function userConfigPath(baseDir) {
  return store.statePaths(baseDir).config;
}

/** 深合并：对象递归，数组整体替换（用户改源列表就是整份替换）。 */
function merge(base, override) {
  if (override === undefined) return base;
  if (Array.isArray(base) || Array.isArray(override)) return override;
  if (base && override && typeof base === 'object' && typeof override === 'object') {
    const out = { ...base };
    for (const k of Object.keys(override)) out[k] = merge(base[k], override[k]);
    return out;
  }
  return override;
}

/** 密钥不落在 config：null/空串表示清除该字段。 */
function sanitizeUserConfig(config) {
  const zotero = config?.integrations?.zotero;
  if (zotero && 'apiKey' in zotero && !zotero.apiKey) delete zotero.apiKey;
  return config;
}

/** 去掉对象上的某个键，返回原对象或浅拷贝；不改动传入对象。 */
function withoutKey(object, key) {
  if (!object || typeof object !== 'object' || !(key in object)) return object;
  const copy = { ...object };
  delete copy[key];
  return copy;
}

/**
 * 剔除已废弃的配置键：老用户的 state/config.json 里可能还留着，
 * 读出来时统一隐藏，UI 与下游只看到现行 schema。
 * 只作用于读出的合并结果，不回写用户的配置文件。
 */
export function stripLegacy(config) {
  if (!config || typeof config !== 'object') return config;
  const integrations = withoutKey(config.integrations, 'translate');
  const analysis = withoutKey(config.analysis, 'autoZotero');
  if (integrations === config.integrations && analysis === config.analysis) return config;
  const out = { ...config };
  if (integrations !== config.integrations) out.integrations = integrations;
  if (analysis !== config.analysis) out.analysis = analysis;
  return out;
}

/** 读「默认 + 用户覆盖」后的完整配置。密钥字段与废弃键已剔除。 */
export async function readConfig(baseDir) {
  const defaults = await store.readJson(defaultsPath(baseDir), {});
  const user = await store.readJson(userConfigPath(baseDir), {});
  return stripLegacy(sanitizeUserConfig(merge(defaults, user)));
}

/** 只写用户改过的部分，默认值永远来自包里。 */
export async function writeUserConfig(baseDir, patch) {
  return store.withLock('config', async () => {
    const defaults = await store.readJson(defaultsPath(baseDir), {});
    const current = await store.readJson(userConfigPath(baseDir), {});
    const next = sanitizeUserConfig(merge(current, patch));
    await store.writeJsonAtomic(userConfigPath(baseDir), next);
    return stripLegacy(sanitizeUserConfig(merge(defaults, next)));
  });
}

/** 启用的 RSS 源。 */
export function enabledFeeds(config) {
  return (config?.sources?.rss || []).filter((f) => f && f.enabled !== false && f.url);
}

/** arXiv 源是否可用（至少要有一个分类或查询式）。 */
export function arxivSource(config) {
  const arxiv = config?.sources?.arxiv;
  if (!arxiv || arxiv.enabled === false) return null;
  const categories = Array.isArray(arxiv.categories) ? arxiv.categories.filter(Boolean) : [];
  const queries = Array.isArray(arxiv.queries) ? arxiv.queries.filter(Boolean) : [];
  if (!categories.length && !queries.length) return null;
  return { ...arxiv, categories, queries };
}

/** 配置里的检索式（watchlist 思路）。 */
export function searchQueries(config) {
  const search = config?.sources?.search;
  if (!search || search.enabled === false) return [];
  const queries = Array.isArray(search.queries) ? search.queries : [];
  return queries
    .filter((q) => q && typeof q.text === 'string' && q.text.trim())
    .map((q, index) => ({
      id: String(q.id || `q${index + 1}`),
      text: q.text.trim(),
      sources: Array.isArray(q.sources) && q.sources.length
        ? q.sources
        : (Array.isArray(search.sources) ? search.sources : undefined),
      sinceDays: Number(q.sinceDays) || Number(search.sinceDays) || 30,
      limit: Number(q.limit) || Number(search.limit) || 20,
    }));
}

/** 网络参数，带默认值。 */
export function networkOf(config) {
  const net = config?.network || {};
  const num = (value, fallback) => (Number.isFinite(Number(value)) ? Number(value) : fallback);
  return {
    timeoutMs: num(net.timeoutMs, 20000),
    retries: num(net.retries, 2),
    rssIntervalMs: num(net.rssIntervalMs, 1000),
    arxivIntervalMs: num(net.arxivIntervalMs, 3000),
    arxivMaxPages: num(net.arxivMaxPages, 20),
  };
}

/**
 * 通用兴趣评分：关键词 / 辅助词 / 期刊会议 / 作者 / 领域标签或 MeSH / 时效。
 * 所有信号都可配置；列表留空就不用该信号，默认不绑定任何研究方向。
 */
export function scorePaper(item, config) {
  const rel = config?.relevance || {};
  const strong = Array.isArray(rel.keywords) ? rel.keywords : [];
  const weak = Array.isArray(rel.contextKeywords) ? rel.contextKeywords : [];
  const excludes = Array.isArray(rel.excludeKeywords) ? rel.excludeKeywords : [];
  const venues = Array.isArray(rel.venues) ? rel.venues : [];
  const authors = Array.isArray(rel.authors) ? rel.authors : [];
  const categories = Array.isArray(rel.categories) ? rel.categories : [];
  const mesh = Array.isArray(rel.mesh) ? rel.mesh : [];
  const weights = {
    keyword: 3, context: 1, venue: 4, author: 3, category: 2, mesh: 2, recency: 0,
    ...(rel.weights || {}),
  };

  const text = [item?.title, item?.summary, ...(Array.isArray(item?.authors) ? item.authors : [])]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  const test = (pattern) => {
    try { return new RegExp(pattern, 'i').test(text); } catch { return false; }
  };
  const norm = (value) => String(value || '').toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, ' ').trim();
  const contains = (haystack, needle) => {
    const n = norm(needle);
    return Boolean(n) && norm(haystack).includes(n);
  };

  const strongHits = strong.filter(test);
  const weakHits = weak.filter(test);
  const excludeHits = excludes.filter(test);
  const venueText = item?.venue || item?.journal || item?.container || '';
  const venueHits = venues.filter((value) => contains(venueText, value));
  const authorHits = authors.filter((value) => (Array.isArray(item?.authors) ? item.authors : [])
    .some((author) => contains(author, value)));
  const categoryList = [
    item?.category,
    ...(Array.isArray(item?.categories) ? item.categories : []),
  ].filter(Boolean);
  const categoryHits = categories.filter((value) => categoryList.some((category) => contains(category, value)));
  const meshList = item?.mesh || item?.meshTerms || [];
  const meshHits = mesh.filter((value) => (Array.isArray(meshList) ? meshList : []).some((term) => contains(term, value)));

  let score = strongHits.length * Number(weights.keyword || 0)
    + weakHits.length * Number(weights.context || 0)
    + venueHits.length * Number(weights.venue || 0)
    + authorHits.length * Number(weights.author || 0)
    + categoryHits.length * Number(weights.category || 0)
    + meshHits.length * Number(weights.mesh || 0);

  let recencyBonus = 0;
  const recencyDays = Number(rel.recencyDays) || 0;
  if (recencyDays > 0 && item?.publishedAt) {
    const time = Date.parse(item.publishedAt);
    if (Number.isFinite(time) && Date.now() - time <= recencyDays * 86400 * 1000) {
      recencyBonus = Number(weights.recency) || 0;
      score += recencyBonus;
    }
  }

  const filtered = strong.length > 0 || weak.length > 0 || venues.length > 0
    || authors.length > 0 || categories.length > 0 || mesh.length > 0;

  return {
    score,
    hits: [
      ...strongHits,
      ...weakHits,
      ...venueHits.map((value) => `venue:${value}`),
      ...authorHits.map((value) => `author:${value}`),
      ...categoryHits.map((value) => `category:${value}`),
      ...meshHits.map((value) => `mesh:${value}`),
    ],
    excluded: excludeHits.length > 0,
    excludeHits,
    filtered,
    signals: {
      keyword: strongHits.length,
      context: weakHits.length,
      venue: venueHits.length,
      author: authorHits.length,
      category: categoryHits.length,
      mesh: meshHits.length,
      recency: recencyBonus,
    },
  };
}

/** 从兴趣关键词里挑出能直接给外部数据库用的“纯文本”词（跳过正则样式）。 */
export function interestQueryTerms(config, limit = 8) {
  const rel = config?.relevance || {};
  const raw = [
    ...(Array.isArray(rel.keywords) ? rel.keywords : []),
    ...(Array.isArray(rel.contextKeywords) ? rel.contextKeywords : []),
  ];
  const terms = raw
    .map((value) => String(value || '').trim())
    .filter((value) => value.length >= 3)
    .filter((value) => !/[\[\]()|?*+\\^$]/.test(value));
  return [...new Set(terms)].slice(0, Math.max(1, Number(limit) || 8));
}

/** 没有手写检索式时，用研究兴趣词自动生成关注式检索。 */
export function autoSearchSpecs(config) {
  const search = config?.sources?.search || {};
  if (search.enabled === false) return [];
  const sources = Array.isArray(search.sources) && search.sources.length
    ? search.sources
    : ['arxiv', 'openalex', 'crossref'];
  return interestQueryTerms(config, 3).map((text, index) => ({
    id: `auto-${index}`,
    text,
    sources,
    sinceDays: Number(search.sinceDays) || 30,
    limit: Number(search.limit) || 20,
  }));
}

/** 最低入队分数。 */
export function minScoreOf(config) {
  const value = Number(config?.relevance?.minScore);
  // 默认 3＝命中 1 个核心关键词就入队；5 分要 2 个核心词，对本领域太严
  return Number.isFinite(value) ? value : 3;
}

export { CONFIG_VERSION };
