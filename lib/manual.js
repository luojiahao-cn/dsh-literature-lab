/**
 * 手动优先：用户直接给标题 / DOI / arXiv id。
 *
 * 2026-11-22 起走正规路径 + 通行权：
 * - 先通过 absorbCandidates 进候选池（manual 通行：绕过 T0/Zotero 过滤）；
 * - 随后自动 promote 到 L2，保持「手动加完就能读」的体验；
 * - 写一条 kind='manual' 的 run，让采集概况与抓取记录能看到这次导入；
 * - 置 priority=true，阅读队列排在最前；尽量顺手取开放原文。
 */
import { lookup, titleSimilarity } from './metadata.js';
import { newRunId } from './runs.js';
import { workId } from './dedup.js';
import { readState, updateState, updateStateAndSeen, advance, today, paperView } from './state.js';
import { readCandidates, updateCandidates, absorbCandidates, promoteCandidate } from './candidates.js';
import { readConfig } from './config.js';
import { download } from './download.js';

const DOI_RE = /^10\.\d{4,9}\/\S+$/i;
const ARXIV_RE = /^(?:arxiv:)?(\d{4}\.\d{4,5})(?:v\d+)?$/i;

/** 把用户输入归一成 lookup 能用的查询。 */
export function classifyManualQuery(raw) {
  const input = String(raw || '').trim();
  if (!input) return null;
  const arxiv = input.match(ARXIV_RE);
  if (arxiv) return { kind: 'arxiv', arxivId: arxiv[1] };
  const doi = input.replace(/^doi:\s*/i, '').replace(/^https?:\/\/doi\.org\//i, '').trim();
  if (DOI_RE.test(doi)) return { kind: 'doi', doi };
  return { kind: 'title', title: input };
}

/** 本地已有数据（候选/论文）里按 DOI / arXiv / 题名找一篇，避免重复走网络。 */
async function findKnown(baseDir, parsed) {
  const [candidates, state] = await Promise.all([readCandidates(baseDir), readState(baseDir)]);
  const rows = [
    ...Object.values(candidates).map((item) => ({ ...item, _source: 'candidate' })),
    ...Object.entries(state.papers || {}).map(([id, paper]) => ({ ...paper, id, _source: 'paper' })),
  ];
  for (const row of rows) {
    if (parsed.kind === 'doi' && row.doi
      && String(row.doi).replace(/^https?:\/\/doi\.org\//i, '').toLowerCase() === parsed.doi.toLowerCase()) {
      return { ...row, matched: true, source: row._source, via: 'local-doi' };
    }
    if (parsed.kind === 'arxiv' && row.arxiv_id
      && String(row.arxiv_id).replace(/^arxiv:/i, '').replace(/v\d+$/i, '') === parsed.arxivId) {
      return { ...row, matched: true, source: row._source, via: 'local-arxiv' };
    }
    if (parsed.kind === 'title' && row.title && titleSimilarity(parsed.title, row.title) >= 0.9) {
      return { ...row, matched: true, source: row._source, via: 'local-title' };
    }
  }
  return null;
}

/**
 * @param {{query:string, stage?:'L1'|'L2'|'L3', fetchPdf?:boolean}} input
 */
export async function addManualPaper(baseDir, { query, stage = 'L2', fetchPdf = true, ctx = null } = {}) {
  const parsed = classifyManualQuery(query);
  if (!parsed) throw new Error('需要标题、DOI 或 arXiv id');
  const finalStage = ['L1', 'L2', 'L3'].includes(stage) ? stage : 'L2';

  let meta = await lookup(
    parsed.kind === 'doi'
      ? { doi: parsed.doi }
      : parsed.kind === 'arxiv'
        ? { arxivId: parsed.arxivId }
        : { title: parsed.title },
  );
  if (!meta?.matched) meta = await findKnown(baseDir, parsed);
  if (!meta?.matched) {
    throw new Error(`没有找到这篇论文${meta?.reason ? `（${meta.reason}）` : ''}；可以换 DOI 或更完整的标题再试`);
  }

  const arxivId = meta.arxiv_id || (parsed.kind === 'arxiv' ? parsed.arxivId : null);
  const id = workId({ doi: meta.doi, arxivId, title: meta.title });
  if (!id) throw new Error('无法生成论文标识');

  const existingPaper = (await readState(baseDir)).papers?.[id] || null;
  let created = false;

  if (existingPaper) {
    // 已在论文库：沿用原来的「更新并置顶」路径，不重复建候选。
    await updateStateAndSeen(baseDir, (state, seen) => {
      const now = new Date().toISOString();
      const paper = state.papers[id];
      if (!paper) return;
      paper.priority = true;
      paper.manual = true;
      paper.last_seen = today();
      if (!paper.abstract && meta.abstract) {
        paper.abstract = meta.abstract;
        paper.summary = String(meta.abstract).slice(0, 1000);
        paper.abstract_lookup = { at: now, matched: true, has_abstract: true, via: 'manual', reason: null };
      }
      if (!['L2', 'L3', 'done'].includes(paper.stage)) advance(paper, finalStage);
      seen[id] = {
        t: now, s: 'manual', title: paper.title,
        a: Array.isArray(meta.authors) && meta.authors.length ? 1 : 0,
      };
    });
    await updateCandidates(baseDir, (items) => {
      if (items[id] && items[id].status !== 'promoted') {
        items[id].status = 'promoted';
        items[id].promoted_at = new Date().toISOString();
      }
      return items;
    });
  } else {
    // 新条目：先走候选池（manual 通行），再自动提升到目标阶段。
    const config = await readConfig(baseDir);
    const item = {
      title: meta.title || parsed.title || '',
      doi: meta.doi || (parsed.kind === 'doi' ? parsed.doi : null),
      arxivId,
      url: meta.oa_url || (meta.doi ? `https://doi.org/${meta.doi}` : arxivId ? `https://arxiv.org/abs/${arxivId}` : null),
      abstract: meta.abstract || null,
      authors: Array.isArray(meta.authors) ? meta.authors : [],
      venue: meta.venue || null,
      year: meta.year || null,
      publishedAt: meta.year ? `${meta.year}-01-01` : null,
    };
    const stats = await absorbCandidates(baseDir, config, [item], { source: 'manual', passThrough: true });
    const promoted = await promoteCandidate(baseDir, id, { stage: finalStage });
    if (promoted?.skipped && !(await readState(baseDir)).papers?.[id]) {
      throw new Error('候选已存在但论文记录缺失，请重试');
    }

    await updateStateAndSeen(baseDir, (state, seen) => {
      const now = new Date().toISOString();
      const paper = state.papers[id];
      if (!paper) return;
      paper.manual = true;
      paper.priority = true;
      paper.last_seen = today();
      if (!paper.meta) paper.meta = { venue: meta.venue || null, year: meta.year || null, source: meta.source || null };
      if (!paper.abstract && meta.abstract) {
        paper.abstract = meta.abstract;
        paper.summary = String(meta.abstract).slice(0, 1000);
        paper.abstract_lookup = { at: now, matched: true, has_abstract: true, via: 'manual', reason: null };
      }
      if (!['L2', 'L3', 'done'].includes(paper.stage)) advance(paper, finalStage);
      seen[id] = {
        t: now, s: 'manual', title: paper.title,
        a: Array.isArray(meta.authors) && meta.authors.length ? 1 : 0,
      };
    });
    created = true;

    // 手动导入也进账：采集概况/抓取记录能看到这次操作。
    await updateState(baseDir, (state) => {
      const run = {
        id: newRunId('manual'),
        date: today(),
        kind: 'manual',
        at: new Date().toISOString(),
        scanned: stats.scanned,
        added: stats.added,
        merged: stats.merged,
        filtered: stats.filtered,
        excluded: stats.excluded,
        owned: stats.owned,
        skippedKnown: stats.known,
        sources: [{ key: 'manual', label: '手动添加', ok: true, count: stats.scanned }],
      };
      state.runs = [run, ...(state.runs || [])].slice(0, 30);
      return state;
    });
  }

  let pdfResult = null;
  if (fetchPdf) {
    try {
      pdfResult = await download(baseDir, { ids: [id], limit: 1, ctx });
    } catch (error) {
      pdfResult = { ok: false, error: String(error?.message || error) };
    }
  }

  const state = await readState(baseDir);
  return {
    ok: true,
    id,
    created,
    stage: state.papers[id]?.stage || finalStage,
    paper: paperView(id, state.papers[id]),
    download: pdfResult,
  };
}
