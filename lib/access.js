/**
 * 机构访问：把「用户自己学校的订阅权限」接进下载链路。
 *
 * 三种方式，全部由用户自己配置，插件不带任何凭据：
 * - ezproxy：按模板改写 URL，请求带上己方会话 Cookie；
 * - webvpn：按用户给的正则改写 URL（各校 WebVPN 规则不同，不能硬编码）；
 * - direct：不改写，只在指定域名上附加 Cookie（CARSI/Shibboleth 登录后的会话就是这样用）。
 *
 * 边界：这里只负责「带着用户自己的授权访问」，不提供任何第三方镜像或代理站点。
 * Cookie 走 host 凭据服务，不落 config、不进仓库。
 */

const DEFAULT_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36';

function str(value) {
  return String(value || '').trim();
}

/** 归一化下载/访问配置，缺省即关闭。 */
export function accessOf(config) {
  const raw = config?.download?.access || {};
  const mode = ['ezproxy', 'webvpn', 'direct'].includes(raw.mode) ? raw.mode : 'none';
  const ez = raw.ezproxy || {};
  const vpn = raw.webvpn || {};
  const session = raw.browserSession || {};
  return {
    mode,
    enabled: mode !== 'none',
    ezproxyTemplate: str(ez.template),
    webvpnPattern: str(vpn.pattern),
    webvpnReplacement: str(vpn.replacement),
    userAgent: str(session.userAgent) || DEFAULT_UA,
    cookieSecret: str(session.cookieSecret) || '',
    institutionalHosts: (Array.isArray(raw.institutionalHosts) ? raw.institutionalHosts : [])
      .map((h) => str(h).toLowerCase()).filter(Boolean),
    allowPrivateHosts: (Array.isArray(raw.allowPrivateHosts) ? raw.allowPrivateHosts : [])
      .map((h) => str(h).toLowerCase()).filter(Boolean),
  };
}

function hostOf(raw) {
  try {
    return new URL(String(raw)).hostname.toLowerCase();
  } catch {
    return '';
  }
}

function hostMatches(host, suffix) {
  const h = String(host || '').toLowerCase();
  const s = String(suffix || '').toLowerCase();
  return Boolean(s) && (h === s || h.endsWith(`.${s}`));
}

/** 该 URL 是否属于「可以附加会话 Cookie」的机构域名。 */
export function isInstitutionalUrl(raw, access) {
  if (!access?.enabled) return false;
  let host = '';
  try {
    host = new URL(String(raw)).hostname;
  } catch {
    return false;
  }
  if (access.institutionalHosts.some((suffix) => hostMatches(host, suffix))) return true;
  const probe = access.mode === 'ezproxy' && access.ezproxyTemplate
    ? access.ezproxyTemplate.replace('{url}', 'x')
    : access.mode === 'webvpn'
      ? access.webvpnReplacement
      : '';
  const m = String(probe || '').match(/([a-z0-9-]+(?:\.[a-z0-9-]+)+)/i);
  return Boolean(m) && hostMatches(host, m[1]);
}

/**
 * 按配置改写 URL。
 * @returns {{url:string, rewritten:boolean, note:string|null}}
 */
export function rewriteForAccess(raw, access) {
  const url = String(raw || '');
  if (!url || !access?.enabled) return { url, rewritten: false, note: null };
  if (access.mode === 'ezproxy') {
    if (!access.ezproxyTemplate) return { url, rewritten: false, note: 'ezproxy-template-missing' };
    if (!access.ezproxyTemplate.includes('{url}')) return { url, rewritten: false, note: 'ezproxy-template-needs-{url}' };
    // 已经在代理域名上：不要再套一层（重定向后的每一跳都会过这里）
    const proxyHost = hostOf(access.ezproxyTemplate.replace('{url}', 'x'));
    if (proxyHost && hostOf(url) === proxyHost) return { url, rewritten: false, note: 'already-proxied' };
    return {
      url: access.ezproxyTemplate.split('{url}').join(encodeURIComponent(url)),
      rewritten: true,
      note: null,
    };
  }
  if (access.mode === 'webvpn') {
    if (!access.webvpnPattern || !access.webvpnReplacement) {
      return { url, rewritten: false, note: 'webvpn-rule-missing' };
    }
    try {
      const pattern = new RegExp(access.webvpnPattern);
      if (!pattern.test(url)) return { url, rewritten: false, note: 'webvpn-rule-no-match' };
      const next = url.replace(pattern, access.webvpnReplacement);
      return { url: next === url ? url : next, rewritten: next !== url, note: next === url ? 'webvpn-rule-no-change' : null };
    } catch {
      return { url, rewritten: false, note: 'webvpn-rule-invalid' };
    }
  }
  return { url, rewritten: false, note: null };
}

/**
 * 给一次请求配请求头：只有机构域名才带 Cookie，避免把己方凭据发给无关站点。
 * @returns {{headers:object, carriedCookie:boolean}}
 */
export function headersForAccess(raw, access, { cookie = '' } = {}) {
  const headers = {};
  if (access?.enabled) headers['user-agent'] = access.userAgent;
  if (!cookie) return { headers, carriedCookie: false };
  let host = '';
  try {
    host = new URL(String(raw)).hostname;
  } catch {
    return { headers, carriedCookie: false };
  }
  let allowed = access.institutionalHosts.some((suffix) => hostMatches(host, suffix));
  if (!allowed && access.mode === 'ezproxy' && access.ezproxyTemplate) {
    try {
      allowed = hostMatches(host, new URL(access.ezproxyTemplate.replace('{url}', 'x')).hostname);
    } catch { /* 模板不合法就不带 Cookie */ }
  }
  if (access.mode === 'webvpn' && access.webvpnReplacement) {
    // 改写后多数学校域名形如 <host>.<school>.webvpn.<edu>，按替换串里出现的域名再放行一次
    const m = access.webvpnReplacement.match(/([a-z0-9-]+(?:\.[a-z0-9-]+)+)/i);
    if (m && hostMatches(host, m[1])) allowed = true;
  }
  if (!allowed) return { headers, carriedCookie: false };
  headers.cookie = cookie;
  return { headers, carriedCookie: true };
}

/** 一次候选的重写着陆页：EZproxy 下 DOI 落地页也要改写。 */
export function landingForAccess(raw, access) {
  return rewriteForAccess(raw, access);
}
