/** AI 分析今日额度、token 估算、运行中任务统计。 */
import { readCandidates } from './candidates.js';
import { readState, today } from './state.js';
import { analysisUsage } from './analysis-quota.js';
import { listJobs } from './jobs.js';

function localDay(iso) {
  const time = Date.parse(iso || '');
  return Number.isFinite(time) ? new Date(time + 8 * 3600 * 1000).toISOString().slice(0, 10) : null;
}

export async function analysisStats(baseDir, config) {
  const day = today();
  const [usage, candidates, state, jobs] = await Promise.all([
    analysisUsage(baseDir),
    readCandidates(baseDir),
    readState(baseDir),
    listJobs(baseDir, { limit: 50 }),
  ]);
  const papers = Object.values(state.papers || {});
  const counts = {};
  for (const item of Object.values(candidates)) counts[item.status] = (counts[item.status] || 0) + 1;

  let tokens = 0;
  // token 是历史记账：按最近一次判读的 usage 累计，不随条目当前状态变化
  for (const item of Object.values(candidates)) tokens += Number(item.analysis?.usage?.estimated_tokens) || 0;
  for (const paper of papers) {
    tokens += Number(paper.l2?.usage?.estimated_tokens) || 0;
    tokens += Number(paper.l3?.usage?.estimated_tokens) || 0;
  }
  const pdfUsed = papers.filter((p) => p.pdf && p.download?.ok && localDay(p.download.at) === day).length;

  return {
    day,
    limits: {
      l1: Number(config?.analysis?.daily?.l1 ?? 50) || 0,
      l2: Number(config?.analysis?.daily?.l2 ?? 10) || 0,
      l3: Number(config?.analysis?.daily?.l3 ?? 2) || 0,
      pdf: Number(config?.download?.maxPerDay ?? 6) || 0,
    },
    usage: { ...usage, pdf: pdfUsed, tokens },
    counts,
    running: jobs.filter((job) => job.status === 'running').map((job) => ({ id: job.id, name: job.name, started_at: job.started_at })),
  };
}
