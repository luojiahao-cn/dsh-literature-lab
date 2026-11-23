import test from 'node:test';
import assert from 'node:assert/strict';
import { handlePaperOverride } from '../index.js';
import { emptyState, writeState, readState } from '../lib/state.js';
import { makeBase } from './helpers.mjs';

test('override：等级与同域性校验，重跑清除人工标记', async () => {
  const base = await makeBase();
  const state = emptyState();
  state.papers['doi:10.1234/override.1'] = {
    title: 'Override', doi: '10.1234/override.1', stage: 'L1', grade: 'D',
    l1: { domain: 'irrelevant', increment: '与图推理无关', use: 'citation' },
    grade_history: [], sources: [],
  };
  await writeState(base, state);

  let req = new Request('http://localhost/paper/override', {
    method: 'POST', body: JSON.stringify({ id: 'doi:10.1234/override.1', grade: 'S', stage: 'L1', reason: 'test' }),
  });
  let res = await handlePaperOverride(req, base);
  assert.equal(res.status, 400);

  req = new Request('http://localhost/paper/override', {
    method: 'POST', body: JSON.stringify({ id: 'doi:10.1234/override.1', reset: true }),
  });
  res = await handlePaperOverride(req, base);
  assert.equal(res.status, 200);
  const paper = (await readState(base)).papers['doi:10.1234/override.1'];
  assert.equal(paper.manual_override, false);
});
