/**
 * 监听浏览器扩展/用户下载目录：读取同名 .json 侧车，按 DOI/标题匹配缺 PDF 的论文，
 * 复制进插件 pdfs/。不删除用户原文件。
 */
import { readdir, readFile, stat, copyFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import * as store from './store.js';
import { readState, updateState } from './state.js';
import { applyPdfArrival } from './download.js';
import { workId, normalizeDoi } from './dedup.js';

export function expandDir(value) {
  const raw = String(value || '~/Downloads/论文');
  return raw.startsWith('~/') ? path.join(process.env.HOME || '', raw.slice(2)) : raw;
}

export function titleKey(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5]+/g, ' ').trim();
}

export function findPaper(state, sidecar) {
  const papers = state.papers || {};
  const doi = normalizeDoi(sidecar.doi);
  if (doi) {
    const id = `doi:${doi}`;
    if (papers[id]) return [id, papers[id]];
    const hit = Object.entries(papers).find(([, p]) => normalizeDoi(p.doi) === doi);
    if (hit) return hit;
  }
  const title = titleKey(sidecar.title);
  if (title) {
    const hit = Object.entries(papers).find(([, p]) => {
      const key = titleKey(p.title);
      return key && (key === title || key.startsWith(title) || title.startsWith(key));
    });
    if (hit) return hit;
  }
  return null;
}

async function siblingPdf(dir, jsonName) {
  const base = jsonName.replace(/\.json$/i, '');
  const entries = await readdir(dir).catch(() => []);
  const name = entries.find((n) => n === `${base}.pdf`)
    || entries.find((n) => n.startsWith(`${base}`) && /\.pdf$/i.test(n));
  return name ? path.join(dir, name) : null;
}

export async function scanWatchFolder(baseDir, config) {
  const download = config?.download || {};
  if (download.watchImport === false) return { scanned: 0, imported: 0, errors: [] };
  const dir = expandDir(download.watchDir);
  const entries = await readdir(dir).catch(() => []);
  const sidecars = entries.filter((n) => /\.json$/i.test(n));
  const stats = { scanned: sidecars.length, imported: 0, errors: [] };
  if (!sidecars.length) return stats;

  const watchFile = path.join(baseDir, 'state', 'watch.json');
  const watch = await store.readJson(watchFile, { done: {} });
  const state = await readState(baseDir);
  for (const name of sidecars) {
    const full = path.join(dir, name);
    const info = await stat(full).catch(() => null);
    if (!info || Date.now() - info.mtimeMs < 3000) continue;
    const key = `${full}:${info.size}:${info.mtimeMs}`;
    if (watch.done?.[key]) continue;
    try {
      const sidecar = JSON.parse(await readFile(full, 'utf8'));
      const found = findPaper(state, sidecar);
      if (!found) continue;
      const [id, paper] = found;
      if (paper.pdf) { watch.done[key] = new Date().toISOString(); continue; }
      const pdf = await siblingPdf(dir, name);
      if (!pdf) continue;
      const destDir = path.join(baseDir, 'pdfs');
      await mkdir(destDir, { recursive: true });
      const safe = String(id).replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 120) || 'paper';
      const dest = path.join(destDir, `${safe}.pdf`);
      await copyFile(pdf, dest);
      const rel = path.relative(baseDir, dest).split(path.sep).join('/');
      const bytes = (await stat(dest)).size;
      await updateState(baseDir, (latest) => {
        const target = latest.papers?.[id];
        if (!target) return;
        applyPdfArrival(target, {
          pdf: rel,
          bytes,
          source: 'extension',
          via: 'extension',
          download: true,
        });
      });
      watch.done[key] = new Date().toISOString();
      stats.imported += 1;
    } catch (error) {
      stats.errors.push(`${name}: ${String(error?.message || error)}`);
    }
  }
  await store.writeJsonAtomic(watchFile, watch);
  return stats;
}

export function startWatch(baseDir, getConfig) {
  const run = () => scanWatchFolder(baseDir, getConfig()).catch(() => {});
  const timer = setInterval(run, 60 * 1000);
  if (typeof timer.unref === 'function') timer.unref();
  run();
  return () => clearInterval(timer);
}
