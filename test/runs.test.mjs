import test from 'node:test';
import assert from 'node:assert/strict';
import { appendRun, newRunId } from '../lib/runs.js';
import { readState, emptyState, writeState } from '../lib/state.js';
import { makeBase } from './helpers.mjs';

test('runs：appendRun 写入 id 并保留最近 30 条', async () => {
  const base = await makeBase();
  await writeState(base, emptyState());
  const id = newRunId('analysis-L1');
  await appendRun(base, { id, kind: 'analysis', stage: 'L1', processed: 2 });
  let state = await readState(base);
  assert.equal(state.analysis_runs[0].id, id);
  assert.equal(state.analysis_runs[0].kind, 'analysis');
  for (let i = 0; i < 35; i += 1) await appendRun(base, { id: `r${i}`, kind: 'L0' });
  state = await readState(base);
  assert.equal(state.runs.length, 30);
});
