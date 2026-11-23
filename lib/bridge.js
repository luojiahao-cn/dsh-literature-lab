/** 扩展 → 插件联动：接收扩展下载好的 PDF 路径，立即匹配论文并导入。 */
import { readFile, copyFile, mkdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { readState, updateState } from './state.js';
import { applyPdfArrival } from './download.js';
import { findPaper, expandDir } from './watch.js';

function allowedRoots(config) {
  const home = process.env.HOME || '';
  return [
    path.join(home, 'Downloads'),
    path.join(home, 'Downloads', '论文'),
    expandDir(config?.download?.watchDir),
  ].filter(Boolean).map((p) => path.resolve(p));
}

export async function importPdfPath(baseDir, config, { file, doi = '', title = '' } = {}) {
  if (!file) return { ok: false, error: '缺少文件路径' };
  const resolved = path.resolve(String(file));
  const roots = allowedRoots(config);
  if (!roots.some((root) => resolved === root || resolved.startsWith(root + path.sep))) {
    return { ok: false, error: '文件不在允许的下载目录内' };
  }
  if (!/\.pdf$/i.test(resolved)) return { ok: false, error: '不是 PDF 文件' };
  const info = await stat(resolved).catch(() => null);
  if (!info?.isFile()) return { ok: false, error: '文件不存在' };
  const head = (await readFile(resolved)).subarray(0, 5).toString('latin1');
  if (head !== '%PDF-') return { ok: false, error: '文件不是有效 PDF' };

  const state = await readState(baseDir);
  const found = findPaper(state, { doi, title });
  if (!found) return { ok: false, error: '没有匹配到缺 PDF 的论文', doi, title };
  const [id, paper] = found;
  if (paper.pdf) return { ok: true, skipped: 'has-pdf', paper_id: id };

  const destDir = path.join(baseDir, 'pdfs');
  await mkdir(destDir, { recursive: true });
  const safe = String(id).replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 120) || 'paper';
  const dest = path.join(destDir, `${safe}.pdf`);
  await copyFile(resolved, dest);
  const bytes = (await stat(dest)).size;
  await updateState(baseDir, (latest) => {
    const target = latest.papers?.[id];
    if (!target) return;
    // 统一收尾：记录 PDF、清 needs_pdf/pdf_error，未进初筛的放回 L2
    applyPdfArrival(target, {
      pdf: path.relative(baseDir, dest).split(path.sep).join('/'),
      bytes,
      source: 'extension',
      via: 'extension',
      download: true,
    });
  });
  return { ok: true, paper_id: id, pdf: dest, bytes };
}
