/**
 * 候选池、回溯采集（年份 / 引文雪球）、T1 粗筛。
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import * as store from '../lib/store.js';
import { absorbCandidates, readCandidates, promoteCandidate, queryCandidates, updateCandidates } from '../lib/candidates.js';
import { startHarvest, listHarvests, resumeHarvest } from '../lib/harvest.js';
import { readState } from '../lib/state.js';
import { makeBase, stubFetch, textResponse } from './helpers.mjs';

const config = {
  relevance: { keywords: [], contextKeywords: [], excludeKeywords: [], minScore: 5 },
  corpus: { maxItems: 20 },
};

function work(id, title, doi, extra = {}) {
  return {
    id: `https://openalex.org/${id}`,
    title,
    doi: `https://doi.org/${doi}`,
    publication_year: 2020,
    publication_date: '2020-01-01',
    primary_location: { source: { display_name: 'Journal' }, landing_page_url: `https://doi.org/${doi}` },
    authorships: [{ author: { display_name: 'A. Author' } }],
    abstract_inverted_index: { Hello: [0], world: [1] },
    referenced_works: [],
    cited_by_api_url: null,
    ...extra,
  };
}

async function waitFor(fn, timeoutMs = 3000) {
  const start = Date.now();
  for (;;) {
    const value = await fn();
    if (value) return value;
    if (Date.now() - start > timeoutMs) throw new Error('waitFor timeout');
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

test('候选池：T0 过滤、收进队列（默认进初筛）', async () => {
  const base = await makeBase();
  const strict = { relevance: { keywords: ['graph'], contextKeywords: [], excludeKeywords: [], minScore: 3 } };
  await absorbCandidates(base, strict, [
    { title: 'Graph-based structure prediction', doi: '10.1234/a', abstract: 'graph field' },
    { title: 'Unrelated gardening', doi: '10.1234/b', abstract: 'plants' },
  ], { source: 'test' });

  let candidates = await readCandidates(base);
  assert.equal(candidates['doi:10.1234/a'].status, 'new');
  assert.equal(candidates['doi:10.1234/b'].status, 'filtered');

  const promoted = await promoteCandidate(base, 'doi:10.1234/a');
  assert.equal(promoted.ok, true);
  // 默认收进初筛：候选已经过摘要判读，论文 L1 是没有入口的中间态
  assert.equal((await readState(base)).papers['doi:10.1234/a'].stage, 'L2');
  candidates = await readCandidates(base);
  assert.equal(candidates['doi:10.1234/a'].status, 'promoted');

  // 显式指定 L1 仍然可用（工具侧兼容）
  const explicit = await promoteCandidate(base, 'doi:10.1234/b', { stage: 'L1' });
  assert.equal(explicit.ok, true);
  assert.equal((await readState(base)).papers['doi:10.1234/b'].stage, 'L1');

  const again = await promoteCandidate(base, 'doi:10.1234/a');
  assert.equal(again.skipped, 'already-promoted');

  const list = await queryCandidates(base, { status: 'new' });
  assert.equal(list.total, 0);
});

test('候选池查询支持多状态（处理队列的待处理是一组的）', async () => {
  const base = await makeBase();
  const cfg = {
    relevance: { keywords: ['graph'], contextKeywords: [], excludeKeywords: [], minScore: 3 },
  };
  await absorbCandidates(base, cfg, [
    { title: 'Graph A', doi: '10.1234/multi.a' },
    { title: 'Graph B', doi: '10.1234/multi.b' },
    { title: 'Graph C', doi: '10.1234/multi.c' },
  ], { source: 'test' });

  // 三种状态各一条：待确认、失败、被过滤
  const items = await readCandidates(base);
  const ids = Object.keys(items);
  await updateCandidates(base, (all) => {
    all[ids[0]].status = 'parked';
    all[ids[1]].status = 'failed';
    all[ids[2]].status = 'filtered';
    return all;
  });

  const todo = await queryCandidates(base, { status: 'new,parked,failed' });
  assert.equal(todo.total, 2);
  assert.deepEqual(todo.items.map((item) => item.status).sort(), ['failed', 'parked']);
  assert.equal(todo.counts.filtered, 1, 'counts 仍是全量口径');

  const noise = await queryCandidates(base, { status: 'filtered,excluded,owned' });
  assert.equal(noise.total, 1);
  assert.equal(noise.items[0].status, 'filtered');

  const all = await queryCandidates(base, { status: 'all' });
  assert.equal(all.total, 3);
  assert.equal(all.counts.parked, 1);
});

test('候选池排序：兴趣分 / 最新 / 年份', async () => {
  const base = await makeBase();
  const cfg = {
    relevance: { keywords: ['graph'], contextKeywords: ['protein'], excludeKeywords: [], minScore: 3 },
  };
  await absorbCandidates(base, cfg, [
    { title: 'Graph Only', doi: '10.1234/sort.low', year: 2018 },
    { title: 'Graph Complex Protein', doi: '10.1234/sort.high', year: 2024 },
  ], { source: 'test' });

  const byScore = await queryCandidates(base, { status: 'new', sort: 'score' });
  assert.equal(byScore.items[0].id, 'doi:10.1234/sort.high', '兴趣分高的在前');
  const byYear = await queryCandidates(base, { status: 'new', sort: 'year' });
  assert.equal(byYear.items[0].id, 'doi:10.1234/sort.high');
  const byTitle = await queryCandidates(base, { status: 'new', sort: 'title' });
  assert.equal(byTitle.items[0].title, 'Graph Complex Protein');
});

test('年份采集：后台任务写入候选池', async () => {
  const base = await makeBase();
  stubFetch([{
    match: 'api.openalex.org/works?search=',
    respond: () => textResponse(JSON.stringify({
      results: [work('W1', 'Year Paper', '10.1234/year')],
      meta: { count: 1, next_cursor: null },
    })),
  }]);

  const record = await startHarvest(base, { kind: 'year', query: 'graph', yearFrom: 2015, yearTo: 2020, maxItems: 10, sources: ['openalex'] });
  assert.equal(record.status, 'running');

  const done = await waitFor(async () => (await listHarvests(base)).find((h) => h.id === record.id && h.status !== 'running'));
  assert.equal(done.status, 'done');
  assert.ok(done.fetched >= 1);

  const candidates = await readCandidates(base);
  assert.ok(candidates['doi:10.1234/year']);
  assert.equal(candidates['doi:10.1234/year'].status, 'new');

  const resumed = await resumeHarvest(base, record.id);
  assert.notEqual(resumed.id, record.id);
  assert.equal(resumed.resume_of, record.id);
  assert.ok(resumed.spec.cursor);
});

test('Crossref 年份采集：走 crossref 源', async () => {
  const base = await makeBase();
  stubFetch([{
    match: 'api.crossref.org/works?',
    respond: () => textResponse(JSON.stringify({
      message: {
        items: [{
          DOI: '10.1234/cr.1',
          title: ['Crossref Paper'],
          author: [{ given: 'B', family: 'Author' }],
          issued: { 'date-parts': [[2018]] },
          'container-title': ['Journal'],
          URL: 'https://doi.org/10.1234/cr.1',
          abstract: '<jats:p>Abstract text</jats:p>',
        }],
        'next-cursor': null,
        'total-results': 1,
      },
    })),
  }]);

  const record = await startHarvest(base, {
    kind: 'year', query: 'graph', yearFrom: 2015, yearTo: 2020, maxItems: 5, sources: ['crossref'],
  });
  const done = await waitFor(async () => (await listHarvests(base)).find((h) => h.id === record.id && h.status !== 'running'));
  assert.equal(done.status, 'done', done.error || '');
  assert.deepEqual(done.result.sources, ['crossref']);
  const candidates = await readCandidates(base);
  assert.ok(candidates['doi:10.1234/cr.1']);
  assert.match(candidates['doi:10.1234/cr.1'].abstract, /Abstract text/);
});

test('arXiv 年份采集：按日期区间入候选', async () => {
  const base = await makeBase();
  const atom = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <id>http://arxiv.org/abs/2101.00001v1</id>
    <title>Arxiv Year Paper</title>
    <summary>Graph-based structure prediction abstract.</summary>
    <published>2020-05-01T00:00:00Z</published>
    <author><name>A. Author</name></author>
    <link href="http://arxiv.org/abs/2101.00001v1" rel="alternate"/>
  </entry>
</feed>`;
  stubFetch([{ match: 'export.arxiv.org/api/query', respond: () => textResponse(atom) }]);

  const record = await startHarvest(base, {
    kind: 'year', query: 'graph', yearFrom: 2019, yearTo: 2021, maxItems: 5, sources: ['arxiv'],
  });
  const done = await waitFor(async () => (await listHarvests(base)).find((h) => h.id === record.id && h.status !== 'running'));
  assert.equal(done.status, 'done', done.error || '');

  const candidates = await readCandidates(base);
  assert.ok(Object.values(candidates).some((c) => c.title === 'Arxiv Year Paper'));
});

test('引文雪球：Zotero 种子 → references + citations', async () => {
  const base = await makeBase();
  const paths = store.statePaths(base);
  await store.writeJsonAtomic(paths.zotero, {
    fetched_at: new Date().toISOString(),
    total: 1,
    items: [{
      key: 'SEED', title: 'Seed Paper', doi: '10.1234/seed', year: '2020',
      tags: ['评级S-顶级'], collections: [], archiveId: '', abstract: '', venue: '',
    }],
    collections: [],
  });

  stubFetch([
    {
      match: '/works/doi:',
      respond: () => textResponse(JSON.stringify(work('W9', 'Seed Paper', '10.1234/seed', {
        referenced_works: ['W2', 'W3'],
        cited_by_api_url: 'https://api.openalex.org/works?filter=cites:W9',
      }))),
    },
    {
      match: 'openalex_id',
      respond: () => textResponse(JSON.stringify({
        results: [work('W2', 'Reference A', '10.1234/r1'), work('W3', 'Reference B', '10.1234/r2')],
        meta: { count: 2, next_cursor: null },
      })),
    },
    {
      match: 'filter=cites:W9',
      respond: () => textResponse(JSON.stringify({
        results: [work('W4', 'Citing Paper', '10.1234/c1')],
        meta: { count: 1, next_cursor: null },
      })),
    },
  ]);

  const record = await startHarvest(base, {
    kind: 'snowball',
    direction: 'both',
    zotero: { tag: '评级S-顶级' },
    maxSeeds: 5,
    maxItems: 10,
  });
  const done = await waitFor(async () => (await listHarvests(base)).find((h) => h.id === record.id && h.status !== 'running'));
  assert.equal(done.status, 'done', done.error || '');

  const candidates = await readCandidates(base);
  assert.ok(candidates['doi:10.1234/r1'], 'references 入候选');
  assert.ok(candidates['doi:10.1234/c1'], 'citations 入候选');
});

test('S2 推荐：按 DOI 取相关论文入候选', async () => {
  const base = await makeBase();
  stubFetch([
    {
      match: '/works/doi:',
      respond: () => textResponse(JSON.stringify(work('W2', 'Seed Two', '10.1234/seed2'))),
    },
    {
      match: 'api.semanticscholar.org',
      respond: () => textResponse(JSON.stringify({
        data: [{
          title: 'Recommended Paper',
          externalIds: { DOI: '10.1234/s2.1' },
          year: 2021,
          venue: 'Journal',
          abstract: 'Recommended abstract',
          authors: [{ name: 'C. Author' }],
          url: 'https://example.org/s2',
        }],
      })),
    },
  ]);

  const record = await startHarvest(base, {
    kind: 'snowball', direction: 'recommend', seeds: [{ doi: '10.1234/seed2' }], maxItems: 5,
  });
  const done = await waitFor(async () => (await listHarvests(base)).find((h) => h.id === record.id && h.status !== 'running'));
  assert.equal(done.status, 'done', done.error || '');

  const candidates = await readCandidates(base);
  assert.ok(candidates['doi:10.1234/s2.1']);
  assert.equal(candidates['doi:10.1234/s2.1'].title, 'Recommended Paper');
});

test('OpenAlex related_works：相似论文进候选', async () => {
  const base = await makeBase();
  stubFetch([
    {
      match: '/works/doi:',
      respond: () => textResponse(JSON.stringify(work('W9', 'Related Seed', '10.1234/relseed', {
        related_works: ['W7', 'W8'],
      }))),
    },
    {
      match: 'openalex_id',
      respond: () => textResponse(JSON.stringify({
        results: [work('W7', 'Related A', '10.1234/rel.a'), work('W8', 'Related B', '10.1234/rel.b')],
        meta: { count: 2, next_cursor: null },
      })),
    },
  ]);

  const record = await startHarvest(base, {
    kind: 'snowball', direction: 'related', seeds: [{ doi: '10.1234/relseed' }], maxItems: 5,
  });
  const done = await waitFor(async () => (await listHarvests(base)).find((h) => h.id === record.id && h.status !== 'running'));
  assert.equal(done.status, 'done', done.error || '');
  const candidates = await readCandidates(base);
  assert.ok(candidates['doi:10.1234/rel.a']);
  assert.ok(candidates['doi:10.1234/rel.b']);
});
