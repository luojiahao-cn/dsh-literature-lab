/** easyScholar 期刊等级查询（用户自己的 key；只存本机，不入 git）。 */
import { readFile, writeFile, chmod, mkdir, unlink } from 'node:fs/promises';
import path from 'node:path';
import * as store from './store.js';
import { hasEasyScholarKey, getEasyScholarKey, setEasyScholarKey } from './secrets.js';
import { venueTierFor } from './venues.js';

const ENDPOINT = 'https://www.easyscholar.cc/open/getPublicationRank';
let lastCall = 0;

export function keyPath(baseDir) {
  return path.join(baseDir, 'state', 'easyscholar-key.json');
}
export function cachePath(baseDir) {
  return path.join(baseDir, 'state', 'venues-easyscholar.json');
}

export async function readKey(baseDir) {
  const data = await store.readJson(keyPath(baseDir), null);
  return data?.secretKey || '';
}

export async function saveKey(baseDir, secretKey, username = '') {
  await mkdir(path.join(baseDir, 'state'), { recursive: true });
  const file = keyPath(baseDir);
  await writeFile(file, JSON.stringify({ secretKey, username, saved_at: new Date().toISOString() }, null, 2), { mode: 0o600 });
  await chmod(file, 0o600);
}

export async function lookup(name, { secretKey, timeoutMs = 25000 } = {}) {
  const venue = String(name || '').trim();
  if (!venue) throw new Error('缺少期刊名');
  if (!secretKey) throw new Error('缺少 easyScholar secretKey');
  const wait = Math.max(0, 900 - (Date.now() - lastCall));
  if (wait) await new Promise((r) => setTimeout(r, wait));
  lastCall = Date.now();
  const url = `${ENDPOINT}?${new URLSearchParams({ secretKey, publicationName: venue })}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs), headers: { accept: 'application/json' } });
  const data = await res.json().catch(() => null);
  if (!res.ok || data?.code !== 200) throw new Error(data?.msg || `HTTP ${res.status}`);
  return data.data || {};
}

export function tierOfEasyScholar(name, data) {
  const all = data?.officialRank?.all || {};
  const primary = all.xr || all.sciUp || all.esci || null;
  if (!primary && !all.sciif && !all.jci) return null;
  return {
    label: all.xr ? `新锐 ${all.xr}` : all.sciUp ? `中科院 ${all.sciUp}` : all.esci ? `JCR ${all.esci}` : '—',
    primary: all.xr ? { system: 'xr', rank: all.xr } : all.sciUp ? { system: 'cas', rank: all.sciUp } : { system: 'jcr', rank: all.esci },
    ranks: {
      cas: all.sciUp || null,
      casSmall: all.sciUpSmall || null,
      xr: all.xr || null,
      xrSmall: all.xrSmall || null,
      jcr: all.esci || null,
    },
    metrics: {
      impactFactor: all.sciif || null,
      impactFactor5y: all.sciif5 || null,
      jci: all.jci || null,
      ei: all.eii || null,
    },
    source: 'easyscholar',
    name,
  };
}

export async function syncVenues(baseDir, names, { secretKey, onProgress }) {
  const cache = await store.readJson(cachePath(baseDir), { schema: 1, items: {} });
  cache.items = cache.items || {};
  const unique = [...new Set(names.map((n) => String(n || '').trim()).filter(Boolean))];
  let fetched = 0;
  const errors = [];
  for (const name of unique) {
    if (cache.items[name]) continue;
    try {
      const data = await lookup(name, { secretKey });
      cache.items[name] = { name, fetched_at: new Date().toISOString(), data, tier: tierOfEasyScholar(name, data) };
      fetched += 1;
      onProgress?.(name, cache.items[name].tier, errors.length);
      await store.writeJsonAtomic(cachePath(baseDir), cache);
    } catch (error) {
      errors.push({ name, error: String(error?.message || error) });
    }
  }
  cache.updated_at = new Date().toISOString();
  await store.writeJsonAtomic(cachePath(baseDir), cache);
  return { fetched, cached: Object.keys(cache.items).length, errors };
}

export async function readVenueCache(baseDir) {
  return store.readJson(cachePath(baseDir), { schema: 1, items: {} });
}


/** 旧明文 key 迁移到 Host credentials，并删除文件。 */
export async function migrateKeyToCredentials(ctx, baseDir) {
  const legacy = await readKey(baseDir);
  if (!legacy) return false;
  if (!(await hasEasyScholarKey(ctx))) await setEasyScholarKey(ctx, legacy);
  await unlink(keyPath(baseDir)).catch(() => {});
  return true;
}

/** 缓存优先；没有缓存才用当前用户 key 查询一次。 */
export async function getOrFetchVenueTier(baseDir, name, ctx) {
  const clean = String(name || '').trim();
  if (!clean) return null;
  const cache = await store.readJson(cachePath(baseDir), { schema: 1, items: {} });
  if (cache.items?.[clean]?.tier) return cache.items[clean].tier;
  // 邮件/出版社常把期刊名截断成 "IEEE Transactions on Medical Robotics …"；先做前缀匹配。
  const needle = clean.toLowerCase().replace(/[.…\s]+$/g, '').trim();
  if (needle.length >= 18) {
    const hit = Object.values(cache.items || {}).find((item) => {
      const name = String(item.name || '').toLowerCase();
      return name === needle || name.startsWith(needle) || needle.startsWith(name);
    });
    if (hit?.tier) return hit.tier;
  }
  const secretKey = await getEasyScholarKey(ctx);
  if (!secretKey) return null;
  try {
    const data = await lookup(clean, { secretKey });
    const tier = tierOfEasyScholar(clean, data);
    cache.items = cache.items || {};
    cache.items[clean] = { name: clean, fetched_at: new Date().toISOString(), data, tier };
    cache.updated_at = new Date().toISOString();
    await store.writeJsonAtomic(cachePath(baseDir), cache);
    return tier;
  } catch {
    return null;
  }
}

export async function ensurePaperVenueTier(baseDir, paper, ctx) {
  if (!paper?.id || paper.venue_tier) return paper;
  const venue = paper.meta?.venue || paper.venue;
  if (!venue || /arxiv|dryad|preprint/i.test(venue)) return paper;
  let tier = await getOrFetchVenueTier(baseDir, venue, ctx);
  if (!tier) tier = venueTierFor(venue);
  if (!tier) return paper;
  await store.updateJson('data', store.statePaths(baseDir).papers, { papers: {} }, (db) => {
    const target = db.papers?.[paper.id];
    if (target && !target.venue_tier) {
      target.venue_tier = { ...tier, at: new Date().toISOString() };
      target.updated_at = new Date().toISOString();
    }
    return db;
  });
  return { ...paper, venue_tier: { ...tier, at: new Date().toISOString() } };
}
