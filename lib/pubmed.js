/**
 * Europe PMC / PubMed 渠道：医学、器械、临床文献。
 * 只取元数据与摘要；全文仍走 OA 下载或人工。
 */
import { politeFetch } from './http.js';

const API = 'https://www.ebi.ac.uk/europepmc/webservices/rest/search';

function cleanText(value) {
  if (!value) return null;
  return String(value).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() || null;
}

function meshTerms(item) {
  const list = item?.meshHeadingList?.meshHeading;
  if (!list) return [];
  return (Array.isArray(list) ? list : [list])
    .map((heading) => heading?.descriptorName)
    .filter(Boolean);
}

export function pubmedToItem(result) {
  const doi = result?.doi || null;
  const pmid = result?.pmid || null;
  const abstract = cleanText(result?.abstractText);
  return {
    title: cleanText(result?.title) || '',
    doi,
    pmid,
    summary: abstract,
    abstract,
    abstractVia: 'europepmc',
    authors: result?.authorString
      ? String(result.authorString).split(/,\s*/).map((name) => name.trim()).filter(Boolean)
      : [],
    venue: result?.journalTitle || null,
    publishedAt: result?.firstPublicationDate || (result?.pubYear ? `${result.pubYear}-01-01` : null),
    url: doi
      ? `https://doi.org/${doi}`
      : pmid
        ? `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`
        : null,
    categories: meshTerms(result),
    mesh: meshTerms(result),
  };
}

export async function searchPubmed({
  query, sinceDays = 30, limit = 50, timeoutMs = 30000, retries = 2,
} = {}) {
  const text = String(query || '').trim();
  if (!text) return { items: [] };
  const days = Math.max(1, Math.min(3650, Number(sinceDays) || 30));
  const since = new Date(Date.now() - days * 86400 * 1000).toISOString().slice(0, 10);
  const until = new Date().toISOString().slice(0, 10);
  const q = `${text} AND (FIRST_PDATE:[${since} TO ${until}])`;
  const params = new URLSearchParams({
    query: q,
    format: 'json',
    pageSize: String(Math.min(100, Math.max(1, Number(limit) || 50))),
    resultType: 'core',
  });
  const res = await politeFetch(`${API}?${params.toString()}`, {
    timeoutMs,
    retries,
    minIntervalMs: 1000,
    headers: { accept: 'application/json' },
  });
  const data = JSON.parse(res.body);
  return {
    items: (data?.resultList?.result || []).map(pubmedToItem).filter((item) => item.title),
    hitCount: data?.hitCount || 0,
  };
}

export { API as PUBMED_API };
