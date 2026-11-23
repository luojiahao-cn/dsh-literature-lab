/**
 * 统一状态存储：路径、按文件串行、原子写、schema 迁移的入口。
 *
 * 为什么需要：之前各模块自己 readFile/writeFile，「读-改-写」在并发时会互相覆盖。
 * 从 P0 起，所有状态文件只能经这里读写；锁是进程内的 promise 链，
 * 不阻塞网络请求，但同一个文件的写入会排队。
 */
import { readFile, writeFile, rename, mkdir, copyFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import path from 'node:path';

const chains = new Map();

/**
 * 按 key 串行执行任务。错误只 reject 本次调用，不打断后续排队。
 * @template T
 * @param {string} key
 * @param {() => Promise<T>} task
 * @returns {Promise<T>}
 */
export function withLock(key, task) {
  const previous = chains.get(key) || Promise.resolve();
  const run = previous.then(task, task);
  chains.set(key, run.then(() => undefined, () => undefined));
  return run;
}

/** 所有状态文件的位置集中在这里。 */
export function statePaths(baseDir) {
  const dir = path.join(baseDir, 'state');
  return {
    dir,
    papers: path.join(dir, 'papers.json'),
    seen: path.join(dir, 'seen.json'),
    config: path.join(dir, 'config.json'),
    zotero: path.join(dir, 'zotero.json'),
    zoteroKey: path.join(dir, 'zotero-local-key.json'),
    jobs: path.join(dir, 'jobs.json'),
    candidates: path.join(dir, 'candidates.json'),
    harvests: path.join(dir, 'harvests.json'),
    schedule: path.join(dir, 'schedule.json'),
    email: path.join(dir, 'email.json'),
    analysis: path.join(dir, 'analysis'),
    texts: path.join(dir, 'texts'),
    cards: path.join(dir, 'cards'),
    watch: path.join(dir, 'watch.json'),
  };
}

async function quarantine(file) {
  const dir = path.join(path.dirname(file), 'quarantine');
  await mkdir(dir, { recursive: true });
  const dest = path.join(dir, `${path.basename(file)}.${Date.now()}.corrupt`);
  await copyFile(file, dest).catch(() => {});
  await rename(file, dest).catch(() => {});
  return dest;
}

export async function readJson(file, fallback) {
  if (!existsSync(file)) return fallback;
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch {
    // 损坏文件不能静默当空状态再被覆盖：先隔离，再让调用方看到错误。
    const dest = await quarantine(file);
    const error = new Error(`状态文件损坏，已隔离到 ${dest}`);
    error.code = 'STATE_CORRUPT';
    throw error;
  }
}

/** 原子写：先写同目录临时文件再 rename。 */
export async function writeJsonAtomic(file, value, { mode } = {}) {
  await mkdir(path.dirname(file), { recursive: true });
  // 同一进程同一毫秒写同一目标时，pid+Date 会互撞；加随机后缀。
  const tmp = `${file}.${process.pid}.${Date.now()}.${randomBytes(6).toString('hex')}.tmp`;
  await writeFile(tmp, JSON.stringify(value), mode ? { encoding: 'utf8', mode } : 'utf8');
  await rename(tmp, file);
  return value;
}

/**
 * 锁内读-改-写。fn 收到当前值，返回新值。
 */
export async function updateJson(key, file, fallback, fn) {
  return withLock(key, async () => {
    const current = await readJson(file, fallback);
    const next = await fn(current);
    await writeJsonAtomic(file, next);
    return next;
  });
}

export function nowIso() {
  return new Date().toISOString();
}
