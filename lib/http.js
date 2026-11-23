/**
 * 统一的 HTTP 访问层：超时、重试、退避、per-host 限速与冷却、条件请求。
 *
 * 只用 Node 自带 fetch，不引依赖。
 * 200/304 正常返回；4xx 直接抛错（429 例外：按 Retry-After 冷却后重试）；
 * 429/5xx/网络错误按指数退避重试。
 *
 * 另提供 fetchOnce：单次请求、可手动跟随重定向，给原文下载链路用（要逐跳校验）。
 */

const DEFAULT_UA = 'dsh-literature-lab/0.2';
const lastHitAt = new Map();
const cooldownUntil = new Map();
const MAX_WAIT_ON_COOLDOWN = 5000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** 记一次 host 冷却（429 或 Retry-After）。 */
export function coolDownHost(host, ms) {
  const value = Math.max(0, Math.min(10 * 60 * 1000, Number(ms) || 0));
  if (!host || !value) return;
  const until = Date.now() + value;
  if (until > (cooldownUntil.get(host) || 0)) cooldownUntil.set(host, until);
}

export function cooldownRemaining(host) {
  return Math.max(0, (cooldownUntil.get(host) || 0) - Date.now());
}

/** 测试与长跑进程用：清掉限速与冷却状态。 */
export function resetThrottle() {
  lastHitAt.clear();
  cooldownUntil.clear();
}

/** 从响应头读 Retry-After（秒或 HTTP 日期）。 */
export function retryAfterMs(headers) {
  const raw = typeof headers?.get === 'function' ? headers.get('retry-after') : headers?.['retry-after'];
  if (raw === null || raw === undefined || raw === '') return 0;
  const text = String(raw).trim();
  if (/^\d+$/.test(text)) return Math.min(10 * 60 * 1000, Number(text) * 1000);
  const at = Date.parse(text);
  if (Number.isFinite(at)) return Math.max(0, Math.min(10 * 60 * 1000, at - Date.now()));
  return 0;
}

async function waitForHost(host, minIntervalMs) {
  const remain = cooldownRemaining(host);
  if (remain > MAX_WAIT_ON_COOLDOWN) {
    throw Object.assign(new Error(`host 冷却中（${Math.ceil(remain / 1000)}s）`), { status: 429, cooldown: remain });
  }
  const wait = Math.max(remain, Math.max(0, (lastHitAt.get(host) || 0) - Date.now()));
  if (wait > 0) await sleep(wait);
  lastHitAt.set(host, Date.now() + Math.max(0, Number(minIntervalMs) || 0));
}

/**
 * @param {string} url
 * @param {{headers?:object, timeoutMs?:number, retries?:number, minIntervalMs?:number, as?:'text'|'buffer', method?:string, body?:string, redirect?:'follow'|'manual'|'error'}} options
 * @returns {Promise<{status:number, headers:Headers, body?:string|Buffer, url:string}>}
 */
export async function politeFetch(url, options = {}) {
  const {
    headers = {},
    timeoutMs = 20000,
    retries = 2,
    minIntervalMs = 1000,
    as = 'text',
    method = 'GET',
    body,
    redirect = 'follow',
  } = options;

  const host = new URL(url).host;
  let lastError = null;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    if (attempt > 0) {
      await sleep(Math.min(4000, 300 * 2 ** (attempt - 1)) + Math.random() * 250);
    }
    await waitForHost(host, minIntervalMs);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        method,
        headers: { 'user-agent': DEFAULT_UA, ...headers },
        ...(body === undefined ? {} : { body }),
        signal: controller.signal,
        redirect,
      });
      if (res.status === 304) {
        return { status: 304, headers: res.headers, url };
      }
      if (res.ok) {
        const payload = as === 'buffer' ? Buffer.from(await res.arrayBuffer()) : await res.text();
        return { status: res.status, headers: res.headers, body: payload, url };
      }
      if (res.status === 429) {
        const waitMs = retryAfterMs(res.headers) || 10 * 1000;
        coolDownHost(host, waitMs);
        lastError = Object.assign(new Error(`HTTP 429（${Math.ceil(waitMs / 1000)}s 冷却）`), { status: 429 });
        continue;
      }
      if (res.status >= 500) {
        lastError = Object.assign(new Error(`HTTP ${res.status}`), { status: res.status });
        continue;
      }
      throw Object.assign(new Error(`HTTP ${res.status}`), { status: res.status });
    } catch (error) {
      if (error?.status && error.status !== 429 && error.status < 500) throw error;
      lastError = error;
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError || new Error('request failed');
}

/**
 * 单次请求，不重试；redirect 默认 manual，由调用方逐跳处理。
 * 4xx/5xx 也照常返回（由调用方分类），只有网络层错误才抛。
 */
export async function fetchOnce(url, {
  headers = {},
  timeoutMs = 30000,
  redirect = 'manual',
  as = 'buffer',
  minIntervalMs = 500,
} = {}) {
  const host = new URL(url).host;
  await waitForHost(host, minIntervalMs);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: { 'user-agent': DEFAULT_UA, ...headers },
      signal: controller.signal,
      redirect,
    });
    let payload = null;
    if (res.ok) {
      payload = as === 'text' ? await res.text() : Buffer.from(await res.arrayBuffer());
    }
    return { ok: res.ok, status: res.status, headers: res.headers, body: payload, url };
  } finally {
    clearTimeout(timer);
  }
}
