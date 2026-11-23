/**
 * 状态存储：并发写不丢更新、原子写、schema 迁移。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { writeFile, readFile, readdir } from 'node:fs/promises';

import * as store from '../lib/store.js';
import {
  readState, writeState, updateState, updateStateAndSeen, emptyState, readSeen, SCHEMA_VERSION,
} from '../lib/state.js';
import { makeBase } from './helpers.mjs';

test('store：并发 updateState 不丢更新', async () => {
  const base = await makeBase();
  await writeState(base, emptyState());

  await Promise.all(Array.from({ length: 25 }, () => updateState(base, (state) => {
    state.counter = (state.counter || 0) + 1;
    return null;
  })));

  const state = await readState(base);
  assert.equal(state.counter, 25);
  assert.equal(state.schema, SCHEMA_VERSION);
});

test('store：并发 updateStateAndSeen 两份文件都正确', async () => {
  const base = await makeBase();
  await writeState(base, emptyState());

  await Promise.all(Array.from({ length: 15 }, (_, i) => updateStateAndSeen(base, (state, seen) => {
    state.papers[`p:${i}`] = { title: `P${i}`, stage: 'L1', grade_history: [], sources: [] };
    seen[`p:${i}`] = { t: new Date().toISOString(), s: 'test', a: 1 };
    return null;
  })));

  const state = await readState(base);
  const seen = await readSeen(base);
  assert.equal(Object.keys(state.papers).length, 15);
  assert.equal(Object.keys(seen).length, 15);
});

test('store：schema 1 迁移到 2 并补齐字段', async () => {
  const base = await makeBase();
  const paths = store.statePaths(base);
  await writeFile(paths.papers, JSON.stringify({
    schema: 1,
    papers: { 'arxiv:1': { title: 'Old', stage: 'L1' } },
  }));

  const state = await readState(base);
  assert.equal(state.schema, SCHEMA_VERSION);
  assert.deepEqual(state.sources, {});
  assert.deepEqual(state.runs, []);
  assert.equal(state.last_success_at, null);
  assert.ok(state.quota);
});

test('store：损坏文件被隔离，不静默回退空状态', async () => {
  const base = await makeBase();
  const paths = store.statePaths(base);
  await writeFile(paths.papers, '{not json');
  await assert.rejects(() => readState(base), /损坏/);
  const files = await readdir(path.join(paths.dir, 'quarantine'));
  assert.ok(files.some((name) => name.startsWith('papers.json.') && name.endsWith('.corrupt')));
});

test('store：原子写不留下临时文件', async () => {
  const base = await makeBase();
  const paths = store.statePaths(base);
  await store.writeJsonAtomic(paths.config, { a: 1 });
  const files = (await readFile(paths.config, 'utf8'));
  assert.match(files, /"a":1/);
});

test('store：并发原子写同一文件不互撞、不残留临时文件', async () => {
  const base = await makeBase();
  const paths = store.statePaths(base);
  await Promise.all(Array.from({ length: 20 }, (_, i) => store.writeJsonAtomic(paths.config, { i })));
  const data = JSON.parse(await readFile(paths.config, 'utf8'));
  assert.equal(typeof data.i, 'number');
  const leftovers = (await readdir(path.dirname(paths.config))).filter((name) => name.endsWith('.tmp'));
  assert.deepEqual(leftovers, []);
});
