import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

import { resetDerived } from '../lib/reset.js';
import { readState, writeState, emptyState, readSeen } from '../lib/state.js';
import { absorbCandidates, readCandidates } from '../lib/candidates.js';
import { makeBase } from './helpers.mjs';

test('resetDerived：一次清候选/runs/seen/来源健康，保留论文并备份', async () => {
  const base = await makeBase();
  await absorbCandidates(base, { relevance: {} }, [
    { title: 'Reset A', doi: '10.1234/reset.a' },
    { title: 'Reset B', doi: '10.1234/reset.b' },
  ], { source: 'test' });

  const state = emptyState();
  state.papers['doi:10.1234/reset.a'] = {
    title: 'Reset A', stage: 'L2', grade_history: [], sources: ['test'],
  };
  state.runs = [{ at: new Date().toISOString(), scanned: 10, added: 2 }];
  state.sources = { arxiv: { last_ok_at: new Date().toISOString(), last_count: 2 } };
  state.last_success_at = new Date().toISOString();
  await writeState(base, state);

  const result = await resetDerived(base);
  assert.equal(result.ok, true);
  assert.equal(result.before.candidates, 2);
  assert.equal(result.before.runs, 1);
  assert.ok(result.before.seen >= 2);
  assert.equal(result.before.papers, 1);

  const after = await readState(base);
  assert.deepEqual(after.runs, []);
  assert.deepEqual(after.sources, {});
  assert.equal(after.last_success_at, null);
  assert.deepEqual(Object.keys(after.papers), ['doi:10.1234/reset.a'], '论文保留');
  assert.equal(Object.keys(await readCandidates(base)).length, 0, '候选清空');
  assert.equal(Object.keys(await readSeen(base)).length, 0, 'seen 清空');

  assert.ok(result.backupDir, '默认备份');
  const files = await readdir(result.backupDir);
  assert.deepEqual(files.sort(), ['candidates.json', 'papers.json', 'seen.json']);
  const backedUp = JSON.parse(await readFile(path.join(result.backupDir, 'papers.json'), 'utf8'));
  assert.equal(backedUp.runs.length, 1, '备份里保留清理前的 runs');
});

test('resetDerived：keepSourceHealth 可保留来源健康', async () => {
  const base = await makeBase();
  const state = emptyState();
  state.sources = { arxiv: { last_ok_at: new Date().toISOString() } };
  await writeState(base, state);

  const result = await resetDerived(base, { backup: false, keepSourceHealth: true });
  assert.equal(result.backupDir, null);
  const after = await readState(base);
  assert.deepEqual(Object.keys(after.sources), ['arxiv']);
});


test('resetDerived：默认清 email 处理账与 schedule 运行摘要，保留开关/时间', async () => {
  const base = await makeBase();
  await writeState(base, emptyState());
  const paths = (await import('../lib/store.js')).statePaths(base);
  await import('node:fs/promises').then(({ writeFile }) => Promise.all([
    writeFile(paths.email, JSON.stringify({ processed: { 1: 'x' }, failed: { 2: { attempts: 1 } }, last_result: { added: 9 } })),
    writeFile(paths.schedule, JSON.stringify({ enabled: true, time: '07:00', last_run_at: '2026-11-22T00:00:00.000Z', last_result: { added: 9 }, last_error: 'x' })),
  ]));
  const result = await resetDerived(base);
  const email = JSON.parse(await readFile(paths.email, 'utf8'));
  const schedule = JSON.parse(await readFile(paths.schedule, 'utf8'));
  assert.deepEqual(email.processed, {});
  assert.deepEqual(email.failed, {});
  assert.equal(schedule.enabled, true);
  assert.equal(schedule.time, '07:00');
  assert.equal(schedule.last_run_at, null);
  assert.equal(schedule.last_result, null);
  assert.equal(schedule.last_error, null);
  assert.ok(result.backupDir);
  const files = await readdir(result.backupDir);
  assert.ok(files.includes('email.json'));
  assert.ok(files.includes('schedule.json'));
});
