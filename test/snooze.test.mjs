/** 稍后：设置、清除、校验，以及 paperView 里能看到 snooze。 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { handleSnooze } from '../index.js';
import { makeBase } from './helpers.mjs';

async function baseWithPaper() {
  const base = await makeBase();
  await writeFile(path.join(base, 'state', 'papers.json'), JSON.stringify({
    schema: 2,
    papers: {
      p1: {
        title: '稍后测试论文', stage: 'L2', grade: 'A', first_seen: '2026-11-21',
        sources: ['arxiv'], l1: { domain: 'core', increment: '增量', use: 'method' },
      },
    },
    runs: [],
    sources: {},
  }, null, 2));
  return base;
}

function post(base, body) {
  return handleSnooze(new Request('http://127.0.0.1/api/dsh-literature-lab/snooze', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }), base);
}

test('稍后：按天数设置，写进 state 且时间在未来', async () => {
  const base = await baseWithPaper();
  const res = await post(base, { id: 'p1', days: 3 });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.ok, true);
  assert.ok(Date.parse(data.paper.snooze.until) > Date.now() + 2 * 86400000);
  const saved = JSON.parse(await readFile(path.join(base, 'state', 'papers.json'), 'utf8'));
  assert.ok(saved.papers.p1.snooze.until);
});

test('稍后：clear 清除标记', async () => {
  const base = await baseWithPaper();
  await post(base, { id: 'p1', days: 7 });
  const res = await post(base, { id: 'p1', clear: true });
  const data = await res.json();
  assert.equal(data.paper.snooze, null);
});

test('稍后：天数越界与缺 id 都拒绝', async () => {
  const base = await baseWithPaper();
  assert.equal((await post(base, { id: 'p1', days: 0 })).status, 400);
  assert.equal((await post(base, { id: 'p1', days: 999 })).status, 400);
  assert.equal((await post(base, {})).status, 400);
});

test('稍后：不存在的论文返回错误而不是静默成功', async () => {
  const base = await baseWithPaper();
  const res = await post(base, { id: 'nope', days: 3 });
  assert.equal(res.status, 500);
  const data = await res.json();
  assert.match(data.error, /不存在/);
});
