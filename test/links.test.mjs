/** 条目落地页解析：优先已存 url，其次 DOI，最后 arXiv；不产出非 http(s) 链接。 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { itemHomeUrl } from '../lib/links.js';

test('links：优先使用已存的 http(s) url', () => {
  assert.equal(itemHomeUrl({ url: 'https://example.org/p/1', doi: '10.1/x' }), 'https://example.org/p/1');
  assert.equal(itemHomeUrl({ url: 'javascript:alert(1)', doi: '10.1234/abc' }), 'https://doi.org/10.1234/abc');
});

test('links：DOI 拼 doi.org，兼容带前缀的写法', () => {
  assert.equal(itemHomeUrl({ doi: '10.1016/j.example.2026.01.001' }), 'https://doi.org/10.1016/j.example.2026.01.001');
  assert.equal(itemHomeUrl({ doi: 'https://doi.org/10.1234/xyz' }), 'https://doi.org/10.1234/xyz');
  assert.equal(itemHomeUrl({ doi: 'not-a-doi' }), null);
});

test('links：arXiv 拼 abs 页，含版本号', () => {
  assert.equal(itemHomeUrl({ arxiv_id: '2610.26605' }), 'https://arxiv.org/abs/2610.26605');
  assert.equal(itemHomeUrl({ arxiv_id: '2610.26605v2' }), 'https://arxiv.org/abs/2610.26605v2');
  assert.equal(itemHomeUrl({ arxiv_id: '../../etc/passwd' }), null);
});

test('links：没有标识符时退回题名检索页', () => {
  assert.equal(
    itemHomeUrl({ title: 'AI-Based Graph Pose Estimation for Small Magnets' }),
    'https://search.crossref.org/?q=AI-Based%20Graph%20Pose%20Estimation%20for%20Small%20Magnets',
  );
  assert.equal(itemHomeUrl({ title: '短文' }), null);
});

test('links：没有可用字段时返回 null', () => {
  assert.equal(itemHomeUrl({}), null);
  assert.equal(itemHomeUrl(null), null);
});
