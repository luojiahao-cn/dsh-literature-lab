import test from 'node:test';
import assert from 'node:assert/strict';
import { assessWhyRead, validateL3Output } from '../lib/analysis.js';

const bad = '随机划分下 magNET 达<1.5 mm、<1°，但结构化留出后仅中央板 40–80 mm 内保持<2 mm/<2°，区域外退化；相对 ResMLP 位置提升约 10% 且不稳定。';
const summary = '随机划分下 magNET 达<1.5 mm、<1°，但结构化留出后仅中央板 40–80 mm 内保持<2 mm/<2°，区域外退化；相对 ResMLP 位置提升约 10% 且不稳定。';
const good = '如果你在做图推理的跨区域评测，这篇的结构化留出实验可以直接拿来设计 hold-out；读完能判断随机划分是否高估，并对比自己的基线。';

test('why_read：结果复述/摘要复读会被标出', () => {
  const warnings = assessWhyRead(bad, summary);
  assert.ok(warnings.includes('why-read-result-first'));
  assert.ok(warnings.includes('why-read-summary-like'));
});

test('why_read：读者用途式推荐通过', () => {
  assert.deepEqual(assessWhyRead(good, summary), []);
});

test('validateL3Output：把 why_read 质量纳入 warnings，不影响硬错误', () => {
  const out = {
    final_grade: 'A', confidence: 'high', why_read: bad, summary,
    card_markdown: '# Card', evidence_claims: [{ claim: 'x', quote: '这一段是原文里确实存在的证据', page: 1 }],
  };
  const result = validateL3Output(out, '这一段是原文里确实存在的证据');
  assert.ok(result.warnings.includes('why-read-summary-like'));
});
