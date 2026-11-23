/**
 * 一手元数据：按 DOI / arXiv / 题名取摘要与书目信息。
 *
 * 只访问公开的一手来源（OpenAlex、Crossref、arXiv），不猜、不编：
 * - DOI 优先查 OpenAlex works/doi:，失败再退 Crossref
 * - arXiv 直接查 arXiv Atom API
 * - 都没有时用题名检索，相似度 ≥0.9 才接受，否则标记为未匹配
 */

const UA = 'dsh-literature-lab/0.1 (mailto:literature-lab@example.invalid)';
const MIN_TITLE_SIM = 0.9;

/** OpenAlex 把摘要存成倒排索引，这里还原成普通文本。 */
export function reconstructAbstract(inverted) {
  if (!inverted || typeof inverted !== 'object') return null;
  const slots = [];
  for (const [word, positions] of Object.entries(inverted)) {
    for (const p of positions || []) slots[p] = word;
  }
  const text = slots.filter((x) => x !== undefined).join(' ').trim();
  return text || null;
}

function normTitle(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, ' ').trim();
}

/** 令牌级相似度：足够判断"是不是同一篇"，比编辑距离更抗措辞差异。 */
export function titleSimilarity(a, b) {
  const A = new Set(normTitle(a).split(' ').filter(Boolean));
  const B = new Set(normTitle(b).split(' ').filter(Boolean));
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter += 1;
  return inter / Math.max(A.size, B.size);
}

async function getJson(url, timeoutMs = 20000) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(url, { headers: { 'user-agent': UA, accept: 'application/json' }, signal: ac.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

async function getText(url, timeoutMs = 20000) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(url, { headers: { 'user-agent': UA }, signal: ac.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

function fromOpenAlex(w, similarity) {
  const loc = w.primary_location || {};
  const src = loc.source || {};
  const authors = (w.authorships || [])
    .map((a) => a?.author?.display_name)
    .filter(Boolean);
  return {
    matched: true,
    source: 'openalex',
    title: w.title || w.display_name || '',
    doi: (w.doi || '').replace(/^https?:\/\/doi\.org\//i, '') || null,
    year: w.publication_year || null,
    venue: src.display_name || null,
    authors,
    abstract: reconstructAbstract(w.abstract_inverted_index),
    oa_status: (w.open_access || {}).oa_status || null,
    // 开放获取原文：优先 PDF 直链，其次落地页；只用于 OA 下载，不猜付费墙地址
    oa_url: (w.best_oa_location && (w.best_oa_location.pdf_url || w.best_oa_location.landing_page_url))
      || w.open_access?.oa_url || null,
    is_oa: Boolean(w.open_access?.is_oa),
    similarity: similarity ?? null,
    openalex_id: (w.id || '').split('/').pop() || null,
  };
}

/** 按 DOI 取元数据。 */
export async function byDoi(doi) {
  const clean = String(doi || '').replace(/^https?:\/\/doi\.org\//i, '').trim();
  if (!clean) return { matched: false, reason: 'no-doi' };
  try {
    const w = await getJson(`https://api.openalex.org/works/doi:${encodeURIComponent(clean)}`);
    const meta = fromOpenAlex(w, null);
    if (meta.abstract) return meta;
    // OpenAlex 没有摘要时，用 Crossref 的 abstract 兜底
    const cr = await crossref(clean);
    return cr.abstract ? { ...meta, abstract: cr.abstract, source: 'openalex+crossref' } : meta;
  } catch {
    const cr = await crossref(clean);
    if (cr.matched) return cr;
    return { matched: false, reason: 'doi-not-found' };
  }
}

/** Crossref 兜底：有些出版社只给了 Crossref 摘要。 */
export async function crossref(doi) {
  try {
    const d = await getJson(`https://api.crossref.org/works/${encodeURIComponent(doi)}`);
    const m = d.message || {};
    const raw = m.abstract || '';
    const abstract = raw
      ? raw.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() || null
      : null;
    return {
      matched: true,
      source: 'crossref',
      title: (m.title || [''])[0] || '',
      doi: (m.DOI || '').toLowerCase() || null,
      year: (m.issued?.['date-parts']?.[0]?.[0]) || null,
      venue: (m['container-title'] || [''])[0] || null,
      authors: (m.author || []).map((a) => [a.given, a.family].filter(Boolean).join(' ')).filter(Boolean),
      abstract,
      oa_status: null,
      oa_url: null,
      is_oa: null,
      similarity: null,
    };
  } catch {
    return { matched: false, reason: 'crossref-miss' };
  }
}

function textBetween(xml, tag) {
  const m = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i'));
  return m ? m[1].replace(/\s+/g, ' ').trim() : null;
}

/** 按 arXiv id 取元数据。 */
export async function byArxiv(arxivId) {
  const id = String(arxivId || '').replace(/^arxiv:/i, '').trim();
  if (!id) return { matched: false, reason: 'no-arxiv' };
  try {
    const xml = await getText(`https://export.arxiv.org/api/query?id_list=${encodeURIComponent(id)}&max_results=1`);
    const entry = xml.match(/<entry>([\s\S]*?)<\/entry>/i);
    if (!entry) return { matched: false, reason: 'arxiv-miss' };
    const body = entry[1];
    const authors = [...body.matchAll(/<name>([^<]+)<\/name>/gi)].map((m) => m[1].trim());
    return {
      matched: true,
      source: 'arxiv',
      title: textBetween(body, 'title') || '',
      doi: textBetween(body, 'arxiv:doi') || null,
      arxiv_id: id,
      year: (textBetween(body, 'published') || '').slice(0, 4) || null,
      venue: textBetween(body, 'arxiv:journal_ref') || 'arXiv preprint',
      authors,
      abstract: textBetween(body, 'summary') || null,
      oa_status: 'green',
      oa_url: `https://arxiv.org/pdf/${id}`,
      is_oa: true,
      similarity: null,
    };
  } catch {
    return { matched: false, reason: 'arxiv-error' };
  }
}

/** 按题名检索：只有相似度 ≥0.9 才接受，避免认错论文。 */
export async function byTitle(title) {
  const q = String(title || '').trim();
  if (!q) return { matched: false, reason: 'no-title' };
  try {
    const d = await getJson(`https://api.openalex.org/works?search=${encodeURIComponent(q)}&per-page=3`);
    let best = null;
    for (const w of d.results || []) {
      const sim = titleSimilarity(q, w.title || w.display_name || '');
      if (!best || sim > best.sim) best = { w, sim };
    }
    if (!best || best.sim < MIN_TITLE_SIM) {
      return { matched: false, reason: `similarity ${best ? best.sim.toFixed(2) : 0} < ${MIN_TITLE_SIM}`, best_similarity: best?.sim ?? 0 };
    }
    return fromOpenAlex(best.w, best.sim);
  } catch {
    return { matched: false, reason: 'title-search-error' };
  }
}

/**
 * 统一入口：按已有标识尽力取一手摘要，返回命中的方式与相似度。
 */
export async function lookup({ doi, arxivId, title }) {
  let reason = 'nothing-to-look-up';
  if (doi) {
    const r = await byDoi(doi);
    if (r.matched) return { ...r, via: 'doi' };
    reason = r.reason || 'doi-not-found';
  }
  if (arxivId) {
    const r = await byArxiv(arxivId);
    if (r.matched) return { ...r, via: 'arxiv' };
    reason = r.reason || 'arxiv-miss';
  }
  if (title) {
    const r = await byTitle(title);
    if (r.matched) return { ...r, via: 'title' };
    return r;
  }
  return { matched: false, reason };
}
