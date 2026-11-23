import test from 'node:test';
import assert from 'node:assert/strict';
import { stat } from 'node:fs/promises';
import path from 'node:path';

import { saveUploadedPdf } from '../lib/upload.js';
import { readState } from '../lib/state.js';
import { makeBase } from './helpers.mjs';

const pdf = Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF\n');

test('upload：PDF 直接进 L2 并落盘', async () => {
  const base = await makeBase();
  const result = await saveUploadedPdf(base, {
    buffer: pdf,
    filename: 'my-paper.pdf',
    title: 'Uploaded Graph Protein',
    doi: '10.1234/upload.1',
  });
  assert.equal(result.ok, true);
  assert.equal(result.id, 'doi:10.1234/upload.1');
  assert.ok(result.text_error, '非法 PDF 文本抽取失败但文件保留');

  const state = await readState(base);
  const paper = state.papers[result.id];
  assert.equal(paper.stage, 'L2');
  assert.equal(paper.pdf_source, 'upload');
  assert.equal(paper.priority, true);
  assert.equal(paper.doi, '10.1234/upload.1');
  const file = await stat(path.join(base, 'pdfs', 'doi_10.1234_upload.1.pdf'));
  assert.equal(file.size, pdf.length);
});
