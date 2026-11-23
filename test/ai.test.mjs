/**
 * AI 关键词建议：提示词构造、输出清洗、流式调用。
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { buildPrompt, normalizeSuggestion, suggestKeywords } from '../lib/ai.js';

const profile = {
  library: { total: 100, cached: 80 },
  topTags: [{ tag: 'graph representation', count: 12 }, { tag: 'calibration', count: 5 }],
  terms: {
    unigrams: [{ term: 'graph', df: 30 }, { term: 'localization', df: 20 }],
    bigrams: [{ term: 'graph-based structure prediction', df: 10 }],
  },
  collections: [{ name: 'Sensing', count: 10 }, { name: 'Empty', count: 0 }],
  sample: [{ title: 'Paper A', abstract: 'Abstract A' }],
};

function fakeLlm(text, finish = { kind: 'stop' }) {
  return {
    stream: async function* stream() {
      yield { type: 'text-delta', index: 0, text };
      yield { type: 'finish', reason: finish };
    },
  };
}

test('ai：提示词包含统计与样本', () => {
  const prompt = buildPrompt(profile);
  assert.ok(prompt.includes('graph representation (12)'));
  assert.ok(prompt.includes('graph-based structure prediction (10)'));
  assert.ok(prompt.includes('Sensing:10'));
  assert.ok(prompt.includes('Paper A'));
  assert.ok(!prompt.includes('Empty'), '空分类不出现');
});

test('ai：解析 JSON、去重、丢弃非法正则、限长', () => {
  const raw = `\`\`\`json
  {"keywords":["Graph-Based Structure Prediction","graph-based structure prediction","[bad(","graph tracking","x","y","z","a","b","c","d","e","f","g"],
   "contextKeywords":["calibration","calibration"],
   "excludeKeywords":["erratum"],
   "reason":"依据图推理 bigram"}
  \`\`\``;
  const suggestion = normalizeSuggestion(raw);
  assert.equal(suggestion.keywords[0], 'graph-based structure prediction');
  assert.equal(suggestion.keywords.length, 12, '最多 12 条');
  assert.ok(!suggestion.keywords.includes('[bad('), '非法正则被丢弃');
  assert.deepEqual(suggestion.contextKeywords, ['calibration']);
  assert.deepEqual(suggestion.excludeKeywords, ['erratum']);
  assert.equal(suggestion.reason, '依据图推理 bigram');
});

test('ai：模型输出没有 JSON / 关键词太少时报错', () => {
  assert.throws(() => normalizeSuggestion('我觉得应该用 graph'), /没有返回 JSON/);
  assert.throws(() => normalizeSuggestion('{"keywords":["a"]}'), /核心关键词太少/);
});

test('ai：流式调用并返回建议', async () => {
  const llm = fakeLlm('{"keywords":["graph-based structure prediction","graph tracking","protein complex"],"contextKeywords":["calibration"],"excludeKeywords":[],"reason":"ok"}');
  const suggestion = await suggestKeywords({ llm, provider: 'p', model: 'm', profile });
  assert.equal(suggestion.keywords.length, 3);
  assert.equal(suggestion.reason, 'ok');
});

test('ai：模型报错时抛出', async () => {
  const llm = fakeLlm('', { kind: 'error', failure: { message: 'quota exceeded' } });
  await assert.rejects(() => suggestKeywords({ llm, provider: 'p', model: 'm', profile }), /quota exceeded/);
  await assert.rejects(() => suggestKeywords({ llm: null, provider: 'p', model: 'm', profile }), /LLM 服务不可用/);
});
