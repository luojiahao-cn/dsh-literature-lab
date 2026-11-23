/**
 * 期刊/会议等级索引：CCF 2026（内置）+ SJR 2025（内置压缩快照）。
 *
 * SJR 的 Q 是按 Scimago field code 内 SJR 排名计算的近似分位，不是 JCR 分区。
 * JCR/中科院分区受数据库许可限制，不内置、不抓取。
 */
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';

const DATA_DIR = new URL('../data/', import.meta.url);
let cache = null;

export function normalizeIssn(value) {
  const matches = String(value || '').toUpperCase().match(/\d{4}-?\d{3}[\dX]/g) || [];
  return matches.map((m) => (m.includes('-') ? m : `${m.slice(0, 4)}-${m.slice(4)}`));
}

export function normalizeVenueName(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/\btransactions\b/g, 'trans')
    .replace(/\binternational\b/g, 'int')
    .replace(/\bjournal\b/g, 'j')
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, ' ')
    .trim();
}

function load() {
  if (cache) return cache;
  const ccf = JSON.parse(readFileSync(fileURLToPath(new URL('venues-ccf.json', DATA_DIR)), 'utf8'));
  const sjr = JSON.parse(gunzipSync(readFileSync(fileURLToPath(new URL('venues-sjr.json.gz', DATA_DIR)))));
  const entries = [];
  const byNameSjr = new Map();

  for (const row of sjr) {
    const entry = {
      name: row.n,
      names: [row.n],
      issn: row.i,
      sjr: { quartile: row.q, value: row.s, field: row.f, year: row.y, percentile: row.p },
    };
    entries.push(entry);
    const norm = normalizeVenueName(row.n);
    if (norm && !byNameSjr.has(norm)) byNameSjr.set(norm, entry);
  }
  for (const row of ccf) {
    const names = [row.full_name, row.abbr].filter(Boolean);
    const existing = names.map((n) => byNameSjr.get(normalizeVenueName(n))).find(Boolean);
    if (existing) {
      existing.ccf = { rank: row.rank, type: row.type, category: row.category };
      for (const n of names) if (!existing.names.includes(n)) existing.names.push(n);
    } else {
      entries.push({
        name: row.full_name,
        names,
        issn: '',
        ccf: { rank: row.rank, type: row.type, category: row.category },
      });
    }
  }

  const byIssn = new Map();
  const byName = new Map();
  for (const entry of entries) {
    for (const issn of normalizeIssn(entry.issn)) {
      if (!byIssn.has(issn)) byIssn.set(issn, []);
      byIssn.get(issn).push(entry);
    }
    for (const key of entry.names) {
      const norm = normalizeVenueName(key);
      if (norm && !byName.has(norm)) byName.set(norm, entry);
    }
  }
  cache = { byIssn, byName, counts: { ccf: ccf.length, sjr: sjr.length } };
  return cache;
}

export function reloadVenues() {
  cache = null;
  return load();
}

export function lookupVenue({ name = '', issn = '' } = {}) {
  const idx = load();
  for (const key of normalizeIssn(issn)) {
    const hit = idx.byIssn.get(key);
    if (hit?.length) return hit[0];
  }
  const norm = normalizeVenueName(name);
  if (norm && idx.byName.has(norm)) return idx.byName.get(norm);
  return null;
}

/** 主标签：有 CCF 用 CCF，否则 SJR Q；两者都存在时 UI 可显示全部。 */
export function tierOf(entry) {
  if (!entry) return null;
  if (entry.ccf?.rank) {
    return {
      label: `CCF-${entry.ccf.rank}`,
      primary: { system: 'ccf', rank: entry.ccf.rank },
      ranks: {
        ccf: entry.ccf.rank,
        sjr: entry.sjr?.quartile || null,
      },
      source: 'ccf',
      year: 2026,
    };
  }
  if (entry.sjr?.quartile) {
    return {
      label: `SJR ${entry.sjr.quartile}`,
      primary: { system: 'sjr', rank: entry.sjr.quartile },
      ranks: { ccf: null, sjr: entry.sjr.quartile },
      source: 'sjr',
      year: entry.sjr.year,
      percentile: entry.sjr.percentile,
    };
  }
  return null;
}

export function venueTierFor(venue, issn = '') {
  return tierOf(lookupVenue({ name: venue, issn }));
}

export function venueStats() {
  return load().counts;
}
