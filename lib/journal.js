/**
 * 轻量 journal：跨文件事务写一个 intent 文件，成功后删除，失败/崩溃保留。
 * 启动时由 heal 重放未完成事务。只覆盖能幂等重放的操作（当前是 promote）。
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import * as store from './store.js';

function journalDir(baseDir) {
  return path.join(store.statePaths(baseDir).dir, 'journal');
}

export async function withJournal(baseDir, operation, meta, task) {
  const id = `tx_${Date.now().toString(36)}_${randomBytes(4).toString('hex')}`;
  const dir = journalDir(baseDir);
  await fs.mkdir(dir, { recursive: true });
  const file = path.join(dir, `${id}.json`);
  const base = { id, operation, meta, at: new Date().toISOString() };
  await store.writeJsonAtomic(file, { ...base, status: 'open' });
  try {
    const result = await task();
    await fs.unlink(file).catch(() => {});
    return result;
  } catch (error) {
    await store.writeJsonAtomic(file, { ...base, status: 'failed', error: String(error?.message || error) }).catch(() => {});
    throw error;
  }
}

export async function listOpenJournals(baseDir) {
  const dir = journalDir(baseDir);
  let names = [];
  try { names = await fs.readdir(dir); } catch { return []; }
  const out = [];
  for (const name of names.filter((item) => item.endsWith('.json'))) {
    try {
      const record = JSON.parse(await fs.readFile(path.join(dir, name), 'utf8'));
      if (record?.operation && ['open', 'failed'].includes(record.status)) out.push(record);
    } catch { /* 坏 journal 留给人工，不阻塞启动 */ }
  }
  return out;
}

export async function removeJournal(baseDir, id) {
  await fs.unlink(path.join(journalDir(baseDir), `${id}.json`)).catch(() => {});
}
