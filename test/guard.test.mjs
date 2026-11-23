import test from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyHtml, discoverPdfUrlFromHtml, hasPdfTrailer, hintOf, inspectPdf, isLoginRedirect, looksLikePdf, assertPublicUrl, FAILURE,
} from '../lib/guard.js';

const good = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(2048, 0x20), Buffer.from('\nstartxref\n42\n%%EOF\n')]);

test('guard：魔数与文件尾', () => {
  assert.equal(looksLikePdf(Buffer.from('%PDF-1.7')), true);
  assert.equal(looksLikePdf(Buffer.from('\ufeff  %PDF-1.4')), true, 'BOM 与前导空白要跳过');
  assert.equal(looksLikePdf(Buffer.from('<html>')), false);
  assert.equal(hasPdfTrailer(Buffer.from('trailer\nstartxref\n9\n%%EOF')), true);
  assert.equal(hasPdfTrailer(Buffer.from('startxref only')), false);
});

test('guard：完整判定区分「不是 PDF」与「被截断」', () => {
  assert.equal(inspectPdf(good).ok, true);
  assert.equal(inspectPdf(good).code, null);
  const truncated = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(2048, 0x20)]);
  const verdict = inspectPdf(truncated);
  assert.equal(verdict.ok, true);
  assert.equal(verdict.code, FAILURE.TRUNCATED);
  assert.equal(verdict.truncated, true);
  assert.equal(inspectPdf(Buffer.from('<html>x</html>')).code, FAILURE.NOT_PDF);
  assert.equal(inspectPdf(Buffer.from('%PDF-')).code, FAILURE.NOT_PDF, '太小的文件不能当 PDF');
});

test('guard：HTML 归类先判付费墙再判反爬', () => {
  const paywall = '<html><body>Sign in to your account or purchase this article</body></html>';
  const cf = '<html><body>Just a moment... checking your browser</body></html>';
  assert.equal(classifyHtml(paywall, new Headers()), FAILURE.PAYWALLED);
  // 同时出现订阅词与 Cloudflare 时，付费墙优先，否则用户不知道该去登录
  assert.equal(classifyHtml(`${paywall}${cf}`, new Headers({ 'cf-ray': 'abc' })), FAILURE.PAYWALLED);
  assert.equal(classifyHtml(cf, new Headers()), FAILURE.BLOCKED);
  assert.equal(classifyHtml('<html>plain landing page</html>', new Headers()), FAILURE.NOT_PDF);
});

test('guard：登录跳转与私网地址', () => {
  assert.equal(isLoginRedirect('https://idp.example.edu/idp/profile/SAML2'), true);
  assert.equal(isLoginRedirect('https://www.sciencedirect.com/login?return='), true);
  assert.equal(isLoginRedirect('https://ezproxy.example.edu/login?url=x'), true);
  assert.equal(isLoginRedirect('https://arxiv.org/pdf/2611.1'), false);

  assert.throws(() => assertPublicUrl('http://127.0.0.1/x'));
  assert.throws(() => assertPublicUrl('http://192.168.1.10/x'));
  assert.throws(() => assertPublicUrl('http://10.0.0.2/x'));
  assert.throws(() => assertPublicUrl('ftp://example.com/x'));
  assert.doesNotThrow(() => assertPublicUrl('https://arxiv.org/pdf/1'));
  // 机构 EZproxy 常在私网：显式放行后可用
  assert.doesNotThrow(() => assertPublicUrl('http://10.0.0.2/x', { allowHosts: ['10.0.0.2'] }));
});

test('guard：从落地页找 citation_pdf_url', () => {
  const html = '<meta name="citation_pdf_url" content="/content/pdf/10.1186%2Fs1.pdf">';
  assert.equal(discoverPdfUrlFromHtml(html, 'https://link.springer.com/article/1'), 'https://link.springer.com/content/pdf/10.1186%2Fs1.pdf');
  assert.equal(discoverPdfUrlFromHtml('<html>nothing</html>'), null);
  assert.ok(hintOf(FAILURE.PAYWALLED).includes('登录'));
});
