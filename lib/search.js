/**
 * 查询式检索：arXiv / OpenAlex / Crossref 三路并查。
 *
 * 为什么需要它：只跟两个 arXiv 分类，会漏掉
 *   - 其他分类里用同一批方法词的论文（跨分类检索）
 *   - 期刊论文（OpenAlex / Crossref，含 IEEE/Elsevier 等不在 arXiv 的）
 *   - 用户自己写的布尔查询（watchlist 思路，来自 arxiv-watcher / paperscraper）
 *
 * 检索结果与 discover 共用同一套去重/过滤/seen（由调用方决定是否 ingest）。
 * 只做检索，不做科学判断。
 */
import { politeFetch } from './http.js';
import { parseFeed } from './feed.js';
import { reconstructAbstract } from './metadata.js';
import { workId } from './dedup.js';
import { formatArxivDate } from './arxiv.js';
import { searchWorks as searchS2 } from './s2.js';

const SEARCH_SOURCES = ['arxiv', 'openalex', 'crossref', 's2'];
const ARXIV_API = 'https://export.arxiv.org/api/query';

function cleanQuery(text) {
  return String(text || '').trim();
}

function arxivSearchQuery(text) {
  // 已经是 arXiv 查询语法（cat:/au:/abs: 或布尔式）就原样用，否则按短语检索引擎查
  if (/[:]|\bAND\b|\bOR\b/.test(text)) return text;
  return `all:"${text.replace(/"/g, '')}"`;
}

function dateOnly(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

function stripMarkup(value) {
  return String(value || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

function fromOpenAlex(work) {
  const abstract = reconstructAbstract(work.abstract_inverted_index);
  const doi = (work.doi || '').replace(/^https?:\/\/doi\.org\//i, '') || null;
  return {
    title: work.title || work.display_name || '',
    url: work.primary_location?.landing_page_url || (doi ? `https://doi.org/${doi}` : work.id),
    doi,
    arxivId: null,
    summary: abstract || '',
    abstract: abstract || '',
    abstractVia: 'openalex',
    authors: (work.authorships || []).map((a) => a?.author?.display_name).filter(Boolean),
    publishedAt: work.publication_date || (work.publication_year ? `${work.publication_year}-01-01` : null),
  };
}

function fromCrossref(work) {
  const abstract = stripMarkup(work.abstract) || '';
  const parts = work.issued?.['date-parts']?.[0] || [];
  return {
    title: (work.title || [''])[0] || '',
    url: work.URL || '',
    doi: (work.DOI || '').toLowerCase() || null,
    arxivId: null,
    summary: abstract,
    abstract,
    abstractVia: 'crossref',
    authors: (work.author || []).map((a) => [a.given, a.family].filter(Boolean).join(' ')).filter(Boolean),
    publishedAt: parts.length ? parts.map((n, i) => (i === 0 ? String(n) : String(n).padStart(2, '0'))).join('-') : null,
  };
}

async function searchArxiv({ text, since, limit, net, mailto }) {
  const search = `${arxivSearchQuery(text)} AND submittedDate:[${formatArxivDate(since)} TO ${formatArxivDate(Date.now())}]`;
  const params = new URLSearchParams({
    search_query: search,
    start: '0',
    max_results: String(Math.min(100, limit)),
    sortBy: 'relevance',
    sortOrder: 'descending',
  });
  const ua = mailto ? `dsh-literature-lab/0.1 (mailto:${mailto})` : 'dsh-literature-lab/0.1';
  const res = await politeFetch(`${ARXIV_API}?${params.toString()}`, {
    timeoutMs: net.timeoutMs,
    retries: net.retries,
    minIntervalMs: net.arxivIntervalMs,
    headers: { 'user-agent': ua, accept: 'application/atom+xml, application/xml;q=0.9, */*;q=0.8' },
  });
  return parseFeed(res.body).map((entry) => ({
    title: entry.title,
    url: entry.url,
    doi: entry.doi,
    arxivId: entry.arxivId,
    summary: entry.summary,
    abstract: entry.summary,
    abstractVia: 'arxiv-feed',
    authors: entry.authors,
    publishedAt: entry.published,
  }));
}

async function searchOpenAlex({ text, since, limit, net, mailto }) {
  const params = new URLSearchParams({
    search: text,
    filter: `from_publication_date:${dateOnly(since)}`,
    'per-page': String(Math.min(200, limit)),
  });
  if (mailto) params.set('mailto', mailto);
  const res = await politeFetch(`https://api.openalex.org/works?${params.toString()}`, {
    timeoutMs: net.timeoutMs,
    retries: net.retries,
    minIntervalMs: net.rssIntervalMs,
    headers: { accept: 'application/json' },
  });
  const data = JSON.parse(res.body);
  return (data.results || []).map(fromOpenAlex).filter((item) => item.title);
}

async function searchS2Runner({ text, sinceDays, limit }) {
  return searchS2({ query: text, sinceDays, limit });
}

async function searchCrossref({ text, since, limit, net, mailto }) {
  const params = new URLSearchParams({
    'query.bibliographic': text,
    filter: `from-pub-date:${dateOnly(since)}`,
    rows: String(Math.min(100, limit)),
    select: 'DOI,title,abstract,author,issued,container-title,URL',
  });
  if (mailto) params.set('mailto', mailto);
  const res = await politeFetch(`https://api.crossref.org/works?${params.toString()}`, {
    timeoutMs: net.timeoutMs,
    retries: net.retries,
    minIntervalMs: net.rssIntervalMs,
    headers: { accept: 'application/json', 'user-agent': mailto ? `dsh-literature-lab/0.1 (mailto:${mailto})` : 'dsh-literature-lab/0.1' },
  });
  const data = JSON.parse(res.body);
  return ((data.message || {}).items || []).map(fromCrossref).filter((item) => item.title);
}

/**
 * 执行一条检索。
 * @param {object} config
 * @param {{text:string, sources?:string[], sinceDays?:number, limit?:number}} spec
 * @param {object} net networkOf(config) 的结果
 */
export async function searchItems(config, spec, net) {
  const text = cleanQuery(spec.text);
  if (!text) throw new Error('检索词为空');
  const requested = Array.isArray(spec.sources) && spec.sources.length
    ? spec.sources.filter((s) => SEARCH_SOURCES.includes(s))
    : SEARCH_SOURCES;
  if (!requested.length) throw new Error(`sources 只能是 ${SEARCH_SOURCES.join(' / ')}`);
  const sinceDays = Math.min(365, Math.max(1, Number(spec.sinceDays) || 30));
  const limit = Math.min(50, Math.max(1, Number(spec.limit) || 20));
  const since = Date.now() - sinceDays * 86400 * 1000;
  const mailto = config?.sources?.arxiv?.mailto || config?.network?.mailto || '';

  const runners = { arxiv: searchArxiv, openalex: searchOpenAlex, crossref: searchCrossref, s2: searchS2Runner };
  const settled = await Promise.allSettled(
    requested.map(async (key) => {
      const items = await runners[key]({ text, since, sinceDays, limit, net, mailto });
      return { key, items };
    }),
  );

  const sources = [];
  const items = [];
  const seenIds = new Set();
  for (const [index, result] of settled.entries()) {
    const key = requested[index];
    if (result.status === 'rejected') {
      sources.push({ key, ok: false, error: String(result.reason?.message || result.reason) });
      continue;
    }
    let kept = 0;
    for (const item of result.value.items) {
      const id = workId(item);
      if (!id || seenIds.has(id)) continue;
      seenIds.add(id);
      items.push({ ...item, searchSource: key });
      kept += 1;
    }
    sources.push({ key, ok: true, count: kept });
  }

  return { query: text, sinceDays, sources, items };
}

export { SEARCH_SOURCES };
