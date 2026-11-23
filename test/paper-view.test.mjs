/** paperView 是界面的唯一数据来源：l3 的关键图必须原样带上，否则抽屉画廊永远为空。 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { paperView } from '../lib/state.js';

test('paperView：保留 l3 关键图与计数', () => {
  const view = paperView('arxiv:1', {
    title: 'P', stage: 'done', grade: 'B',
    l3: {
      final_grade: 'B', card_markdown: '# 卡片', usage: null, at: '2026-11-22T00:00:00.000Z',
      figures: [{ page: 1, caption: 'Figure 1', why: '先看结构', file: 'state/figures/x/p1.png', kind: 'page' }],
      figure_count: 1,
    },
  });
  assert.equal(view.l3.figure_count, 1);
  assert.equal(view.l3.figures.length, 1);
  assert.equal(view.l3.figures[0].file, 'state/figures/x/p1.png');
});

test('paperView：没有图时给空数组，不缺字段', () => {
  const view = paperView('arxiv:2', { title: 'Q', stage: 'done', grade: 'C', l3: { final_grade: 'C' } });
  assert.deepEqual(view.l3.figures, []);
  assert.equal(view.l3.figure_count, 0);
});
