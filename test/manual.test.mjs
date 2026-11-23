import test from 'node:test';
import assert from 'node:assert/strict';

import { addManualPaper, classifyManualQuery } from '../lib/manual.js';
import { readState, writeState, emptyState, advance } from '../lib/state.js';
import { absorbCandidates, readCandidates } from '../lib/candidates.js';
import { makeBase, stubFetch, textResponse } from './helpers.mjs';

function openAlexWork(doi = '10.1234/manual.1', title = 'Manual Priority Paper') {
  return {
    id: `https://openalex.org/W${Math.floor(Math.random() * 1e6)}`,
    title,
    doi: `https://doi.org/${doi}`,
    publication_year: 2021,
    primary_location: { source: { display_name: 'Journal' }, landing_page_url: `https://doi.org/${doi}` },
    authorships: [{ author: { display_name: 'M. Author' } }],
    abstract_inverted_index: { Manual: [0], abstract: [1] },
    open_access: { oa_status: 'closed' },
    best_oa_location: null,
  };
}

test('manual：输入分类（DOI / arXiv / 标题）', () => {
  assert.equal(classifyManualQuery('10.1234/abc.1').kind, 'doi');
  assert.equal(classifyManualQuery('https://doi.org/10.1234/abc.1').kind, 'doi');
  assert.equal(classifyManualQuery('arXiv:2508.06243').kind, 'arxiv');
  assert.equal(classifyManualQuery('2508.06243v2').kind, 'arxiv');
  assert.equal(classifyManualQuery('A Paper Title').kind, 'title');
});

test('manual：DOI 先进候选（通行）再自动提升到 L2', async () => {
  const base = await makeBase();
  stubFetch([{
    match: 'api.openalex.org/works/doi:',
    respond: () => textResponse(JSON.stringify(openAlexWork())),
  }]);

  const result = await addManualPaper(base, { query: '10.1234/manual.1', fetchPdf: false });
  assert.equal(result.ok, true);
  assert.equal(result.created, true);
  assert.equal(result.stage, 'L2');

  const state = await readState(base);
  const paper = state.papers['doi:10.1234/manual.1'];
  assert.ok(paper, '直接写入 papers');
  assert.equal(paper.stage, 'L2');
  assert.equal(paper.priority, true);
  assert.equal(paper.manual, true);
  assert.equal(paper.sources[0], 'manual');
  assert.match(paper.abstract, /Manual abstract/);

  const candidate = (await readCandidates(base))['doi:10.1234/manual.1'];
  assert.ok(candidate, '进入候选池');
  assert.equal(candidate.status, 'promoted', '自动提升');
  assert.equal(candidate.manual, true);
  assert.equal(state.runs[0]?.kind, 'manual', '写一条手动导入 run');
  assert.equal(state.runs[0]?.added, 1);
});

test('manual：网络查不到时回退本地候选', async () => {
  const base = await makeBase();
  await absorbCandidates(base, { relevance: {} }, [{
    title: 'Local Candidate Paper',
    doi: '10.1234/local.1',
    abstract: 'Local abstract',
    year: 2020,
    venue: 'Journal',
  }], { source: 'test' });
  stubFetch([]);

  const result = await addManualPaper(base, { query: '10.1234/local.1', fetchPdf: false });
  assert.equal(result.ok, true);
  const paper = (await readState(base)).papers['doi:10.1234/local.1'];
  assert.equal(paper.stage, 'L2');
  assert.equal(paper.priority, true);
  assert.equal(paper.abstract, 'Local abstract');
  assert.equal((await readCandidates(base))['doi:10.1234/local.1'].status, 'promoted');
});

test('manual：已有论文提升到 L2 并置顶；候选标记 promoted', async () => {
  const base = await makeBase();
  await absorbCandidates(base, { relevance: {} }, [{ title: 'Old Paper', doi: '10.1234/manual.2' }], { source: 'test' });

  const state = emptyState();
  const paper = { title: 'Old Paper', stage: 'L1', sources: ['arxiv'], grade_history: [] };
  advance(paper, 'L1');
  state.papers['doi:10.1234/manual.2'] = paper;
  await writeState(base, state);

  stubFetch([{
    match: 'api.openalex.org/works/doi:',
    respond: () => textResponse(JSON.stringify(openAlexWork('10.1234/manual.2', 'Old Paper'))),
  }]);

  const result = await addManualPaper(base, { query: '10.1234/manual.2', fetchPdf: false });
  assert.equal(result.created, false);
  const latest = await readState(base);
  assert.equal(latest.papers['doi:10.1234/manual.2'].stage, 'L2');
  assert.equal(latest.papers['doi:10.1234/manual.2'].priority, true);
  const candidates = await readCandidates(base);
  assert.equal(candidates['doi:10.1234/manual.2'].status, 'promoted');
});
