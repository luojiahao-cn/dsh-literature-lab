/**
 * Semantic Scholar 推荐（可选补充）：按 DOI 取相关论文。
 * 无需 key，但有公共限流；失败不影响主流程。
 */
import { politeFetch } from './http.js';

const API = 'https://api.semanticscholar.org/graph/v1';

export async function recommendations(doi, {
  limit = 50,
  timeoutMs = 20000,
  retries = 1,
} = {}) {
  const clean = String(doi || '').replace(/^https?:\/\/doi\.org\//i, '').trim();
  if (!clean) return [];
  const fields = 'title,abstract,year,venue,externalIds,authors,url';
  const url = `${API}/paper/DOI:${encodeURIComponent(clean)}/recommendations?limit=${Math.min(100, Math.max(1, limit))}&fields=${fields}`;
  const res = await politeFetch(url, {
    timeoutMs,
    retries,
    minIntervalMs: 1200,
    headers: { accept: 'application/json' },
  });
  const data = JSON.parse(res.body);
  return (data?.data || [])
    .map((row) => row?.paper || row)
    .filter((paper) => paper?.title)
    .map((paper) => ({
      title: paper.title,
      doi: paper.externalIds?.DOI || null,
      arxivId: paper.externalIds?.ArXiv || null,
      year: paper.year || null,
      venue: paper.venue || null,
      abstract: paper.abstract || '',
      summary: paper.abstract || '',
      authors: (paper.authors || []).map((author) => author?.name).filter(Boolean),
      url: paper.url || (paper.externalIds?.DOI ? `https://doi.org/${paper.externalIds.DOI}` : null),
      publishedAt: paper.year ? `${paper.year}-01-01` : null,
    }));
}


/** Semantic Scholar bulk 检索：补关键词主动检索，不只推荐。 */
export async function searchWorks({
  query, sinceDays = 30, limit = 20, timeoutMs = 20000, retries = 1,
} = {}) {
  const text = String(query || '').trim();
  if (!text) return [];
  const days = Math.max(1, Math.min(3650, Number(sinceDays) || 30));
  const fromYear = new Date(Date.now() - days * 86400 * 1000).getUTCFullYear();
  const toYear = new Date().getUTCFullYear();
  const params = new URLSearchParams({
    query: text,
    limit: String(Math.min(100, Math.max(1, Number(limit) || 20))),
    fields: 'title,abstract,year,venue,externalIds,authors,url',
    year: `${fromYear}-${toYear}`,
  });
  const res = await politeFetch(`${API}/paper/search/bulk?${params.toString()}`, {
    timeoutMs,
    retries,
    minIntervalMs: 1000,
    headers: { accept: 'application/json' },
  });
  const data = JSON.parse(res.body);
  return (data?.data || []).map((paper) => ({
    title: paper.title || '',
    doi: paper.externalIds?.DOI || null,
    arxivId: paper.externalIds?.ArXiv || null,
    year: paper.year || null,
    venue: paper.venue || null,
    abstract: paper.abstract || '',
    summary: paper.abstract || '',
    abstractVia: 's2',
    authors: (paper.authors || []).map((author) => author?.name).filter(Boolean),
    publishedAt: paper.year ? `${paper.year}-01-01` : null,
    url: paper.url || (paper.externalIds?.DOI ? `https://doi.org/${paper.externalIds.DOI}` : null),
  })).filter((item) => item.title);
}

export { API as S2_API };
