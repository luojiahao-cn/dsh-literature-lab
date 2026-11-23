/** 摘要补齐：只有更长的一手摘要才覆盖快讯片段。 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { fullerAbstract } from '../lib/abstracts.js';
import { enrichSummaries } from '../lib/email.js';

test('abstracts：一手摘要更长才替换', () => {
  assert.equal(fullerAbstract('short snippet', { abstract: 'a much longer abstract text' }), 'a much longer abstract text');
  assert.equal(fullerAbstract('already long enough', { abstract: 'tiny' }), null);
  assert.equal(fullerAbstract('snippet', { abstract: '' }), null);
  assert.equal(fullerAbstract(null, null), null);
});

test('abstracts：补不到时保留片段并标注来源', async () => {
  const lookupFn = async ({ arxivId }) => (arxivId === '2610.26605'
    ? { matched: true, abstract: 'A complete abstract that is definitely longer than the snippet.' }
    : { matched: false });
  const rows = await enrichSummaries([
    { title: 'A', arxivId: '2610.26605', summary: 'snippet' },
    { title: 'B', doi: '10.1234/none', summary: 'snippet' },
    { title: 'C', summary: '' },
  ], lookupFn);
  assert.equal(rows[0].summary.startsWith('A complete abstract'), true);
  assert.equal(rows[0].abstractSource, 'canonical');
  assert.equal(rows[1].abstractSource, 'snippet');
  assert.equal(rows[2].abstractSource, undefined);
});
