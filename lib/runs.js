import { randomUUID } from 'node:crypto';
import { updateState, today } from './state.js';

/** 统一 run id：让采集、分析、任务日志能关联到同一轮。 */
export function newRunId(kind = 'run') {
  const prefix = String(kind || 'run').replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 16) || 'run';
  return `${prefix}_${Date.now().toString(36)}_${randomUUID().slice(0, 8)}`;
}

/** 追加一条统一运行记录；runs 仍只保留最近 30 条。 */
export async function appendRun(baseDir, run) {
  const record = {
    date: run?.date || today(),
    at: run?.at || new Date().toISOString(),
    ...run,
  };
  await updateState(baseDir, (state) => {
    // 分析 run 单独存：它没有 scanned/added，混进采集 runs 会把采集历史挤出 30 条上限。
    if (record.kind === 'analysis') {
      state.analysis_runs = [record, ...(state.analysis_runs || [])].slice(0, 30);
    } else {
      state.runs = [record, ...(state.runs || [])].slice(0, 30);
    }
  });
  return record;
}
