import test from 'node:test';
import assert from 'node:assert/strict';
import { stat } from 'node:fs/promises';
import path from 'node:path';

import { handleUpload } from '../index.js';
import { readState } from '../lib/state.js';
import { makeBase } from './helpers.mjs';

test('upload HTTP handler：multipart 文件 + 标题进入 L2', async () => {
  const base = await makeBase();
  const form = new FormData();
  form.append('file', new File([Buffer.from('%PDF-1.4\n%%EOF\n')], 'local.pdf', { type: 'application/pdf' }));
  form.append('title', 'HTTP Uploaded Paper');
  form.append('doi', '10.1234/http.1');
  const req = new Request('http://127.0.0.1/api/dsh-literature-lab/upload', { method: 'POST', body: form });
  const res = await handleUpload(req, base);
  const data = await res.json();
  assert.equal(data.ok, true);
  assert.equal(data.paper.id, 'doi:10.1234/http.1');
  const state = await readState(base);
  assert.equal(state.papers['doi:10.1234/http.1'].stage, 'L2');
  assert.ok(state.papers['doi:10.1234/http.1'].pdf);
  await stat(path.join(base, state.papers['doi:10.1234/http.1'].pdf));
});
