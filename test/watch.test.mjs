import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile, utimes } from 'node:fs/promises';
import path from 'node:path';

import { scanWatchFolder } from '../lib/watch.js';
import { readState, writeState, emptyState } from '../lib/state.js';
import { makeBase } from './helpers.mjs';

test('watch：同名 JSON 侧车匹配 DOI 并导入 PDF', async () => {
  const base = await makeBase();
  const state = emptyState();
  state.papers['doi:10.1234/watch.1'] = {
    title: 'Watch Paper', doi: '10.1234/watch.1', stage: 'L2', grade: null, sources: [],
  };
  await writeState(base, state);
  const dir = path.join(base, 'inbox');
  await mkdir(dir, { recursive: true });
  const sidecar = path.join(dir, 'dsh-test.json');
  const pdf = path.join(dir, 'dsh-test.pdf');
  await writeFile(sidecar, JSON.stringify({ doi: '10.1234/watch.1', title: 'Watch Paper' }));
  await writeFile(pdf, '%PDF-1.4\n%%EOF\n');
  const old = new Date(Date.now() - 60_000);
  await utimes(sidecar, old, old);
  const stats = await scanWatchFolder(base, { download: { watchImport: true, watchDir: dir } });
  assert.equal(stats.imported, 1);
  const saved = await readState(base);
  assert.ok(saved.papers['doi:10.1234/watch.1'].pdf);
  assert.equal(saved.papers['doi:10.1234/watch.1'].pdf_source, 'extension');
});
