/**
 * 去重索引：论文与 seen 里的 id / DOI / arXiv / 题名都指向同一个 id。
 * 只保留 buildIndex；历史 absorbItems 已被 candidates.absorbCandidates 取代。
 */
import { aliasesOf, titleKey } from './dedup.js';

/** 去重索引：论文与 seen 里的 id / DOI / arXiv / 题名都指向同一个 id。 */
export function buildIndex(state, seen) {
  const index = new Map();
  for (const [id, paper] of Object.entries(state.papers || {})) {
    index.set(id, id);
    for (const alias of aliasesOf({ doi: paper.doi, arxivId: paper.arxiv_id, title: paper.title })) {
      if (!index.has(alias)) index.set(alias, id);
    }
  }
  for (const [id, entry] of Object.entries(seen || {})) {
    if (!index.has(id)) index.set(id, id);
    const key = entry?.title ? titleKey(entry.title) : null;
    if (key && !index.has(key)) index.set(key, id);
  }
  return index;
}

