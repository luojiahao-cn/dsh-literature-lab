/**
 * 条目级租约：同一 candidate/paper 在 TTL 内只能被一个 runner 处理。
 * 分析 runner 已有进程内串行锁；claims 是给未来多进程/多入口用的显式凭据，
 * 也方便崩溃后按过期时间回收，而不是只看 status=analyzing。
 */
import path from 'node:path';
import * as store from './store.js';

function claimsFile(baseDir) {
  return path.join(store.statePaths(baseDir).dir, 'claims.json');
}

export async function acquireClaim(baseDir, key, { ttlMs = 30 * 60 * 1000, owner = '' } = {}) {
  return store.withLock('claims', async () => {
    const db = await store.readJson(claimsFile(baseDir), { claims: {} });
    const claims = db.claims || {};
    const now = Date.now();
    for (const [id, claim] of Object.entries(claims)) {
      if (Number(claim?.exp) <= now) delete claims[id];
    }
    if (claims[key]) return { ok: false, claim: claims[key] };
    const claim = { key, owner, at: new Date().toISOString(), exp: now + Math.max(1, Number(ttlMs) || 0) };
    claims[key] = claim;
    await store.writeJsonAtomic(claimsFile(baseDir), { claims });
    return { ok: true, claim };
  });
}

export async function releaseClaim(baseDir, key, owner = '') {
  return store.withLock('claims', async () => {
    const db = await store.readJson(claimsFile(baseDir), { claims: {} });
    const claims = db.claims || {};
    const current = claims[key];
    if (!current) return false;
    if (owner && current.owner && current.owner !== owner) return false;
    delete claims[key];
    await store.writeJsonAtomic(claimsFile(baseDir), { claims });
    return true;
  });
}

export async function readClaims(baseDir) {
  const db = await store.readJson(claimsFile(baseDir), { claims: {} });
  return db.claims || {};
}
