/** 关键图定位：图注解析、区域裁剪换算、图区包围盒；不依赖真实 PDF。 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { findCaption, figureRegion, regionToPixels } from '../lib/figures.js';

const items = [
  { str: 'Fig. 1.', transform: [1, 0, 0, 1, 313, 434], height: 8 },
  { str: 'Figure 2', transform: [1, 0, 0, 1, 60, 300], height: 9 },
  { str: 'Figure 2 (continued)', transform: [1, 0, 0, 1, 60, 120], height: 9 },
  { str: 'body text', transform: [1, 0, 0, 1, 60, 500], height: 9 },
];

test('figures：按编号优先找图注，找不到回退第一处', () => {
  assert.equal(findCaption(items, 1).yBottom, 434);
  assert.equal(findCaption(items, 2).yBottom, 300);
  assert.equal(findCaption(items, 9).yBottom, 434);
  assert.equal(findCaption([], 1), null);
});

test('figures：页面点 → 裁剪像素按 DPI 换算，y 从顶部算', () => {
  const box = [100, 200, 300, 400]; // 200pt 高
  assert.deepEqual(regionToPixels(box, 800, 72), { left: 100, top: 400, width: 200, height: 200 });
  assert.deepEqual(regionToPixels(box, 800, 144), { left: 200, top: 800, width: 400, height: 400 });
});

test('figures：只取图注上方、同列的图形；太小或为空返回 null', () => {
  const caption = { num: 1, x: 313, yBottom: 434, yTop: 442 };
  const boxes = [
    [320, 450, 560, 620], // 图区内
    [330, 460, 380, 470],
    [60, 450, 280, 620], // 左栏，不属于这张图
    [320, 300, 560, 430], // 图注下方
  ];
  const region = figureRegion(boxes, caption, { pageWidth: 612, pageHeight: 792 });
  assert.ok(region, '应定位到图区');
  assert.equal(region[0], 314, '左边界扩 6pt 后仍限制在右栏');
  assert.equal(region[2], 558, '右边界受默认页边距限制');
  assert.ok(region[1] <= 450 && region[3] >= 620);
  assert.equal(figureRegion([], caption, { pageWidth: 612, pageHeight: 792 }), null);
  assert.equal(
    figureRegion([[320, 450, 330, 460]], caption, { pageWidth: 612, pageHeight: 792 }),
    null,
    '面积过小不给区域，交给整页回退',
  );
});
