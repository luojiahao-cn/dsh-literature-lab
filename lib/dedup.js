/**
 * 标识归一化与去重键。
 *
 * 同一篇论文在不同来源里可能写成：
 *   - arXiv id 带/不带版本号（2611.12345v2 vs 2611.12345）
 *   - DOI 带 https://doi.org/ 前缀、末尾带标点、大小写不同
 *   - 题名带全角标点、多余空白、不同 Unicode 形式
 * 这里统一成可比较的键；id 优先级 DOI → arXiv → 题名哈希。
 */
import { createHash } from 'node:crypto';

export function normalizeTitle(value) {
  return String(value || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\p{P}\p{S}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function titleKey(value) {
  const text = normalizeTitle(value);
  if (!text) return null;
  return `title:${createHash('sha1').update(text).digest('hex').slice(0, 16)}`;
}

export function normalizeDoi(value) {
  const text = String(value || '')
    .trim()
    .replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, '')
    .replace(/^doi:/i, '')
    .replace(/[.,;)\]]+$/, '')
    .toLowerCase();
  return /^10\.\d{4,9}\/\S+$/.test(text) ? text : null;
}

export function normalizeArxiv(value) {
  const text = String(value || '')
    .trim()
    .replace(/^arxiv:/i, '')
    .replace(/v\d+$/i, '');
  return /^\d{4}\.\d{4,5}$/.test(text) ? text : null;
}

export function workId({ doi, arxivId, title }) {
  const cleanDoi = normalizeDoi(doi);
  if (cleanDoi) return `doi:${cleanDoi}`;
  const cleanArxiv = normalizeArxiv(arxivId);
  if (cleanArxiv) return `arxiv:${cleanArxiv}`;
  return titleKey(title);
}

/** 一条文献可能同时有 DOI、arXiv 和题名，三者都要能命中已有记录。 */
export function aliasesOf({ doi, arxivId, title }) {
  const out = [];
  const cleanDoi = normalizeDoi(doi);
  if (cleanDoi) out.push(`doi:${cleanDoi}`);
  const cleanArxiv = normalizeArxiv(arxivId);
  if (cleanArxiv) out.push(`arxiv:${cleanArxiv}`);
  const key = titleKey(title);
  if (key) out.push(key);
  return out;
}
