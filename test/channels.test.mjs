import test from 'node:test';
import assert from 'node:assert/strict';
import { discover } from '../lib/discover.js';
import { readCandidates } from '../lib/candidates.js';
import { readState } from '../lib/state.js';
import { makeBase, fastNetwork, stubFetch, textResponse } from './helpers.mjs';

test('PubMed 渠道：Europe PMC 结果进候选池', async () => {
  const base = await makeBase({
    network: fastNetwork(),
    sources: {
      arxiv: { enabled: false },
      rss: [],
      pubmed: { enabled: true, queries: ['protein retrieval AND graph'], sinceDays: 30, limit: 10 },
    },
  });
  stubFetch([{
    match: 'europepmc/webservices/rest/search',
    respond: () => textResponse(JSON.stringify({
      hitCount: 1,
      resultList: {
        result: [{
          title: 'Graph complex localization for retrieval',
          doi: '10.1234/pm.1',
          pmid: '123456',
          authorString: 'A. Author, B. Author',
          journalTitle: 'IEEE Transactions on Biomedical Engineering',
          pubYear: '2020',
          abstractText: 'A graph complex method.',
          meshHeadingList: { meshHeading: [{ descriptorName: 'Protein Retrieval' }] },
        }],
      },
    })),
  }]);

  const result = await discover(base);
  assert.equal(result.added, 1);
  assert.ok(result.sources.some((s) => s.key === 'pubmed:protein retrieval AND graph' && s.ok));
  const candidate = (await readCandidates(base))['doi:10.1234/pm.1'];
  assert.ok(candidate, '进候选池');
  assert.equal(candidate.venue, 'IEEE Transactions on Biomedical Engineering');
  assert.equal(candidate.abstract, 'A graph complex method.');
  assert.equal((await readState(base)).papers['doi:10.1234/pm.1'], undefined, '不直接进 papers');
});

test('widget 运行：only 只跑指定渠道', async () => {
  const base = await makeBase({
    network: fastNetwork(),
    sources: {
      arxiv: { enabled: false },
      rss: [],
      pubmed: { enabled: true, queries: ['protein'], sinceDays: 30, limit: 10 },
      dblp: { enabled: true, queries: ['graph'], sinceYears: 2, limit: 10 },
    },
  });
  stubFetch([{
    match: 'europepmc/webservices/rest/search',
    respond: () => textResponse(JSON.stringify({
      resultList: { result: [{ title: 'Only PubMed', doi: '10.1234/only.1' }] },
    })),
  }]);

  const result = await discover(base, { only: ['pubmed'] });
  assert.equal(result.added, 1);
  assert.ok(result.sources.every((s) => s.key.startsWith('pubmed:')));
  assert.ok((await readCandidates(base))['doi:10.1234/only.1']);
});

test('PubMed 自动使用研究兴趣词（不再手填检索式）', async () => {
  const base = await makeBase({
    network: fastNetwork(),
    relevance: { keywords: ['graph tracking'], contextKeywords: [], excludeKeywords: [], minScore: 0 },
    sources: {
      arxiv: { enabled: false },
      rss: [],
      pubmed: { enabled: true, queries: [], sinceDays: 30, limit: 10 },
    },
  });
  const calls = stubFetch([{
    match: 'europepmc/webservices/rest/search',
    respond: () => textResponse(JSON.stringify({
      resultList: { result: [{ title: 'Auto Query Paper', doi: '10.1234/auto.1' }] },
    })),
  }]);

  const result = await discover(base);
  assert.equal(result.added, 1);
  assert.ok(calls[0].url.includes('graph'));
  assert.ok(calls[0].url.includes('tracking'));
  assert.ok((await readCandidates(base))['doi:10.1234/auto.1']);
});

test('DBLP 渠道：会议书目进候选池', async () => {
  const base = await makeBase({
    network: fastNetwork(),
    sources: {
      arxiv: { enabled: false },
      rss: [],
      dblp: { enabled: true, queries: ['graph-based structure prediction'], sinceYears: 5, limit: 10 },
    },
  });
  stubFetch([{
    match: 'dblp.org/search/publ/api',
    respond: () => textResponse(JSON.stringify({
      result: {
        hits: {
          '@total': '1',
          hit: [{
            info: {
              title: 'Graph-Based Structure Prediction for Protein Complexes',
              authors: { author: [{ text: 'A. Author' }] },
              venue: 'ICRA',
              year: '2021',
              doi: '10.1234/dblp.1',
              ee: 'https://doi.org/10.1234/dblp.1',
            },
          }],
        },
      },
    })),
  }]);

  const result = await discover(base);
  assert.equal(result.added, 1);
  const candidate = (await readCandidates(base))['doi:10.1234/dblp.1'];
  assert.ok(candidate);
  assert.equal(candidate.venue, 'ICRA');
});


test('bioRxiv 渠道：预印本进候选池', async () => {
  const base = await makeBase({
    network: fastNetwork(),
    sources: {
      arxiv: { enabled: false },
      rss: [],
      preprint: { enabled: true, servers: ['biorxiv'], sinceDays: 2, limit: 10 },
    },
  });
  stubFetch([{
    match: 'api.biorxiv.org/details/biorxiv/',
    respond: () => textResponse(JSON.stringify({
      collection: [{
        title: 'Graph complex preprint',
        doi: '10.1234/biorxiv.1',
        authors: 'A. Author; B. Author',
        date: '2026-11-20',
        abstract: 'Preprint abstract',
        category: 'bioengineering',
      }],
      messages: [{ status: 'ok' }],
    })),
  }]);

  const result = await discover(base);
  assert.equal(result.added, 1);
  const candidate = (await readCandidates(base))['doi:10.1234/biorxiv.1'];
  assert.ok(candidate);
  assert.equal(candidate.venue, 'bioRxiv');
  assert.equal(candidate.abstract, 'Preprint abstract');
});
