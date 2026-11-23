import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { ensureStateSchemas, STATE_SCHEMAS } from '../lib/schema.js';
import { emptyState, writeState } from '../lib/state.js';
import { updateCandidates } from '../lib/candidates.js';
import * as store from '../lib/store.js';
import { makeBase } from './helpers.mjs';

test('schema：建立台账并备份，重复执行幂等', async () => {
  const base = await makeBase();
  await writeState(base, emptyState());
  await updateCandidates(base, (items) => {
    items['doi:schema.1'] = { id: 'doi:schema.1', title: 'Schema', status: 'new' };
    return items;
  });
  const first = await ensureStateSchemas(base);
  assert.equal(first.changed, true);
  assert.ok(first.backupDir);
  const manifest = JSON.parse(await readFile(path.join(store.statePaths(base).dir, 'schema.json'), 'utf8'));
  for (const [name, version] of Object.entries(STATE_SCHEMAS)) {
    if (manifest.files[name] !== undefined) assert.equal(manifest.files[name], version);
  }
  const files = await readdir(first.backupDir);
  assert.ok(files.includes('papers.json'));
  assert.ok(files.includes('candidates.json'));
  const second = await ensureStateSchemas(base);
  assert.equal(second.changed, false);
});
