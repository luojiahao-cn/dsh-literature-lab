import test from 'node:test';
import assert from 'node:assert/strict';

import { healRuntime } from '../lib/heal.js';
import { updateCandidates, readCandidates } from '../lib/candidates.js';
import * as store from '../lib/store.js';
import { makeBase } from './helpers.mjs';
import { emptyState, writeState, readState } from '../lib/state.js';

test('heal：analyzing 回 new，running job 标 cancelled', async () => {
  const base = await makeBase();
  await updateCandidates(base, (items) => {
    items['doi:heal.1'] = { id: 'doi:heal.1', title: 'Heal', status: 'analyzing' };
    items['doi:heal.2'] = { id: 'doi:heal.2', title: 'Keep', status: 'new' };
    return items;
  });
  await store.updateJson('jobs', store.statePaths(base).jobs, { jobs: {} }, (db) => {
    db.jobs.job_old = { id: 'job_old', status: 'running', started_at: new Date().toISOString() };
    return db;
  });

  const result = await healRuntime(base);
  assert.equal(result.candidates, 1);
  assert.equal(result.jobs, 1);
  const items = await readCandidates(base);
  assert.equal(items['doi:heal.1'].status, 'new');
  assert.equal(items['doi:heal.2'].status, 'new');
  const jobs = await store.readJson(store.statePaths(base).jobs, { jobs: {} });
  assert.equal(jobs.jobs.job_old.status, 'cancelled');
});


test('heal：不再把 L0/L1 论文静默改成 L2', async () => {
  const base = await makeBase();
  const state = emptyState();
  state.papers['doi:heal.stage'] = { title: 'Stage', stage: 'L1', grade_history: [], sources: [] };
  await writeState(base, state);
  await healRuntime(base);
  const after = await readState(base);
  assert.equal(after.papers['doi:heal.stage'].stage, 'L1');
});


test('heal：论文已写、候选仍 new 时补成 promoted', async () => {
  const base = await makeBase();
  const state = emptyState();
  state.papers['doi:heal.recover'] = {
    title: 'Recovered', doi: '10.1234/heal.recover', stage: 'L2',
    candidate_id: 'doi:heal.recover', grade_history: [], sources: [],
  };
  await writeState(base, state);
  await updateCandidates(base, (items) => {
    items['doi:heal.recover'] = { id: 'doi:heal.recover', title: 'Recovered', status: 'new' };
    return items;
  });
  await healRuntime(base);
  const candidate = (await readCandidates(base))['doi:heal.recover'];
  assert.equal(candidate.status, 'promoted');
});

test('heal：候选 admitted 但论文缺失时补建论文', async () => {
  const base = await makeBase();
  await writeState(base, emptyState());
  await updateCandidates(base, (items) => {
    items['doi:heal.missing'] = {
      id: 'doi:heal.missing', title: 'Missing Paper', doi: '10.1234/heal.missing',
      status: 'admitted', t0: { score: 9 }, authors: ['A'], venue: 'Test Venue', year: 2026,
      abstract: 'abstract', sources: ['test'],
    };
    return items;
  });
  const result = await healRuntime(base);
  assert.ok(result.papers >= 1);
  const state = await readState(base);
  assert.equal(state.papers['doi:heal.missing'].meta.venue, 'Test Venue');
});


test('heal：摘要复述式 why_read 修成读者用途式', async () => {
  const base = await makeBase();
  const state = emptyState();
  state.papers['doi:heal.why'] = {
    title: 'Why', stage: 'done', grade: 'A', grade_history: [], sources: [],
    l1: { domain: 'core', use: 'method', increment: '把随机划分换成结构化留出' },
    l3: { why_read: '随机划分下 magNET 达<1.5 mm、<1°，相对 ResMLP 提升约 10%。', summary: '随机划分下 magNET 达<1.5 mm、<1°，相对 ResMLP 提升约 10%。' },
  };
  await writeState(base, state);
  const result = await healRuntime(base);
  assert.equal(result.whyRead, 1);
  const paper = (await readState(base)).papers['doi:heal.why'];
  assert.match(paper.l3.why_read, /^如果你在做相近方向/);
  assert.equal(paper.l3.why_read_source, 'fallback');
});
