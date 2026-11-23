import test from 'node:test';
import assert from 'node:assert/strict';

import { migrateLegacyTriage } from '../lib/migrate.js';
import { readCandidates, updateCandidates } from '../lib/candidates.js';
import { makeBase } from './helpers.mjs';

test('migrate：triaged 旧候选迁移为 parked/dropped', async () => {
  const base = await makeBase();
  await updateCandidates(base, (items) => {
    items['doi:old.keep'] = { id: 'doi:old.keep', title: 'Keep', status: 'triaged', t1: { verdict: 'keep' } };
    items['doi:old.maybe'] = { id: 'doi:old.maybe', title: 'Maybe', status: 'triaged', t1: { verdict: 'maybe' } };
    items['doi:old.drop'] = { id: 'doi:old.drop', title: 'Drop', status: 'triaged', t1: { verdict: 'drop' } };
    return items;
  });
  const result = await migrateLegacyTriage(base);
  assert.equal(result.changed, 3);
  const items = await readCandidates(base);
  assert.equal(items['doi:old.keep'].status, 'parked');
  assert.equal(items['doi:old.maybe'].status, 'parked');
  assert.equal(items['doi:old.drop'].status, 'dropped');
  assert.equal(items['doi:old.keep'].legacy_triage.verdict, 'keep');
  assert.equal(items['doi:old.keep'].t1, undefined);
});
