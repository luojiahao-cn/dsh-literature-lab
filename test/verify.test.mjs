import test from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyMatch, coerceGradeForVerification, ensureVerification, verifyPaper, VERIFICATION,
} from '../lib/verify.js';
import { checkVerification } from '../lib/judge.js';
import { resetThrottle } from '../lib/http.js';
import { makeBase, stubFetch, textResponse, statusResponse } from './helpers.mjs';

function json(body, status = 200) {
  return textResponse(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

test('verify：题名比对决定「同一篇 / 张冠李戴 / 无法判断」', () => {
  const same = classifyMatch('Graph-Based Structure Prediction for Protein Complexes',
    { title: 'Graph-based structure prediction for protein complexes' }, 'crossref');
  assert.equal(same.status, VERIFICATION.CROSSREF_OK);
  assert.equal(same.trusted, true);

  const other = classifyMatch('Magnetic localization for soft robots',
    { title: 'Deep learning for protein folding' }, 'crossref');
  assert.equal(other.status, VERIFICATION.FABRICATED);
  assert.match(other.reason, /指向另一篇/);

  const empty = classifyMatch('Magnetic localization for soft robots', { title: '' }, 'crossref');
  assert.equal(empty.status, VERIFICATION.UNINDEXED, '记录没有题名时不能判假');
});

test('verify：DOI 在 Crossref 有记录且题名一致 → crossref-ok', async () => {
  resetThrottle();
  const calls = stubFetch([{
    match: 'api.crossref.org/works',
    respond: () => json({ message: { DOI: '10.1109/TMECH.2026.1', title: ['Capacitive Sensing for Soft Grippers'] } }),
  }]);
  const out = await verifyPaper({ doi: '10.1109/TMECH.2026.1', title: 'Capacitive Sensing for Soft Grippers' });
  assert.equal(out.status, VERIFICATION.CROSSREF_OK);
  assert.equal(out.trusted, true);
  assert.equal(calls.length, 1);
});

test('verify：Crossref 无记录则退 DataCite', async () => {
  resetThrottle();
  stubFetch([
    { match: 'api.crossref.org/works', respond: () => statusResponse(404) },
    { match: 'api.datacite.org', respond: () => json({ data: { attributes: { titles: [{ title: 'A Dataset of Tactile Sensors' }] } } }) },
  ]);
  const out = await verifyPaper({ doi: '10.5281/zenodo.1', title: 'A Dataset of Tactile Sensors' });
  assert.equal(out.status, VERIFICATION.DATACITE_OK);
  assert.equal(out.source, 'datacite');
});

test('verify：DOI 指向另一篇 → fabricated', async () => {
  resetThrottle();
  stubFetch([
    { match: 'api.crossref.org/works', respond: () => json({ message: { DOI: '10.1/x', title: ['Completely Different Work on Mollusks'] } }) },
  ]);
  const out = await verifyPaper({ doi: '10.1/x', title: 'Arc-Shaped Magnetic Localization for Flexible Sensors' });
  assert.equal(out.status, VERIFICATION.FABRICATED);
  assert.equal(out.trusted, false);
});

test('verify：没有 DOI 时靠题名检索，最多 title-ok', async () => {
  resetThrottle();
  stubFetch([{
    match: 'api.openalex.org/works?search=',
    respond: () => json({ results: [{ title: 'Tactile Sensing with Barometric Arrays' }] }),
  }]);
  const out = await verifyPaper({ title: 'Tactile Sensing with Barometric Arrays' });
  assert.equal(out.status, VERIFICATION.TITLE_OK);
  assert.equal(out.trusted, false);
});

test('verify：核验结论如何约束等级', () => {
  assert.equal(coerceGradeForVerification('S', VERIFICATION.CROSSREF_OK).downgraded, false);
  const capped = coerceGradeForVerification('A', VERIFICATION.TITLE_OK);
  assert.equal(capped.grade, 'B');
  assert.equal(capped.downgraded, true);
  assert.equal(coerceGradeForVerification('B', VERIFICATION.TITLE_OK).grade, 'B', 'B 不再下调');
  const unverified = coerceGradeForVerification('A', VERIFICATION.UNINDEXED);
  assert.equal(unverified.grade, 'A', '「没查到」不降级');
  const dropped = coerceGradeForVerification('A', VERIFICATION.FABRICATED);
  assert.equal(dropped.verdict, 'drop');

  assert.equal(checkVerification('S', { status: VERIFICATION.TITLE_OK }).ok, false);
  assert.equal(checkVerification('B', { status: VERIFICATION.TITLE_OK }).ok, true);
  assert.equal(checkVerification('A', { status: VERIFICATION.UNINDEXED }).ok, true);
  assert.equal(checkVerification('A', { status: VERIFICATION.FABRICATED }).ok, false);
  assert.equal(checkVerification('A', null).ok, true, '没有核验信息时放行（老数据）');
});

test('verify：结果进缓存，重复核验不再发请求', async () => {
  resetThrottle();
  const base = await makeBase();
  let calls = 0;
  stubFetch([{
    match: 'api.crossref.org/works',
    respond: () => {
      calls += 1;
      return json({ message: { DOI: '10.9/cache', title: ['Cached Paper'] } });
    },
  }]);
  const paper = { doi: '10.9/cache', title: 'Cached Paper' };
  const first = await ensureVerification(base, paper);
  const second = await ensureVerification(base, paper);
  assert.equal(first.status, VERIFICATION.CROSSREF_OK);
  assert.equal(second.status, VERIFICATION.CROSSREF_OK);
  assert.equal(calls, 1, '第二次走缓存');
});
