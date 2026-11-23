/**
 * bioRxiv / medRxiv 预印本渠道。
 * API 按日期区间返回，每页 30 条；区间建议 1–3 天，这里自动分块。
 */
import { politeFetch } from './http.js';

const API = 'https://api.biorxiv.org/details';

function ymd(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

export function preprintToItem(server, row) {
  const doi = row?.doi || null;
  const date = row?.date || null;
  const abstract = row?.abstract || null;
  return {
    title: String(row?.title || '').replace(/\s+/g, ' ').trim(),
    doi,
    summary: abstract,
    abstract,
    abstractVia: server,
    authors: row?.authors ? String(row.authors).split(/;\s*/).map((name) => name.trim()).filter(Boolean) : [],
    venue: server === 'medrxiv' ? 'medRxiv' : 'bioRxiv',
    publishedAt: date,
    url: doi ? `https://www.${server}.org/content/${doi}` : null,
    categories: row?.category ? [String(row.category)] : [],
    preprint: true,
  };
}

/**
 * @param {{server?:'biorxiv'|'medrxiv', sinceDays?:number, limit?:number, categories?:string[]}} input
 */
export async function searchPreprints({
  server = 'biorxiv', sinceDays = 3, limit = 50, categories = [],
  timeoutMs = 30000, retries = 1,
} = {}) {
  const days = Math.max(1, Math.min(30, Number(sinceDays) || 3));
  const end = Date.now();
  const start = end - days * 86400 * 1000;
  const items = [];
  const wanted = new Set((Array.isArray(categories) ? categories : []).map((c) => String(c).toLowerCase()));
  const maxItems = Math.min(200, Math.max(1, Number(limit) || 50));

  for (let cursorMs = start; cursorMs < end && items.length < maxItems; cursorMs += 3 * 86400 * 1000) {
    const chunkEnd = Math.min(end, cursorMs + 3 * 86400 * 1000);
    let offset = 0;
    while (items.length < maxItems) {
      const res = await politeFetch(`${API}/${server}/${ymd(cursorMs)}/${ymd(chunkEnd)}/${offset}/json`, {
        timeoutMs,
        retries,
        minIntervalMs: 1000,
        headers: { accept: 'application/json' },
      });
      const data = JSON.parse(res.body);
      const rows = Array.isArray(data?.collection) ? data.collection : [];
      if (!rows.length) break;
      for (const row of rows) {
        const item = preprintToItem(server, row);
        if (!item.title) continue;
        if (wanted.size) {
          const category = String(row?.category || '').toLowerCase();
          if (!wanted.has(category)) continue;
        }
        items.push(item);
        if (items.length >= maxItems) break;
      }
      if (rows.length < 30) break;
      offset += 30;
    }
  }
  return { items, server };
}

export { API as PREPRINT_API };
