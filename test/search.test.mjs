/**
 * 查询式检索测试：三源并查、跨源去重、配置驱动的每日检索。
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { searchItems } from '../lib/search.js';
import { discover } from '../lib/discover.js';
import { readState, writeState, emptyState } from '../lib/state.js';
import { readCandidates } from '../lib/candidates.js';
import {
  makeBase, fastNetwork, stubFetch, textResponse,
  arxivEntry, arxivFeed,
} from './helpers.mjs';

const openAlexWork = {
  id: 'https://openalex.org/W1',
  title: 'OpenAlex Paper on Sensors',
  doi: 'https://doi.org/10.1234/xyz',
  publication_date: '2026-11-01',
  primary_location: { landing_page_url: 'https://doi.org/10.1234/xyz' },
  authorships: [{ author: { display_name: 'A. Author' } }],
  abstract_inverted_index: { We: [0], propose: [1], a: [2], graph: [3], method: [4] },
};

const crossrefWork = {
  title: ['Crossref Paper on Sensors'],
  DOI: '10.1234/XYZ',
  abstract: '<jats:p>Crossref <b>abstract</b>.</jats:p>',
  author: [{ given: 'B', family: 'Writer' }],
  issued: { 'date-parts': [[2026, 11, 2]] },
  URL: 'https://doi.org/10.1234/xyz',
};

test('search：三源并查、跨源按 DOI 去重', async () => {
  const calls = stubFetch([
    {
      match: 'export.arxiv.org/api/query',
      respond: () => textResponse(arxivFeed([
        arxivEntry({ id: '2611.88888', title: 'arXiv Paper on Sensors', published: '2026-11-20T00:00:00Z', summary: 'arXiv abstract.' }),
      ])),
    },
    {
      match: 'api.openalex.org/works',
      respond: () => textResponse(JSON.stringify({ results: [openAlexWork] })),
    },
    {
      match: 'api.crossref.org/works',
      respond: () => textResponse(JSON.stringify({ message: { items: [crossrefWork] } })),
    },
  ]);

  const config = { sources: { arxiv: { mailto: 'me@example.com' } } };
  const res = await searchItems(
    config,
    { text: 'sensor', sources: ['arxiv', 'openalex', 'crossref'], sinceDays: 7, limit: 5 },
    fastNetwork(),
  );

  assert.equal(res.items.length, 2, 'arXiv 一条 + OpenAlex/Crossref 同 DOI 合成一条');
  assert.equal(res.sources.find((s) => s.key === 'arxiv').count, 1);
  assert.equal(res.sources.find((s) => s.key === 'openalex').count, 1);
  assert.equal(res.sources.find((s) => s.key === 'crossref').count, 0);
  assert.equal(res.items[0].abstract, 'arXiv abstract.');
  assert.equal(res.items[1].abstract, 'We propose a graph method');
  assert.ok(calls.some((c) => c.url.includes('search_query=all') && c.url.includes('submittedDate')));
  assert.ok(calls.some((c) => c.url.includes('from_publication_date')));
  assert.ok(calls.some((c) => c.url.includes('from-pub-date')));
});

test('search：arXiv 语法原样透传', async () => {
  const calls = stubFetch([
    {
      match: 'export.arxiv.org/api/query',
      respond: () => textResponse(arxivFeed([])),
    },
    { match: 'api.openalex.org/works', respond: () => textResponse('{"results":[]}') },
    { match: 'api.crossref.org/works', respond: () => textResponse('{"message":{"items":[]}}') },
  ]);
  await searchItems(
    { sources: {} },
    { text: 'au:"Doe" AND abs:"graph"', sources: ['arxiv', 'openalex', 'crossref'] },
    fastNetwork(),
  );
  const arxivCall = calls.find((c) => c.url.includes('export.arxiv.org'));
  const searchQuery = new URL(arxivCall.url).searchParams.get('search_query') || '';
  assert.ok(searchQuery.includes('au:"Doe" AND abs:"graph"'), searchQuery);
});

test('discover：配置里的检索式会并入队列', async () => {
  const base = await makeBase({
    network: fastNetwork(),
    window: { hours: 24, backfillDays: 14 },
    sources: {
      arxiv: { enabled: false },
      rss: [],
      search: {
        enabled: true,
        sources: ['openalex'],
        sinceDays: 7,
        limit: 5,
        queries: [{ id: 'q1', text: 'sensor' }],
      },
    },
  });
  stubFetch([
    {
      match: 'api.openalex.org/works',
      respond: () => textResponse(JSON.stringify({ results: [openAlexWork] })),
    },
  ]);

  const result = await discover(base);
  assert.equal(result.added, 1);
  assert.ok(result.sources.some((s) => s.key === 'search:q1' && s.ok));

  const candidates = await readCandidates(base);
  const candidate = candidates['doi:10.1234/xyz'];
  assert.ok(candidate, '检索结果进候选池');
  assert.deepEqual(candidate.sources, ['search:q1']);
  const state = await readState(base);
  assert.equal(state.sources['search:q1'].last_count, 1);
  assert.equal(candidate.title, 'OpenAlex Paper on Sensors');
});

test('search：Semantic Scholar bulk 源', async () => {
  stubFetch([{
    match: 'api.semanticscholar.org/graph/v1/paper/search/bulk',
    respond: () => textResponse(JSON.stringify({
      total: 1,
      data: [{
        title: 'S2 Paper',
        year: 2024,
        venue: 'ICRA',
        externalIds: { DOI: '10.1234/s2.9' },
        authors: [{ name: 'A. Author' }],
        url: 'https://example.org/s2',
        abstract: 'S2 abstract',
      }],
    })),
  }]);
  const res = await searchItems({}, { text: 'graph', sources: ['s2'], limit: 2 }, fastNetwork());
  assert.equal(res.items.length, 1);
  assert.equal(res.items[0].title, 'S2 Paper');
  assert.equal(res.items[0].doi, '10.1234/s2.9');
});

test('discover：没有手写检索式时用研究兴趣自动查', async () => {
  const base = await makeBase({
    network: fastNetwork(),
    relevance: { keywords: ['graph'], contextKeywords: [], excludeKeywords: [], minScore: 3 },
    sources: {
      arxiv: { enabled: false },
      rss: [],
      search: { enabled: true, sources: ['openalex'], sinceDays: 30, limit: 5, queries: [] },
    },
  });
  stubFetch([{
    match: 'api.openalex.org/works',
    respond: () => textResponse(JSON.stringify({ results: [openAlexWork] })),
  }]);

  const result = await discover(base);
  assert.equal(result.added, 1);
  assert.ok(result.sources.some((s) => s.key.startsWith('search:auto-') && s.ok));
  assert.ok((await readCandidates(base))['doi:10.1234/xyz']);
});

test('search：检索式为空时报错', async () => {
  await assert.rejects(() => searchItems({}, { text: '   ' }, fastNetwork()), /检索词为空/);
});
