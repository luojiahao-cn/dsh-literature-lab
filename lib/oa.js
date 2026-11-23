/**
 * 开放获取与机构入口的候选链：谁能给 PDF、按什么顺序试。
 *
 * 设计：
 * - 候选是一个结构化对象（url/kind/oa/source），不是裸字符串，这样才能排序与解释失败；
 * - 反查（OpenAlex/Europe PMC/OpenAIRE v3/Unpaywall/S2）带 1h 正缓存与 6h 空缓存，单源失败只记错不抛；
 * - 出版商模板只是「按 DOI 前缀拼官方 PDF 地址」，抓到什么由抓取层判定，不做任何绕过；
 * - 所有网络调用都经 politeFetch，遵守 per-host 限速与冷却。
 */
import { politeFetch } from './http.js';

const LOOKUP_TTL_MS = 60 * 60 * 1000;
const EMPTY_TTL_MS = 6 * 60 * 60 * 1000;
const CACHE_LIMIT = 200;
const lookupCache = new Map();

const SOURCE_RANK = {
  record: 0, arxiv: 1, unpaywall: 2, openalex: 3, europepmc: 4, s2: 5, openaire: 6, template: 7, landing: 8,
};

export function clearLocationCache() {
  lookupCache.clear();
}

export function cacheSize() {
  return lookupCache.size;
}

export function cleanDoi(doi) {
  return String(doi || '').replace(/^https?:\/\/doi\.org\//i, '').replace(/^doi:/i, '').trim();
}

function cacheKey({ doi, pmcid }) {
  const c = cleanDoi(doi);
  if (c) return `doi:${c.toLowerCase()}`;
  const p = String(pmcid || '').trim().toUpperCase();
  return p ? `pmcid:${p}` : null;
}

function readCache(key) {
  const hit = lookupCache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > hit.ttl) {
    lookupCache.delete(key);
    return null;
  }
  return hit.value;
}

function writeCache(key, value) {
  if (!key) return value;
  if (lookupCache.size >= CACHE_LIMIT) {
    const oldest = [...lookupCache.entries()].sort((a, b) => a[1].at - b[1].at)[0];
    if (oldest) lookupCache.delete(oldest[0]);
  }
  const empty = !(value.locations || []).length;
  lookupCache.set(key, { at: Date.now(), ttl: empty ? EMPTY_TTL_MS : LOOKUP_TTL_MS, value });
  return value;
}

async function getJson(url, { timeoutMs = 15000, headers = {} } = {}) {
  const res = await politeFetch(url, {
    timeoutMs, retries: 1, minIntervalMs: 900, headers: { accept: 'application/json', ...headers },
  });
  return JSON.parse(res.body);
}

function pdfish(url) {
  const v = String(url || '');
  return /\.pdf($|\?)|pdf=render|\/pdf\/|getPDF|type=printable|document-?file/i.test(v);
}

/** @returns {{url:string, kind:'pdf'|'landing', oa:boolean|null, source:string}} */
export function location(url, kind, oa, source) {
  return { url: String(url), kind, oa: oa ?? null, source };
}

export function locationOf(url, source = 'unknown', { oa = null } = {}) {
  const value = String(url || '').trim();
  if (!/^https?:\/\//i.test(value)) return null;
  return location(value, pdfish(value) ? 'pdf' : 'landing', oa, source);
}

// ---------- 出版商官方 PDF 地址（按 DOI 前缀） ----------
const PUBLISHER_TEMPLATES = [
  { test: (d) => d.startsWith('10.1186/') || d.startsWith('10.1007/'), build: (d) => `https://link.springer.com/content/pdf/${encodeURI(d)}.pdf` },
  { test: (d) => d.startsWith('10.3389/'), build: (d) => `https://www.frontiersin.org/articles/${encodeURI(d)}/pdf` },
  { test: (d) => d.startsWith('10.1371/journal.pone.'), build: (d) => `https://journals.plos.org/plosone/article/file?id=${encodeURI(d)}&type=printable` },
  { test: (d) => d.startsWith('10.1038/'), build: (d) => `https://www.nature.com/articles/${encodeURI(d.slice('10.1038/'.length))}.pdf` },
  { test: (d) => d.startsWith('10.1088/'), build: (d) => `https://iopscience.iop.org/article/${encodeURI(d)}/pdf` },
  { test: (d) => d.startsWith('10.1080/'), build: (d) => `https://www.tandfonline.com/doi/pdf/${encodeURI(d)}` },
  { test: (d) => d.startsWith('10.1177/'), build: (d) => `https://journals.sagepub.com/doi/pdf/${encodeURI(d)}` },
  { test: (d) => d.startsWith('10.1016/'), build: (d) => `https://www.sciencedirect.com/science/article/pii/${encodeURI(d.split('/').pop())}/pdfft` },
];

export function publisherTemplate(doi) {
  const d = cleanDoi(doi);
  if (!d) return null;
  const hit = PUBLISHER_TEMPLATES.find((t) => t.test(d));
  return hit ? hit.build(d) : null;
}

export function pmcRenderUrls(pmcid) {
  const id = String(pmcid || '').replace(/^PMC/i, '').trim();
  if (!id) return [];
  return [
    `https://europepmc.org/articles/PMC${encodeURIComponent(id)}?pdf=render`,
    `https://www.ncbi.nlm.nih.gov/pmc/articles/PMC${encodeURIComponent(id)}/pdf/`,
  ];
}

// ---------- 反查 ----------
async function openalexLocations(doi) {
  const d = cleanDoi(doi);
  if (!d) return [];
  const w = await getJson(`https://api.openalex.org/works/doi:${encodeURIComponent(d)}`);
  const out = [];
  const best = w?.best_oa_location;
  if (best?.pdf_url) out.push(location(best.pdf_url, 'pdf', Boolean(best.is_oa ?? true), 'openalex'));
  if (best?.landing_page_url) out.push(location(best.landing_page_url, 'landing', Boolean(best.is_oa ?? true), 'openalex'));
  for (const loc of w?.locations || []) {
    if (loc?.pdf_url) out.push(location(loc.pdf_url, 'pdf', Boolean(loc.is_oa), 'openalex'));
    if (loc?.landing_page_url) out.push(location(loc.landing_page_url, 'landing', Boolean(loc.is_oa), 'openalex'));
  }
  return out;
}

async function europepmcLocations(doi, pmcid) {
  const d = cleanDoi(doi);
  const pid = String(pmcid || '').replace(/^PMC/i, '').trim();
  if (!d && !pid) return [];
  const query = [d ? `DOI:"${d}"` : '', pid ? `EXT_ID:${pid}` : ''].filter(Boolean).join(' OR ');
  const data = await getJson(`https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=${encodeURIComponent(query)}&resultType=core&pageSize=1&format=json`);
  const hit = data?.resultList?.result?.[0];
  if (!hit) return [];
  const out = [];
  const foundPmc = hit.pmcid ? String(hit.pmcid).replace(/^PMC/i, '') : pid;
  for (const u of hit?.fullTextUrlList?.fullTextUrl || []) {
    if (!u?.url) continue;
    const style = String(u.documentStyle || '').toLowerCase();
    const availability = String(u.availabilityCode || '').toLowerCase();
    if (style === 'pdf' || pdfish(u.url)) out.push(location(u.url, 'pdf', availability === 'oa', 'europepmc'));
  }
  for (const url of pmcRenderUrls(foundPmc)) out.push(location(url, 'pdf', null, 'europepmc'));
  return out;
}

async function openaireLocations(doi) {
  const d = cleanDoi(doi);
  if (!d) return [];
  // v4 会忽略 pid 参数，必须用 v3 的 graph 接口
  const data = await getJson(`https://api.openaire.eu/graph/v3/research-products?pid=${encodeURIComponent(d)}&pageSize=1`);
  const hit = data?.results?.[0];
  if (!hit) return [];
  const out = [];
  for (const inst of hit.instances || []) {
    for (const u of inst?.urls || []) {
      const value = typeof u === 'string' ? u : u?.url;
      if (!value) continue;
      out.push(location(value, pdfish(value) ? 'pdf' : 'landing', null, 'openaire'));
    }
  }
  return out;
}

async function unpaywallLocations(doi, email) {
  const d = cleanDoi(doi);
  if (!d || !email) return [];
  const data = await getJson(`https://api.unpaywall.org/v2/${encodeURIComponent(d)}?email=${encodeURIComponent(email)}`);
  const out = [];
  for (const loc of [data?.best_oa_location, ...(data?.oa_locations || [])]) {
    if (!loc) continue;
    if (loc.url_for_pdf) out.push(location(loc.url_for_pdf, 'pdf', true, 'unpaywall'));
    if (loc.url_for_landing_page) out.push(location(loc.url_for_landing_page, 'landing', true, 'unpaywall'));
  }
  return out;
}

async function s2Locations(doi) {
  const d = cleanDoi(doi);
  if (!d) return [];
  const data = await getJson(`https://api.semanticscholar.org/graph/v1/paper/DOI:${encodeURIComponent(d)}?fields=openAccessPdf,isOpenAccess`);
  const url = data?.openAccessPdf?.url;
  return url ? [location(url, 'pdf', Boolean(data?.isOpenAccess ?? true), 's2')] : [];
}

/** 单个反查源的兼容包装：失败返回错误，不抛。 */
async function safe(label, fn, errors) {
  try {
    return await fn();
  } catch (error) {
    errors.push({ source: label, error: String(error?.message || error) });
    return [];
  }
}

/**
 * 反查所有开放存取的候选位置。
 * @returns {{locations:Array, errors:Array<{source:string,error:string}>, cached:boolean}}
 */
export async function lookupLocations({ doi, pmcid, email = '', sources } = {}) {
  const key = cacheKey({ doi, pmcid });
  const cached = key ? readCache(key) : null;
  if (cached) return { ...cached, cached: true };
  const want = Array.isArray(sources) && sources.length
    ? sources
    : ['openalex', 'europepmc', 'openaire', 'unpaywall', 's2'];
  const errors = [];
  const runners = {
    openalex: () => safe('openalex', () => openalexLocations(doi), errors),
    europepmc: () => safe('europepmc', () => europepmcLocations(doi, pmcid), errors),
    openaire: () => safe('openaire', () => openaireLocations(doi), errors),
    unpaywall: () => safe('unpaywall', () => unpaywallLocations(doi, email), errors),
    s2: () => safe('s2', () => s2Locations(doi), errors),
  };
  const batches = await Promise.all(want.filter((s) => runners[s]).map((s) => runners[s]()));
  const locations = batches.flat().filter(Boolean);
  const value = { locations, errors };
  writeCache(key, value);
  return { ...value, cached: false };
}

// ---------- 排序 ----------
export function tierOf(loc) {
  if (!loc || loc.kind !== 'pdf') return 3;
  if (/europepmc\.org|ncbi\.nlm\.nih\.gov/i.test(loc.url) && /(\?pdf=render|\/pdf\/)/i.test(loc.url)) return 2;
  return loc.oa ? 0 : 1;
}

function normalizeUrl(url) {
  try {
    const u = new URL(String(url));
    u.hash = '';
    return u.toString().toLowerCase();
  } catch {
    return String(url || '').toLowerCase();
  }
}

/** 去重 + 三档排序：已确认 OA 直链 > 未确认直链 > 仓储渲染页 > 落地页。 */
export function rankLocations(list) {
  const seen = new Map();
  for (const loc of list || []) {
    if (!loc?.url) continue;
    const key = normalizeUrl(loc.url);
    const prev = seen.get(key);
    if (!prev) {
      seen.set(key, loc);
      continue;
    }
    const better = tierOf(loc) < tierOf(prev)
      || (tierOf(loc) === tierOf(prev) && (SOURCE_RANK[loc.source] ?? 9) < (SOURCE_RANK[prev.source] ?? 9));
    if (better) seen.set(key, loc);
  }
  return [...seen.values()].sort((a, b) => tierOf(a) - tierOf(b)
    || (SOURCE_RANK[a.source] ?? 9) - (SOURCE_RANK[b.source] ?? 9)
    || a.url.length - b.url.length);
}

/**
 * 论文记录自带的候选（不联网）。
 * @param {object} paper
 * @param {{templates?:boolean}} options
 */
export function metadataLocations(paper, { templates = true } = {}) {
  const out = [];
  const recordPdf = paper?.pdf_url || paper?.meta?.pdf_url;
  if (recordPdf && /^https?:\/\//i.test(recordPdf)) out.push(location(recordPdf, 'pdf', paper?.meta?.is_oa ?? null, 'record'));
  const oaUrl = paper?.meta?.oa_url;
  if (oaUrl && /^https?:\/\//i.test(oaUrl)) {
    out.push(location(oaUrl, pdfish(oaUrl) ? 'pdf' : 'landing', paper?.meta?.is_oa ?? null, 'record'));
  }
  const arxiv = String(paper?.arxiv_id || '').replace(/^arxiv:/i, '').replace(/v\d+$/i, '').trim();
  if (arxiv) {
    out.push(location(`https://arxiv.org/pdf/${arxiv}`, 'pdf', true, 'arxiv'));
  }
  if (paper?.pmcid) {
    for (const url of pmcRenderUrls(paper.pmcid)) out.push(location(url, 'pdf', null, 'europepmc'));
  }
  if (templates) {
    const built = publisherTemplate(paper?.doi);
    if (built) out.push(location(built, 'pdf', false, 'template'));
  }
  return out;
}

/** 落地页（DOI 解析后的出版社页面），供「从页面里找 PDF」这一步用。 */
export function landingLocations(paper) {
  const out = [];
  const d = cleanDoi(paper?.doi);
  if (d) out.push(location(`https://doi.org/${encodeURI(d)}`, 'landing', null, 'landing'));
  if (paper?.url && /^https?:\/\//i.test(paper.url)) out.push(location(paper.url, 'landing', null, 'landing'));
  return out;
}

// ---------- 兼容旧接口 ----------
export async function s2PdfUrl(doi) {
  const list = await s2Locations(doi).catch(() => []);
  return list[0]?.url || null;
}

export async function unpaywallPdfUrls(doi, email = '') {
  const list = await unpaywallLocations(doi, email).catch(() => []);
  return [...new Set(list.filter((l) => l.kind === 'pdf').map((l) => l.url))];
}

export async function crossrefPdfUrls(doi, email = '') {
  const d = cleanDoi(doi);
  if (!d) return [];
  try {
    const suffix = email ? `?mailto=${encodeURIComponent(email)}` : '';
    const data = await getJson(`https://api.crossref.org/works/${encodeURIComponent(d)}${suffix}`);
    const links = data?.message?.link || [];
    return links
      .filter((link) => /pdf/i.test(String(link?.['content-type'] || '')))
      .filter((link) => link?.['intended-application'] !== 'text-mining')
      .map((link) => link.URL)
      .filter((url) => /^https:\/\//i.test(String(url)))
      .filter((v, i, arr) => arr.indexOf(v) === i);
  } catch {
    return [];
  }
}

/** 旧接口：只返回 URL 列表。保留给已有调用方。 */
export async function oaPdfUrls(doi, email = '', { institutionalDirect = false } = {}) {
  const d = cleanDoi(doi);
  if (!d) return [];
  const [direct, found] = await Promise.all([
    institutionalDirect ? crossrefPdfUrls(d, email) : Promise.resolve([]),
    lookupLocations({ doi: d, email }),
  ]);
  const out = rankLocations([...found.locations, ...direct.map((url) => location(url, 'pdf', false, 'openalex'))])
    .filter((l) => l.kind === 'pdf')
    .map((l) => l.url);
  return [...new Set(out)];
}
