/**
 * 分析额度：按 Asia/Shanghai 自然日统计 L1/L2/L3 已处理数。
 * L1 看候选 analysis_at；L2/L3 看论文 l2.at / l3.at。
 */
import { readCandidates } from './candidates.js';
import { readState, today } from './state.js';

function localDay(iso) {
  const time = Date.parse(iso || '');
  return Number.isFinite(time) ? new Date(time + 8 * 3600 * 1000).toISOString().slice(0, 10) : null;
}

export async function analysisUsage(baseDir) {
  const day = today();
  const [candidates, state] = await Promise.all([readCandidates(baseDir), readState(baseDir)]);
  const l1 = Object.values(candidates).filter((c) => c.analysis_at && localDay(c.analysis_at) === day).length;
  const papers = Object.values(state.papers || {});
  const l2 = papers.filter((p) => p.l2?.at && localDay(p.l2.at) === day).length;
  const l3 = papers.filter((p) => p.l3?.at && localDay(p.l3.at) === day).length;
  return { day, l1, l2, l3 };
}

export async function remainingQuota(baseDir, config, stage) {
  const key = String(stage).toLowerCase();
  const defaults = { l1: 50, l2: 10, l3: 2 };
  const limit = Math.max(0, Number(config?.analysis?.daily?.[key] ?? defaults[key]) || 0);
  const used = (await analysisUsage(baseDir))[key] || 0;
  return { limit, used, remaining: Math.max(0, limit - used) };
}
