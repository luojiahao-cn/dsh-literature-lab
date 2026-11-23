/**
 * 凭据：走 DSH host 的 credentials 服务，每个用户在自己的机器上保存。
 *
 * 插件要分享给别人用，密钥不能写进 config、不能进仓库、不能靠个人凭据库。
 * ref 用插件命名空间；/config 只回 hasApiKey，永不回传值。
 */
import { readConfig, writeUserConfig } from './config.js';

export const ZOTERO_API_KEY_REF = 'DSH_LITERATURE_LAB_ZOTERO_API_KEY';
export const EASYSCHOLAR_KEY_REF = 'DSH_LITERATURE_LAB_EASYSCHOLAR_KEY';
/** 机构会话 Cookie（EZproxy / WebVPN / CARSI 登录后的浏览器 Cookie）。只在本机凭据里，不进 config。 */
export const INSTITUTIONAL_COOKIE_REF = 'DSH_LITERATURE_LAB_INSTITUTIONAL_COOKIE';

function credentialsOf(ctx) {
  const credentials = ctx?.get?.('credentials');
  if (!credentials) throw new Error('凭据服务不可用（host 未加载 credentials）');
  return credentials;
}

export async function hasZoteroKey(ctx) {
  try {
    const info = await credentialsOf(ctx).describe(ZOTERO_API_KEY_REF);
    return Boolean(info?.configured);
  } catch {
    return false;
  }
}

export async function getZoteroKey(ctx) {
  const credentials = credentialsOf(ctx);
  const resolved = await credentials.resolve(ZOTERO_API_KEY_REF);
  return resolved?.value || '';
}

export async function setZoteroKey(ctx, value) {
  const text = String(value || '').trim();
  const credentials = credentialsOf(ctx);
  if (!text) {
    await credentials.unset(ZOTERO_API_KEY_REF);
    return false;
  }
  await credentials.set(ZOTERO_API_KEY_REF, text);
  return true;
}

/**
 * 把旧 config 里的 apiKey 迁到 credentials，并从用户配置删除。
 * 只在启动时跑一次；没有旧值就什么都不做。
 */
export async function migrateZoteroKey(ctx, baseDir) {
  const config = await readConfig(baseDir);
  const legacy = config?.integrations?.zotero?.apiKey;
  if (!legacy) return false;
  await credentialsOf(ctx).set(ZOTERO_API_KEY_REF, String(legacy));
  await writeUserConfig(baseDir, { integrations: { zotero: { apiKey: null } } });
  return true;
}

/** 内部用：读配置并把 key 填进去（只在 host 内部，不返回给浏览器）。 */
export async function readConfigWithSecrets(ctx, baseDir) {
  const config = await readConfig(baseDir);
  const key = await getZoteroKey(ctx);
  config.integrations = config.integrations || {};
  config.integrations.zotero = { ...(config.integrations.zotero || {}), apiKey: key };
  return config;
}


export async function hasEasyScholarKey(ctx) {
  try {
    const info = await credentialsOf(ctx).describe(EASYSCHOLAR_KEY_REF);
    return Boolean(info?.configured);
  } catch {
    return false;
  }
}

export async function getEasyScholarKey(ctx) {
  try {
    const resolved = await credentialsOf(ctx).resolve(EASYSCHOLAR_KEY_REF);
    return resolved?.value || '';
  } catch {
    return '';
  }
}

export async function setEasyScholarKey(ctx, value) {
  const text = String(value || '').trim();
  const credentials = credentialsOf(ctx);
  if (!text) {
    await credentials.unset(EASYSCHOLAR_KEY_REF);
    return false;
  }
  await credentials.set(EASYSCHOLAR_KEY_REF, text);
  return true;
}

/** 机构会话 Cookie：没有配置或服务不可用时返回空串，下载链路自动退回匿名访问。 */
export async function getInstitutionalCookie(ctx, ref = '') {
  if (!ctx) return '';
  try {
    const resolved = await credentialsOf(ctx).resolve(ref || INSTITUTIONAL_COOKIE_REF);
    return String(resolved?.value || '').trim();
  } catch {
    return '';
  }
}

export async function setInstitutionalCookie(ctx, value, ref = '') {
  const text = String(value || '').trim();
  if (!ctx) throw new Error('凭据服务不可用（host 未加载 credentials）');
  const credentials = credentialsOf(ctx);
  if (!text) {
    await credentials.unset(ref || INSTITUTIONAL_COOKIE_REF);
    return false;
  }
  await credentials.set(ref || INSTITUTIONAL_COOKIE_REF, text);
  return true;
}

export async function hasInstitutionalCookie(ctx, ref = '') {
  if (!ctx) return false;
  try {
    const info = await credentialsOf(ctx).describe(ref || INSTITUTIONAL_COOKIE_REF);
    return Boolean(info?.configured);
  } catch {
    return false;
  }
}

