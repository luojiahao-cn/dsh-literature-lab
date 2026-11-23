/**
 * 启动自愈：进程重启后，上一轮残留的 analyzing 候选与 running job 不应永久卡住。
 */
import { updateJobsDb } from './repo/jobs.js';
import { updateCandidates, readCandidates, promoteCandidate } from './candidates.js';
import { readState, updateState } from './state.js';
import { listOpenJournals, removeJournal } from './journal.js';
import { assessWhyRead, readerOrientedWhy } from './analysis.js';

export async function healRuntime(baseDir) {
  let candidates = 0;
  await updateCandidates(baseDir, (items) => {
    for (const item of Object.values(items)) {
      if (item.status === 'analyzing') {
        item.status = 'new';
        item.last_interrupted_at = new Date().toISOString();
        candidates += 1;
      }
    }
    return items;
  });

  // 阶段迁移交给 versioned migration（schema 台账），启动不再静默把 L0/L1 改成 L2。
  // 候选→论文是两段提交：若崩溃发生在「论文已写、候选状态未写」之间，
  // 这里按论文的 candidate_id 把候选补成 promoted；反过来缺论文则补建。
  let papers = 0;
  // 先重放未完成事务：promote 的 paper 写入是否已发生，由 promoteCandidate 自己幂等判断。
  for (const record of await listOpenJournals(baseDir)) {
    if (record.operation === 'promote' && record.meta?.candidateId) {
      try {
        await promoteCandidate(baseDir, record.meta.candidateId, { journal: false });
        papers += 1;
      } catch { /* 留作人工处理 */ }
    }
    await removeJournal(baseDir, record.id);
  }
  const candidatesNow = await readCandidates(baseDir);
  const stateNow = await readState(baseDir);
  for (const [id, candidate] of Object.entries(candidatesNow)) {
    if (!['admitted', 'promoted'].includes(candidate.status)) continue;
    if (stateNow.papers?.[id]) continue;
    try {
      await promoteCandidate(baseDir, id);
      papers += 1;
    } catch { /* 缺摘要等异常留给人工，不阻塞启动 */ }
  }
  const stateAfter = await readState(baseDir);
  await updateCandidates(baseDir, (items) => {
    for (const paper of Object.values(stateAfter.papers || {})) {
      const cid = paper?.candidate_id;
      if (!cid || !items[cid]) continue;
      if (['promoted', 'admitted', 'dropped'].includes(items[cid].status)) continue;
      items[cid].status = 'promoted';
      items[cid].promoted_at = items[cid].promoted_at || new Date().toISOString();
    }
    return items;
  });

  // 旧卡片里 why_read 可能只是摘要复述：按同一套质量规则修成读者用途式。
  let whyRead = 0;
  await updateState(baseDir, (state) => {
    for (const paper of Object.values(state.papers || {})) {
      if (!paper?.l3?.why_read) continue;
      const warnings = assessWhyRead(paper.l3.why_read, paper.l3.summary || paper.abstract || '');
      const bad = warnings.some((warning) => ['why-read-result-first', 'why-read-summary-like', 'why-read-not-reader-oriented', 'why-read-too-short'].includes(warning));
      if (!bad) continue;
      paper.l3.why_read = readerOrientedWhy(paper);
      paper.l3.why_read_source = 'fallback';
      paper.l3.why_read_warnings = warnings;
      paper.updated_at = new Date().toISOString();
      whyRead += 1;
    }
  });

  let jobs = 0;
  await updateJobsDb(baseDir, (db) => {
    for (const job of Object.values(db.jobs || {})) {
      if (job.status === 'running') {
        job.status = 'cancelled';
        job.finished_at = new Date().toISOString();
        job.error = '进程重启，任务中断';
        jobs += 1;
      }
    }
    return db;
  });

  return { candidates, papers, jobs, whyRead };
}
