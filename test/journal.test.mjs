import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readdir } from 'node:fs/promises';
import { withJournal, listOpenJournals } from '../lib/journal.js';
import { healRuntime } from '../lib/heal.js';
import { readState, emptyState, writeState } from '../lib/state.js';
import { updateCandidates, readCandidates } from '../lib/candidates.js';
import * as store from '../lib/store.js';
import { makeBase } from './helpers.mjs';

test('journal：成功删除，失败保留 intent', async () => {
  const base = await makeBase();
  await withJournal(base, 'promote', { candidateId: 'x' }, async () => 'ok');
  assert.deepEqual(await listOpenJournals(base), []);
  await assert.rejects(() => withJournal(base, 'promote', { candidateId: 'y' }, async () => {
    throw new Error('boom');
  }), /boom/);
  const open = await listOpenJournals(base);
  assert.equal(open.length, 1);
  assert.equal(open[0].meta.candidateId, 'y');
});

test('journal：启动重放未完成 promote', async () => {
  const base = await makeBase();
  await writeState(base, emptyState());
  await updateCandidates(base, (items) => {
    items['doi:journal.1'] = {
      id: 'doi:journal.1', title: 'Journal Paper', doi: '10.1234/journal.1',
      status: 'promoted', t0: { score: 5 }, authors: ['A'], sources: ['test'],
    };
    return items;
  });
  const dir = path.join(store.statePaths(base).dir, 'journal');
  await import('node:fs/promises').then(async ({ mkdir, writeFile }) => {
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, 'tx_old.json'), JSON.stringify({
      id: 'tx_old', operation: 'promote', meta: { candidateId: 'doi:journal.1' }, status: 'open',
    }));
  });
  await healRuntime(base);
  const state = await readState(base);
  assert.ok(state.papers['doi:journal.1']);
  assert.deepEqual(await readdir(dir), []);
  assert.equal((await readCandidates(base))['doi:journal.1'].status, 'promoted');
});
