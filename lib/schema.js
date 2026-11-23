/**
 * 状态文件 schema 台账：用 state/schema.json 记录每个文件的版本，
 * 迁移前备份，迁移可重复执行。不往 seen/watch 这类扁平 map 里塞 schema 字段。
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { existsSync } from 'node:fs';
import * as store from './store.js';

export const STATE_SCHEMAS = {
  papers: 2,
  candidates: 1,
  seen: 1,
  jobs: 1,
  harvests: 1,
  email: 1,
  schedule: 1,
  watch: 1,
};

function stamp() {
  return new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
}

export async function ensureStateSchemas(baseDir) {
  const paths = store.statePaths(baseDir);
  const manifestPath = path.join(paths.dir, 'schema.json');
  const manifest = await store.readJson(manifestPath, { schema: 1, files: {} });
  const files = { ...(manifest.files || {}) };
  let changed = false;
  let backupDir = null;

  for (const [name, version] of Object.entries(STATE_SCHEMAS)) {
    const file = paths[name];
    if (!file || !existsSync(file)) continue;
    if (Number(files[name] || 0) >= version) continue;
    if (!backupDir) {
      backupDir = path.join(paths.dir, 'backup', `${stamp()}-schema`);
      await fs.mkdir(backupDir, { recursive: true });
    }
    await fs.copyFile(file, path.join(backupDir, path.basename(file))).catch(() => {});
    files[name] = version;
    changed = true;
  }

  if (changed) {
    await store.writeJsonAtomic(manifestPath, {
      schema: 1,
      files,
      updated_at: new Date().toISOString(),
    });
  }
  return { changed, backupDir, files };
}
