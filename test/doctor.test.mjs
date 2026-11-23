import test from 'node:test';
import assert from 'node:assert/strict';
import { dataDoctor } from '../lib/doctor.js';
import { emptyState, writeState } from '../lib/state.js';
import { updateCandidates } from '../lib/candidates.js';
import { makeBase } from './helpers.mjs';

test('data-doctor：报告 promoted 缺论文和缺失 PDF', async () => {
  const base = await makeBase();
  const state = emptyState();
  state.papers['doi:doctor.missing'] = {
    title: 'Doctor Missing', doi: '10.1234/doctor.missing', stage: 'L2',
    pdf: 'pdfs/not-there.pdf', candidate_id: 'doi:doctor.missing', grade_history: [], sources: [],
  };
  await writeState(base, state);
  await updateCandidates(base, (items) => {
    items['doi:doctor.orphan'] = { id: 'doi:doctor.orphan', title: 'Orphan', status: 'promoted' };
    return items;
  });
  const report = await dataDoctor(base);
  const codes = report.issues.map((item) => item.code);
  assert.ok(codes.includes('pdf-missing'));
  assert.ok(codes.includes('promoted-without-paper'));
  assert.equal(report.ok, false);
});
