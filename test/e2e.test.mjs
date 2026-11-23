import test from 'node:test';
import assert from 'node:assert/strict';

import { discover } from '../lib/discover.js';
import { readCandidates } from '../lib/candidates.js';
import { analyzeCandidates } from '../lib/analysis-run.js';
import { readState } from '../lib/state.js';
import { makeBase, fastNetwork, stubFetch, textResponse } from './helpers.mjs';

test('e2e：兴趣自动检索 → 候选 → L1 摘要判读 → L2', async () => {
  const base = await makeBase({
    network: fastNetwork(),
    relevance: { keywords: ['graph'], contextKeywords: [], excludeKeywords: [], minScore: 3 },
    sources: {
      arxiv: { enabled: false },
      rss: [],
      search: { enabled: true, sources: ['openalex'], sinceDays: 30, limit: 5, queries: [] },
    },
  });
  const work = {
    id: 'https://openalex.org/W5',
    title: 'Graph-Based Structure Prediction for Protein Complexes',
    doi: 'https://doi.org/10.1234/e2e.1',
    publication_date: '2026-11-01',
    primary_location: { source: { display_name: 'IEEE T-Mech' }, landing_page_url: 'https://doi.org/10.1234/e2e.1' },
    authorships: [{ author: { display_name: 'A. Author' } }],
    abstract_inverted_index: { graph: [0], localization: [1] },
  };
  stubFetch([
    {
      match: 'api.openalex.org/works',
      respond: () => textResponse(JSON.stringify({ results: [work] })),
    },
    {
      // 引用核验：DOI 在 Crossref 有记录且题名一致，才允许拿 A
      match: 'api.crossref.org/works',
      respond: () => textResponse(JSON.stringify({ message: { DOI: '10.1234/e2e.1', title: [work.title] } })),
    },
  ]);

  const run = await discover(base);
  assert.equal(run.added, 1);
  const candidates = await readCandidates(base);
  assert.ok(candidates['doi:10.1234/e2e.1']);

  const fakeLlm = {
    async listProviders() { return [{ id: 'deepseek' }]; },
    async listModels() { return [{ id: 'deepseek-flash' }]; },
    stream() {
      return (async function* stream() {
        yield { type: 'text-delta', text: JSON.stringify({ verdict: 'continue', domain: 'core', use: 'method', grade: 'A', increment: '把离线图推理扩展到在线蛋白质复合物', reason: '直接相关', confidence: 'high', evidence: [{ source: 'abstract', quote: 'graph-based structure prediction' }] }) };
        yield { type: 'finish', reason: { kind: 'stop' } };
      })();
    },
  };
  const result = await analyzeCandidates(
    { get: (name) => (name === 'llm' ? fakeLlm : undefined) },
    base,
    { analysis: { models: {}, maxTokens: { l1: 1000 }, daily: { l1: 10 }, lowConfidence: 'continue' } },
    { limit: 5, sort: 'score' },
  );
  assert.equal(result.admitted, 1);
  const paper = (await readState(base)).papers['doi:10.1234/e2e.1'];
  assert.ok(paper, 'continue 进入 papers');
  assert.equal(paper.stage, 'L2');
  assert.equal(paper.grade, 'A');
  assert.equal(paper.verification?.status, 'crossref-ok', '入库时要带上核验结论');
});
