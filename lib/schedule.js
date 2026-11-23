/**
 * 插件内定时任务：开关与时间在插件设置里，用插件自己的 timer 执行，
 * 不创建 DSH schedule 任务、不写用户会话。
 *
 * 时区固定按 Asia/Shanghai（UTC+8，无夏令时）解释 HH:MM。
 */
import * as store from './store.js';
import { readConfig } from './config.js';
import { discover } from './discover.js';
import { runEmail } from './email.js';
import { analyzeCandidates, analyzeL2Papers, analyzeL3Papers } from './analysis-run.js';

const TZ_OFFSET_MS = 8 * 3600 * 1000;
let timer = null;
let watchdog = null;
let running = false;

function schedulePath(baseDir) {
  return store.statePaths(baseDir).schedule;
}

/** 下一次运行时间（本地 HH:MM → UTC 毫秒）。 */
export function nextRunAt(time = '07:00', now = Date.now()) {
  const [h, m] = String(time).split(':').map(Number);
  const hh = Number.isFinite(h) ? Math.min(23, Math.max(0, h)) : 7;
  const mm = Number.isFinite(m) ? Math.min(59, Math.max(0, m)) : 0;
  const local = new Date(now + TZ_OFFSET_MS);
  const targetLocal = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate(), hh, mm, 0);
  let target = targetLocal - TZ_OFFSET_MS;
  if (target <= now) target += 86400 * 1000;
  return target;
}

export async function readScheduleState(baseDir) {
  return store.readJson(schedulePath(baseDir), {
    enabled: false,
    time: '07:00',
    scope: 'A',
    next_run_at: null,
    last_run_at: null,
    last_result: null,
    last_error: null,
  });
}

async function patchScheduleState(baseDir, patch) {
  return store.updateJson('schedule', schedulePath(baseDir), {
    enabled: false,
    time: '07:00',
    scope: 'A',
    next_run_at: null,
    last_run_at: null,
    last_result: null,
    last_error: null,
  }, (db) => ({ ...db, ...patch }));
}

export function stopSchedule() {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  if (watchdog) {
    clearInterval(watchdog);
    watchdog = null;
  }
}

/** 单次执行入口；timer 与 watchdog 共用，避免重叠。 */
async function fire(ctx, baseDir) {
  if (running) return;
  running = true;
  try {
    await runDaily(ctx, baseDir);
  } catch (error) {
    await patchScheduleState(baseDir, {
      last_run_at: new Date().toISOString(),
      last_error: String(error?.message || error),
    });
  } finally {
    running = false;
    armSchedule(ctx, baseDir).catch(() => {});
  }
}

/** 自动采集后是否自动分析：显式开关，默认关；不再沿用隐藏的 analysis.auto。 */
export function shouldAutoAnalyze(config) {
  return config?.analysis?.enabled !== false && config?.schedule?.autoAnalyze === true;
}

/** 每次成功跑完写一条摘要；失败只记错误，等下一次。 */
export async function runDaily(ctx, baseDir) {
  const config = await readConfig(baseDir);
  const scope = config?.schedule?.scope === 'C' ? 'C' : 'A';
  const hidden = new Set(Array.isArray(config?.radar?.hidden) ? config.radar.hidden : []);
  const only = ['arxiv', 'rss', 'search', 'pubmed', 'dblp', 'preprint']
    .filter((id) => !hidden.has(id));
  const result = only.length
    ? await discover(baseDir, { only })
    : { added: 0, merged: 0, scanned: 0, sources: [] };
  let email = null;
  if (!hidden.has('email')) {
    try {
      email = await runEmail(ctx, baseDir);
    } catch (error) {
      email = { ok: false, error: String(error?.message || error) };
    }
  }
  const analysis = {};
  if (shouldAutoAnalyze(config)) {
    try {
      analysis.l1 = await analyzeCandidates(ctx, baseDir, config, { limit: config.analysis.daily?.l1 || 30, sort: 'score' });
    } catch (error) {
      analysis.l1 = { ok: false, error: String(error?.message || error) };
    }
    try {
      analysis.l2 = await analyzeL2Papers(ctx, baseDir, config, { limit: config.analysis.daily?.l2 || 6 });
    } catch (error) {
      analysis.l2 = { ok: false, error: String(error?.message || error) };
    }
    try {
      analysis.l3 = await analyzeL3Papers(ctx, baseDir, config, { limit: config.analysis.daily?.l3 || 3 });
    } catch (error) {
      analysis.l3 = { ok: false, error: String(error?.message || error) };
    }
  }
  await patchScheduleState(baseDir, {
    last_run_at: new Date().toISOString(),
    last_result: {
      added: result.added,
      merged: result.merged,
      scanned: result.scanned,
      email_added: email?.added || 0,
      email_error: email?.error || null,
      analysis: {
        l1: analysis.l1 ? { admitted: analysis.l1.admitted, parked: analysis.l1.parked, dropped: analysis.l1.dropped, failed: analysis.l1.failed, error: analysis.l1.error || null } : null,
        l2: analysis.l2 ? { closeRead: analysis.l2.closeRead, skim: analysis.l2.skim, skip: analysis.l2.skip, needsPdf: analysis.l2.needsPdf, failed: analysis.l2.failed, error: analysis.l2.error || null } : null,
        l3: analysis.l3 ? { done: analysis.l3.done, parked: analysis.l3.parked, zotero: analysis.l3.zotero, failed: analysis.l3.failed, error: analysis.l3.error || null } : null,
      },
      sources: (result.sources || []).map((s) => ({ key: s.key, ok: s.ok, count: s.count })),
    },
    last_error: null,
  });
  return { discover: result, email, analysis, scope };
}

/**
 * 按当前配置重新计算下一次并挂上 timer。
 * enabled=false 时只清空 next_run_at，不执行任何任务。
 */
export async function armSchedule(ctx, baseDir) {
  stopSchedule();
  const config = await readConfig(baseDir);
  const schedule = config?.schedule || {};
  if (schedule.enabled !== true) {
    await patchScheduleState(baseDir, { enabled: false, next_run_at: null });
    return readScheduleState(baseDir);
  }
  const time = /^\d{1,2}:\d{2}$/.test(String(schedule.time || '')) ? String(schedule.time) : '07:00';
  const scope = schedule.scope === 'C' ? 'C' : 'A';
  const existing = await readScheduleState(baseDir);
  // 插件重载/睡眠可能错过触发点；如果下一次时间已过且还没跑过，补跑一次。
  const nextAt = existing.next_run_at ? Date.parse(existing.next_run_at) : NaN;
  const lastAt = existing.last_run_at ? Date.parse(existing.last_run_at) : NaN;
  const missed = Number.isFinite(nextAt)
    && nextAt <= Date.now()
    && (!Number.isFinite(lastAt) || lastAt < nextAt);
  const at = missed ? Date.now() + 1000 : nextRunAt(time);
  await patchScheduleState(baseDir, {
    enabled: true,
    time,
    scope,
    next_run_at: new Date(at).toISOString(),
    ...(missed ? { last_error: null } : {}),
  });

  const delay = Math.max(1000, at - Date.now());
  timer = setTimeout(() => {
    timer = null;
    fire(ctx, baseDir).catch(() => {});
  }, delay);
  if (typeof timer.unref === 'function') timer.unref();

  // watchdog：即使 setTimeout 因插件重载/宿主挂起丢失，也能每分钟补一次。
  watchdog = setInterval(async () => {
    try {
      const current = await readScheduleState(baseDir);
      if (!current.enabled || !current.next_run_at) return;
      if (Date.parse(current.next_run_at) <= Date.now()) await fire(ctx, baseDir);
    } catch { /* 下一轮再试 */ }
  }, 30 * 1000);
  if (typeof watchdog.unref === 'function') watchdog.unref();

  return readScheduleState(baseDir);
}
