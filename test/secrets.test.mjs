/**
 * 凭据与工具面：走 DSH credentials、旧 key 迁移、工具收敛。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { writeFile } from 'node:fs/promises';

import {
  ZOTERO_API_KEY_REF, hasZoteroKey, getZoteroKey, setZoteroKey, migrateZoteroKey,
  readConfigWithSecrets,
} from '../lib/secrets.js';
import { readConfig } from '../lib/config.js';
import { makeBase } from './helpers.mjs';

function fakeCredentials() {
  const map = new Map();
  return {
    map,
    async set(ref, value) { map.set(ref, value); },
    async unset(ref) { map.delete(ref); },
    async describe(ref) { return { configured: map.has(ref), writable: true }; },
    async resolve(ref) { return map.has(ref) ? { value: map.get(ref), source: 'test' } : undefined; },
  };
}

function ctxWith(credentials) {
  return { get: (name) => (name === 'credentials' ? credentials : undefined) };
}

test('凭据：set / has / get / unset', async () => {
  const credentials = fakeCredentials();
  const ctx = ctxWith(credentials);
  assert.equal(await hasZoteroKey(ctx), false);
  assert.equal(await getZoteroKey(ctx), '');

  await setZoteroKey(ctx, 'abc123');
  assert.equal(await hasZoteroKey(ctx), true);
  assert.equal(await getZoteroKey(ctx), 'abc123');

  await setZoteroKey(ctx, '');
  assert.equal(await hasZoteroKey(ctx), false);
});

test('凭据：旧 config 里的 apiKey 迁移到 credentials 并清除', async () => {
  const base = await makeBase();
  await writeFile(path.join(base, 'state', 'config.json'), JSON.stringify({
    integrations: { zotero: { mode: 'web', userId: '1234', apiKey: 'legacy-key' } },
  }));

  const credentials = fakeCredentials();
  const ctx = ctxWith(credentials);
  const migrated = await migrateZoteroKey(ctx, base);
  assert.equal(migrated, true);
  assert.equal(credentials.map.get(ZOTERO_API_KEY_REF), 'legacy-key');

  const config = await readConfig(base);
  assert.equal(config.integrations.zotero.apiKey, undefined, 'config 不再含 key');
  assert.equal(config.integrations.zotero.userId, '1234');

  const withSecrets = await readConfigWithSecrets(ctx, base);
  assert.equal(withSecrets.integrations.zotero.apiKey, 'legacy-key');

  // 再跑一次不应重复迁移
  assert.equal(await migrateZoteroKey(ctx, base), false);
});

test('工具面：10 个工具、Zotero 导入已并入 action', async () => {
  const plugin = await import('../index.js');
  const tools = new Map();
  const routes = [];
  const ctx = {
    get: () => undefined,
    inject(services, cb) {
      cb({ connection: { fetch: { register: (route) => routes.push(route.path) } } });
    },
    tools: { register: (tool) => { tools.set(tool.name, tool); } },
    effect: () => {},
  };
  plugin.apply(ctx);
  assert.equal(tools.size, 10, [...tools.keys()].join(', '));
  assert.ok(tools.has('literature-lab_zotero'));
  assert.ok(!tools.has('literature-lab_zotero_import'));
  const zotero = tools.get('literature-lab_zotero');
  assert.ok(zotero.parameters.properties.action.enum.includes('import'));
  assert.ok(routes.some((p) => p.endsWith('/credentials')));
  assert.ok(routes.some((p) => p.endsWith('/paper')));
});
