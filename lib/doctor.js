/**
 * 只读对账：候选↔论文↔PDF↔run 账本。
 * 只报告问题，不修改数据；供 scripts/data-doctor.mjs 与排障使用。
 */
import path from 'node:path';
import { existsSync } from 'node:fs';
import { readState, readSeen } from './state.js';
import { readCandidates } from './candidates.js';
import { readJobsDb } from './repo/jobs.js';
import { normalizeTitle } from './dedup.js';

export async function dataDoctor(baseDir) {
  const state = await readState(baseDir);
  const candidates = await readCandidates(baseDir);
  const seen = await readSeen(baseDir);
  const papers = state.papers || {};
  const issues = [];
  const add = (severity, code, message, detail = {}) => issues.push({ severity, code, message, ...detail });

  const paperIds = new Set(Object.keys(papers));
  const byDoi = new Map();
  const byTitle = new Map();
  for (const [id, paper] of Object.entries(papers)) {
    if (paper?.candidate_id && !candidates[paper.candidate_id]) {
      add('warn', 'paper-candidate-missing', `论文 ${id} 的候选记录不存在`, { paperId: id, candidateId: paper.candidate_id });
    }
    if (paper?.doi) {
      const key = String(paper.doi).toLowerCase();
      if (byDoi.has(key)) add('error', 'duplicate-doi', `DOI 重复：${key}`, { ids: [byDoi.get(key), id] });
      else byDoi.set(key, id);
    }
    const title = normalizeTitle(paper?.title || '');
    if (title) {
      if (byTitle.has(title)) add('warn', 'duplicate-title', `题名重复：${paper?.title}`, { ids: [byTitle.get(title), id] });
      else byTitle.set(title, id);
    }
    if (paper?.pdf) {
      const file = path.isAbsolute(paper.pdf) ? paper.pdf : path.resolve(baseDir, paper.pdf);
      if (!existsSync(file)) add('error', 'pdf-missing', `论文 ${id} 标记有 PDF 但文件不存在`, { paperId: id, pdf: paper.pdf });
    }
  }

  // 取原文失败的分布：paywalled/blocked 集中出现时，提示配机构访问或走浏览器扩展
  const failed = Object.entries(papers).filter(([, p]) => ['paywalled', 'blocked'].includes(p?.pdf_failure?.code));
  if (failed.length) {
    add('info', 'pdf-needs-access', `${failed.length} 篇因订阅或拦截没取到原文：可配置机构访问（download.access），或用浏览器扩展手动补件`, {
      count: failed.length,
      ids: failed.slice(0, 5).map(([id]) => id),
    });
  }

  for (const [id, candidate] of Object.entries(candidates)) {
    if (!['admitted', 'promoted'].includes(candidate?.status)) continue;
    if (!paperIds.has(id)) {
      add('error', 'promoted-without-paper', `候选 ${id} 已转论文但没有论文记录`, { candidateId: id });
    }
    if (candidate?.candidate_id && candidate.candidate_id !== id) {
      add('warn', 'candidate-self-id', `候选 ${id} 的 candidate_id 指向自己之外`, { candidateId: id });
    }
  }

  const runs = [...(state.runs || []), ...(state.analysis_runs || [])];
  for (const run of runs) {
    if (!run?.id) add('info', 'run-without-id', `采集轮次缺少 id（旧数据）`, { at: run?.at || null });
  }
  const runIds = new Set(runs.map((run) => run?.id).filter(Boolean));
  const jobs = (await readJobsDb(baseDir)).jobs || {};
  for (const job of Object.values(jobs)) {
    if (job?.meta?.run_id && !runIds.has(job.meta.run_id) && ['running', 'done'].includes(job.status)) {
      add('warn', 'job-run-missing', `任务 ${job.id} 的 run_id 没有对应运行记录`, { jobId: job.id, runId: job.meta.run_id });
    }
    if (job?.status === 'running') {
      const started = Date.parse(job.started_at || '');
      if (Number.isFinite(started) && Date.now() - started > Number(job.timeout_ms || 0) + 60_000) {
        add('warn', 'job-stale-running', `任务 ${job.id} 超时后仍是 running`, { jobId: job.id, startedAt: job.started_at });
      }
    }
  }

  return {
    ok: issues.filter((item) => item.severity === 'error').length === 0,
    counts: {
      papers: paperIds.size,
      candidates: Object.keys(candidates).length,
      runs: (state.runs || []).length,
      analysisRuns: (state.analysis_runs || []).length,
      seen: Object.keys(seen || {}).length,
      issues: issues.length,
    },
    issues,
  };
}
