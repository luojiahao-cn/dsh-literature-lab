/** 每日摘要：资格 / 分组 / 排序 / 边界 / 空态。 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDigest } from '../lib/digest.js';

const DAY = '2026-11-21';

function paper(overrides = {}) {
  return {
    stage: 'L2', grade: 'A', first_seen: DAY, sources: ['arxiv'],
    title: '', abstract: '', meta: { venue: 'Test', year: 2026 },
    l1: { domain: 'core', increment: '有点新东西', use: 'method' },
    ...overrides,
  };
}

const config = { relevance: { keywords: ['图特征', 'funnel'] } };

function state(papers) {
  const map = {};
  for (const [id, p] of Object.entries(papers)) map[id] = p;
  return { papers: map };
}

test('摘要：按关注词分组，命中的进对应组', () => {
  const digest = buildDigest(state({
    a: paper({ title: '图特征标定方法', grade: 'S' }),
    b: paper({ title: 'A funnel control scheme' }),
    c: paper({ title: '无关题目' }),
  }), config, { date: DAY });
  assert.deepEqual(digest.groups.map((g) => g.keyword).sort(), ['funnel', '图特征'].sort());
  assert.equal(digest.groups[0].items.length, 1);
  assert.equal(digest.others.length, 1);
  assert.equal(digest.others[0].title, '无关题目');
});

test('摘要：只收 S/A，B 级默认排除', () => {
  const digest = buildDigest(state({
    a: paper({ title: '图特征 B 级', grade: 'B' }),
    b: paper({ title: '图特征 C 级', grade: 'C' }),
  }), config, { date: DAY });
  assert.equal(digest.stats.graded, 0);
  assert.equal(digest.groups.length, 0);
});

test('摘要：includeB 打开后 B 级进入', () => {
  const digest = buildDigest(state({ a: paper({ title: '图特征 B 级', grade: 'B' }) }), {
    ...config, digest: { includeB: true },
  }, { date: DAY });
  assert.equal(digest.stats.graded, 1);
  assert.equal(digest.groups[0].items[0].grade, 'B');
});

test('摘要：当天才判完的也算今天（边界）', () => {
  const digest = buildDigest(state({
    a: paper({ title: '图特征旧文', first_seen: '2026-11-01', l2: { at: '2026-11-21T02:00:00Z' } }),
    b: paper({ title: '图特征前天的', first_seen: '2026-11-01', l2: { at: '2026-11-19T02:00:00Z' } }),
  }), config, { date: DAY });
  assert.equal(digest.stats.graded, 1);
  assert.equal(digest.groups[0].items[0].title, '图特征旧文');
});

test('摘要：每组最多 N 条，组内 S 在 A 前', () => {
  const digest = buildDigest(state({
    a: paper({ title: '图特征 A 一', grade: 'A' }),
    b: paper({ title: '图特征 S 一', grade: 'S' }),
    c: paper({ title: '图特征 A 二', grade: 'A' }),
  }), { ...config, digest: { maxPerGroup: 2 } }, { date: DAY });
  assert.equal(digest.groups[0].total, 3);
  assert.equal(digest.groups[0].items.length, 2);
  assert.equal(digest.groups[0].items[0].grade, 'S');
});

test('摘要：没有内容时 groups 与 others 都是空的', () => {
  const digest = buildDigest(state({ a: paper({ title: '题目', first_seen: '2026-11-01' }) }), config, { date: DAY });
  assert.deepEqual(digest.groups, []);
  assert.deepEqual(digest.others, []);
  assert.equal(digest.stats.graded, 0);
});

test('摘要：没配关注词时全部进「其他」，不被丢弃', () => {
  const digest = buildDigest(state({ a: paper({ title: '任意题目', grade: 'S' }) }), { relevance: {} }, { date: DAY });
  assert.equal(digest.groups.length, 0);
  assert.equal(digest.others.length, 1);
});
