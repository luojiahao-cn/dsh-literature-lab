import test from 'node:test';
import assert from 'node:assert/strict';
import { scorePaper, interestQueryTerms } from '../lib/config.js';
import { buildPrompt, calibrateThreshold } from '../lib/ai.js';

test('兴趣评分：关键词 + 期刊 + 作者 + 标签/MeSH', () => {
  const item = {
    title: 'Graph-based structure prediction for protein complexes',
    summary: 'A graph representation method.',
    venue: 'IEEE Transactions on Mechatronics',
    authors: ['Sarthak Misra', 'A. Author'],
    categories: ['cs.RO'],
    mesh: ['Image Retrieval'],
    publishedAt: new Date().toISOString(),
  };
  const result = scorePaper(item, {
    relevance: {
      keywords: ['graph'],
      contextKeywords: [],
      excludeKeywords: [],
      venues: ['mechatronics'],
      authors: ['Sarthak Misra'],
      categories: ['cs.RO'],
      mesh: ['Image Retrieval'],
      recencyDays: 30,
      weights: { keyword: 3, context: 1, venue: 4, author: 3, category: 2, mesh: 2, recency: 1 },
    },
  });
  assert.equal(result.score, 15);
  assert.equal(result.filtered, true);
  assert.equal(result.excluded, false);
  assert.deepEqual(result.signals, {
    keyword: 1, context: 0, venue: 1, author: 1, category: 1, mesh: 1, recency: 1,
  });
  assert.ok(result.hits.includes('venue:mechatronics'));
  assert.ok(result.hits.includes('author:Sarthak Misra'));
});

test('兴趣评分：空配置不绑定方向，全部放行', () => {
  const result = scorePaper({ title: 'Anything' }, { relevance: {} });
  assert.equal(result.score, 0);
  assert.equal(result.filtered, false);
  assert.equal(result.excluded, false);
});

test('兴趣评分：排除词优先', () => {
  const result = scorePaper({ title: 'A survey of graph models' }, {
    relevance: { keywords: ['graph'], excludeKeywords: ['survey'] },
  });
  assert.equal(result.excluded, true);
  assert.deepEqual(result.excludeHits, ['survey']);
});


test('兴趣词导出：跳过正则样式，保留纯文本给数据库', () => {
  const terms = interestQueryTerms({
    relevance: {
      keywords: ['graph-based structure prediction', 'graph locali[sz]ation', 'protein endoscop(y|e)', 'pose estimation'],
      contextKeywords: ['calibration'],
    },
  }, 8);
  assert.deepEqual(terms, ['graph-based structure prediction', 'pose estimation', 'calibration']);
});

test('calibrateThreshold：阈值取能覆盖目标比例的分数', () => {
  const relevance = { keywords: ['graph'], contextKeywords: [], excludeKeywords: [] };
  const items = [
    { title: 'graph navigation for protein targets' },
    { title: 'graph tracking of a protein' },
    { title: 'graph baseline model control' },
    { title: 'some unrelated paper about wound healing' },
  ];
  const out = calibrateThreshold(items, relevance, { target: 0.7 });
  assert.equal(out.items, 4);
  assert.equal(out.minScore, 3);
  assert.ok(out.coverage >= 0.7);
  assert.ok(out.coverage < 1);
  assert.ok(out.uncovered.length >= 1);
});

test('buildPrompt：带覆盖反馈时附上漏掉的库内论文', () => {
  const prompt = buildPrompt({ library: { total: 10 }, sample: [] }, { uncovered: ['A graph navigation system'] });
  assert.match(prompt, /上一轮的词漏掉了这些库内论文/);
  assert.match(prompt, /A graph navigation system/);
});
