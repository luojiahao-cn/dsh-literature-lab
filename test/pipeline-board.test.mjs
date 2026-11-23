/**
 * 队列口径纯函数测试：一条只落一行一组、表与两框守恒、优先级与额度文案。
 *
 * 这些函数在 client.js 的 factory 里，通过模块对象的 board 退出（test-only seam），
 * 不渲染组件即可验收口径。改动任何分类规则先改这里。
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import assert from 'node:assert/strict';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const NOW = Date.parse('2026-11-22T08:00:00+08:00');

const ReactStub = {
  createElement: () => null,
  useState: (init) => [typeof init === 'function' ? init() : init, () => {}],
  useEffect: () => {},
  useCallback: (fn) => fn,
  useMemo: (fn) => fn(),
  useRef: (value) => ({ current: value }),
};
class Component {
  constructor(props) { this.props = props; this.state = {}; }
  setState() {}
}
Component.prototype.isReactComponent = {};
ReactStub.Component = Component;

let mod = null;
globalThis.window = {
  __ModuleLoader__: {
    load({ factory }) {
      mod = factory((name) => {
        if (name === 'react') return ReactStub;
        throw new Error(`unexpected require: ${name}`);
      });
    },
  },
};

const src = await readFile(path.join(ROOT, 'client.js'), 'utf8');
new Function('window', src)(globalThis.window);

const board = mod?.board;
assert.ok(board, '模块导出 board（测试用口径出口）');
const {
  classifyQueueEntry, pipelineBoard, formatQuota, nextRunLabel, sortHumanEntries, sortAiEntries,
} = board;

const paper = (patch) => ({
  id: patch.id || `paper:${Math.random()}`,
  title: patch.title || 'Paper',
  stage: patch.stage || 'L2',
  review_flags: patch.review_flags || [],
  has_pdf: patch.has_pdf !== false,
  first_seen: '2026-11-20',
  ...patch,
});
const candidate = (patch) => ({
  id: patch.id || `cand:${Math.random()}`,
  title: patch.title || 'Candidate',
  status: patch.status || 'new',
  abstract: patch.abstract === undefined ? 'An abstract.' : patch.abstract,
  t0: { score: 80 },
  ...patch,
});

// ── 单条分类 ────────────────────────────────────────────────
test('候选：新条目进 AI，缺摘要进人工且主按钮是补摘要', () => {
  const clean = classifyQueueEntry({ kind: 'candidate', item: candidate({}) }, NOW);
  assert.equal(clean.row, 'new');
  assert.equal(clean.side, 'ai');
  assert.equal(clean.group, null);

  const noAbstract = classifyQueueEntry({ kind: 'candidate', item: candidate({ abstract: '' }) }, NOW);
  assert.equal(noAbstract.group, 'material');
  assert.equal(noAbstract.side, 'human');
  assert.equal(noAbstract.primary, '补全摘要');
});

test('候选：有摘要就不算材料不全（过期的 abstract-short 不作数）', () => {
  const short = classifyQueueEntry({
    kind: 'candidate',
    item: candidate({ status: 'parked', analysis: { confidence_reasons: ['abstract-short'] } }),
  }, NOW);
  assert.equal(short.group, 'confirm', '有摘要的停在待确认，不回材料不全');
  const noAbstract = classifyQueueEntry({ kind: 'candidate', item: candidate({ abstract: '   ' }) }, NOW);
  assert.equal(noAbstract.group, 'material', '空白摘要才算材料不全');
  const failed = classifyQueueEntry({ kind: 'candidate', item: candidate({ status: 'failed' }) }, NOW);
  assert.equal(failed.row, 'new');
  assert.equal(failed.group, 'failed');
  assert.equal(failed.primary, '重试判读');
});

test('候选：待确认进「待确认」行，主按钮是加入初筛', () => {
  const parked = classifyQueueEntry({ kind: 'candidate', item: candidate({ status: 'parked' }) }, NOW);
  assert.equal(parked.row, 'confirm');
  assert.equal(parked.group, 'confirm');
  assert.equal(parked.primary, '加入初筛');
});

test('候选：已加入初筛与被丢弃不进入队列', () => {
  for (const status of ['admitted', 'promoted', 'dropped', 'filtered', 'excluded', 'owned']) {
    assert.equal(classifyQueueEntry({ kind: 'candidate', item: candidate({ status }) }, NOW), null, status);
  }
});

test('论文：旧版阶段单列一行一组，主按钮进入初筛', () => {
  const legacy = classifyQueueEntry({ kind: 'paper', item: paper({ stage: 'L1' }) }, NOW);
  assert.equal(legacy.row, 'legacy');
  assert.equal(legacy.group, 'legacy');
  assert.equal(legacy.primary, '进入初筛');
});

test('论文：材料优先于失败与低置信，且只进一个组', () => {
  const blocked = classifyQueueEntry({
    kind: 'paper',
    item: paper({ stage: 'L3', review_flags: ['needs_pdf', 'low_confidence', 'analysis_failed'] }),
  }, NOW);
  assert.equal(blocked.row, 'l3');
  assert.equal(blocked.group, 'material');
  assert.equal(blocked.side, 'human');
  assert.equal(blocked.primary, '补 PDF');

  const broken = classifyQueueEntry({ kind: 'paper', item: paper({ stage: 'L2', review_flags: ['pdf_error'] }) }, NOW);
  assert.equal(broken.primary, '更换 PDF');
});

test('论文：没试过下载的缺原文留在 AI 队列，尝试失败才回人工', () => {
  const untouched = classifyQueueEntry({ kind: 'paper', item: paper({ stage: 'L2', has_pdf: false, review_flags: [] }) }, NOW);
  assert.equal(untouched.side, 'ai', '还没尝试下载，不该推给人工');
  const failed = classifyQueueEntry({ kind: 'paper', item: paper({ stage: 'L2', has_pdf: false, review_flags: ['needs_pdf'] }) }, NOW);
  assert.equal(failed.side, 'human');
  assert.equal(failed.primary, '补 PDF');
});

test('论文：干净的 L2 / L3 属于 AI 队列，主按钮为空', () => {
  const l2 = classifyQueueEntry({ kind: 'paper', item: paper({ stage: 'L2' }) }, NOW);
  assert.equal(l2.side, 'ai');
  assert.equal(l2.primary, null);
  const l3 = classifyQueueEntry({ kind: 'paper', item: paper({ stage: 'L3' }) }, NOW);
  assert.equal(l3.row, 'l3');
});

test('论文：暂停中、已完成、已丢弃不进入队列', () => {
  const snoozed = paper({ stage: 'L2', snooze: { until: new Date(NOW + 86400000).toISOString() } });
  assert.equal(classifyQueueEntry({ kind: 'paper', item: snoozed }, NOW), null);
  assert.equal(classifyQueueEntry({ kind: 'paper', item: paper({ stage: 'done' }) }, NOW), null);
  assert.equal(classifyQueueEntry({ kind: 'paper', item: paper({ stage: 'dropped' }) }, NOW), null);
});

// ── 看板：守恒与分组 ────────────────────────────────────────
const papers = [
  paper({ id: 'p1', stage: 'L1' }),
  paper({ id: 'p2', stage: 'L2' }),
  paper({ id: 'p3', stage: 'L3', review_flags: ['needs_pdf', 'low_confidence'] }),
  paper({ id: 'p4', stage: 'L2', review_flags: ['analysis_failed'] }),
  paper({ id: 'p5', stage: 'L3', review_flags: ['low_confidence'] }),
  paper({ id: 'p6', stage: 'done' }),
  paper({ id: 'p7', stage: 'L2', snooze: { until: new Date(NOW + 86400000).toISOString() } }),
  paper({ id: 'p8', stage: 'L2', review_flags: ['pdf_error'] }),
];
const candidates = [
  candidate({ id: 'c1' }),
  candidate({ id: 'c2', abstract: '' }),
  candidate({ id: 'c3', status: 'parked' }),
  candidate({ id: 'c4', status: 'failed' }),
  candidate({ id: 'c5', status: 'analyzing' }),
  candidate({ id: 'c6', status: 'admitted' }),
];
const summary = {
  stages: { L0: 0, L1: 1, L2: 4, L3: 2, done: 1, dropped: 0 },
  counts: { new: 2, analyzing: 1, failed: 1, parked: 1, dropped: 1 },
};
const stats = {
  limits: { l1: 30, l2: 6, l3: 3, pdf: 6 },
  usage: { l1: 30, l2: 0, l3: 1, pdf: 0 },
};

test('看板：每行排队 = 人工 + 自动，合计 = Σ 行，两框之和 = 合计', () => {
  const result = pipelineBoard({ papers, candidates, summary, stats, now: NOW });
  for (const row of result.rows) {
    assert.equal(row.queued, row.human + row.auto, `${row.label} 行不守恒`);
    assert.equal(row.loaded, row.human + row.auto);
  }
  assert.equal(result.total.queued, result.rows.reduce((sum, row) => sum + row.queued, 0));
  assert.equal(result.total.human + result.total.auto, result.total.loaded);
  assert.equal(result.humanItems.length, result.total.human);
  assert.equal(result.aiItems.length, result.total.auto);
});

test('看板：五组互斥且只装人工项，组内条数之和等于人工合计', () => {
  const result = pipelineBoard({ papers, candidates, summary, stats, now: NOW });
  assert.deepEqual(result.groups.map((g) => g.key), ['material', 'failed', 'confirm', 'lowconf', 'legacy']);
  assert.equal(result.groups.reduce((sum, g) => sum + g.items.length, 0), result.total.human);
  const ids = result.groups.flatMap((g) => g.items.map((item) => item.id));
  assert.equal(new Set(ids).size, ids.length, '同一条不能进两个组');
  assert.deepEqual(ids.filter((id) => id === 'p3'), ['p3'], '材料+低置信只算材料');
});

test('看板：暂停与终态不进表，暂停数单独给出', () => {
  const result = pipelineBoard({ papers, candidates, summary, stats, now: NOW });
  assert.equal(result.paused, 1);
  const allIds = [...result.humanItems, ...result.aiItems].map((item) => item.id);
  for (const id of ['p6', 'p7', 'c6']) assert.equal(allIds.includes(id), false, `${id} 不应出现`);
});

test('看板：额度按档位取数，用满标 error，没有档位给 null', () => {
  const result = pipelineBoard({ papers, candidates, summary, stats, now: NOW });
  const byKey = Object.fromEntries(result.rows.map((row) => [row.key, row]));
  assert.deepEqual(byKey.new.quota, { text: '已用完 · 30 / 30', tone: 'error' });
  assert.deepEqual(byKey.l2.quota, { text: '剩 6 / 6', tone: 'normal' });
  assert.deepEqual(byKey.l3.quota, { text: '剩 2 / 3', tone: 'normal' });
  assert.equal(byKey.confirm.quota, null);
  assert.equal(byKey.legacy.quota, null);
});

test('看板：处理方按人工/自动分布推导', () => {
  const result = pipelineBoard({ papers, candidates, summary, stats, now: NOW });
  const byKey = Object.fromEntries(result.rows.map((row) => [row.key, row]));
  assert.equal(byKey.new.owner, 'both');
  assert.equal(byKey.confirm.owner, 'human');
  assert.equal(byKey.l2.owner, 'both');
  assert.equal(byKey.l3.owner, 'human');
  assert.equal(byKey.legacy.owner, 'human');
});

test('看板：服务端摘要落后于列表时，排队数取已加载数并标 truncated=false', () => {
  const result = pipelineBoard({
    papers: [],
    candidates: [candidate({ id: 'a' }), candidate({ id: 'b' })],
    summary: { stages: { L2: 0, L3: 0 }, counts: { new: 0 } },
    stats, now: NOW,
  });
  const row = result.rows.find((item) => item.key === 'new');
  assert.equal(row.queued, 2, '排队数不能小于已加载数');
  assert.equal(row.human, 0);
  assert.equal(row.auto, 2);
  assert.equal(row.truncated, false);
  assert.equal(result.total.queued, 2);
});

test('看板：已加载少于全量时标 truncated，不谎称全量', () => {
  const result = pipelineBoard({
    papers: [], candidates: [candidate({ id: 'only' })],
    summary: { stages: { L2: 0, L3: 0 }, counts: { new: 9 } },
    stats, now: NOW,
  });
  const row = result.rows.find((item) => item.key === 'new');
  assert.equal(row.queued, 9);
  assert.equal(row.loaded, 1);
  assert.equal(row.truncated, true);
  assert.equal(result.total.truncated, true);
});

test('AI 队列排序：能立刻处理的在前，等原文的在后，正在跑的最前', () => {
  const entries = [
    { kind: 'paper', row: 'l2', side: 'ai', item: paper({ id: 'l2-nopdf', stage: 'L2', has_pdf: false }) },
    { kind: 'paper', row: 'l3', side: 'ai', item: paper({ id: 'l3-pdf', stage: 'L3', has_pdf: true }) },
    { kind: 'paper', row: 'l2', side: 'ai', item: paper({ id: 'l2-pdf', stage: 'L2', has_pdf: true }) },
    { kind: 'candidate', row: 'new', side: 'ai', item: candidate({ id: 'cand-1' }) },
  ];
  const sorted = sortAiEntries(entries, { sort: 'score', runningIds: ['l3-pdf'] }).map((e) => e.item.id);
  assert.deepEqual(sorted, ['l3-pdf', 'cand-1', 'l2-pdf', 'l2-nopdf']);

  const pinned = sortAiEntries([
    { kind: 'paper', row: 'l2', side: 'ai', item: paper({ id: 'normal', has_pdf: true }) },
    { kind: 'paper', row: 'l2', side: 'ai', item: paper({ id: 'next', has_pdf: true, priority: 'next' }) },
  ], {}).map((e) => e.item.id);
  assert.deepEqual(pinned, ['next', 'normal'], '置顶条目仍在最前');
});

test('人工行排序：组内按 S→D，无等级排最后', () => {
  const make = (id, grade, group, score) => ({
    kind: 'paper',
    group,
    item: paper({ id, grade, stage: 'L2', review_flags: ['needs_pdf'], t0: { score } }),
  });
  const sorted = sortHumanEntries([
    make('none', null, 'material', 50),
    make('b', 'B', 'material', 10),
    make('a', 'A', 'material', 5),
    make('s', 'S', 'material', 1),
  ]);
  assert.deepEqual(sorted.map((e) => e.item.id), ['s', 'a', 'b', 'none']);
});

// ── 文案工具 ────────────────────────────────────────────────
test('额度文案：0 表示这一级不做，用满带「已用完」', () => {
  assert.deepEqual(formatQuota(0, 0), { text: '不做', tone: 'off' });
  assert.deepEqual(formatQuota(1, 0), { text: '不做', tone: 'off' });
  assert.deepEqual(formatQuota(0, 30), { text: '剩 30 / 30', tone: 'normal' });
  assert.deepEqual(formatQuota(4, 6), { text: '剩 2 / 6', tone: 'normal' });
  assert.deepEqual(formatQuota(3, 3), { text: '已用完 · 3 / 3', tone: 'error' });
});

test('下次运行：按当前时间给出今天或明天，关闭与非法时间分开表达', () => {
  assert.equal(nextRunLabel(NOW, { enabled: false, time: '07:00' }), null);
  assert.equal(nextRunLabel(NOW, null), null);
  assert.deepEqual(nextRunLabel(NOW, { enabled: true, time: '07:00' }).text, '明天 07:00');
  const early = Date.parse('2026-11-22T06:30:00+08:00');
  assert.deepEqual(nextRunLabel(early, { enabled: true, time: '07:00' }).text, '今天 07:00');
  assert.deepEqual(nextRunLabel(NOW, { enabled: true, time: '' }).text, '时间未设置');
  assert.deepEqual(nextRunLabel(NOW, { enabled: true, time: '25:00' }).text, '时间未设置');
});

