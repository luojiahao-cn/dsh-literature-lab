import test from 'node:test';
import assert from 'node:assert/strict';
import { pickAttachment } from '../lib/zotero-pdf.js';

const child = (title, file) => ({
  links: { enclosure: { title, href: `file:///tmp/${file}.pdf`, type: 'application/pdf' } },
});

test('Zotero 附件：优先英文原文，避开 mono/dual 译本与补充材料', () => {
  const children = [
    child('补充材料（英文原文）PDF', 'ESM'),
    child('中英双语 PDF', 'paper.zh-CN.dual'),
    child('中文单语 PDF', 'paper.zh-CN.mono'),
    child('英文原文 PDF', 'paper'),
    child('补充材料（中文单语）PDF', 'ESM.zh-CN.mono'),
  ];
  const picked = pickAttachment(children);
  assert.equal(picked.links.enclosure.title, '英文原文 PDF');
});

test('Zotero 附件：只有译本时仍能用（不返回空）', () => {
  const picked = pickAttachment([child('中文单语 PDF', 'paper.zh-CN.mono')]);
  assert.equal(picked.links.enclosure.title, '中文单语 PDF');
});
