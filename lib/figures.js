/**
 * 关键图提取：L3 选页（page + caption + why）后按三步取图：
 * 1) 页内有足够大的内嵌位图 → 直接导出该位图；
 * 2) 矢量图 → 用图注定位列，取图注上方矢量路径的包围盒，按区域裁剪渲染；
 * 3) 定位失败 → 整页渲染，并把 kind 标成 page（界面标明是整页截图）。
 */
import { readFile, mkdir, writeFile, rename, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { deflateSync } from 'node:zlib';
import path from 'node:path';
import * as store from './store.js';

const execFileAsync = promisify(execFile);
const MIN_IMAGE_SIDE = 180;
const MAX_FIGURES = 3;

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let k = 0; k < 8; k += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, crc]);
}

/** RGBA/RGB → PNG（filter 0 + zlib）；不引入原生依赖。 */
export function encodePng(input, width, height, channels = 4) {
  const rgba = Buffer.alloc(width * height * 4);
  if (channels === 4) {
    Buffer.from(input).copy(rgba);
  } else if (channels === 3) {
    for (let i = 0, j = 0; i < width * height; i += 1, j += 3) {
      rgba[i * 4] = input[j];
      rgba[i * 4 + 1] = input[j + 1];
      rgba[i * 4 + 2] = input[j + 2];
      rgba[i * 4 + 3] = 255;
    }
  } else {
    return null;
  }
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (width * 4 + 1)] = 0;
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function pdfImage(page, id) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (value) => { if (!done) { done = true; resolve(value); } };
    try {
      const value = page.objs.get(id, finish);
      if (value) finish(value);
    } catch { finish(null); }
  });
}

async function pageImages(page) {
  const { OPS } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const ops = await page.getOperatorList();
  const out = [];
  for (let i = 0; i < ops.fnArray.length; i += 1) {
    const fn = ops.fnArray[i];
    let img = null;
    if (fn === OPS.paintImageXObject) {
      img = await pdfImage(page, ops.argsArray[i][0]);
    } else if (fn === OPS.paintInlineImageXObject) {
      img = ops.argsArray[i][0];
    }
    if (!img?.data || !img.width || !img.height) continue;
    if (img.width < MIN_IMAGE_SIDE || img.height < MIN_IMAGE_SIDE) continue;
    out.push(img);
  }
  return out.sort((a, b) => b.width * b.height - a.width * a.height);
}

const RENDER_DPI = 200;
const MIN_FIGURE_AREA_RATIO = 0.06;

/** PDF 点 → 裁剪像素：pdftoppm 的 -x/-y 从左上角算。 */
export function regionToPixels(box, pageHeight, dpi = RENDER_DPI) {
  const scale = dpi / 72;
  const [x0, y0, x1, y1] = box;
  const left = Math.max(0, Math.round(x0 * scale));
  const top = Math.max(0, Math.round((pageHeight - y1) * scale));
  const width = Math.max(1, Math.round((x1 - x0) * scale));
  const height = Math.max(1, Math.round((y1 - y0) * scale));
  return { left, top, width, height };
}

/** 从页内文本里找图注（Fig. 1 / Figure 2），可按编号择优。 */
export function findCaption(items, number = null) {
  const found = [];
  for (const item of items || []) {
    const text = String(item?.str || '').trim();
    const match = /^(fig(?:ure)?\.?)\s*(\d+)/i.exec(text);
    if (!match) continue;
    const [a, b, c, d, x, y] = item.transform || [];
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    found.push({
      num: Number(match[2]),
      x,
      yBottom: y,
      yTop: y + (Number(item.height) || 10),
    });
  }
  if (!found.length) return null;
  if (number) {
    const hit = found.find((item) => item.num === Number(number));
    if (hit) return hit;
  }
  return found[0];
}

const mulMatrix = (m, n) => [
  m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5],
];
const applyMatrix = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];

/** 页内所有图形（路径与位图）的页面坐标包围盒；CTM 逐层累乘。 */
export async function pageGraphicBoxes(page) {
  const { OPS } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const ops = await page.getOperatorList();
  const boxes = [];
  let ctm = [1, 0, 0, 1, 0, 0];
  const stack = [];
  for (let i = 0; i < ops.fnArray.length; i += 1) {
    const fn = ops.fnArray[i];
    const args = ops.argsArray[i];
    if (fn === OPS.save) stack.push(ctm.slice());
    else if (fn === OPS.restore) ctm = stack.pop() || [1, 0, 0, 1, 0, 0];
    else if (fn === OPS.transform) ctm = mulMatrix(ctm, args);
    else if (fn === OPS.constructPath) {
      const minMax = args?.[2];
      if (!Array.isArray(minMax)) continue;
      const [x1, y1, x2, y2] = minMax;
      const pts = [applyMatrix(ctm, x1, y1), applyMatrix(ctm, x2, y1), applyMatrix(ctm, x2, y2), applyMatrix(ctm, x1, y2)];
      const xs = pts.map((p) => p[0]);
      const ys = pts.map((p) => p[1]);
      boxes.push([Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]);
    } else if (fn === OPS.paintImageXObject || fn === OPS.paintInlineImageXObject) {
      const pts = [[0, 0], [1, 0], [1, 1], [0, 1]].map(([x, y]) => applyMatrix(ctm, x, y));
      const xs = pts.map((p) => p[0]);
      const ys = pts.map((p) => p[1]);
      boxes.push([Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]);
    }
  }
  return boxes;
}

/** 图注上方的图形包围盒，限定在图注所在列内；定位不到时返回 null。 */
export function figureRegion(boxes, caption, { pageWidth, pageHeight, singleColumn = false, margins = { left: 54, right: 54 } }) {
  if (!caption) return null;
  const rightColumn = caption.x > pageWidth * 0.45;
  const x0 = singleColumn ? margins.left : rightColumn ? pageWidth / 2 : margins.left;
  const x1 = singleColumn ? pageWidth - margins.right : rightColumn ? pageWidth - margins.right : pageWidth / 2;
  const yFloor = caption.yBottom + 2;
  const selected = (boxes || []).filter((box) => box[3] >= yFloor && box[2] > x0 && box[0] < x1);
  if (!selected.length) return null;
  const union = selected.reduce((acc, box) => [
    Math.min(acc[0], box[0]), Math.min(acc[1], box[1]),
    Math.max(acc[2], box[2]), Math.max(acc[3], box[3]),
  ], selected[0].slice());
  const region = [
    Math.max(x0, union[0] - 6),
    Math.max(0, union[1] - 6),
    Math.min(x1, union[2] + 6),
    Math.min(pageHeight, union[3] + 6),
  ];
  const area = (region[2] - region[0]) * (region[3] - region[1]);
  if (area < pageWidth * pageHeight * MIN_FIGURE_AREA_RATIO) return null;
  return region;
}

async function renderRegion(pdfPath, pageNo, box, pageHeight, outFile) {
  const { left, top, width, height } = regionToPixels(box, pageHeight);
  const dir = path.dirname(outFile);
  const prefix = path.join(dir, `crop-${pageNo}`);
  await rm(`${prefix}.png`, { force: true }).catch(() => {});
  await execFileAsync('pdftoppm', [
    '-f', String(pageNo), '-l', String(pageNo), '-r', String(RENDER_DPI), '-png',
    '-x', String(left), '-y', String(top), '-W', String(width), '-H', String(height),
    '-singlefile', pdfPath, prefix,
  ]);
  await rename(`${prefix}.png`, outFile);
}

async function renderPage(pdfPath, pageNo, outFile) {
  const dir = path.dirname(outFile);
  const prefix = path.join(dir, `render-${pageNo}`);
  await execFileAsync('pdftoppm', ['-f', String(pageNo), '-l', String(pageNo), '-r', '150', '-png', '-singlefile', pdfPath, prefix]);
  await rename(`${prefix}.png`, outFile);
}

/**
 * @param {object} paper 论文（需要 paper.pdf）
 * @param {Array<{page:number, caption?:string, why?:string}>} selections
 */
export async function extractFigures(baseDir, paper, selections = [], paperId = '') {
  if (!paper?.pdf) return [];
  const pdfPath = path.resolve(baseDir, paper.pdf);
  if (!existsSync(pdfPath)) return [];
  const safe = String(paperId || paper.id || 'paper').replace(/[^a-zA-Z0-9._-]+/g, '_');
  const outDir = path.join(store.statePaths(baseDir).dir, 'figures', safe);
  await mkdir(outDir, { recursive: true });
  const wanted = [];
  const seen = new Set();
  for (const item of selections) {
    const page = Number(item?.page);
    if (!Number.isFinite(page) || page < 1 || seen.has(page)) continue;
    seen.add(page);
    wanted.push({ ...item, page, rank: Number(item?.rank) || wanted.length + 1 });
    if (wanted.length >= MAX_FIGURES) break;
  }
  if (!wanted.length) return [];

  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const buffer = await readFile(pdfPath);
  const doc = await getDocument({
    data: new Uint8Array(buffer), useWorkerFetch: false, isEvalSupported: false,
    disableFontFace: true, useSystemFonts: false,
  }).promise;
  const figures = [];
  try {
    for (const item of wanted) {
      if (item.page > doc.numPages) continue;
      const page = await doc.getPage(item.page);
      const viewport = page.getViewport({ scale: 1 });
      const pageWidth = viewport.width;
      const pageHeight = viewport.height;
      const text = await page.getTextContent();
      const number = /(\d+)/.exec(String(item?.caption || ''))?.[1] || null;
      const caption = findCaption(text.items, number);
      const rightColumnItems = text.items.filter((it) => Number(it?.transform?.[4]) > pageWidth * 0.45).length;
      const singleColumn = rightColumnItems < 5;
      const xs = text.items.map((it) => Number(it?.transform?.[4])).filter(Number.isFinite);
      const maxRight = text.items
        .map((it) => Number(it?.transform?.[4]) + (Number(it?.width) || 0))
        .filter(Number.isFinite);
      const margins = {
        left: Math.max(24, (xs.length ? Math.min(...xs) : 54) - 6),
        right: Math.max(24, pageWidth - (maxRight.length ? Math.max(...maxRight) : pageWidth - 54) - 6),
      };
      const file = path.join(outDir, `p${item.page}.png`);
      const rel = path.relative(baseDir, file).split(path.sep).join('/');
      let kind = 'image';
      let width = null;
      let height = null;
      const images = await pageImages(page);
      const usable = images.find((img) => img.width >= 300 && img.height >= 200);
      let wrote = false;
      if (usable) {
        const png = encodePng(usable.data, usable.width, usable.height, usable.kind === 2 ? 3 : 4);
        if (png) {
          await writeFile(file, png);
          width = usable.width;
          height = usable.height;
          wrote = true;
        }
      }
      if (!wrote) {
        // 矢量图：按图注定位列，取图注上方的路径包围盒裁剪
        const boxes = await pageGraphicBoxes(page);
        const region = figureRegion(boxes, caption, { pageWidth, pageHeight, singleColumn, margins });
        if (region) {
          try {
            await renderRegion(pdfPath, item.page, region, pageHeight, file);
            kind = 'figure';
            width = Math.round((region[2] - region[0]) * (RENDER_DPI / 72));
            height = Math.round((region[3] - region[1]) * (RENDER_DPI / 72));
            wrote = true;
          } catch { /* 裁剪失败退回整页 */ }
        }
      }
      if (!wrote) {
        try {
          await renderPage(pdfPath, item.page, file);
          kind = 'page';
        } catch {
          continue;
        }
      }
      figures.push({
        rank: item.rank,
        page: item.page,
        caption: String(item?.caption || '').slice(0, 300),
        why: String(item?.why || '').slice(0, 300),
        file: rel,
        kind,
        width,
        height,
      });
    }
  } finally {
    try { await doc.destroy(); } catch { /* ignore */ }
  }
  return figures;
}
