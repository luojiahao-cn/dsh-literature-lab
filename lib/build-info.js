/**
 * 运行时代码新鲜度：插件服务端代码在 DSH 启动时加载，
 * lib/ 改动后只有完全重启才生效。这里对比「启动时间」与「lib 最新 mtime」，
 * 供界面提示用户重启，避免把旧进程的结果当成新逻辑。
 */
import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const SERVER_STARTED_AT = new Date().toISOString();

const LIB_DIR = path.dirname(fileURLToPath(import.meta.url));
let cache = { at: 0, newest: 0 };

function newestLibMtime() {
  const now = Date.now();
  if (now - cache.at < 30_000) return cache.newest;
  let newest = 0;
  try {
    for (const name of readdirSync(LIB_DIR)) {
      if (!name.endsWith('.js')) continue;
      newest = Math.max(newest, statSync(path.join(LIB_DIR, name)).mtimeMs);
    }
    const handlers = path.join(LIB_DIR, 'http');
    for (const name of readdirSync(handlers)) {
      if (!name.endsWith('.js')) continue;
      newest = Math.max(newest, statSync(path.join(handlers, name)).mtimeMs);
    }
  } catch { /* 取不到就不提示 */ }
  cache = { at: now, newest };
  return newest;
}

/** { startedAt, newestMtime, stale }：stale=true 表示 lib 在启动后被改过。 */
export function buildInfo() {
  const newest = newestLibMtime();
  return {
    startedAt: SERVER_STARTED_AT,
    newestMtime: newest ? new Date(newest).toISOString() : null,
    stale: newest > Date.parse(SERVER_STARTED_AT),
  };
}
