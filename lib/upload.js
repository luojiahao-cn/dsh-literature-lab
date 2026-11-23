/**
 * 用户已有 PDF 的上传入口：直接进 L2，跳过候选池和 L1。
 * 文件存 pdfs/<paper_id>.pdf；正文抽取失败不影响论文与 PDF 落盘。
 */
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { workId } from './dedup.js';
import { updateStateAndSeen, today } from './state.js';
import { ensurePdfText } from './pdf.js';
import { applyPdfArrival } from './download.js';

function safeId(id) {
  return String(id || 'upload').replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 120) || 'upload';
}

/**
 * @param {object} input
 * @param {Buffer} input.buffer
 * @param {string} [input.filename]
 * @param {string} [input.title]
 * @param {string} [input.doi]
 * @param {string} [input.paperId]
 * @param {number} [input.maxBytes]
 */
export async function saveUploadedPdf(baseDir, {
  buffer, filename = '', title = '', doi = '', paperId = '', maxBytes = 20 * 1024 * 1024,
} = {}) {
  if (!buffer || buffer.length < 5 || buffer.subarray(0, 5).toString('latin1') !== '%PDF-') {
    throw new Error('不是有效的 PDF 文件');
  }
  if (buffer.length > maxBytes) throw new Error(`PDF 超过 ${Math.round(maxBytes / 1024 / 1024)} MB`);

  const cleanTitle = String(title || '').trim() || String(filename || '').replace(/\.pdf$/i, '').trim() || '未命名论文';
  const cleanDoi = String(doi || '').replace(/^https?:\/\/doi\.org\//i, '').replace(/^doi:\s*/i, '').trim();
  const id = String(paperId || '').trim()
    || workId({ doi: cleanDoi, title: cleanTitle })
    || `upload:${createHash('sha256').update(`${cleanTitle}:${buffer.length}`).digest('hex').slice(0, 12)}`;

  const dir = path.join(baseDir, 'pdfs');
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, `${safeId(id)}.pdf`);
  await writeFile(file, buffer);

  const relative = path.relative(baseDir, file).split(path.sep).join('/');
  const now = new Date().toISOString();
  await updateStateAndSeen(baseDir, (state, seen) => {
    if (!state.papers) state.papers = {};
    const existing = state.papers[id];
    if (existing) {
      // 本机补 PDF = 原文到位：清 needs_pdf/pdf_error，没走完初筛的放回 L2（done/dropped 不回退）。
      applyPdfArrival(existing, { pdf: relative, bytes: buffer.length, source: 'upload', at: now });
    } else {
      state.papers[id] = {
        title: cleanTitle,
        doi: cleanDoi || null,
        arxiv_id: null,
        url: null,
        first_seen: today(),
        last_seen: today(),
        published_at: null,
        sources: ['upload'],
        summary: null,
        abstract: null,
        abstract_lookup: null,
        meta: { venue: null, year: null, source: 'upload' },
        relevance: null,
        stage: 'L2',
        grade: null,
        grade_history: [],
        pdf: relative,
        pdf_bytes: buffer.length,
        pdf_source: 'upload',
        priority: true,
        review_flags: [],
      };
    }
    seen[id] = { t: now, s: 'upload', title: cleanTitle, a: 1, score: null };
  });

  let text = null;
  let textError = null;
  try {
    const meta = await ensurePdfText(baseDir, { id, pdf: relative });
    text = meta ? { chars: meta.chars, pages: meta.pages, scanned: meta.scanned, sections: Object.keys(meta.sections || {}) } : null;
  } catch (error) {
    textError = String(error?.message || error);
  }

  return { ok: true, id, title: cleanTitle, pdf: relative, bytes: buffer.length, text, text_error: textError };
}
