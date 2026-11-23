/**
 * DBLP 渠道：CS / 机器人会议与期刊。
 * 只有书目，没有摘要；先进候选池，T0 用标题/venue/作者打分，取摘要留给后续。
 */
import { politeFetch } from './http.js';

const API = 'https://dblp.org/search/publ/api';

function authorsOf(info) {
  const authors = info?.authors?.author;
  if (!authors) return [];
  return (Array.isArray(authors) ? authors : [authors])
    .map((author) => (typeof author === 'string' ? author : author?.text || author?.name))
    .filter(Boolean);
}

export function dblpToItem(info) {
  const year = Number(info?.year) || null;
  return {
    title: String(info?.title || '').replace(/\s+/g, ' ').trim(),
    doi: info?.doi || null,
    summary: null,
    abstract: null,
    abstractVia: null,
    authors: authorsOf(info),
    venue: info?.venue || null,
    publishedAt: year ? `${year}-01-01` : null,
    url: info?.ee || info?.url || null,
    categories: info?.venue ? [String(info.venue)] : [],
  };
}

export async function searchDblp({
  query, sinceYears = 1, limit = 50, timeoutMs = 30000, retries = 2,
} = {}) {
  const text = String(query || '').trim();
  if (!text) return { items: [] };
  const params = new URLSearchParams({
    q: text,
    format: 'json',
    h: String(Math.min(100, Math.max(1, Number(limit) || 50))),
  });
  const res = await politeFetch(`${API}?${params.toString()}`, {
    timeoutMs,
    retries,
    minIntervalMs: 1000,
    headers: { accept: 'application/json' },
  });
  const data = JSON.parse(res.body);
  const cutoff = new Date().getFullYear() - Math.max(0, Number(sinceYears) || 0);
  const hits = data?.result?.hits?.hit || [];
  return {
    items: hits
      .map((hit) => hit?.info)
      .filter(Boolean)
      .filter((info) => !info.year || Number(info.year) >= cutoff)
      .map(dblpToItem)
      .filter((item) => item.title),
    hitCount: Number(data?.result?.hits?.['@total']) || 0,
  };
}

export { API as DBLP_API };
