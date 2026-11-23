import test from 'node:test';
import assert from 'node:assert/strict';

import { detectSections, l2Excerpts, extractPdfText, savePdfText, readPdfText } from '../lib/pdf.js';
import { makeBase } from './helpers.mjs';

const text = `Abstract\nA graph-based structure prediction method.\n\n1. Introduction\nGraph tracking is important.\n\nConclusion\nThe method improves accuracy.\n\nFig. 3 Accuracy plot.`;

test('pdf：章节定位与 L2 摘录', () => {
  const sections = detectSections(text);
  assert.ok(sections.abstract);
  assert.ok(sections.introduction);
  assert.ok(sections.conclusion);
  const excerpts = l2Excerpts(text, sections);
  assert.ok(excerpts.introduction.includes('Graph tracking'));
  assert.ok(excerpts.conclusion.includes('improves accuracy'));
  assert.ok(excerpts.captions.includes('Fig. 3'));
});

test('pdf：拒绝非 PDF，文本缓存可读写', async () => {
  await assert.rejects(() => extractPdfText(Buffer.from('not a pdf')), /不是 PDF/);
  const base = await makeBase();
  const meta = await savePdfText(base, 'doi:10.1234/pdf.1', {
    text, chars: text.length, pageCount: 3, pages: [1, 2, 3], scanned: false, sections: detectSections(text),
  });
  assert.equal(meta.pageCount, undefined);
  assert.equal(meta.pages, 3);
  const cached = await readPdfText(base, 'doi:10.1234/pdf.1');
  assert.equal(cached.text, text);
  assert.equal(cached.scanned, false);
});
