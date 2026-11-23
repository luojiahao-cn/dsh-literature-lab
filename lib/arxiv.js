/**
 * arXiv API 源：按分类/查询式 + 提交日期区间取条目。
 *
 * 为什么不用 RSS：RSS 只给最近一批，漏跑就丢；API 能按日期区间回填，
 * 还能用 quiet 的早停策略（连续两页没有新条目就停）避免刷接口。
 * 官方建议请求间隔 ≥3s，这里默认 3s，并可配置。
 */
import { politeFetch } from './http.js';
import { parseFeed } from './feed.js';

const API = 'https://export.arxiv.org/api/query';

/** arXiv 的 submittedDate 用 UTC 的 YYYYMMDDHHMM。 */
export function formatArxivDate(ms) {
  const date = new Date(ms);
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}`;
}

/** 分类或自定义查询式 → arXiv 的 search_query 主体。 */
export function arxivQueryOf(arxiv = {}) {
  const queries = Array.isArray(arxiv.queries) ? arxiv.queries.filter(Boolean) : [];
  if (queries.length) return queries.map((q) => `(${q})`).join(' OR ');
  const categories = Array.isArray(arxiv.categories) ? arxiv.categories.filter(Boolean) : [];
  if (!categories.length) return '';
  return `(${categories.map((c) => `cat:${c}`).join(' OR ')})`;
}

/**
 * 拉取 arXiv 条目。
 * @param {{categories?:string[], queries?:string[], mailto?:string}} arxiv
 * @param {{since:number, until:number, isKnown?:(entry:object)=>boolean, timeoutMs?:number,
 *          retries?:number, intervalMs?:number, maxPages?:number}} options
 */
export async function fetchArxiv(arxiv, options = {}) {
  const {
    since, until,
    isKnown = () => false,
    timeoutMs = 20000,
    retries = 2,
    intervalMs = 3000,
    maxPages = 20,
  } = options;

  const base = arxivQueryOf(arxiv);
  if (!base) throw new Error('arXiv 源未配置分类或查询式');
  const search = `${base} AND submittedDate:[${formatArxivDate(since)} TO ${formatArxivDate(until)}]`;
  const ua = arxiv.mailto
    ? `dsh-literature-lab/0.1 (mailto:${arxiv.mailto})`
    : 'dsh-literature-lab/0.1';

  const entries = [];
  let pages = 0;
  let zeroNewInARow = 0;
  let truncated = false;

  for (let start = 0; start < maxPages * 100; start += 100) {
    const params = new URLSearchParams({
      search_query: search,
      start: String(start),
      max_results: '100',
      sortBy: 'submittedDate',
      sortOrder: 'descending',
    });
    const res = await politeFetch(`${API}?${params.toString()}`, {
      as: 'text',
      timeoutMs,
      retries,
      minIntervalMs: intervalMs,
      headers: { 'user-agent': ua, accept: 'application/atom+xml, application/xml;q=0.9, */*;q=0.8' },
    });
    const parsed = parseFeed(res.body);
    pages += 1;
    if (!parsed.length) break;

    let fresh = 0;
    for (const entry of parsed) {
      const time = Date.parse(entry.published);
      if (Number.isFinite(time) && time < since) continue;
      entries.push(entry);
      if (!isKnown(entry)) fresh += 1;
    }
    if (fresh === 0) {
      zeroNewInARow += 1;
      if (zeroNewInARow >= 2) break;
    } else {
      zeroNewInARow = 0;
    }
    if (parsed.length < 100) break;
    if (start + 100 >= maxPages * 100) truncated = true;
  }

  return { entries, pages, truncated };
}
