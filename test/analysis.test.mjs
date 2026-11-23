import test from 'node:test';
import assert from 'node:assert/strict';

import {
  inputHash, normalizeL1Output, validateL1Output, assessL1Confidence,
  applyGradePolicy, analyzeL1, readCurrentAnalysis, l3Source, normalizeL3Output,
} from '../lib/analysis.js';
import { makeBase } from './helpers.mjs';

const abstract = 'This paper introduces a graph-based structure prediction method for protein complexes with a new calibration scheme. ' +
  'Experiments show improved accuracy under dynamic disturbances. '.repeat(5);

function fakeCtx(json) {
  const llm = {
    async listProviders() { return [{ id: 'deepseek-account' }]; },
    async listModels() { return [{ id: 'deepseek-flash' }]; },
    stream() {
      return (async function* stream() {
        yield { type: 'text-delta', text: JSON.stringify(json) };
        yield { type: 'finish', reason: { kind: 'stop' } };
      })();
    },
  };
  return { get: (name) => (name === 'llm' ? llm : undefined) };
}

test('analysis：输入 hash 稳定且随内容变化', () => {
  const a = inputHash({ title: 'A', abstract: 'x' }, 'L1');
  const b = inputHash({ title: 'A', abstract: 'x' }, 'L1');
  const c = inputHash({ title: 'A', abstract: 'y' }, 'L1');
  assert.equal(a, b);
  assert.notEqual(a, c);
});

test('analysis：L1 校验与等级策略', () => {
  const output = normalizeL1Output({
    verdict: 'continue', domain: 'core', use: 'method', grade: 'A',
    increment: '在动态干扰下提高了蛋白质复合物定位精度', reason: '方法直接相关',
    confidence: 0.9,
    evidence: [{ source: 'abstract', quote: 'graph-based structure prediction method for protein complexes' }],
  });
  const validation = validateL1Output(output, { title: 'Protein', abstract });
  assert.equal(validation.ok, true);
  assert.equal(validation.grounded, 1);
  assert.equal(validation.grade_admissible, true);

  const c = normalizeL1Output({ verdict: 'continue', domain: 'edge', use: 'citation', grade: 'C', increment: '有一定参考价值', reason: '边缘' });
  assert.equal(applyGradePolicy(c, {}).verdict, 'drop');
  assert.equal(applyGradePolicy(c, { analysis: { lowGrade: 'park' } }).verdict, 'hold');
});

test('analysis：置信度由输入、证据与校验决定', () => {
  const output = normalizeL1Output({
    verdict: 'continue', domain: 'core', use: 'method', grade: 'A',
    increment: '在动态干扰下提高了蛋白质复合物定位精度', reason: '方法直接相关',
    confidence: 0.9,
    evidence: [
      { source: 'abstract', quote: 'graph-based structure prediction method for protein complexes' },
      { source: 'abstract', quote: 'new calibration scheme' },
    ],
  });
  const validation = validateL1Output(output, { title: 'Protein', abstract });
  const high = assessL1Confidence({ output, validation, abstract });
  assert.equal(high.level, 'high');
  assert.ok(high.reasons.includes('evidence-grounded:2'));

  const hyphen = normalizeL1Output({
    verdict: 'continue', domain: 'core', use: 'method', grade: 'A',
    increment: '在动态干扰下提高了蛋白质复合物定位精度', reason: '方法直接相关',
    confidence: 'high',
    evidence: [{ source: 'abstract', quote: 'com-parisons with original implementations' }],
  });
  const hyphenCheck = validateL1Output(hyphen, { title: '', abstract: 'comparisons with original implementations' });
  assert.equal(hyphenCheck.grounded, 1, 'PDF 断词不影响证据落地');

  const low = assessL1Confidence({ output, validation, abstract: '' });
  assert.equal(low.level, 'low');
  assert.ok(low.reasons.includes('no-abstract'));
});

test('analysis：L1 调用、落盘与当前记录', async () => {
  const base = await makeBase();
  const item = {
    id: 'doi:10.1234/analysis.1',
    title: 'Graph complex models',
    abstract,
    doi: '10.1234/analysis.1',
  };
  const record = await analyzeL1(fakeCtx({
    verdict: 'continue', domain: 'core', use: 'method', grade: 'A',
    increment: '在动态干扰下提高了蛋白质复合物定位精度', reason: '方法直接相关',
    confidence: 'high',
    evidence: [
      { source: 'abstract', quote: 'graph-based structure prediction method for protein complexes' },
      { source: 'abstract', quote: 'new calibration scheme' },
    ],
  }), base, { analysis: { models: {}, maxTokens: { l1: 1000 } } }, item);

  assert.equal(record.output.grade, 'A');
  assert.equal(record.confidence, 'high');
  assert.equal(record.applied, false);
  const current = await readCurrentAnalysis(base, item.id);
  assert.equal(current.run_id, record.run_id);
  assert.equal(current.output.verdict, 'continue');
});


test('L3 输入：常见论文整篇喂入，不抽样', () => {
  const full = `${'[Page 1] Results 250 um accuracy. '.repeat(2500)}`;
  assert.ok(full.length > 60000, '构造 6 万字符的论文');
  assert.equal(l3Source(full, {}), full, '6 万字符必须原样全文');
});

test('L3 输入：只有超长综述才抽样，仍保留结果与结论', () => {
  const body = Array.from({ length: 2500 }, (_, i) => `Paragraph ${i} about magnetic localization with 250 um accuracy result.`).join(' ');
  const text = `[Page 1] Introduction ${body} [Page 9] Results Fig. 6 DSA trajectory alignment [Page 16] Conclusion done.`;
  assert.ok(text.length > 150000, '构造超长文本');
  const out = l3Source(text, {});
  assert.ok(out.length > 40000, '长论文应给出至少 4 万字符的输入');
  assert.ok(out.includes('DSA'), '正文中段的结果描述要进输入');
  assert.ok(out.includes('Conclusion'), '结论段要进输入');
  assert.ok(out.includes('250 um'), '图注/正文里的硬数字要能在输入里找到');
});

test('L3 输入：预算内的论文直接给全文', () => {
  const text = '[Page 1] short paper';
  assert.equal(l3Source(text, {}), text);
});


test('L3 输出：带出领域与用途，取值非法时置空', () => {
  const ok = normalizeL3Output({ final_grade: 'A', confidence: 'high', domain: 'core', use: 'method' });
  assert.equal(ok.domain, 'core');
  assert.equal(ok.use, 'method');
  const bad = normalizeL3Output({ final_grade: 'A', confidence: 'high', domain: '核心', use: 'METHOD' });
  assert.equal(bad.domain, null);
  assert.equal(bad.use, 'method');
});
