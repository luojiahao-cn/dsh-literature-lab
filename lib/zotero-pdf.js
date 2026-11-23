/**
 * 从 Zotero 本地库复用已有 PDF 附件。
 * 只读本地 API：item key → children → enclosure file:// → 复制到插件 pdfs/。
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readZoteroCache } from './zotero.js';
import { updateState } from './state.js';
import { applyPdfArrival } from './download.js';
import { readConfig } from './config.js';

function cleanDoi(value) {
  return String(value || '').replace(/^https?:\/\/doi\.org\//i, '').trim().toLowerCase();
}

function findCachedItem(cache, paper) {
  const doi = cleanDoi(paper?.doi);
  const arxiv = String(paper?.arxiv_id || '').replace(/^arxiv:/i, '').replace(/v\d+$/i, '');
  const title = String(paper?.title || '').trim().toLowerCase();
  return (cache?.items || []).find((item) => {
    if (doi && cleanDoi(item.doi) === doi) return true;
    if (arxiv && String(item.archiveId || '').includes(arxiv)) return true;
    return title && String(item.title || '').trim().toLowerCase() === title;
  }) || null;
}

async function childrenOf(localPort, key) {
  const res = await fetch(`http://127.0.0.1:${localPort}/api/users/0/items/${encodeURIComponent(key)}/children?limit=25`, {
    headers: { accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`Zotero children HTTP ${res.status}`);
  return res.json();
}

/** 附件可读名：Zotero 的 enclosure.title，退回文件名。 */
function attachmentTitle(child) {
  return String(child?.links?.enclosure?.title || child?.filename || child?.data?.filename || '');
}

// 译本识别要覆盖文件名标记：.zh-CN.mono / .zh-CN.dual / no_watermark
// （只认「中文/双语/中英」会漏掉 Zotero 自带的翻译附件命名）
const TRANSLATED_HINT = /中文|双语|中英|translated|zotero-translate|\.zh-CN\.|\.zh\.|\.mono\.|\.dual\./i;
const SUPPLEMENT_HINT = /补充材料|附录材料|supplement|supporting|MOESM|_ESM|source data|源代码/i;

/** 找 item 下最像“原始论文”的 PDF：优先英文原文，避开译本与补充材料。 */
export function pickAttachment(children) {
  const score = (child) => {
    const title = attachmentTitle(child);
    let value = 0;
    if (TRANSLATED_HINT.test(title)) value += 8;
    if (SUPPLEMENT_HINT.test(title)) value += 4;
    if (/英文原文|英文原版|original/i.test(title)) value -= 2;
    return value;
  };
  return (children || [])
    .filter((child) => {
      const href = child?.links?.enclosure?.href || '';
      const title = attachmentTitle(child);
      return /\.pdf$/i.test(title) || child?.links?.enclosure?.type === 'application/pdf' || /\.pdf$/i.test(href);
    })
    .sort((a, b) => score(a) - score(b)
      || attachmentTitle(a).length - attachmentTitle(b).length
      || attachmentTitle(a).localeCompare(attachmentTitle(b)))[0] || null;
}

/**
 * 尝试把 Zotero 中的 PDF 复制到插件 pdfs/；成功返回 {ok,pdf,bytes,via}。
 * 任何一步失败都返回 null，不影响在线 OA 回退。
 */
export async function pdfFromZotero(baseDir, paper, { config = null } = {}) {
  const cfg = config || await readConfig(baseDir);
  const zotero = cfg?.integrations?.zotero || {};
  if (zotero.enabled === false) return null;
  const localPort = Number(zotero.localPort) || 23119;
  const cache = await readZoteroCache(baseDir);
  if (!cache) return null;
  const item = findCachedItem(cache, paper);
  if (!item?.key) return null;

  const children = await childrenOf(localPort, item.key);
  const attachment = pickAttachment(children);
  const href = attachment?.links?.enclosure?.href;
  if (!href || !href.startsWith('file://')) return null;

  const source = fileURLToPath(href);
  const buffer = await readFile(source);
  if (buffer.length < 5 || buffer.subarray(0, 5).toString('latin1') !== '%PDF-') return null;

  const rawId = String(paper.id || (paper.doi ? `doi:${paper.doi}` : '') || item.key);
  const safe = rawId.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 120) || 'paper';
  const dir = path.join(baseDir, 'pdfs');
  const file = path.join(dir, `${safe}.pdf`);
  const { mkdir, writeFile, rename } = await import('node:fs/promises');
  await mkdir(dir, { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmp, buffer);
  await rename(tmp, file);

  const rel = path.relative(baseDir, file).split(path.sep).join('/');
  const now = new Date().toISOString();
  await updateState(baseDir, (state) => {
    const target = state.papers?.[paper.id];
    if (!target) return;
    applyPdfArrival(target, {
      pdf: rel,
      bytes: buffer.length,
      source: 'zotero',
      via: 'zotero',
      at: now,
      download: true,
    });
  });
  return { ok: true, pdf: rel, bytes: buffer.length, via: 'zotero' };
}
