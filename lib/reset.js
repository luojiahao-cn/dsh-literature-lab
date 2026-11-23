/**
 * 清空派生数据：候选池 + runs + seen + 来源健康，一次完成。
 *
 * 为什么需要单独一个入口：
 * - 只清 candidates 会留下 runs 的累计和 seen 的旧索引，采集概况会出现
 *   「累计进入候选」远大于「当前存量」，下次抓取还会把旧条目当已见过跳过；
 * - 清空是破坏性操作，必须同时清、可备份、可验证，而不是散在各处手工删文件。
 *
 * 保留：papers、精读卡片、config、凭据、PDF/翻译产物；
 * 默认同时清 email 处理账与 schedule 运行摘要，避免重置后“历史说 admitted 2、库里 0 篇”。
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import * as store from './store.js';
import { SCHEMA_VERSION, migrateState } from './state.js';

function stamp() {
  return new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
}

async function copyIfExists(from, dir, name) {
  try {
    await fs.copyFile(from, path.join(dir, name));
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}

/**
 * @param {string} baseDir 插件根目录（含 state/）
 * @param {{backup?: boolean, keepSourceHealth?: boolean, keepEmailProcessed?: boolean}} options
 *   backup=true 时把相关文件复制到 state/backup/<时间>-reset/。
 *   keepSourceHealth=true 时保留 state.sources 的健康记录（默认清）。
 *   keepEmailProcessed=true 时保留 email.processed/failed（默认清）。
 */
export async function resetDerived(baseDir, { backup = true, keepSourceHealth = false, keepEmailProcessed = false } = {}) {
  const paths = store.statePaths(baseDir);

  // 先锁 papers/seen 的 'data'，再锁 candidates；本项目没有反向嵌套，顺序稳定。
  return store.withLock('data', () => store.withLock('candidates', async () => {
    const rawState = await store.readJson(paths.papers, null);
    const rawCandidates = await store.readJson(paths.candidates, { items: {} });
    const rawSeen = await store.readJson(paths.seen, {});
    const rawEmail = await store.readJson(paths.email, null);
    const rawSchedule = await store.readJson(paths.schedule, null);
    const state = migrateState(rawState || {});

    const before = {
      candidates: Object.keys(rawCandidates?.items || {}).length,
      runs: Array.isArray(state.runs) ? state.runs.length : 0,
      seen: Object.keys(rawSeen || {}).length,
      papers: Object.keys(state.papers || {}).length,
      sources: Object.keys(state.sources || {}).length,
    };

    let backupDir = null;
    if (backup) {
      backupDir = path.join(paths.dir, 'backup', `${stamp()}-reset`);
      await fs.mkdir(backupDir, { recursive: true });
      await copyIfExists(paths.papers, backupDir, 'papers.json');
      await copyIfExists(paths.candidates, backupDir, 'candidates.json');
      await copyIfExists(paths.seen, backupDir, 'seen.json');
      await copyIfExists(paths.email, backupDir, 'email.json');
      await copyIfExists(paths.schedule, backupDir, 'schedule.json');
    }

    const next = migrateState({
      ...state,
      schema: SCHEMA_VERSION,
      updated_at: new Date().toISOString(),
      runs: [],
      sources: keepSourceHealth ? (state.sources || {}) : {},
      last_success_at: null,
    });
    await store.writeJsonAtomic(paths.papers, next);
    await store.writeJsonAtomic(paths.candidates, { items: {} });
    await store.writeJsonAtomic(paths.seen, {});
    const emailNext = keepEmailProcessed
      ? (rawEmail || {})
      : { processed: {}, failed: {} };
    await store.writeJsonAtomic(paths.email, emailNext);
    const scheduleBase = rawSchedule && typeof rawSchedule === 'object' ? rawSchedule : {};
    const scheduleNext = {
      ...scheduleBase,
      last_run_at: null,
      last_result: null,
      last_error: null,
    };
    await store.writeJsonAtomic(paths.schedule, scheduleNext);

    return {
      ok: true,
      backupDir,
      before,
      after: {
        candidates: 0,
        runs: 0,
        seen: 0,
        papers: Object.keys(next.papers || {}).length,
        sources: Object.keys(next.sources || {}).length,
        email: Object.keys(emailNext.processed || {}).length,
        schedule: { enabled: scheduleNext.enabled ?? null, time: scheduleNext.time ?? null },
      },
    };
  }));
}
