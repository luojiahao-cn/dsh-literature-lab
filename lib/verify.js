/**
 * 引用核验：在判读之前先确认「这条引文真实存在，且 DOI 没指向别的论文」。
 *
 * 四档（判真）+ 两档（判疑）：
 *   crossref-ok / datacite-ok / arxiv-ok —— 一手来源有记录且题名对得上，可支撑 S/A/B；
 *   title-ok —— 只有题名检索能对上（缺正式 DOI 记录、或题名差异较大），最高只能到 C；
 *   unindexed —— 哪个索引都没有：不判假（中文 DOI、机构库、新预印本很常见），最高 C；
 *   fabricated —— DOI 存在但指向另一篇论文，属于「张冠李戴」，直接丢弃。
 *
 * 判假的门槛刻意收窄：只有「DOI 有记录但题名明显是另一篇」才算 fabricated，
 * 找不到记录一律 unindexed，避免把中文期刊误杀。
 */
import path from 'node:path';
import * as store from './store.js';
import { politeFetch } from './http.js';
import { titleSimilarity } from './metadata.js';

export const VERIFICATION = {
  CROSSREF_OK: 'crossref-ok',
  DATACITE_OK: 'datacite-ok',
  ARXIV_OK: 'arxiv-ok',
  TITLE_OK: 'title-ok',
  UNINDEXED: 'unindexed',
  FABRICATED: 'fabricated',
};

export const TRUSTED_VERIFICATIONS = new Set([
  VERIFICATION.CROSSREF_OK, VERIFICATION.DATACITE_OK, VERIFICATION.ARXIV_OK,
]);

export const VERIFY_LABEL = {
  [VERIFICATION.CROSSREF_OK]: 'Crossref 已收录',
  [VERIFICATION.DATACITE_OK]: 'DataCite 已收录',
  [VERIFICATION.ARXIV_OK]: 'arXiv 已收录',
  [VERIFICATION.TITLE_OK]: '题名可对上，但缺正式 DOI 记录',
  [VERIFICATION.UNINDEXED]: '未在任何索引里找到',
  [VERIFICATION.FABRICATED]: 'DOI 指向另一篇论文',
};

const SAME_WORK_SIM = 0.8;
const DIFFERENT_WORK_SIM = 0.5;
const TITLE_SEARCH_SIM = 0.9;
const TTL_TRUSTED = 30 * 24 * 60 * 60 * 1000;
const TTL_WEAK = 7 * 24 * 60 * 60 * 1000;

function cleanDoi(doi) {
  return String(doi || '').replace(/^https?:\/\/doi\.org\//i, '').replace(/^doi:/i, '').trim();
}

async function getJson(url) {
  const res = await politeFetch(url, {
    timeoutMs: 15000, retries: 1, minIntervalMs: 800, headers: { accept: 'application/json' },
  });
  return JSON.parse(res.body);
}

async function getText(url) {
  const res = await politeFetch(url, { timeoutMs: 15000, retries: 1, minIntervalMs: 800 });
  return res.body;
}

async function crossrefRecord(doi) {
  try {
    const data = await getJson(`https://api.crossref.org/works/${encodeURIComponent(doi)}`);
    const message = data?.message;
    const title = (message?.title || [''])[0] || '';
    // 只有真的是 Crossref 记录才算命中：防止被别的 JSON 端点误伤成「指向另一篇」
    if (!message || !message.DOI || !title) return { found: false };
    return { found: true, title, doi: (message.DOI || '').toLowerCase() || null };
  } catch {
    return { found: false };
  }
}

async function dataciteRecord(doi) {
  try {
    const data = await getJson(`https://api.datacite.org/dois/${encodeURIComponent(doi)}`);
    const attrs = data?.data?.attributes;
    const title = (attrs?.titles || [{}])[0]?.title || '';
    if (!attrs || !title) return { found: false };
    return { found: true, title };
  } catch {
    return { found: false };
  }
}

async function arxivRecord(arxivId) {
  const id = String(arxivId || '').replace(/^arxiv:/i, '').replace(/v\d+$/i, '').trim();
  if (!id) return { found: false };
  try {
    const xml = await getText(`https://export.arxiv.org/api/query?id_list=${encodeURIComponent(id)}&max_results=1`);
    const entry = xml.match(/<entry>([\s\S]*?)<\/entry>/i);
    if (!entry) return { found: false };
    const title = (entry[1].match(/<title>([\s\S]*?)<\/title>/i) || [])[1] || '';
    return { found: true, title: title.replace(/\s+/g, ' ').trim(), id };
  } catch {
    return { found: false };
  }
}

async function titleRecord(title) {
  const q = String(title || '').trim();
  if (q.length < 8) return { found: false };
  try {
    const data = await getJson(`https://api.openalex.org/works?search=${encodeURIComponent(q)}&per-page=3`);
    let best = null;
    for (const work of data?.results || []) {
      const sim = titleSimilarity(q, work.title || work.display_name || '');
      if (!best || sim > best.sim) best = { work, sim };
    }
    if (!best || best.sim < TITLE_SEARCH_SIM) return { found: false, best };
    return { found: true, title: best.work.title || best.work.display_name || '', similarity: best.sim };
  } catch {
    return { found: false };
  }
}

function okStatus(status, extra = {}) {
  return { status, trusted: TRUSTED_VERIFICATIONS.has(status), ...extra };
}

/** 纯函数：给定题名与命中记录的题名，决定核验结论。 */
export function classifyMatch(title, found, source) {
  const sim = titleSimilarity(title, found?.title || '');
  if (sim >= SAME_WORK_SIM) {
    return okStatus({
      crossref: VERIFICATION.CROSSREF_OK,
      datacite: VERIFICATION.DATACITE_OK,
      arxiv: VERIFICATION.ARXIV_OK,
    }[source] || VERIFICATION.TITLE_OK, { similarity: sim, matchedTitle: found?.title || null });
  }
  if (sim < DIFFERENT_WORK_SIM) {
    // 记录存在但题名为空：不能据此判假，按「没查到」处理
    if (!String(found?.title || '').trim()) {
      return { status: VERIFICATION.UNINDEXED, trusted: false, similarity: sim, matchedTitle: null, reason: '命中的记录没有题名，无法比对' };
    }
    return {
      status: VERIFICATION.FABRICATED,
      trusted: false,
      similarity: sim,
      matchedTitle: found?.title || null,
      reason: `DOI 有记录，但指向另一篇：《${String(found?.title || '').slice(0, 80)}》`,
    };
  }
  // 题名差异大但又不至于无关：多半是译名/副标题差异，按「题名可对上」处理
  return okStatus(VERIFICATION.TITLE_OK, { similarity: sim, matchedTitle: found?.title || null });
}

/**
 * 核验一篇文献。
 * @param {{doi?:string, arxiv_id?:string, title?:string}} paper
 * @returns {Promise<{status:string, trusted:boolean, source:string|null, similarity:number|null, reason:string|null, checked_at:string}>}
 */
export async function verifyPaper(paper) {
  const title = String(paper?.title || '').trim();
  const doi = cleanDoi(paper?.doi);
  const arxivId = String(paper?.arxiv_id || '').replace(/^arxiv:/i, '').trim();
  const at = new Date().toISOString();

  if (doi) {
    const cr = await crossrefRecord(doi);
    if (cr.found) {
      const verdict = classifyMatch(title, cr, 'crossref');
      return { ...verdict, source: 'crossref', checked_at: at };
    }
    const dc = await dataciteRecord(doi);
    if (dc.found) {
      const verdict = classifyMatch(title, dc, 'datacite');
      return { ...verdict, source: 'datacite', checked_at: at };
    }
    // Crossref/DataCite 都没有：可能是中文 DOI 或刚注册的，继续用题名兜底，不判假
  }

  if (arxivId) {
    const record = await arxivRecord(arxivId);
    if (record.found) {
      const verdict = classifyMatch(title, record, 'arxiv');
      return { ...verdict, source: 'arxiv', checked_at: at };
    }
  }

  const byTitle = await titleRecord(title);
  if (byTitle.found) {
    return {
      ...okStatus(VERIFICATION.TITLE_OK, { similarity: byTitle.similarity ?? null, matchedTitle: byTitle.title }),
      source: 'title',
      reason: doi ? 'DOI 无记录，题名能对上' : null,
      checked_at: at,
    };
  }

  return {
    status: VERIFICATION.UNINDEXED,
    trusted: false,
    source: null,
    similarity: byTitle.best?.sim ?? null,
    reason: doi ? 'DOI 在 Crossref/DataCite 无记录，题名检索也无结果' : '没有任何可核验的标识符',
    checked_at: at,
  };
}

function cachePath(baseDir) {
  return path.join(store.statePaths(baseDir).dir, 'verify-cache.json');
}

function cacheKey(paper) {
  const doi = cleanDoi(paper?.doi).toLowerCase();
  if (doi) return `doi:${doi}`;
  const arxiv = String(paper?.arxiv_id || '').replace(/^arxiv:/i, '').trim();
  if (arxiv) return `arxiv:${arxiv}`;
  const title = String(paper?.title || '').trim().toLowerCase();
  return title ? `title:${title.slice(0, 120)}` : null;
}

/** 带缓存的核验：正结果缓存 30 天，弱结果 7 天。 */
export async function ensureVerification(baseDir, paper, { force = false } = {}) {
  if (!force && paper?.verification?.status && paper.verification.checked_at) {
    const age = Date.now() - Date.parse(paper.verification.checked_at);
    const ttl = paper.verification.trusted ? TTL_TRUSTED : TTL_WEAK;
    if (Number.isFinite(age) && age >= 0 && age < ttl) return paper.verification;
  }
  const key = cacheKey(paper);
  const cache = key ? await store.readJson(cachePath(baseDir), {}) : {};
  if (key && !force && cache[key]) {
    const age = Date.now() - Date.parse(cache[key].at || '');
    const ttl = cache[key].value?.trusted ? TTL_TRUSTED : TTL_WEAK;
    if (Number.isFinite(age) && age >= 0 && age < ttl) return cache[key].value;
  }
  const value = await verifyPaper(paper);
  if (key) {
    cache[key] = { at: new Date().toISOString(), value };
    const entries = Object.entries(cache);
    const trimmed = entries.length > 2000 ? Object.fromEntries(entries.slice(-2000)) : cache;
    await store.writeJsonAtomic(cachePath(baseDir), trimmed).catch(() => {});
  }
  return value;
}

/**
 * 按核验结论约束等级：S/A/B 必须有可信记录，fabricated 直接丢弃。
 * @returns {{grade:string|null, verdict:string|null, downgraded:boolean, note:string|null}}
 */
export function coerceGradeForVerification(grade, status) {
  if (!status || !grade) return { grade: grade || null, verdict: null, downgraded: false, note: null };
  if (status === VERIFICATION.FABRICATED) {
    return { grade: null, verdict: 'drop', downgraded: true, note: '核验发现 DOI 指向另一篇论文，已丢弃' };
  }
  if (TRUSTED_VERIFICATIONS.has(status)) return { grade, verdict: null, downgraded: false, note: null };
  // unindexed = 「没查到」，不是「查到了反证」：不降级，只在记录上标未核验
  if (status === VERIFICATION.UNINDEXED) {
    return { grade, verdict: null, downgraded: false, note: '未在索引里核到，等级未受限（记录为 unindexed）' };
  }
  // title-ok = 题名能对上但缺正式 DOI 记录：真实存在，但不该给到 S/A
  if (['S', 'A'].includes(grade)) {
    return {
      grade: 'B',
      verdict: null,
      downgraded: true,
      note: `核验状态「${VERIFY_LABEL[status] || status}」不足以支持 ${grade} 级，降为 B`,
    };
  }
  return { grade, verdict: null, downgraded: false, note: null };
}
