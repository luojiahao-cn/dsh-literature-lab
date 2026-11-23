/**
 * 把 L1 分析记录应用到候选状态 / 论文队列。
 *
 * 规则：
 * - continue + S/A/B → 建论文 L1，写等级与三问；
 * - hold / 低置信 park → 候选 parked；
 * - drop / C-D → 候选 dropped；
 * - 分析失败 → failed，不覆盖已有论文。
 *
 * 人工写入优先：如果论文已经有 manual_override，这里不覆盖。
 */
import { mkdir, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
import * as store from './store.js';
import { readCandidates, updateCandidates } from './candidates.js';
import { readState, updateState, updateStateAndSeen, today } from './state.js';
import { checkGradeDomain } from './judge.js';
import { readerOrientedWhy } from './analysis.js';
import { extractFigures } from './figures.js';

const WHY_READ_BAD = new Set([
  'why-read-result-first', 'why-read-summary-like', 'why-read-not-reader-oriented', 'why-read-too-short',
]);

function localDay(iso) {
  const time = Date.parse(iso || '');
  return Number.isFinite(time) ? new Date(time + 8 * 3600 * 1000).toISOString().slice(0, 10) : null;
}

/** 分析成功走完一层后，旧标记不再成立：缺原文/抽取失败/低置信/分析失败一起清掉。 */
const ANALYSIS_SUCCESS_CLEARS = ['needs_pdf', 'pdf_error', 'low_confidence', 'analysis_failed'];

/** 成功应用（含低置信停车）说明原文读到了、分析跑通了，只留本次要保留的那一个标记。 */
const ANALYSIS_PARTIAL_CLEARS = ['needs_pdf', 'pdf_error', 'analysis_failed'];

function clearReviewFlags(target, flags) {
  if (!Array.isArray(target?.review_flags) || !target.review_flags.length) return;
  target.review_flags = target.review_flags.filter((flag) => !flags.includes(flag));
}

function candidateSummary(record) {
  return {
    run_id: record.run_id,
    stage: 'L1',
    model: record.model,
    prompt_version: record.prompt_version,
    verdict: record.output?.verdict || null,
    grade: record.output?.grade || null,
    confidence: record.confidence || null,
    confidence_reasons: record.confidence_reasons || [],
    reason: record.output?.reason || null,
    error: record.error || null,
    at: record.finished_at || new Date().toISOString(),
    usage: record.usage || null,
  };
}

async function admitPaper(baseDir, candidate, record) {
  const output = record.output;
  return updateStateAndSeen(baseDir, (state, seen) => {
    if (state.papers?.[candidate.id]) {
      return { created: false, overridden: Boolean(state.papers[candidate.id].manual_override) };
    }
    const now = new Date().toISOString();
    const paper = {
      title: candidate.title || '',
      doi: candidate.doi || null,
      arxiv_id: candidate.arxiv_id || null,
      url: candidate.url || null,
      first_seen: today(),
      last_seen: today(),
      published_at: candidate.year ? `${candidate.year}-01-01` : null,
      sources: candidate.sources || ['candidate'],
      summary: candidate.abstract ? String(candidate.abstract).slice(0, 1000) : null,
      abstract: candidate.abstract || null,
      abstract_lookup: candidate.abstract
        ? { at: now, matched: true, has_abstract: true, via: 'candidate', reason: null }
        : null,
      meta: {
        venue: candidate.venue || null,
        year: candidate.year || null,
        source: 'candidate',
      },
      relevance: candidate.t0
        ? { score: candidate.t0.score, hits: candidate.t0.hits || [] }
        : null,
      stage: 'L2',
      grade: output.grade,
      grade_source: 'ai',
      grade_basis: 'abstract',
      verification: record.verification || null,
      verification_note: record.verification_note || null,
      grade_history: [{
        stage: 'L1',
        grade: output.grade,
        reason: output.reason || '',
        basis: 'abstract',
        at: now,
        l1: {
          domain: output.domain,
          increment: output.increment,
          use: output.use,
        },
      }],
      l1: {
        domain: output.domain,
        increment: output.increment,
        use: output.use,
        note: '',
        at: now,
      },
      analysis_ref: record.run_id,
      candidate_id: candidate.id,
      priority: false,
    };
    state.papers[candidate.id] = paper;
    seen[candidate.id] = {
      t: now,
      s: 'analysis',
      title: paper.title,
      a: 1,
      score: candidate.t0?.score ?? null,
    };
    return { created: true, overridden: false };
  });
}

/**
 * @param {object} config
 * @param {object} record analyzeL1 返回的记录
 */
export async function applyL1Record(baseDir, config, record) {
  const candidates = await readCandidates(baseDir);
  const candidate = candidates[record.paper_id];
  if (!candidate) return { ok: false, status: 'missing', paper_id: record.paper_id };

  let status;
  let admit = null;
  if (record.error || !record.output || record.validation?.ok === false) {
    status = 'failed';
  } else {
    let verdict = record.output.verdict;
    if (record.confidence === 'low') {
      const policy = config?.analysis?.lowConfidence || 'park';
      if (policy === 'park' && verdict === 'continue') verdict = 'hold';
      if (policy === 'drop' && verdict === 'continue') verdict = 'drop';
    }

    if (verdict === 'continue') {
      if (!['S', 'A', 'B'].includes(record.output.grade)) {
        status = 'dropped';
      } else {
        admit = await admitPaper(baseDir, candidate, record);
        status = 'admitted';
      }
    } else if (verdict === 'hold') {
      status = 'parked';
    } else {
      status = 'dropped';
    }
  }

  await updateCandidates(baseDir, (items) => {
    if (items[candidate.id]) {
      items[candidate.id].status = status;
      items[candidate.id].analysis = candidateSummary(record);
      items[candidate.id].analysis_at = record.finished_at || new Date().toISOString();
    }
    return items;
  });

  return {
    ok: status !== 'failed',
    status,
    paper_id: candidate.id,
    admitted: Boolean(admit?.created),
    overridden: Boolean(admit?.overridden),
  };
}

/** 今天的 L1 成功应用数（用于额度展示）。 */
export async function appliedToday(baseDir) {
  const candidates = Object.values(await readCandidates(baseDir));
  const day = today();
  return candidates.filter((item) => item.analysis_at && localDay(item.analysis_at) === day).length;
}


/** 应用 L2 分诊：close-read → L3；skim/skip → done；低置信按策略停在 L2。 */
export async function applyL2Record(baseDir, config, record) {
  const state = await readState(baseDir);
  const paper = state.papers?.[record.paper_id];
  if (!paper) return { ok: false, status: 'missing', paper_id: record.paper_id };
  if (paper.manual_override) return { ok: false, status: 'manual', paper_id: record.paper_id };

  let status = 'failed';
  if (!record.error && record.output && record.validation?.ok !== false) {
    let verdict = record.output.verdict;
    if (record.confidence === 'low' && config?.analysis?.lowConfidence === 'park' && verdict === 'close-read') {
      verdict = 'park';
    }
    if (verdict === 'close-read') status = 'L3';
    else if (verdict === 'park') status = 'parked';
    else status = 'done';
  }

  const now = new Date().toISOString();
  await updateState(baseDir, (latest) => {
    const target = latest.papers?.[record.paper_id];
    if (!target) return;
    target.l2 = {
      verdict: record.output?.verdict || null,
      confidence: record.confidence || null,
      confidence_reasons: record.confidence_reasons || [],
      reason: record.output?.reason || null,
      usage: record.usage || null,
      // 失败不写 at：额度按 at 统计，失败占用额度会让重试被误判为已用。
      at: status === 'failed' ? null : (record.finished_at || now),
      failed_at: status === 'failed' ? now : null,
      run_id: record.run_id,
    };
    target.analysis_ref = record.run_id;
    target.analysis_l2 = target.l2;
    target.updated_at = new Date().toISOString();
    // L2 用引言末段/结论/图注重评等级；与 L1 同域性不冲突才写入，依据记为「初筛」。
    const regrade = status === 'failed' ? null : record.output?.grade || null;
    const domainOk = !regrade || !target.l1?.domain || checkGradeDomain(regrade, target.l1.domain).ok;
    // close-read 与 C/D 自相矛盾时不落等级，等人工处理
    const contradictory = record.output?.verdict === 'close-read' && ['C', 'D'].includes(regrade);
    if (regrade && domainOk && !contradictory) {
      target.grade = regrade;
      target.grade_source = 'ai';
      target.grade_basis = 'triage';
      target.grade_history = [...(target.grade_history || []), {
        stage: 'L2',
        grade: regrade,
        reason: record.output?.reason || '',
        basis: 'triage',
        at: now,
        l1: target.l1 || null,
      }];
    }
    if (status === 'L3') {
      target.stage = 'L3';
      clearReviewFlags(target, ANALYSIS_SUCCESS_CLEARS);
    } else if (status === 'done') {
      target.stage = 'done';
      clearReviewFlags(target, ANALYSIS_SUCCESS_CLEARS);
    } else if (status === 'parked') {
      target.stage = 'L2';
      clearReviewFlags(target, ANALYSIS_PARTIAL_CLEARS);
      target.review_flags = [...new Set([...(target.review_flags || []), 'low_confidence'])];
    } else {
      target.review_flags = [...new Set([...(target.review_flags || []), 'analysis_failed'])];
    }
  });
  return { ok: status !== 'failed', status, paper_id: record.paper_id };
}


/** 应用 L3：写最终等级、全文分析、Markdown 卡片，进入 done。 */
export async function applyL3Record(baseDir, config, record) {
  const state = await readState(baseDir);
  const paper = state.papers?.[record.paper_id];
  if (!paper) return { ok: false, status: 'missing', paper_id: record.paper_id };
  if (paper.manual_override) return { ok: false, status: 'manual', paper_id: record.paper_id };

  const failed = Boolean(record.error || !record.output || record.validation?.ok === false);
  const low = record.confidence === 'low' && config?.analysis?.lowConfidence === 'park';
  const status = failed ? 'failed' : low ? 'parked' : 'done';
  const figures = failed
    ? []
    : await extractFigures(
      baseDir,
      paper,
      [...(record.output?.figures || [])].sort((a, b) => (Number(a?.rank) || 99) - (Number(b?.rank) || 99)),
      record.paper_id,
    ).catch(() => []);

  let cardPath = null;
  if (!failed && record.output?.card_markdown) {
    const safe = String(record.paper_id).replace(/[^a-zA-Z0-9._-]+/g, '_');
    const dir = store.statePaths(baseDir).cards;
    await mkdir(dir, { recursive: true });
    const file = path.join(dir, `${safe}.md`);
    const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(tmp, record.output.card_markdown, 'utf8');
    await rename(tmp, file);
    cardPath = path.relative(baseDir, file).split(path.sep).join('/');
  }

  await updateState(baseDir, (latest) => {
    const target = latest.papers?.[record.paper_id];
    if (!target) return;
    const now = new Date().toISOString();
    target.analysis_ref = record.run_id;
    target.updated_at = now;
    if (failed) {
      target.review_flags = [...new Set([...(target.review_flags || []), 'analysis_failed'])];
      return;
    }
    const whyWarnings = (record.validation?.warnings || []).filter((warning) => WHY_READ_BAD.has(warning));
    const whyRead = whyWarnings.length
      ? readerOrientedWhy(target, record.output)
      : (record.output.why_read || '');
    target.l3 = {
      final_grade: record.output.final_grade,
      confidence: record.confidence,
      domain: record.output.domain || null,
      use: record.output.use || null,
      why_read: whyRead,
      why_read_source: whyWarnings.length ? 'fallback' : 'model',
      why_read_warnings: whyWarnings,
      figures,
      figure_count: figures.length,
      summary: record.output.summary,
      method: record.output.method,
      evidence_claims: record.output.evidence_claims,
      limitations: record.output.limitations,
      reproduction: record.output.reproduction,
      card_markdown: record.output.card_markdown,
      card_path: cardPath,
      usage: record.usage || null,
      at: now,
      run_id: record.run_id,
    };
    if (!String(target.abstract || '').trim() && String(record.output.abstract || '').trim()) {
      target.abstract = String(record.output.abstract).trim();
      target.abstract_source = 'l3';
    }
    target.grade = record.output.final_grade;
    target.grade_source = 'ai';
    target.grade_basis = 'fulltext';
    target.grade_history = [...(target.grade_history || []), {
      stage: 'L3',
      grade: record.output.final_grade,
      reason: record.output.summary || record.output.method || '',
      basis: 'fulltext',
      at: now,
      l1: target.l1 || null,
    }];
    if (status === 'done') {
      target.stage = 'done';
      clearReviewFlags(target, ANALYSIS_SUCCESS_CLEARS);
    } else if (status === 'parked') {
      target.stage = 'L3';
      clearReviewFlags(target, ANALYSIS_PARTIAL_CLEARS);
      target.review_flags = [...new Set([...(target.review_flags || []), 'low_confidence'])];
    }
  });
  return { ok: status !== 'failed', status, paper_id: record.paper_id, card: cardPath };
}
