import test from 'node:test';
import assert from 'node:assert/strict';
import { startJob, listJobs, getJob, cancelJob } from '../lib/jobs.js';
import { makeBase } from './helpers.mjs';

test('jobs：后台任务状态机', async () => {
  const base = await makeBase();
  const record = await startJob(base, {
    name: 'demo',
    run: async () => ({ added: 3 }),
  });
  assert.equal(record.status, 'running');

  await new Promise((resolve) => setTimeout(resolve, 30));
  const done = await getJob(base, record.id);
  assert.equal(done.status, 'done');
  assert.deepEqual(done.result, { added: 3 });

  const failed = await startJob(base, {
    name: 'boom',
    run: async () => { throw new Error('nope'); },
  });
  await new Promise((resolve) => setTimeout(resolve, 30));
  const job = await getJob(base, failed.id);
  assert.equal(job.status, 'error');
  assert.match(job.error, /nope/);

  const jobs = await listJobs(base);
  assert.equal(jobs.length, 2);
});


test('jobs：任务可以上报条目级进度', async () => {
  const base = await makeBase();
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const record = await startJob(base, {
    name: 'analysis:L2',
    meta: { stage: 'L2', targets: ['arxiv:1'] },
    run: async ({ report }) => {
      await report({ id: 'arxiv:1', phase: '查找原文中' });
      await gate;
      return { processed: 1 };
    },
  });
  await new Promise((resolve) => setTimeout(resolve, 30));
  const running = await getJob(base, record.id);
  assert.equal(running.progress.id, 'arxiv:1');
  assert.equal(running.progress.phase, '查找原文中');
  assert.ok(running.progress.at, '进度带时间戳');
  release();
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal((await getJob(base, record.id)).status, 'done');
});

test('jobs：取消与超时', async () => {
  const base = await makeBase();
  const run = ({ signal }) => new Promise((resolve, reject) => {
    signal.addEventListener('abort', () => reject(new Error('cancelled')));
  });
  const long = await startJob(base, { name: 'long', run });
  await cancelJob(base, long.id);
  await new Promise((resolve) => setTimeout(resolve, 30));
  const cancelled = await getJob(base, long.id);
  assert.equal(cancelled.status, 'cancelled');

  const timeout = await startJob(base, { name: 'timeout', run, timeoutMs: 20 });
  await new Promise((resolve) => setTimeout(resolve, 80));
  const timedOut = await getJob(base, timeout.id);
  assert.equal(timedOut.status, 'cancelled');
});
