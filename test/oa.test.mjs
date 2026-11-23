import test from 'node:test';
import assert from 'node:assert/strict';
import {
  clearLocationCache, landingLocations, lookupLocations, metadataLocations, pmcRenderUrls, publisherTemplate, rankLocations, tierOf,
} from '../lib/oa.js';
import { resetThrottle } from '../lib/http.js';
import { textResponse, stubFetch, statusResponse } from './helpers.mjs';

function json(body, status = 200) {
  return textResponse(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

test('oa：出版商模板按 DOI 前缀', () => {
  assert.match(publisherTemplate('10.1186/s12915-024-01'), /link\.springer\.com\/content\/pdf\//);
  assert.match(publisherTemplate('10.1038/s41586-024-07'), /nature\.com\/articles\/s41586-024-07\.pdf/);
  assert.equal(publisherTemplate('10.1109/TMECH.2024.1'), null, 'IEEE 不猜地址，交给机构会话');
  assert.equal(publisherTemplate(''), null);
});

test('oa：三档排序与去重', () => {
  const list = [
    { url: 'https://x.org/landing', kind: 'landing', oa: true, source: 'openalex' },
    { url: 'https://x.org/a.pdf', kind: 'pdf', oa: false, source: 'template' },
    { url: 'https://x.org/b.pdf', kind: 'pdf', oa: true, source: 'unpaywall' },
    { url: 'https://europepmc.org/articles/PMC1?pdf=render', kind: 'pdf', oa: null, source: 'europepmc' },
    { url: 'https://X.org/b.pdf#page=2', kind: 'pdf', oa: true, source: 'openalex' },
  ];
  const ranked = rankLocations(list);
  assert.equal(ranked[0].url, 'https://x.org/b.pdf', '已确认 OA 直链第一，且大小写/锚点去重');
  assert.equal(tierOf(ranked[0]), 0);
  assert.equal(ranked.at(-1).kind, 'landing');
  assert.equal(tierOf({ url: 'https://europepmc.org/articles/PMC1?pdf=render', kind: 'pdf' }), 2, '仓储渲染页排在直链之后');
});

test('oa：记录自带候选与模板开关', () => {
  const paper = { arxiv_id: '2611.00001', doi: '10.1186/s1', pmcid: '1234567' };
  const withTpl = metadataLocations(paper, { templates: true });
  const without = metadataLocations(paper, { templates: false });
  assert.ok(withTpl.some((l) => l.source === 'template'));
  assert.ok(!without.some((l) => l.source === 'template'));
  assert.ok(withTpl.some((l) => l.url === 'https://arxiv.org/pdf/2611.00001'));
  assert.ok(withTpl.some((l) => l.source === 'europepmc' && l.url.includes('PMC1234567')));
  assert.equal(pmcRenderUrls('PMC42').length, 2);
  assert.deepEqual(landingLocations({ doi: '10.1038/x' }).map((l) => l.kind), ['landing']);
});

test('oa：反查合并、单源失败不抛、命中缓存', async () => {
  resetThrottle();
  clearLocationCache();
  let openalexCalls = 0;
  const calls = stubFetch([
    {
      match: 'api.openalex.org',
      respond: () => {
        openalexCalls += 1;
        return json({ best_oa_location: { pdf_url: 'https://repo.example.edu/x.pdf', is_oa: true } });
      },
    },
    {
      match: 'api.unpaywall.org',
      respond: () => json({ best_oa_location: { url_for_pdf: 'https://other.example.edu/x.pdf' } }),
    },
    { match: 'europepmc', respond: () => statusResponse(500) },
    { match: 'openaire', respond: () => json({ results: [] }) },
    { match: 'semanticscholar', respond: () => json({}) },
  ]);

  const first = await lookupLocations({ doi: '10.1186/s1', email: 'a@b.c' });
  assert.equal(first.cached, false);
  assert.ok(first.locations.some((l) => l.url.includes('repo.example.edu')));
  assert.ok(first.locations.some((l) => l.url.includes('other.example.edu')));
  assert.ok(first.errors.some((e) => e.source === 'europepmc'), '单源 500 只进 errors');
  assert.ok(calls.length >= 5);

  const second = await lookupLocations({ doi: '10.1186/s1', email: 'a@b.c' });
  assert.equal(second.cached, true);
  assert.equal(openalexCalls, 1, '同一 DOI 第二次走缓存');
});

test('oa：没有 DOI 时不发无意义的反查', async () => {
  resetThrottle();
  clearLocationCache();
  const calls = stubFetch([]);
  const out = await lookupLocations({ doi: '', pmcid: '' });
  assert.deepEqual(out.locations, []);
  assert.equal(calls.length, 0);
});
