/**
 * 配置收敛：废弃键（integrations.translate / analysis.autoZotero）删除、
 * 老用户配置读时剔除、自动入库只保留 shouldAutoImport 单一门禁。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { readConfig, stripLegacy } from '../lib/config.js';
import { shouldAutoImport } from '../lib/zotero.js';
import { makeBase } from './helpers.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('默认配置：不再含 integrations.translate 与 analysis.autoZotero', async () => {
  const defaults = JSON.parse(await readFile(path.join(REPO, 'config', 'default.json'), 'utf8'));
  assert.equal('translate' in (defaults.integrations || {}), false, 'integrations.translate 已删除');
  assert.equal('autoZotero' in (defaults.analysis || {}), false, 'analysis.autoZotero 已删除');
  // 自动入库的唯一开关仍是 zotero.autoImport.enabled
  assert.equal(defaults.integrations.zotero.autoImport.enabled, false);
  assert.equal(typeof defaults.integrations.zotero.autoImport.minGrade, 'string');
});

test('老用户配置：两个废弃键读出来被剔除，且不改写配置文件', async () => {
  const legacy = {
    integrations: {
      translate: { enabled: true, server: 'http://127.0.0.1:2003' },
      zotero: { enabled: true, mode: 'local' },
    },
    analysis: { enabled: true, autoZotero: false },
  };
  const base = await makeBase(legacy);
  const config = await readConfig(base);

  assert.equal(config.integrations.translate, undefined, '读出的配置不含 translate');
  assert.equal(config.analysis.autoZotero, undefined, '读出的配置不含 autoZotero');
  // 其他键照常保留，老配置其余部分不受影响
  assert.equal(config.integrations.zotero.enabled, true);
  assert.equal(config.integrations.zotero.mode, 'local');
  assert.equal(config.analysis.enabled, true);

  // 只影响读出的值：图盘上的用户配置保持原样
  const onDisk = JSON.parse(await readFile(path.join(base, 'state', 'config.json'), 'utf8'));
  assert.deepEqual(onDisk, legacy);
});

test('stripLegacy：纯函数式剔除，无废弃键时原样返回', () => {
  const original = { integrations: { translate: { enabled: true } }, analysis: { autoZotero: true } };
  const stripped = stripLegacy(original);
  assert.deepEqual(stripped, { integrations: {}, analysis: {} });
  assert.deepEqual(original, {
    integrations: { translate: { enabled: true } },
    analysis: { autoZotero: true },
  }, '不修改传入对象');

  const clean = { integrations: { zotero: {} }, analysis: { enabled: true } };
  assert.equal(stripLegacy(clean), clean, '无废弃键时返回原对象');

  assert.equal(stripLegacy(null), null);
  assert.deepEqual(stripLegacy({}), {});
});

test('自动入库单一门禁：只由 shouldAutoImport 决定', async () => {
  const base = await makeBase({
    integrations: { zotero: { enabled: true, autoImport: { enabled: true, minGrade: 'B', requirePdf: false } } },
  });
  const config = await readConfig(base);
  // autoImport.enabled=true 且达到等级阈值 → 入库；低于阈值 → 不入库
  assert.equal(shouldAutoImport(config, { grade: 'A' }), true);
  assert.equal(shouldAutoImport(config, { grade: 'B' }), true);
  assert.equal(shouldAutoImport(config, { grade: 'C' }), false);
  assert.equal(shouldAutoImport(config, { grade: 'A', zotero_key: 'X' }), false);

  // autoImport.enabled=false 时不入库——即使老配置里残留 analysis.autoZotero=true
  const offBase = await makeBase({
    integrations: { zotero: { enabled: true, autoImport: { enabled: false, minGrade: 'B' } } },
    analysis: { autoZotero: true },
  });
  const offConfig = await readConfig(offBase);
  assert.equal(offConfig.analysis.autoZotero, undefined);
  assert.equal(shouldAutoImport(offConfig, { grade: 'S' }), false);

  // Zotero 总开关关闭时也不入库
  const disabledBase = await makeBase({
    integrations: { zotero: { enabled: false, autoImport: { enabled: true, minGrade: 'B' } } },
  });
  const disabledConfig = await readConfig(disabledBase);
  assert.equal(shouldAutoImport(disabledConfig, { grade: 'A' }), false);
});

test('analysis-run.js 不再引用 analysis.autoZotero', async () => {
  const source = await readFile(path.join(REPO, 'lib', 'analysis-run.js'), 'utf8');
  assert.equal(source.includes('autoZotero'), false, 'L3 自动入库外层门禁已移除');
});

test('总开关：关闭 AI 判读后，手动运行也被拒绝', async () => {
  const { handleAnalyze } = await import('../index.js');
  const base = await makeBase({ analysis: { enabled: false } });
  const request = new Request('http://127.0.0.1/api/dsh-literature-lab/analyze', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ stage: 'L1' }),
  });
  const res = await handleAnalyze(request, base);
  assert.equal(res.status, 409);
  const data = await res.json();
  assert.equal(data.ok, false);
  assert.match(data.error, /AI 判读已关闭/);
});

test('总开关：非 POST 仍返回 405，且不受开关影响', async () => {
  const { handleAnalyze } = await import('../index.js');
  const base = await makeBase({ analysis: { enabled: false } });
  const res = await handleAnalyze(new Request('http://127.0.0.1/api/dsh-literature-lab/analyze'), base);
  assert.equal(res.status, 405);
});

test('配置写入白名单：digest 与 views 能落盘（防静默丢弃）', async () => {
  const { handleConfig } = await import('../index.js');
  const base = await makeBase();
  const res = await handleConfig(new Request('http://127.0.0.1/api/dsh-literature-lab/config', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      digest: { maxPerGroup: 3, includeB: true },
      views: [{ id: 'v1', name: '今天要处理', status: 'new' }],
    }),
  }), {}, base);
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.config.digest.maxPerGroup, 3);
  assert.equal(data.config.digest.includeB, true);
  assert.equal(data.config.views.length, 1);
  const back = await readConfig(base);
  assert.equal(back.digest.maxPerGroup, 3);
  assert.equal(back.views[0].name, '今天要处理');
});
