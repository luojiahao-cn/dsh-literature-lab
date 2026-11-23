import test from 'node:test';
import assert from 'node:assert/strict';

import { absorbCandidates, readCandidates } from '../lib/candidates.js';
import { applyL1Record, applyL2Record, applyL3Record } from '../lib/analysis-apply.js';
import { writeState } from '../lib/state.js';
import { analyzeCandidates } from '../lib/analysis-run.js';
import { readState, emptyState } from '../lib/state.js';
import { makeBase } from './helpers.mjs';

async function seed(base) {
  await absorbCandidates(base, { relevance: { keywords: [], minScore: 0 } }, [{
    title: 'Graph Protein Complex',
    doi: '10.1234/apply.1',
    abstract: 'A graph-based structure prediction method for protein complexes.',
  }], { source: 'test' });
  return 'doi:10.1234/apply.1';
}

function record(id, output, extra = {}) {
  return {
    run_id: 'run_test_1',
    paper_id: id,
    stage: 'L1',
    model: { provider: 'deepseek-account', model: 'deepseek-flash' },
    prompt_version: 'l1-v1',
    confidence: 'high',
    confidence_reasons: ['abstract-present', 'evidence-grounded:2'],
    output,
    validation: { ok: true },
    applied: false,
    error: null,
    finished_at: new Date().toISOString(),
    ...extra,
  };
}

const continueOutput = {
  verdict: 'continue', domain: 'core', use: 'method', grade: 'A',
  increment: '在动态干扰下提高了蛋白质复合物定位精度', reason: '直接相关',
};

test('analysis-apply：continue S/A/B 建论文 L2 并写等级', async () => {
  const base = await makeBase();
  const id = await seed(base);
  const result = await applyL1Record(base, { analysis: { lowConfidence: 'park' } }, record(id, continueOutput));
  assert.equal(result.status, 'admitted');
  const state = await readState(base);
  assert.equal(state.papers[id].stage, 'L2');
  assert.equal(state.papers[id].grade, 'A');
  assert.equal(state.papers[id].grade_source, 'ai');
  assert.equal(state.papers[id].l1.domain, 'core');
  assert.equal((await readCandidates(base))[id].status, 'admitted');
});

test('analysis-apply：hold → parked；低置信 continue → parked', async () => {
  const base = await makeBase();
  const id = await seed(base);
  const held = await applyL1Record(base, { analysis: { lowConfidence: 'park' } }, record(id, { ...continueOutput, verdict: 'hold' }));
  assert.equal(held.status, 'parked');
  assert.equal((await readState(base)).papers[id], undefined);

  const low = await applyL1Record(base, { analysis: { lowConfidence: 'park' } }, record(id, continueOutput, { confidence: 'low' }));
  assert.equal(low.status, 'parked');
});

test('analysis-apply：C/D → dropped；错误 → failed', async () => {
  const base = await makeBase();
  const id = await seed(base);
  const dropped = await applyL1Record(base, {}, record(id, { ...continueOutput, grade: 'C' }));
  assert.equal(dropped.status, 'dropped');

  const failed = await applyL1Record(base, {}, record(id, null, { error: '模型失败' }));
  assert.equal(failed.status, 'failed');
});


test('analysis-run：批量 L1 自动应用', async () => {
  const base = await makeBase();
  const id = await seed(base);
  const llm = {
    async listProviders() { return [{ id: 'deepseek-account' }]; },
    async listModels() { return [{ id: 'deepseek-flash' }]; },
    stream() {
      return (async function* stream() {
        yield { type: 'text-delta', text: JSON.stringify({
          verdict: 'continue', domain: 'core', use: 'method', grade: 'A',
          increment: '在动态干扰下提高了蛋白质复合物定位精度', reason: '直接相关', confidence: 'high',
          evidence: [{ source: 'abstract', quote: 'graph-based structure prediction method for protein complexes' }],
        }) };
        yield { type: 'finish', reason: { kind: 'stop' } };
      })();
    },
  };
  const ctx = { get: (name) => (name === 'llm' ? llm : undefined) };
  const stats = await analyzeCandidates(ctx, base, { analysis: { models: {}, maxTokens: { l1: 1000 }, lowConfidence: 'continue' } }, { limit: 1, sort: 'score' });
  assert.equal(stats.admitted, 1);
  assert.equal((await readState(base)).papers[id].grade, 'A');
  assert.equal((await readCandidates(base))[id].status, 'admitted');
});


test('analysis-apply：L2 close-read → L3，skim → done，低置信停车', async () => {
  const base = await makeBase();
  const state = emptyState();
  state.papers['doi:10.1234/l2.1'] = {
    title: 'L2 Paper', doi: '10.1234/l2.1', stage: 'L2', grade: 'A',
    grade_history: [], sources: [], pdf: 'pdfs/x.pdf',
  };
  await writeState(base, state);
  const l2 = (output, extra = {}) => record('doi:10.1234/l2.1', output, {
    stage: 'L2', validation: { ok: true }, ...extra,
  });
  const close = await applyL2Record(base, { analysis: { lowConfidence: 'park' } }, l2(
    {
      verdict: 'close-read', grade: 'A', confidence: 'high', reason: '结论给出实测抓取力，可作基线',
      evidence: [{ section: 'conclusion', page: 8, quote: 'x' }],
    },
  ));
  assert.equal(close.status, 'L3');
  const afterClose = (await readState(base)).papers['doi:10.1234/l2.1'];
  assert.equal(afterClose.stage, 'L3');
  assert.equal(afterClose.grade, 'A', 'L2 按初筛证据重评等级');
  assert.equal(afterClose.grade_basis, 'triage');
  assert.equal(afterClose.grade_history.at(-1).stage, 'L2');
  assert.equal(afterClose.grade_history.at(-1).basis, 'triage');

  await writeState(base, state);
  const skim = await applyL2Record(base, {}, l2({
    verdict: 'skim', grade: 'C', confidence: 'high', reason: '只有方法描述，没有结果',
  }));
  assert.equal(skim.status, 'done');
  assert.equal((await readState(base)).papers['doi:10.1234/l2.1'].grade, 'C', 'skim 也重评等级');

  await writeState(base, state);
  const conflicting = await applyL2Record(base, {}, l2({
    verdict: 'close-read', grade: 'D', confidence: 'high', reason: '自相矛盾的组合',
  }));
  const afterConflict = (await readState(base)).papers['doi:10.1234/l2.1'];
  assert.equal(conflicting.status, 'L3');
  assert.equal(afterConflict.grade, 'A', 'close-read 与 C/D 矛盾时不覆盖等级');

  await writeState(base, state);
  const low = await applyL2Record(base, { analysis: { lowConfidence: 'park' } }, l2(
    { verdict: 'close-read', confidence: 'low', reason: '不确定' }, { confidence: 'low' },
  ));
  assert.equal(low.status, 'parked');
});


test('analysis-apply：L3 写最终等级、卡片并进入 done', async () => {
  const base = await makeBase();
  const state = emptyState();
  state.papers['doi:10.1234/l3.1'] = {
    title: 'L3 Paper', doi: '10.1234/l3.1', stage: 'L3', grade: 'B',
    grade_history: [], sources: [], pdf: 'pdfs/x.pdf',
  };
  await writeState(base, state);
  const r = record('doi:10.1234/l3.1', {
    final_grade: 'A', confidence: 'high', abstract: '原文摘要逐字内容。', domain: 'core', use: 'method', summary: '总结', method: '方法',
    evidence_claims: [{ claim: '结论', quote: '原文', page: 3 }],
    limitations: ['局限'], reproduction: '复现', card_markdown: '# 卡片\n\n内容',
  }, { stage: 'L3', validation: { ok: true } });
  const applied = await applyL3Record(base, { analysis: { lowConfidence: 'park' } }, r);
  assert.equal(applied.status, 'done');
  const saved = await readState(base);
  assert.equal(saved.papers['doi:10.1234/l3.1'].stage, 'done');
  assert.equal(saved.papers['doi:10.1234/l3.1'].grade, 'A');
  assert.equal(saved.papers['doi:10.1234/l3.1'].l3.card_markdown, '# 卡片\n\n内容');
  // 原条目没有摘要时，用 L3 读到的原文摘要补上，避免界面显示「未获取摘要」
  assert.equal(saved.papers['doi:10.1234/l3.1'].abstract, '原文摘要逐字内容。');
  assert.equal(saved.papers['doi:10.1234/l3.1'].abstract_source, 'l3');
  // 手动添加的论文没有 L1，精读也要给出同口径的领域/用途
  assert.equal(saved.papers['doi:10.1234/l3.1'].l3.domain, 'core');
  assert.equal(saved.papers['doi:10.1234/l3.1'].l3.use, 'method');
  assert.ok(applied.card);
});


test('analysis-run：并发两个 L1 只调用一次模型', async () => {
  const base = await makeBase();
  await seed(base);
  let calls = 0;
  const llm = {
    async listProviders() { return [{ id: 'deepseek-account' }]; },
    async listModels() { return [{ id: 'deepseek-flash' }]; },
    stream() {
      calls += 1;
      return (async function* stream() {
        yield { type: 'text-delta', text: JSON.stringify({
          verdict: 'continue', domain: 'core', use: 'method', grade: 'A',
          increment: '在动态干扰下提高了蛋白质复合物定位精度', reason: '直接相关', confidence: 'high',
          evidence: [{ source: 'abstract', quote: 'graph-based structure prediction method for protein complexes' }],
        }) };
        yield { type: 'finish', reason: { kind: 'stop' } };
      })();
    },
  };
  const ctx = { get: (name) => (name === 'llm' ? llm : undefined) };
  const config = { analysis: { models: {}, maxTokens: { l1: 1000 }, lowConfidence: 'continue' } };
  const [a, b] = await Promise.all([
    analyzeCandidates(ctx, base, config, { limit: 5, sort: 'score' }),
    analyzeCandidates(ctx, base, config, { limit: 5, sort: 'score' }),
  ]);
  assert.equal(calls, 1, '并发只调用一次模型');
  assert.equal((a.requested || 0) + (b.requested || 0), 1);
});


test('analysis-apply：L2 失败不写 l2.at，不占当日额度', async () => {
  const base = await makeBase();
  const state = emptyState();
  state.papers['doi:10.1234/l2fail.1'] = {
    title: 'L2 Fail', doi: '10.1234/l2fail.1', stage: 'L2', grade: 'A',
    grade_history: [], sources: [], pdf: 'pdfs/x.pdf',
  };
  await writeState(base, state);
  const result = await applyL2Record(base, { analysis: { daily: { l2: 1 } } }, {
    run_id: 'run_l2_fail', paper_id: 'doi:10.1234/l2fail.1', stage: 'L2',
    error: 'model down', confidence: 'high',
  });
  assert.equal(result.status, 'failed');
  const paper = (await readState(base)).papers['doi:10.1234/l2fail.1'];
  assert.equal(paper.l2.at, null);
  assert.ok(paper.l2.failed_at);
  const { remainingQuota } = await import('../lib/analysis-quota.js');
  const quota = await remainingQuota(base, { analysis: { daily: { l2: 1 } } }, 'L2');
  assert.equal(quota.remaining, 1);
});


test('analysis-apply：L3 摘要复述式 why_read 用读者用途兜底', async () => {
  const base = await makeBase();
  const state = emptyState();
  state.papers['doi:10.1234/why.1'] = {
    title: 'Why Read Test', doi: '10.1234/why.1', stage: 'L3', grade: 'A',
    grade_history: [], sources: [],
    l1: { domain: 'core', use: 'method', increment: '把随机划分换成了结构化留出，能暴露跨区域退化' },
  };
  await writeState(base, state);
  const record = {
    run_id: 'run_why', paper_id: 'doi:10.1234/why.1', stage: 'L3', confidence: 'high',
    validation: { ok: true, warnings: ['why-read-summary-like', 'why-read-result-first'] },
    output: {
      final_grade: 'A', why_read: '随机划分下 magNET 达<1.5 mm、<1°，相对 ResMLP 提升约 10%。',
      summary: '随机划分下 magNET 达<1.5 mm、<1°，但结构化留出后退化。',
      card_markdown: '# Card', evidence_claims: [], limitations: [], reproduction: '',
    },
  };
  await applyL3Record(base, {}, record);
  const paper = (await readState(base)).papers['doi:10.1234/why.1'];
  assert.equal(paper.l3.why_read_source, 'fallback');
  assert.match(paper.l3.why_read, /^如果你在做相近方向/);
  assert.doesNotMatch(paper.l3.why_read, /magNET|ResMLP/);
});
