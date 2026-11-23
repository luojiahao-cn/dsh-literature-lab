import test from 'node:test';
import assert from 'node:assert/strict';
import { shouldAutoAnalyze, nextRunAt, armSchedule, readScheduleState, stopSchedule } from '../lib/schedule.js';
import { writeUserConfig } from '../lib/config.js';
import { makeBase } from './helpers.mjs';

test('schedule：下一次运行时间按 Asia/Shanghai 计算', () => {
  // 2026-01-01T00:00:00Z = 本地 08:00，07:00 已过 → 次日 07:00 = 2026-01-01T23:00:00Z
  const now = Date.parse('2026-01-01T00:00:00Z');
  assert.equal(new Date(nextRunAt('07:00', now)).toISOString(), '2026-01-01T23:00:00.000Z');
  // 06:00 未到 → 当天 06:00 = 2025-12-31T22:00:00Z（now 之前），应排到次日 06:00
  assert.equal(new Date(nextRunAt('08:30', now)).toISOString(), '2026-01-01T00:30:00.000Z');
});

test('schedule：默认关闭；启用后写入 next_run_at', async () => {
  const base = await makeBase();
  const state = await readScheduleState(base);
  assert.equal(state.enabled, false);
  assert.equal(state.next_run_at, null);

  await writeUserConfig(base, { schedule: { enabled: true, time: '07:00', scope: 'C' } });
  const armed = await armSchedule({}, base);
  assert.equal(armed.enabled, true);
  assert.equal(armed.scope, 'C');
  assert.ok(armed.next_run_at);
  assert.ok(Date.parse(armed.next_run_at) > Date.now());
  stopSchedule();

  await writeUserConfig(base, { schedule: { enabled: false } });
  const off = await armSchedule({}, base);
  assert.equal(off.enabled, false);
  assert.equal(off.next_run_at, null);
});


test('schedule：采集后自动分析必须显式 autoAnalyze=true', () => {
  assert.equal(shouldAutoAnalyze({ analysis: { enabled: true, auto: true }, schedule: {} }), false);
  assert.equal(shouldAutoAnalyze({ analysis: { enabled: true }, schedule: { autoAnalyze: true } }), true);
  assert.equal(shouldAutoAnalyze({ analysis: { enabled: false }, schedule: { autoAnalyze: true } }), false);
});
