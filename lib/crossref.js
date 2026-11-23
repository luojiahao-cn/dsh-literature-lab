/**
 * Crossref 年份检索：与 OpenAlex 互补的书目来源。
 * 只读元数据；摘要里的 JATS 标签会被清掉。
 */
import { politeFetch } from './http.js';

const API = 'https://api.crossref.org/works';

function cleanAbstract(value) {
  if (!value) return null;
  return String(value)
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 2000);
}

export function crossrefToItem(message) {
  const year = message?.issued?.['date-parts']?.[0]?.[0]
    || message?.published?.['date-parts']?.[0]?.[0]
    || null;
  const authors = (message?.author || [])
    .map((author) => [author?.given, author?.family].filter(Boolean).join(' '))
    .filter(Boolean);
  return {
    title: Array.isArray(message?.title) ? String(message.title[0] || '') : String(message?.title || ''),
    doi: message?.DOI || null,
    year,
    venue: Array.isArray(message?.['container-title']) ? (message['container-title'][0] || null) : null,
    abstract: cleanAbstract(message?.abstract),
    summary: cleanAbstract(message?.abstract),
    abstractVia: 'crossref',
    authors,
    publishedAt: year ? `${year}-01-01` : null,
    url: message?.URL || (message?.DOI ? `https://doi.org/${message.DOI}` : null),
  };
}

export async function searchWorks({
  query, yearFrom, yearTo, cursor = '*', rows = 100, mailto = '', timeoutMs, retries,
} = {}) {
  const params = new URLSearchParams({
    'query.bibliographic': String(query || ''),
    rows: String(Math.min(200, Math.max(1, rows))),
    cursor,
  });
  const filters = [];
  if (yearFrom) filters.push(`from-pub-date:${yearFrom}-01-01`);
  if (yearTo) filters.push(`until-pub-date:${yearTo}-12-31`);
  if (filters.length) params.set('filter', filters.join(','));
  if (mailto) params.set('mailto', mailto);
  const res = await politeFetch(`${API}?${params.toString()}`, {
    timeoutMs,
    retries,
    minIntervalMs: 1000,
    headers: { accept: 'application/json' },
  });
  const data = JSON.parse(res.body);
  return {
    items: (data?.message?.items || []).map(crossrefToItem).filter((item) => item.title),
    nextCursor: data?.message?.['next-cursor'] || null,
    count: data?.message?.['total-results'] || 0,
  };
}

export { API as CROSSREF_API };
