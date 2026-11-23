/** 优先读：标记、取消、校验。 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { handlePriority } from '../index.js';
import { makeBase } from './helpers.mjs';

async function baseWithPaper() {
  const base = await makeBase();
  await writeFile(path.join(base, 'state', 'papers.json'), JSON.stringify({
    schema: 2,
    papers: {
      p1: { title: '优先读测试', stage: 'L3', grade: 'A', first_seen: '2026-11-21', sources: ['arxiv'] },
    },
    runs: [],
    sources: {},
  }, null, 2));
  return base;
}

function post(base, body) {
  return handlePriority(new Request('http://127.0.0.1/api/dsh-literature-lab/priority', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }), base);
}

test('优先读：标记后 paperView 能看到 priority', async () => {
  const base = await baseWithPaper();
  const res = await post(base, { id: 'p1', value: 'next' });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.paper.priority, 'next');
  const saved = JSON.parse(await readFile(path.join(base, 'state', 'papers.json'), 'utf8'));
  assert.equal(saved.papers.p1.priority, 'next');
});

test('优先读：value=null 取消标记', async () => {
  const base = await baseWithPaper();
  await post(base, { id: 'p1', value: 'next' });
  const res = await post(base, { id: 'p1', value: null });
  const data = await res.json();
  assert.equal(data.paper.priority, null);
});

test('优先读：非法值与非 POST 被拒绝', async () => {
  const base = await baseWithPaper();
  assert.equal((await post(base, { id: 'p1', value: 'high' })).status, 400);
  assert.equal((await post(base, {})).status, 400);
  const get = await handlePriority(new Request('http://127.0.0.1/api/dsh-literature-lab/priority'), base);
  assert.equal(get.status, 405);
});

test('优先读：不存在的论文报错', async () => {
  const base = await baseWithPaper();
  const res = await post(base, { id: 'nope', value: 'next' });
  assert.equal(res.status, 500);
  assert.match((await res.json()).error, /不存在/);
});
