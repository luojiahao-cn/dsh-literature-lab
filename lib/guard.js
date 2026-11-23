/**
 * 原文链路的判定层：PDF 字节完整性、HTML 拦截页归类、登录跳转识别、私网地址拦截。
 *
 * 这一层只做判断，不发请求，全部是纯函数，便于单测。
 * 分类顺序是有讲究的：先判「付费墙/登录」，再判「反爬」，否则付费墙会被统一报成机器人拦截，
 * 用户就不知道该去登录机构账号还是该换时间重试。
 */

export const PDF_MAGIC = '%PDF-';

/** 失败原因：下载结果里只出现这几个值，提示文案由 hintOf 统一给。 */
export const FAILURE = {
  NO_CANDIDATE: 'no-candidate',
  PAYWALLED: 'paywalled',
  BLOCKED: 'blocked',
  NOT_PDF: 'not-pdf',
  TRUNCATED: 'truncated',
  TOO_LARGE: 'too-large',
  FAILED: 'failed',
};

const HINTS = {
  [FAILURE.NO_CANDIDATE]: '没有找到可用的入口：在浏览器打开 DOI 页面手动保存，或用浏览器扩展抓取',
  [FAILURE.PAYWALLED]: '出版社要求订阅或登录：在浏览器登录机构账号（或配好 EZproxy/WebVPN）后重试',
  [FAILURE.BLOCKED]: '对方拦截了自动请求：用浏览器手动保存，或用浏览器扩展抓取',
  [FAILURE.NOT_PDF]: '返回的不是 PDF（多半是落地页）：用浏览器扩展从页面里抓',
  [FAILURE.TRUNCATED]: 'PDF 不完整（缺少文件尾）：换一个来源重试，或手动保存',
  [FAILURE.TOO_LARGE]: '文件超过大小上限，未保存',
  [FAILURE.FAILED]: '网络或服务器错误：稍后重试',
};

export function hintOf(code) {
  return HINTS[code] || HINTS[FAILURE.FAILED];
}

/** 跳过 BOM 与前导空白后看魔数。 */
export function looksLikePdf(head) {
  if (!head || head.length < 5) return false;
  let i = 0;
  if (head[0] === 0xef && head[1] === 0xbb && head[2] === 0xbf) i = 3;
  while (i < head.length && [0x20, 0x0a, 0x0d, 0x09].includes(head[i])) i += 1;
  return head.subarray(i, i + 5).toString('latin1') === PDF_MAGIC;
}

/** 文件尾必须同时有 %%EOF 与 startxref，否则多半是被截断的下载。 */
export function hasPdfTrailer(tail) {
  if (!tail || !tail.length) return false;
  const text = Buffer.isBuffer(tail) ? tail.toString('latin1') : String(tail);
  return text.includes('%%EOF') && text.includes('startxref');
}

/**
 * 完整判定：魔数 + 大小下限；strict 时还查文件尾。
 * @returns {{ok:boolean, code:string|null, truncated:boolean}}
 */
export function inspectPdf(buffer, { minBytes = 1024, strict = true } = {}) {
  if (!buffer || buffer.length < minBytes) return { ok: false, code: FAILURE.NOT_PDF, truncated: false };
  if (!looksLikePdf(buffer.subarray(0, 64))) return { ok: false, code: FAILURE.NOT_PDF, truncated: false };
  if (!strict) return { ok: true, code: null, truncated: false };
  const tail = buffer.subarray(Math.max(0, buffer.length - 4096));
  if (!hasPdfTrailer(tail)) return { ok: true, code: FAILURE.TRUNCATED, truncated: true };
  return { ok: true, code: null, truncated: false };
}

const PAYWALL_RE = /(sign in to|log in to|login to|sign in|log in|purchase|buy (this )?article|subscribe|subscription required|institutional access|access through your institution|access this article|get access|rent this article|check access|unlock)/i;
const BLOCK_RE = /(cloudflare|cf-chl|just a moment|attention required|checking your browser|enable javascript and cookies|captcha|access denied|request blocked|unusual traffic|too many requests|akamai|incapsula|perimeterx|ddos)/i;

/**
 * HTML 响应归类。headers 用 Headers 实例或普通对象都行。
 * @returns {'paywalled'|'blocked'|'not-pdf'}
 */
export function classifyHtml(text, headers = {}) {
  const body = String(text || '').slice(0, 8192);
  const get = (name) => (typeof headers?.get === 'function' ? headers.get(name) : headers?.[name]) || '';
  const server = String(get('server') || '').toLowerCase();
  if (PAYWALL_RE.test(body)) return FAILURE.PAYWALLED;
  if (get('cf-ray') || server.includes('cloudflare') || BLOCK_RE.test(body)) return FAILURE.BLOCKED;
  return FAILURE.NOT_PDF;
}

const LOGIN_HOST_RE = /^(login|idp|sso|auth|signin|shibboleth|wayf|cas)[.-]/i;
const LOGIN_PATH_RE = /\/(login|signin|sign-in|sso|shibboleth|auth|idp|cas)(\/|$|\?)/i;

/** 跳到登录/机构认证页：不再陪着重定向，直接判付费墙。 */
export function isLoginRedirect(url) {
  try {
    const u = new URL(String(url));
    if (LOGIN_HOST_RE.test(u.hostname)) return true;
    if (LOGIN_PATH_RE.test(u.pathname)) return true;
    if (/ezproxy|openathens|shibboleth|simplesaml|sso\./i.test(u.hostname + u.pathname)) return true;
    return false;
  } catch {
    return false;
  }
}

function isPrivateV4(host) {
  const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 0) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  return false;
}

/**
 * 只允许 http(s)，且默认不允许私网/环回/链路本地地址（防 SSRF）。
 * 机构 EZproxy 若在私网，用 allowHosts 显式放行。
 */
export function assertPublicUrl(raw, { allowHosts = [] } = {}) {
  let u;
  try {
    u = new URL(String(raw));
  } catch {
    throw Object.assign(new Error('不是合法 URL'), { code: FAILURE.FAILED });
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    throw Object.assign(new Error(`不允许的协议：${u.protocol}`), { code: FAILURE.FAILED });
  }
  const host = u.hostname.toLowerCase();
  if (allowHosts.some((h) => h && (host === h.toLowerCase() || host.endsWith(`.${h.toLowerCase()}`)))) return u;
  const blocked = host === 'localhost'
    || host === '::1'
    || host.endsWith('.localhost')
    || host.endsWith('.internal')
    || host.endsWith('.local')
    || isPrivateV4(host)
    || /^fc|^fd|^fe80:/i.test(host);
  if (blocked) throw Object.assign(new Error(`不允许访问内网地址：${host}`), { code: FAILURE.FAILED });
  return u;
}

/** 从落地页 HTML 里找出版社自己声明的 PDF 地址。 */
export function discoverPdfUrlFromHtml(html, baseUrl = '') {
  const src = String(html || '');
  const meta = src.match(/<meta[^>]+name=["']citation_pdf_url["'][^>]*content=["']([^"']+)["']/i)
    || src.match(/<meta[^>]+content=["']([^"']+)["'][^>]*name=["']citation_pdf_url["']/i);
  if (meta) return absoluteUrl(meta[1], baseUrl);
  const alternate = src.match(/<link[^>]+type=["']application\/pdf["'][^>]*href=["']([^"']+)["']/i)
    || src.match(/<link[^>]+href=["']([^"']+)["'][^>]*type=["']application\/pdf["']/i);
  if (alternate) return absoluteUrl(alternate[1], baseUrl);
  return null;
}

function absoluteUrl(raw, baseUrl) {
  const value = String(raw || '').trim();
  if (!value) return null;
  if (/^https?:\/\//i.test(value)) return value;
  try {
    return new URL(value, baseUrl || undefined).toString();
  } catch {
    return null;
  }
}
