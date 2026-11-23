/**
 * 原文只读路由：浏览器不能开 file://，由 Host 回源。
 * 重点验证「只服务 pdfs/ 目录」这条边界。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

import { handlePdf, handleUpload } from '../index.js';
import { readState, writeState, emptyState } from '../lib/state.js';
import { makeBase } from './helpers.mjs';

const PDF_BYTES = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF\n');

async function uploadOne(base) {
  const form = new FormData();
  form.append('file', new File([PDF_BYTES], 'paper.pdf', { type: 'application/pdf' }));
  form.append('title', 'PDF Route Paper');
  form.append('doi', '10.5555/pdf.1');
  const req = new Request('http://127.0.0.1/api/dsh-literature-lab/upload', { method: 'POST', body: form });
  const res = await handleUpload(req, base);
  const data = await res.json();
  assert.equal(data.ok, true);
  return data.paper.id;
}

test('原文路由：返回 application/pdf 并保持字节一致', async () => {
  const base = await makeBase();
  const id = await uploadOne(base);
  const res = await handlePdf(new Request(`http://127.0.0.1/api/dsh-literature-lab/pdf?id=${encodeURIComponent(id)}`), base);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'application/pdf');
  assert.equal(res.headers.get('content-disposition'), 'inline');
  const buf = Buffer.from(await res.arrayBuffer());
  assert.deepEqual(buf, PDF_BYTES);
});

test('原文路由：未知 id 返回 404', async () => {
  const base = await makeBase();
  const res = await handlePdf(new Request('http://127.0.0.1/api/dsh-literature-lab/pdf?id=nope'), base);
  assert.equal(res.status, 404);
  assert.equal((await res.json()).error, '这篇还没有原文');
});

test('原文路由：缺 id 返回 400，非 GET 返回 405', async () => {
  const base = await makeBase();
  const missing = await handlePdf(new Request('http://127.0.0.1/api/dsh-literature-lab/pdf'), base);
  assert.equal(missing.status, 400);
  const post = await handlePdf(new Request('http://127.0.0.1/api/dsh-literature-lab/pdf?id=x', { method: 'POST' }), base);
  assert.equal(post.status, 405);
});

test('原文路由：拒绝 pdfs/ 之外的路径', async () => {
  const base = await makeBase();
  await mkdir(path.join(base, 'state'), { recursive: true });
  await writeFile(path.join(base, 'secret.pdf'), PDF_BYTES);
  const state = emptyState();
  state.papers['doi:10.5555/escape'] = {
    title: 'Escape', stage: 'L2', grade: 'B', pdf: '../secret.pdf',
  };
  await writeState(base, state);
  const res = await handlePdf(new Request('http://127.0.0.1/api/dsh-literature-lab/pdf?id=doi:10.5555/escape'), base);
  assert.equal(res.status, 403);
  assert.equal((await res.json()).error, '路径越界');
});

test('原文路由：pdf 字段指向不存在文件返回 404', async () => {
  const base = await makeBase();
  const state = emptyState();
  state.papers['doi:10.5555/gone'] = { title: 'Gone', stage: 'L2', pdf: 'pdfs/missing.pdf' };
  await writeState(base, state);
  const res = await handlePdf(new Request('http://127.0.0.1/api/dsh-literature-lab/pdf?id=doi:10.5555/gone'), base);
  assert.equal(res.status, 404);
  assert.equal((await res.json()).error, '原文文件不存在');
});
