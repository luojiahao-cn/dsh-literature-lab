/**
 * 长任务骨架：采集/检索/同步这类活儿不挂在 HTTP 请求里。
 *
 * 调用方 startJob 后立即拿到 id；任务后台跑，状态写 state/jobs.json。
 * 支持超时与取消：run 收到 AbortSignal，长循环应定期检查 signal.aborted。
 */
import { randomBytes } from 'node:crypto';
import { readJobsDb, updateJobsDb } from './repo/jobs.js';

const MAX_JOBS = 50;
const controllers = new Map();

function prune(db) {
  const entries = Object.entries(db.jobs || {});
  if (entries.length <= MAX_JOBS) return db;
  entries.sort((a, b) => String(b[1]?.started_at || '').localeCompare(String(a[1]?.started_at || '')));
  const keep = new Set(entries.slice(0, MAX_JOBS).map(([id]) => id));
  for (const id of Object.keys(db.jobs)) if (!keep.has(id)) delete db.jobs[id];
  return db;
}

async function updateJob(baseDir, id, patch) {
  return updateJobsDb(baseDir, (db) => {
    db.jobs = db.jobs || {};
    db.jobs[id] = { ...(db.jobs[id] || { id }), ...patch };
    return prune(db);
  });
}

export async function listJobs(baseDir, { limit = 20 } = {}) {
  const db = await readJobsDb(baseDir);
  return Object.values(db.jobs || {})
    .sort((a, b) => String(b.started_at || '').localeCompare(String(a.started_at || '')))
    .slice(0, Math.min(50, Math.max(1, Number(limit) || 20)));
}

export async function getJob(baseDir, id) {
  const db = await readJobsDb(baseDir);
  return db.jobs?.[id] || null;
}

export async function cancelJob(baseDir, id) {
  const controller = controllers.get(id);
  if (controller) controller.abort();
  const record = await getJob(baseDir, id);
  if (!record) return null;
  if (record.status === 'running') {
    await updateJob(baseDir, id, {
      status: 'cancelled',
      finished_at: new Date().toISOString(),
      error: 'cancelled',
    });
  }
  return getJob(baseDir, id);
}

/**
 * 启动一个后台任务。run({signal}) 返回可 JSON 化的摘要。
 * @param {{name:string, run:(ctx:{signal:AbortSignal, jobId:string, report:(p:object)=>Promise<void>})=>Promise<any>, timeoutMs?:number}} spec
 */
export async function startJob(baseDir, { name, run, timeoutMs = 30 * 60 * 1000, meta = null }) {
  const id = `job_${randomBytes(6).toString('hex')}`;
  const controller = new AbortController();
  controllers.set(id, controller);
  const timer = setTimeout(() => controller.abort(), Math.max(10, Number(timeoutMs) || 30 * 60 * 1000));
  if (typeof timer.unref === 'function') timer.unref();

  const record = {
    id,
    name,
    status: 'running',
    started_at: new Date().toISOString(),
    timeout_ms: timeoutMs,
    // 谁在跑：界面靠它把「分析中」标到具体条目上
    ...(meta && typeof meta === 'object' ? { meta } : {}),
  };
  await updateJobsDb(baseDir, (db) => {
    db.jobs = db.jobs || {};
    db.jobs[id] = record;
    return prune(db);
  });

  // 任务进度：界面按 id 把阶段标到具体条目上（如「查找原文中」）
  const report = (progress) => (progress && typeof progress === 'object'
    ? updateJob(baseDir, id, { progress: { ...progress, at: new Date().toISOString() } })
    : Promise.resolve());

  Promise.resolve()
    .then(() => run({ signal: controller.signal, jobId: id, report }))
    .then(async (result) => {
      await updateJob(baseDir, id, {
        status: 'done',
        finished_at: new Date().toISOString(),
        result: result === undefined ? null : result,
      });
    })
    .catch(async (error) => {
      await updateJob(baseDir, id, {
        status: controller.signal.aborted ? 'cancelled' : 'error',
        finished_at: new Date().toISOString(),
        error: String(error?.message || error),
      });
    })
    .finally(() => {
      clearTimeout(timer);
      controllers.delete(id);
    });

  return record;
}
