/**
 * OpenAlex 读取：年份检索、按 DOI 取、按 OpenAlex ID 批量取、被引列表。
 * 只读开放元数据；所有请求经 lib/http.js 限速与重试。
 */
import { politeFetch } from './http.js';
import { reconstructAbstract } from './metadata.js';

const API = 'https://api.openalex.org';

export function workToItem(work) {
  const doi = (work?.doi || '').replace(/^https?:\/\/doi\.org\//i, '') || null;
  const abstract = reconstructAbstract(work?.abstract_inverted_index) || '';
  const source = work?.primary_location?.source || {};
  return {
    openalexId: (work?.id || '').split('/').pop() || null,
    title: work?.title || work?.display_name || '',
    doi,
    year: work?.publication_year || null,
    venue: source.display_name || null,
    abstract,
    summary: abstract,
    abstractVia: 'openalex',
    authors: (work?.authorships || []).map((a) => a?.author?.display_name).filter(Boolean),
    publishedAt: work?.publication_date || (work?.publication_year ? `${work.publication_year}-01-01` : null),
    url: work?.primary_location?.landing_page_url || (doi ? `https://doi.org/${doi}` : work?.id || ''),
    citedByUrl: work?.cited_by_api_url || null,
    referencedWorks: Array.isArray(work?.referenced_works) ? work.referenced_works : [],
    relatedWorks: Array.isArray(work?.related_works) ? work.related_works : [],
  };
}

async function getJson(url, { timeoutMs = 30000, retries = 2, mailto = '' } = {}) {
  const target = mailto ? `${url}${url.includes('?') ? '&' : '?'}mailto=${encodeURIComponent(mailto)}` : url;
  const res = await politeFetch(target, {
    timeoutMs,
    retries,
    minIntervalMs: 1000,
    headers: { accept: 'application/json' },
  });
  return JSON.parse(res.body);
}

/** 关键词 + 年份区间检索，游标分页。 */
export async function searchWorks({ query, yearFrom, yearTo, cursor = '*', perPage = 100, mailto = '', timeoutMs, retries } = {}) {
  const filters = [];
  if (yearFrom) filters.push(`from_publication_date:${yearFrom}-01-01`);
  if (yearTo) filters.push(`to_publication_date:${yearTo}-12-31`);
  const params = new URLSearchParams({
    search: String(query || ''),
    'per-page': String(Math.min(200, Math.max(1, perPage))),
    cursor,
  });
  if (filters.length) params.set('filter', filters.join(','));
  const data = await getJson(`${API}/works?${params.toString()}`, { timeoutMs, retries, mailto });
  return {
    items: (data.results || []).map(workToItem).filter((item) => item.title),
    nextCursor: data.meta?.next_cursor || null,
    count: data.meta?.count || 0,
  };
}

export async function workByDoi(doi, options = {}) {
  const clean = String(doi || '').replace(/^https?:\/\/doi\.org\//i, '').trim();
  if (!clean) return null;
  try {
    const data = await getJson(`${API}/works/doi:${encodeURIComponent(clean)}`, options);
    return workToItem(data);
  } catch {
    return null;
  }
}

/** 按 OpenAlex ID 批量取（单次 ≤50）。 */
export async function worksByIds(ids, options = {}) {
  const clean = [...new Set((ids || []).map((id) => String(id).split('/').pop()).filter(Boolean))].slice(0, 50);
  if (!clean.length) return [];
  const params = new URLSearchParams({
    filter: `openalex_id:${clean.join('|')}`,
    'per-page': '50',
  });
  const data = await getJson(`${API}/works?${params.toString()}`, options);
  return (data.results || []).map(workToItem).filter((item) => item.title);
}

/** 拉某一页被引论文。 */
export async function citingWorks(citedByUrl, { cursor = '*', perPage = 100, ...options } = {}) {
  if (!citedByUrl) return { items: [], nextCursor: null };
  const params = new URLSearchParams({ 'per-page': String(perPage), cursor });
  const data = await getJson(`${citedByUrl}${citedByUrl.includes('?') ? '&' : '?'}${params.toString()}`, options);
  return {
    items: (data.results || []).map(workToItem).filter((item) => item.title),
    nextCursor: data.meta?.next_cursor || null,
  };
}

export { API as OPENALEX_API };
