/**
 * PDF 抓取层：手动跟随重定向、逐跳校验、按响应内容分类失败原因。
 *
 * 为什么不用 fetch 自动跟随：
 * - 自动跟随时看不清「从出版社跳到了登录页」，只能拿到一个 HTML，最后报 not-a-pdf；
 * - 逐跳可以把 paywalled / blocked / not-pdf 分开，用户才知道下一步该干什么。
 */
import { fetchOnce, coolDownHost, retryAfterMs } from './http.js';
import {
  FAILURE, classifyHtml, discoverPdfUrlFromHtml, hintOf, inspectPdf, looksLikePdf, isLoginRedirect, assertPublicUrl,
} from './guard.js';
import { headersForAccess, rewriteForAccess } from './access.js';

export class PdfError extends Error {
  constructor(code, message, extra = {}) {
    super(message || hintOf(code));
    this.name = 'PdfError';
    this.code = code || FAILURE.FAILED;
    this.hint = hintOf(this.code);
    this.status = extra.status ?? null;
    this.hops = extra.hops || [];
    this.finalUrl = extra.finalUrl || null;
  }
}

const MAX_BYTES_DEFAULT = 80 * 1024 * 1024;
const MAX_HOPS_DEFAULT = 5;

function isHtmlResponse(headers, body) {
  const type = String((typeof headers?.get === 'function' ? headers.get('content-type') : headers?.['content-type']) || '').toLowerCase();
  if (type.includes('text/html')) return true;
  const head = Buffer.isBuffer(body) ? body.subarray(0, 64).toString('latin1').trim() : '';
  return head.startsWith('<');
}

function asText(body) {
  if (Buffer.isBuffer(body)) return body.subarray(0, 8192).toString('utf8');
  return String(body || '');
}

/**
 * 抓一份 PDF。
 * @returns {Promise<{ok:true, buffer:Buffer, bytes:number, truncated:boolean, hops:Array, finalUrl:string}>}
 * @throws {PdfError}
 */
export async function fetchPdf(url, {
  access = null,
  cookie = '',
  maxBytes = MAX_BYTES_DEFAULT,
  maxHops = MAX_HOPS_DEFAULT,
  timeoutMs = 60000,
  allowPrivateHosts = [],
  referer = null,
  minIntervalMs = 500,
} = {}) {
  let current = String(url || '');
  const hops = [];
  for (let hop = 0; hop < maxHops; hop += 1) {
    const moved = rewriteForAccess(current, access);
    const target = moved.url;
    assertPublicUrl(target, { allowHosts: allowPrivateHosts });
    const carried = headersForAccess(target, access, { cookie });
    const headers = { accept: 'application/pdf,application/octet-stream;q=0.9,*/*;q=0.5', ...carried.headers };
    if (referer) headers.referer = referer;
    const startedAt = Date.now();
    let res;
    try {
      res = await fetchOnce(target, { headers, timeoutMs, redirect: 'manual', minIntervalMs });
    } catch (error) {
      hops.push({ url: target, status: null, error: String(error?.message || error), ms: Date.now() - startedAt });
      throw new PdfError(FAILURE.FAILED, `请求失败：${error?.message || error}`, { hops, finalUrl: target });
    }
    hops.push({ url: target, status: res.status, ms: Date.now() - startedAt });

    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location');
      if (!location) throw new PdfError(FAILURE.FAILED, '重定向缺少 Location', { hops, finalUrl: target, status: res.status });
      let next;
      try {
        next = new URL(location, target).toString();
      } catch {
        throw new PdfError(FAILURE.FAILED, '重定向地址不合法', { hops, finalUrl: target, status: res.status });
      }
      if (isLoginRedirect(next)) {
        throw new PdfError(FAILURE.PAYWALLED, '跳转到登录/机构认证页', { hops: [...hops, { url: next, status: null, note: 'login-redirect' }], finalUrl: next, status: res.status });
      }
      current = next;
      continue;
    }
    if (res.status === 401 || res.status === 402) {
      throw new PdfError(FAILURE.PAYWALLED, `需要订阅或登录（HTTP ${res.status}）`, { hops, finalUrl: target, status: res.status });
    }
    if (res.status === 429) {
      const waitMs = retryAfterMs(res.headers) || 10 * 1000;
      coolDownHost(new URL(target).host, waitMs);
      throw new PdfError(FAILURE.BLOCKED, `被限流（HTTP 429，冷却 ${Math.ceil(waitMs / 1000)}s）`, { hops, finalUrl: target, status: res.status });
    }
    if (res.status === 403) {
      throw new PdfError(FAILURE.BLOCKED, '被拒绝（HTTP 403）', { hops, finalUrl: target, status: res.status });
    }
    if (!res.ok || !res.body) {
      throw new PdfError(FAILURE.FAILED, `HTTP ${res.status}`, { hops, finalUrl: target, status: res.status });
    }
    const buffer = Buffer.isBuffer(res.body) ? res.body : Buffer.from(res.body);
    if (buffer.length > maxBytes) {
      throw new PdfError(FAILURE.TOO_LARGE, `文件 ${buffer.length} 字节，超过上限 ${maxBytes}`, { hops, finalUrl: target, status: res.status });
    }
    if (isHtmlResponse(res.headers, buffer) || !looksLikePdf(buffer.subarray(0, 64))) {
      if (isHtmlResponse(res.headers, buffer)) {
        const code = classifyHtml(asText(buffer), res.headers);
        throw new PdfError(code, code === FAILURE.PAYWALLED ? '返回的是订阅/登录页' : '返回的是拦截页或落地页', { hops, finalUrl: target, status: res.status });
      }
      throw new PdfError(FAILURE.NOT_PDF, '返回内容不是 PDF', { hops, finalUrl: target, status: res.status });
    }
    const verdict = inspectPdf(buffer, { strict: true });
    if (!verdict.ok) throw new PdfError(verdict.code || FAILURE.NOT_PDF, 'PDF 校验未通过', { hops, finalUrl: target, status: res.status });
    return {
      ok: true,
      buffer,
      bytes: buffer.length,
      truncated: Boolean(verdict.truncated),
      hops,
      finalUrl: target,
    };
  }
  throw new PdfError(FAILURE.FAILED, `重定向超过 ${maxHops} 跳`, { hops, finalUrl: current });
}

/** 从落地页 HTML 里找出版社自己声明的 PDF 地址（citation_pdf_url）。 */
export async function discoverPdfFromLanding(url, {
  access = null, cookie = '', timeoutMs = 30000, allowPrivateHosts = [],
} = {}) {
  const moved = rewriteForAccess(url, access);
  assertPublicUrl(moved.url, { allowHosts: allowPrivateHosts });
  const carried = headersForAccess(moved.url, access, { cookie });
  let res;
  try {
    res = await fetchOnce(moved.url, {
      headers: { accept: 'text/html,application/xhtml+xml', ...carried.headers },
      timeoutMs,
      redirect: 'follow',
      as: 'text',
    });
  } catch {
    return null;
  }
  if (!res.ok || !res.body) return null;
  const found = discoverPdfUrlFromHtml(res.body, res.url || moved.url);
  return found || null;
}
