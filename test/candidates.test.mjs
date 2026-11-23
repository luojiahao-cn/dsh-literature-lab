import test from 'node:test';
import assert from 'node:assert/strict';
import { absorbCandidates, readCandidates, promoteCandidate, queryCandidates, updateCandidates } from '../lib/candidates.js';
import { readConfig } from '../lib/config.js';
import { readState, emptyState, writeState } from '../lib/state.js';
import { makeBase } from './helpers.mjs';

test('候选：同一篇以 DOI/题名/arXiv 到达只保留一条', async () => {
  const base = await makeBase();
  await writeState(base, emptyState());
  const config = await readConfig(base);

  const title = 'Alias Paper for Dedup Regression';
  const first = await absorbCandidates(base, config, [
    { title, doi: '10.1234/alias.1', abstract: 'A' },
  ], { source: 'test-doi' });
  assert.equal(first.added + first.filtered, 1);

  const second = await absorbCandidates(base, config, [
    { title, arxivId: '2611.99999' },
  ], { source: 'test-arxiv' });
  assert.equal(second.merged, 1);

  const items = await readCandidates(base);
  assert.equal(Object.keys(items).length, 1);
  const only = Object.values(items)[0];
  assert.ok(only.sources.includes('test-doi'));
  assert.ok(only.sources.includes('test-arxiv'));
});

test('候选：promote 后论文保留 venue/year/authors，并按别名识别已知', async () => {
  const base = await makeBase();
  await writeState(base, emptyState());
  const config = await readConfig(base);
  const title = 'Promote Metadata Paper';
  await absorbCandidates(base, config, [
    { title, doi: '10.1234/meta.1', venue: 'IEEE Transactions on Robotics', year: 2026, authors: ['A', 'B'] },
  ], { source: 'test', passThrough: true });
  const items = await readCandidates(base);
  const id = Object.keys(items)[0];
  await promoteCandidate(base, id);
  const state = await readState(base);
  const paper = state.papers[id];
  assert.equal(paper.meta.venue, 'IEEE Transactions on Robotics');
  assert.equal(paper.meta.year, 2026);
  assert.deepEqual(paper.authors, ['A', 'B']);

  const again = await absorbCandidates(base, config, [
    { title, arxivId: '2611.88888' },
  ], { source: 'test-arxiv' });
  assert.equal(again.known, 1);
});


test('候选查询：since/until 按 added_at 过滤，counts 同窗', async () => {
  const base = await makeBase();
  await updateCandidates(base, (items) => {
    items['doi:time.new'] = { id: 'doi:time.new', title: 'New', status: 'new', added_at: '2026-11-22T01:00:00.000Z' };
    items['doi:time.old'] = { id: 'doi:time.old', title: 'Old', status: 'new', added_at: '2026-11-01T01:00:00.000Z' };
    items['doi:time.filtered'] = { id: 'doi:time.filtered', title: 'Filtered', status: 'filtered', added_at: '2026-11-22T02:00:00.000Z' };
    return items;
  });
  const recent = await queryCandidates(base, { status: 'all', since: '2026-11-16', until: '2026-11-22' });
  assert.equal(recent.total, 2);
  assert.equal(recent.counts.new, 1);
  assert.equal(recent.counts.filtered, 1);
  assert.equal(recent.window.since, '2026-11-16');
  const old = await queryCandidates(base, { status: 'all', since: '2026-11-01', until: '2026-11-01' });
  assert.equal(old.total, 1);
  assert.equal(old.items[0].id, 'doi:time.old');
});
