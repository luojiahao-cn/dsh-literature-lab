/**
 * RSS 2.0 / Atom 解析：只取 L0 需要的字段，但对常见写法都要稳。
 *
 * 处理：CDATA、命名实体与数字实体、Atom 的 <link href>、多 link、命名空间标签
 * （arxiv:doi / arxiv:journal_ref）、description/summary/content 三种摘要。
 * 不引 XML 依赖；条目之间不嵌套，按块匹配足够。
 */

const NAMED_ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  mdash: '—', ndash: '–', hellip: '…', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“',
};

export function decodeEntities(value) {
  return String(value || '')
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => {
      try { return String.fromCodePoint(parseInt(hex, 16)); } catch { return ''; }
    })
    .replace(/&#(\d+);/g, (_, dec) => {
      try { return String.fromCodePoint(Number(dec)); } catch { return ''; }
    })
    .replace(/&([a-z]+);/gi, (match, name) => NAMED_ENTITIES[name.toLowerCase()] ?? match);
}

export function stripTags(value) {
  return decodeEntities(
    String(value || '')
      .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/\s+/g, ' ')
    .trim();
}

function firstText(block, tags) {
  for (const tag of tags) {
    const match = block.match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, 'i'));
    if (match && match[1].trim()) return stripTags(match[1]);
  }
  return '';
}

function linksOf(block) {
  const out = [];
  for (const match of block.matchAll(/<link\b([^>]*)>([\s\S]*?)<\/link>|<link\b([^>]*)\/>/gi)) {
    const attrs = match[1] ?? match[3] ?? '';
    const text = match[2] ? stripTags(match[2]) : '';
    const href = (attrs.match(/\bhref\s*=\s*["']([^"']+)["']/i) || [])[1] || text;
    const rel = (attrs.match(/\brel\s*=\s*["']([^"']+)["']/i) || [])[1] || '';
    if (href) out.push({ href: href.trim(), rel: rel.toLowerCase() });
  }
  return out;
}

function pickLink(block) {
  const links = linksOf(block);
  if (!links.length) return '';
  return (links.find((l) => l.rel === 'alternate' || l.rel === '') || links[0]).href;
}

function authorsOf(block) {
  const names = [...block.matchAll(/<author\b[^>]*>[\s\S]*?<name>([\s\S]*?)<\/name>[\s\S]*?<\/author>/gi)]
    .map((m) => stripTags(m[1]))
    .filter(Boolean);
  if (names.length) return names;
  return [...block.matchAll(/<dc:creator\b[^>]*>([\s\S]*?)<\/dc:creator>/gi)]
    .map((m) => stripTags(m[1]))
    .filter(Boolean);
}

function arxivIdFrom(value) {
  const match = String(value || '').match(/(\d{4}\.\d{4,5})(?:v\d+)?/);
  return match ? match[1] : null;
}

function doiFrom(value) {
  const match = String(value || '').match(/10\.\d{4,9}\/[^\s"'<>]+/);
  return match ? match[0].replace(/[.,;)\]]+$/, '') : null;
}

/** 解析一份 feed，返回条目数组。 */
export function parseFeed(xml) {
  const entries = [];
  const blocks = String(xml || '').match(/<(item|entry)\b[^>]*>[\s\S]*?<\/\1>/gi) || [];
  for (const block of blocks) {
    const title = firstText(block, ['title']);
    if (!title) continue;
    const link = pickLink(block);
    const rawId = firstText(block, ['id', 'guid']);
    const summary = firstText(block, ['description', 'summary', 'content']);
    const published = firstText(block, ['published', 'pubDate', 'updated', 'dc:date']);
    const doi = firstText(block, ['arxiv:doi']) || doiFrom(link) || doiFrom(rawId) || null;
    entries.push({
      title,
      url: link || rawId || '',
      rawId: rawId || '',
      summary,
      published,
      authors: authorsOf(block),
      doi,
      arxivId: arxivIdFrom(rawId) || arxivIdFrom(link),
    });
  }
  return entries;
}
