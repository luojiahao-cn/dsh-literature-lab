/**
 * 条目落地页：优先用已存的 url，其次拼 DOI，最后拼 arXiv。
 * 只接受 http(s)，避免把 javascript: 之类的串交给系统浏览器。
 */
export function itemHomeUrl(item) {
  const raw = String(item?.url || '').trim();
  if (/^https?:\/\//i.test(raw)) return raw;

  const doi = String(item?.doi || '').trim().replace(/^https?:\/\/(dx\.)?doi\.org\//i, '');
  if (doi && /^10\.\d{4,9}\/\S+$/.test(doi)) return `https://doi.org/${doi}`;

  const arxiv = String(item?.arxiv_id || '').trim();
  if (/^\d{4}\.\d{4,5}(v\d+)?$/.test(arxiv)) return `https://arxiv.org/abs/${arxiv}`;

  // 没有标识符（快讯来源常见）：退回 Crossref 题名检索，至少能落到可核对的页面
  const title = String(item?.title || '').trim();
  if (title.length >= 8) return `https://search.crossref.org/?q=${encodeURIComponent(title)}`;

  return null;
}
