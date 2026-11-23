import test from 'node:test';
import assert from 'node:assert/strict';
import { tierOfEasyScholar, ensurePaperVenueTier, cachePath } from '../lib/easyscholar.js';
import { readState, writeState, updateState, emptyState } from '../lib/state.js';
import { makeBase } from './helpers.mjs';

test('easyscholar：中科院/新锐/JCR 解析', () => {
  const tier = tierOfEasyScholar('Test Journal', {
    officialRank: {
      all: {
        sciif: '4.3', sciif5: '4.3', jci: '0.79',
        sciUp: '医学3区', sciUpSmall: '工程：生物医学3区/机器人学3区。',
        xr: '医学2区', xrSmall: '工程：生物医学3区; 机器人学2区', esci: 'Q2', eii: 'EI',
      },
    },
  });
  assert.equal(tier.label, '新锐 医学2区');
  assert.equal(tier.ranks.cas, '医学3区');
  assert.equal(tier.ranks.xr, '医学2区');
  assert.equal(tier.ranks.jcr, 'Q2');
  assert.equal(tier.metrics.impactFactor, '4.3');
  assert.equal(tierOfEasyScholar('None', {}), null);
});


test('easyscholar：与 updateState 并发不丢论文更新（同一 data 锁）', async () => {
  const base = await makeBase();
  await writeState(base, emptyState());
  await updateState(base, (state) => {
    state.papers['p:1'] = { title: 'Before', stage: 'L2', meta: { venue: 'IEEE Transactions on Robotics' } };
    return null;
  });
  const cache = { schema: 1, items: { 'IEEE Transactions on Robotics': { name: 'IEEE Transactions on Robotics', tier: { label: 'CCF A' } } } };
  await import('node:fs/promises').then(({ writeFile }) => writeFile(cachePath(base), JSON.stringify(cache)));
  const paper = { id: 'p:1', meta: { venue: 'IEEE Transactions on Robotics' } };
  await Promise.all(Array.from({ length: 15 }, () => ensurePaperVenueTier(base, paper, null)));
  await Promise.all(Array.from({ length: 15 }, (_, i) => updateState(base, (state) => {
    state.papers['p:1'].title = `After${i}`;
    return null;
  })));
  const state = await readState(base);
  assert.ok(state.papers['p:1'].venue_tier, 'venue_tier 应写入');
  assert.match(state.papers['p:1'].title, /^After\d+$/, 'title 更新不应被覆盖');
});
