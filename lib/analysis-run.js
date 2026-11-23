/**
 * 批量 L1 分析：从候选池取 new（或指定 ids），逐篇调用模型并应用结果。
 * 不创建会话；由 jobs 后台执行。
 */
import { readCandidates, sortCandidates, updateCandidates } from './candidates.js';
import { withLock } from './store.js';
import { acquireClaim, releaseClaim } from './claims.js';
import { readState, updateState, today, isSnoozed } from './state.js';
import { download, applyPdfArrival } from './download.js';
import { ensurePdfText } from './pdf.js';
import { abstractFromText } from './abstracts.js';
import { remainingQuota } from './analysis-quota.js';
import { enrichPaper } from './enrich.js';
import { ensurePaperVenueTier } from './easyscholar.js';
import { shouldAutoImport, importPapers } from './zotero.js';
import { analyzeL1, analyzeL2, analyzeL3 } from './analysis.js';
import { applyL1Record, applyL2Record, applyL3Record } from './analysis-apply.js';
import { coerceGradeForVerification, ensureVerification } from './verify.js';

async function analyzeCandidatesInner(ctx, baseDir, config, {
  stage = 'L1', ids, limit = 10, sort = 'score', signal, onProgress,
} = {}) {
  if (stage !== 'L1') throw new Error('目前只支持 L1 摘要判读');
  const all = await readCandidates(baseDir);
  const explicit = Array.isArray(ids) && ids.length
    ? [...new Set(ids.map((id) => String(id).trim()).filter(Boolean))]
    : null;
  const selected = explicit
    ? explicit.map((id) => all[id]).filter(Boolean)
    : sortCandidates(
      Object.values(all).filter((item) => item.status === 'new'),
      sort,
    ).rows;
  const quota = await remainingQuota(baseDir, config, 'L1');
  const cap = Math.min(50, Math.max(0, Number(limit) || 10), quota.remaining);
  const targets = selected.slice(0, cap);
  const stats = { ok: true, requested: targets.length, processed: 0, admitted: 0, parked: 0, dropped: 0, failed: 0, quota, items: [] };
  const report = progressReporter(onProgress);

  for (const candidate of targets) {
    const claimKey = `L1:${candidate.id}`;
    const claim = await acquireClaim(baseDir, claimKey, { owner: 'analysis' });
    if (!claim.ok) continue;
    try {
      await updateCandidates(baseDir, (items) => {
        if (items[candidate.id]) items[candidate.id].status = 'analyzing';
        return items;
      });
    try {
      await report(candidate.id, '引用核验中');
      const verification = await ensureVerification(baseDir, candidate).catch(() => null);
      await report(candidate.id, '摘要判读中');
      const record = await analyzeL1(ctx, baseDir, config, candidate);
      record.verification = verification;
      // 核验结论先于评级：DOI 张冠李戴直接丢，没核实过的拿不到 S/A/B
      const coerced = coerceGradeForVerification(record.output?.grade, verification?.status);
      if (record.output && coerced.downgraded) {
        if (coerced.verdict === 'drop') record.output.verdict = 'drop';
        if (coerced.grade) record.output.grade = coerced.grade;
        record.verification_note = coerced.note;
      }
      await report(candidate.id, '写入结果中');
      const applied = await applyL1Record(baseDir, config, record);
      stats.processed += 1;
      if (applied.status === 'admitted') stats.admitted += 1;
      else if (applied.status === 'parked') stats.parked += 1;
      else if (applied.status === 'dropped') stats.dropped += 1;
      else stats.failed += 1;
      stats.items.push({
        id: candidate.id,
        status: applied.status,
        verdict: record.output?.verdict || null,
        grade: record.output?.grade || null,
        confidence: record.confidence || null,
        error: record.error || null,
      });
    } catch (error) {
      stats.failed += 1;
      const message = String(error?.message || error);
      await updateCandidates(baseDir, (items) => {
        if (items[candidate.id]) {
          items[candidate.id].status = 'failed';
          items[candidate.id].analysis = {
            ...(items[candidate.id].analysis || {}),
            error: message,
            at: new Date().toISOString(),
          };
        }
        return items;
      });
      stats.items.push({ id: candidate.id, status: 'failed', error: message });
    }
    } finally {
      await releaseClaim(baseDir, claimKey, 'analysis');
    }
  }
  return stats;
}



/** 进度上报：失败不影响分析；阶段文案固定 5 个字，界面上长度一致。 */
function progressReporter(onProgress) {
  return async (id, phase) => {
    if (typeof onProgress !== 'function') return;
    try { await onProgress({ id, phase }); } catch { /* 进度写失败不影响分析 */ }
  };
}

function localDay(iso) {
  const time = Date.parse(iso || '');
  return Number.isFinite(time) ? new Date(time + 8 * 3600 * 1000).toISOString().slice(0, 10) : null;
}

/** L2 下载也受 download.maxPerDay 限制；返回 false 表示额度已满。 */
async function canDownloadForL2(baseDir, config) {
  const max = Math.max(1, Number(config?.download?.maxPerDay) || 6);
  const state = await readState(baseDir);
  const day = today();
  const used = Object.values(state.papers || {})
    .filter((p) => p.pdf && p.download?.ok && localDay(p.download.at) === day)
    .length;
  return used < max;
}

/** L2：只处理 stage=L2 的论文；需要时才下载 PDF，再抽取正文。 */
async function analyzeL2PapersInner(ctx, baseDir, config, { ids, limit = 10, signal, onProgress } = {}) {
  const state = await readState(baseDir);
  const gradeRank = { S: 5, A: 4, B: 3, C: 2, D: 1 };
  const explicit = Array.isArray(ids) && ids.length
    ? [...new Set(ids.map((id) => String(id).trim()).filter(Boolean))]
    : null;
  const quota = await remainingQuota(baseDir, config, 'L2');
  const cap = Math.min(20, Math.max(0, Number(limit) || 10), quota.remaining);
  const pool = Object.entries(state.papers || {})
    .filter(([, p]) => p.stage === 'L2')
    // 用户按了「暂停」的论文不参与自动处理
    .filter(([, p]) => !isSnoozed(p))
    .filter(([id]) => !explicit || explicit.includes(id))
    .sort((a, b) => Number(Boolean(b[1].priority)) - Number(Boolean(a[1].priority))
      || (gradeRank[b[1].grade] || 0) - (gradeRank[a[1].grade] || 0)
      || (Number(b[1].relevance?.score) || 0) - (Number(a[1].relevance?.score) || 0))
    .slice(0, cap);
  const stats = { ok: true, requested: pool.length, processed: 0, closeRead: 0, skim: 0, skip: 0, parked: 0, manual: 0, needsPdf: 0, failed: 0, quota, items: [] };
  const report = progressReporter(onProgress);

  for (const [id] of pool) {
    if (signal?.aborted) { stats.cancelled = true; break; }
    if (signal?.aborted) { stats.cancelled = true; break; }
    if (signal?.aborted) { stats.cancelled = true; break; }
    let paper = (await readState(baseDir)).papers?.[id];
    if (!paper) continue;
    await report(id, '查找原文中');
    let attemptedDownload = false;
    if (!paper.pdf) {
      const enriched = await enrichPaper(baseDir, { ...paper, id });
      paper = enriched.paper || paper;
    }
    paper = await ensurePaperVenueTier(baseDir, { ...paper, id }, ctx).catch(() => paper);
    if (!paper.pdf) {
      if (await canDownloadForL2(baseDir, config)) {
        try {
          attemptedDownload = true;
          const fetched = await download(baseDir, { ids: [id], limit: 1, ctx });
          if (fetched?.fetched) {
            // 原文到位即续跑：download 已经清掉 needs_pdf/pdf_error 并把论文放回 L2，
            // 这里按最新状态再兜一次，免得并发写入或旧版本状态留下残留标记。
            await updateState(baseDir, (latest) => {
              const target = latest.papers?.[id];
              if (target?.pdf) {
                applyPdfArrival(target, {
                  pdf: target.pdf,
                  bytes: target.pdf_bytes,
                  source: target.pdf_source || null,
                });
              }
            });
          }
        } catch { /* 下载失败按 needs_pdf */ }
      }
      paper = (await readState(baseDir)).papers?.[id];
    }
    if (!paper?.pdf) {
      // 额度用完属于「还没试」：不打 needs_pdf，留在 AI 队列等明天
      if (!attemptedDownload) {
        stats.deferred = (stats.deferred || 0) + 1;
        stats.items.push({ id, status: 'deferred', reason: 'pdf-quota' });
        continue;
      }
      stats.needsPdf += 1;
      await updateState(baseDir, (latest) => {
        const target = latest.papers?.[id];
        if (target) target.review_flags = [...new Set([...(target.review_flags || []), 'needs_pdf'])];
      });
      stats.items.push({ id, status: 'needs_pdf' });
      continue;
    }

    try {
      await report(id, '初筛判断中');
      const textMeta = await ensurePdfText(baseDir, { ...paper, id });
      if (!textMeta) throw new Error('PDF 文本抽取为空');
      await deriveAbstract(baseDir, id, textMeta);
      const record = await analyzeL2(ctx, baseDir, config, { ...paper, id }, textMeta);
      await report(id, '写入结果中');
      const applied = await applyL2Record(baseDir, config, record);
      stats.processed += 1;
      if (applied.status === 'L3') stats.closeRead += 1;
      else if (applied.status === 'parked') stats.parked += 1;
      else if (applied.status === 'manual') stats.manual += 1;
      else if (applied.status === 'done') {
        if (record.output?.verdict === 'skim') stats.skim += 1;
        else stats.skip += 1;
      } else stats.failed += 1;
      stats.items.push({
        id,
        status: applied.status,
        verdict: record.output?.verdict || null,
        confidence: record.confidence || null,
        error: record.error || null,
      });
    } catch (error) {
      stats.failed += 1;
      await updateState(baseDir, (latest) => {
        const target = latest.papers?.[id];
        if (target) target.review_flags = [...new Set([...(target.review_flags || []), 'pdf_error'])];
      });
      stats.items.push({ id, status: 'failed', error: String(error?.message || error) });
    }
  }
  return stats;
}


/** L3：全文精读；完成且达阈值时按 Zotero 自动入库策略执行。 */
async function analyzeL3PapersInner(ctx, baseDir, config, { ids, limit = 5, signal, onProgress } = {}) {
  const state = await readState(baseDir);
  const gradeRank = { S: 5, A: 4, B: 3, C: 2, D: 1 };
  const explicit = Array.isArray(ids) && ids.length
    ? [...new Set(ids.map((id) => String(id).trim()).filter(Boolean))]
    : null;
  const quota = await remainingQuota(baseDir, config, 'L3');
  const cap = Math.min(10, Math.max(0, Number(limit) || 5), quota.remaining);
  const pool = Object.entries(state.papers || {})
    .filter(([, p]) => p.stage === 'L3')
    .filter(([, p]) => !isSnoozed(p))
    .filter(([id]) => !explicit || explicit.includes(id))
    .sort((a, b) => Number(Boolean(b[1].priority)) - Number(Boolean(a[1].priority))
      || (gradeRank[b[1].grade] || 0) - (gradeRank[a[1].grade] || 0)
      || (Number(b[1].relevance?.score) || 0) - (Number(a[1].relevance?.score) || 0)
      || String(b[1].first_seen || '').localeCompare(String(a[1].first_seen || '')))
    .slice(0, cap);
  const stats = { ok: true, requested: pool.length, processed: 0, done: 0, parked: 0, manual: 0, failed: 0, zotero: 0, needsPdf: 0, quota, items: [] };
  const report = progressReporter(onProgress);

  for (const [id] of pool) {
    const paper = (await readState(baseDir)).papers?.[id];
    if (!paper) continue;
    if (!paper.pdf) {
      stats.needsPdf += 1;
      await updateState(baseDir, (latest) => {
        const target = latest.papers?.[id];
        if (target) target.review_flags = [...new Set([...(target.review_flags || []), 'needs_pdf'])];
      });
      stats.items.push({ id, status: 'needs_pdf' });
      continue;
    }
    try {
      await report(id, '精读全文中');
      const textMeta = await ensurePdfText(baseDir, { ...paper, id });
      if (!textMeta) throw new Error('PDF 文本抽取为空');
      await deriveAbstract(baseDir, id, textMeta);
      const record = await analyzeL3(ctx, baseDir, config, { ...paper, id }, textMeta);
      await report(id, '写入结果中');
      const applied = await applyL3Record(baseDir, config, record);
      stats.processed += 1;
      if (applied.status === 'done') stats.done += 1;
      else if (applied.status === 'parked') stats.parked += 1;
      else if (applied.status === 'manual') stats.manual += 1;
      else stats.failed += 1;

      if (applied.status === 'done') {
        const latest = await readState(baseDir);
        const target = latest.papers?.[id];
        if (target && shouldAutoImport(config, target)) {
          try {
            const imported = await importPapers(baseDir, config, latest, [target], {});
            if (imported?.results?.[0]?.ok) stats.zotero += 1;
          } catch { /* 自动入库失败不回滚分析 */ }
        }
      }
      stats.items.push({
        id,
        status: applied.status,
        grade: record.output?.final_grade || null,
        confidence: record.confidence || null,
        error: record.error || null,
      });
    } catch (error) {
      stats.failed += 1;
      await updateState(baseDir, (latest) => {
        const target = latest.papers?.[id];
        if (target) target.review_flags = [...new Set([...(target.review_flags || []), 'analysis_failed'])];
      });
      stats.items.push({ id, status: 'failed', error: String(error?.message || error) });
    }
  }
  return stats;
}


// 分析串行化：同一进程内 L1/L2/L3 共用一把锁，且锁内重新读取状态。
// 这样定时与人工、双击两个入口不会同时选中同一批条目重复调用模型；
// 第二个人口进来时看到的已经是第一个人口推进后的状态。
/** 全文已抽到但没元数据摘要时，直接从正文补一条，避免界面显示「未获取摘要」。 */
async function deriveAbstract(baseDir, id, textMeta) {
  const derived = abstractFromText(textMeta?.text);
  if (!derived) return false;
  let wrote = false;
  await updateState(baseDir, (state) => {
    const target = state.papers?.[id];
    if (!target || String(target.abstract || '').trim()) return;
    target.abstract = derived;
    target.abstract_source = 'pdf';
    target.updated_at = new Date().toISOString();
    wrote = true;
  });
  return wrote;
}

export function analyzeCandidates(...args) {
  return withLock('analysis', () => analyzeCandidatesInner(...args));
}

export function analyzeL2Papers(...args) {
  return withLock('analysis', () => analyzeL2PapersInner(...args));
}

export function analyzeL3Papers(...args) {
  return withLock('analysis', () => analyzeL3PapersInner(...args));
}
