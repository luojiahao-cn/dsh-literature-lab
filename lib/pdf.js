/**
 * PDF 文本层：只抽取文本，不渲染图片；扫描版会被标记而不是硬送模型。
 *
 * 缓存：
 *   state/texts/<paper>.json  元数据 + 章节定位
 *   state/texts/<paper>.txt   全文（不进 git）
 */
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
import * as store from './store.js';

const MAX_PAGES = 60;
const MIN_TEXT_PER_PAGE = 40;

export function textHash(text) {
  return createHash('sha256').update(String(text || '')).digest('hex').slice(0, 24);
}

/** 章节定位：返回每段起始字符与截取片段，供 L2 prompt 使用。 */
export function detectSections(text) {
  const src = String(text || '');
  const lower = src.toLowerCase();
  const patterns = [
    ['abstract', ['abstract', '摘要']],
    ['introduction', ['introduction', '1. introduction', 'i. introduction', '引言']],
    ['conclusion', ['conclusion', 'conclusions', 'concluding remarks', '结论']],
  ];
  const found = {};
  for (const [name, needles] of patterns) {
    for (const needle of needles) {
      const idx = lower.indexOf(needle);
      if (idx >= 0) {
        found[name] = { index: idx, text: src.slice(idx, idx + 2500).trim() };
        break;
      }
    }
  }
  return found;
}

function pageTexts(text) {
  const pages = [];
  const re = /\[Page (\d+)\]\s*([\s\S]*?)(?=\n\[Page \d+\]|$)/g;
  let match;
  while ((match = re.exec(text))) pages.push({ page: Number(match[1]), text: match[2].trim() });
  return pages;
}

/** 抽取 PDF 文本；返回 text/pages/sections/scanned。 */
export async function extractPdfText(buffer, { maxPages = MAX_PAGES } = {}) {
  if (!buffer || buffer.length < 5 || buffer.subarray(0, 5).toString('latin1') !== '%PDF-') {
    throw new Error('不是 PDF 文件');
  }
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await getDocument({
    data: new Uint8Array(buffer),
    useWorkerFetch: false,
    isEvalSupported: false,
    disableFontFace: true,
    useSystemFonts: false,
  }).promise;
  const pages = [];
  const limit = Math.min(doc.numPages, Math.max(1, maxPages));
  for (let pageNo = 1; pageNo <= limit; pageNo += 1) {
    const page = await doc.getPage(pageNo);
    const content = await page.getTextContent();
    const text = content.items.map((item) => item.str || '').join(' ').replace(/\s+/g, ' ').trim();
    pages.push({ page: pageNo, text });
  }
  const joined = pages.map((p) => `[Page ${p.page}]\n${p.text}`).join('\n\n');
  try { await doc.destroy(); } catch { /* 释放失败不影响文本 */ }
  const totalChars = pages.reduce((sum, p) => sum + p.text.length, 0);
  const scanned = totalChars < Math.max(120, pages.length * MIN_TEXT_PER_PAGE);
  return {
    text: joined,
    pages: pages.map((p) => p.page),
    pageCount: doc.numPages,
    truncated: doc.numPages > limit,
    chars: totalChars,
    scanned,
    sections: detectSections(joined),
  };
}

function textPath(baseDir, id) {
  const safe = String(id || 'unknown').replace(/[^a-zA-Z0-9._-]+/g, '_');
  return path.join(store.statePaths(baseDir).texts, safe);
}

export async function savePdfText(baseDir, id, extracted) {
  const stem = textPath(baseDir, id);
  await mkdir(path.dirname(stem), { recursive: true });
  const txt = `${stem}.txt`;
  const tmp = `${txt}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmp, extracted.text || '', 'utf8');
  await rename(tmp, txt);
  const meta = {
    paper_id: id,
    hash: textHash(extracted.text),
    chars: extracted.chars ?? String(extracted.text || '').length,
    pages: extracted.pageCount ?? (extracted.pages || []).length,
    page_list: extracted.pages || [],
    truncated: Boolean(extracted.truncated),
    scanned: Boolean(extracted.scanned),
    sections: extracted.sections || {},
    text_path: path.relative(baseDir, txt).split(path.sep).join('/'),
    extracted_at: new Date().toISOString(),
  };
  await store.writeJsonAtomic(`${stem}.json`, meta);
  return meta;
}

/** 只读文本元数据（不含正文），用于界面展示抽取状态。 */
export async function readPdfTextMeta(baseDir, id) {
  const stem = textPath(baseDir, id);
  return store.readJson(`${stem}.json`, null);
}

export async function readPdfText(baseDir, id) {
  const stem = textPath(baseDir, id);
  const meta = await store.readJson(`${stem}.json`, null);
  if (!meta) return null;
  try {
    const text = await readFile(path.join(baseDir, meta.text_path), 'utf8');
    return { ...meta, text };
  } catch {
    return null;
  }
}

/** 给 L2 的输入：优先缓存；需要时从 paper.pdf 重新抽取。 */
export async function ensurePdfText(baseDir, paper, { maxPages = MAX_PAGES } = {}) {
  const cached = await readPdfText(baseDir, paper.id);
  if (cached) return cached;
  if (!paper.pdf) return null;
  const buffer = await readFile(path.join(baseDir, paper.pdf));
  const extracted = await extractPdfText(buffer, { maxPages });
  await savePdfText(baseDir, paper.id, extracted);
  return readPdfText(baseDir, paper.id);
}

/** L2 prompt 用的三段文本：引言末段、结论、图注（图注暂从文本里截取）。 */
export function l2Excerpts(text, sections = {}) {
  const src = String(text || '');
  const intro = sections.introduction?.text || src.slice(0, 4000);
  const conclusion = sections.conclusion?.text || src.slice(-4000);
  const captions = [];
  const re = /(Fig(?:ure)?\.?\s*\d+[^\n]{0,400})/gi;
  let match;
  while ((match = re.exec(src)) && captions.length < 8) captions.push(match[1].trim());
  return {
    introduction: intro.slice(0, 5000),
    conclusion: conclusion.slice(0, 5000),
    captions: captions.join('\n').slice(0, 3000),
  };
}

export { pageTexts };
