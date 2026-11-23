import test from 'node:test';
import assert from 'node:assert/strict';
import { acquireClaim, releaseClaim, readClaims } from '../lib/claims.js';
import { makeBase } from './helpers.mjs';

test('claims：同一 key 只能被一个 runner 持有，释放后可重取', async () => {
  const base = await makeBase();
  const a = await acquireClaim(base, 'L1:doi:1', { owner: 'a' });
  assert.equal(a.ok, true);
  const b = await acquireClaim(base, 'L1:doi:1', { owner: 'b' });
  assert.equal(b.ok, false);
  assert.equal((await readClaims(base))['L1:doi:1'].owner, 'a');
  await releaseClaim(base, 'L1:doi:1', 'a');
  const c = await acquireClaim(base, 'L1:doi:1', { owner: 'c' });
  assert.equal(c.ok, true);
});

test('claims：过期后可回收', async () => {
  const base = await makeBase();
  await acquireClaim(base, 'L1:doi:2', { owner: 'a', ttlMs: 1 });
  await new Promise((resolve) => setTimeout(resolve, 5));
  const again = await acquireClaim(base, 'L1:doi:2', { owner: 'b' });
  assert.equal(again.ok, true);
});
