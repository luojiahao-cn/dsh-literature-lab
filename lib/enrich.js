/** L2 前置元数据补全：缺 DOI/URL 时用标题查一手源，匹配到才回填。 */
import { lookup } from './metadata.js';
import { readState, updateState } from './state.js';

function doiUrl(doi) {
  return doi ? `https://doi.org/${doi}` : null;
}

export async function enrichPaper(baseDir, paper) {
  if (!paper?.id) return { paper, changed: false };
  if (paper.pdf) return { paper, changed: false };

  let changed = false;
  const patch = {};
  if (paper.doi && !paper.url) {
    patch.url = doiUrl(paper.doi);
    changed = true;
  }
  if (paper.doi || paper.url) {
    if (changed) {
      await updateState(baseDir, (state) => {
        const target = state.papers?.[paper.id];
        if (target) {
          target.url = patch.url;
          target.updated_at = new Date().toISOString();
        }
      });
      return { paper: { ...paper, ...patch }, changed: true };
    }
    return { paper, changed: false };
  }

  if (!paper.title) return { paper, changed: false };
  try {
    const meta = await lookup({ title: paper.title });
    if (!meta?.matched) {
      await updateState(baseDir, (state) => {
        const target = state.papers?.[paper.id];
        if (target) {
          target.review_flags = [...new Set([...(target.review_flags || []), 'needs_metadata'])];
          target.metadata_lookup = { at: new Date().toISOString(), matched: false, reason: meta?.reason || 'not-matched' };
        }
      });
      return { paper, changed: false, matched: false, reason: meta?.reason || 'not-matched' };
    }
    const doi = meta.doi || paper.doi || null;
    const arxivId = meta.arxiv_id || paper.arxiv_id || null;
    const url = doiUrl(doi) || (arxivId ? `https://arxiv.org/abs/${arxivId}` : paper.url);
    const now = new Date().toISOString();
    await updateState(baseDir, (state) => {
      const target = state.papers?.[paper.id];
      if (!target) return;
      target.doi = doi;
      target.arxiv_id = arxivId;
      target.url = url;
      target.title = target.title || meta.title;
      if (!target.abstract && meta.abstract) target.abstract = String(meta.abstract).slice(0, 4000);
      target.meta = {
        ...(target.meta || {}),
        venue: target.meta?.venue || meta.venue || null,
        year: target.meta?.year || meta.year || null,
        authors: (target.meta?.authors || []).length ? target.meta.authors : (meta.authors || []),
        oa_url: meta.oa_url || target.meta?.oa_url || null,
        is_oa: meta.is_oa ?? target.meta?.is_oa ?? null,
        source: meta.source || 'metadata',
      };
      target.abstract_lookup = target.abstract_lookup?.has_abstract
        ? target.abstract_lookup
        : { at: now, matched: true, has_abstract: Boolean(target.abstract), via: 'title', reason: null };
      target.metadata_lookup = { at: now, matched: true, via: meta.via || 'title', similarity: meta.similarity ?? null, source: meta.source || null };
      target.review_flags = (target.review_flags || []).filter((x) => x !== 'needs_metadata');
      target.updated_at = now;
    });
    return { paper: { ...paper, doi, arxiv_id: arxivId, url, meta: { ...(paper.meta || {}), venue: meta.venue, year: meta.year } }, changed: true, matched: true, meta };
  } catch (error) {
    return { paper, changed: false, matched: false, reason: String(error?.message || error) };
  }
}
