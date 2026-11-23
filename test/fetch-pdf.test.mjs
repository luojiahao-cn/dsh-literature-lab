import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchPdf, discoverPdfFromLanding, PdfError } from '../lib/fetch-pdf.js';
import { cooldownRemaining, resetThrottle } from '../lib/http.js';
import { bufferResponse, textResponse, stubFetch } from './helpers.mjs';

const goodPdf = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(2048, 0x20), Buffer.from('\nstartxref\n42\n%%EOF\n')]);
const barePdf = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(2048, 0x20)]);

function redirectTo(location, status = 302) {
  return {
    ok: false, status, headers: new Headers({ location }), text: async () => '', arrayBuffer: async () => new ArrayBuffer(0),
  };
}

test('fetch-pdf：跳到登录页直接判付费墙', async () => {
  resetThrottle();
  stubFetch([
    { match: 'publisher.example', respond: () => redirectTo('https://idp.school.edu/idp/profile/SAML2') },
  ]);
  await assert.rejects(
    () => fetchPdf('https://publisher.example/article', { minIntervalMs: 0 }),
    (error) => {
      assert.equal(error instanceof PdfError, true);
      assert.equal(error.code, 'paywalled');
      assert.match(error.hint, /登录/);
      assert.equal(error.hops.length >= 2, true);
      return true;
    },
  );
});

test('fetch-pdf：403 判 blocked，429 记冷却', async () => {
  resetThrottle();
  stubFetch([{ match: 'blocked.example', respond: () => ({ ok: false, status: 403, headers: new Headers(), text: async () => '', arrayBuffer: async () => new ArrayBuffer(0) }) }]);
  await assert.rejects(() => fetchPdf('https://blocked.example/x', { minIntervalMs: 0 }), (e) => e.code === 'blocked');

  resetThrottle();
  stubFetch([{
    match: 'limited.example',
    respond: () => ({
      ok: false, status: 429, headers: new Headers({ 'retry-after': '30' }), text: async () => '', arrayBuffer: async () => new ArrayBuffer(0),
    }),
  }]);
  await assert.rejects(() => fetchPdf('https://limited.example/x', { minIntervalMs: 0 }), (e) => e.code === 'blocked');
  assert.ok(cooldownRemaining('limited.example') > 0, '429 要给该 host 记冷却');
});

test('fetch-pdf：HTML 付费墙页面按付费墙报，不按「不是 PDF」', async () => {
  resetThrottle();
  stubFetch([{
    match: 'wall.example',
    respond: () => textResponse('<html><body>Sign in to access this article</body></html>', { headers: { 'content-type': 'text/html' } }),
  }]);
  await assert.rejects(() => fetchPdf('https://wall.example/x', { minIntervalMs: 0 }), (e) => e.code === 'paywalled');

  resetThrottle();
  stubFetch([{
    match: 'plain.example',
    respond: () => textResponse('<html><body>hello</body></html>', { headers: { 'content-type': 'text/html' } }),
  }]);
  await assert.rejects(() => fetchPdf('https://plain.example/x', { minIntervalMs: 0 }), (e) => e.code === 'not-pdf');
});

test('fetch-pdf：截断的 PDF 照收但标记', async () => {
  resetThrottle();
  stubFetch([{ match: 'half.example', respond: () => bufferResponse(barePdf) }]);
  const got = await fetchPdf('https://half.example/x.pdf', { minIntervalMs: 0 });
  assert.equal(got.ok, true);
  assert.equal(got.truncated, true);
  assert.equal(got.bytes, barePdf.length);

  resetThrottle();
  stubFetch([{ match: 'full.example', respond: () => bufferResponse(goodPdf) }]);
  const full = await fetchPdf('https://full.example/x.pdf', { minIntervalMs: 0 });
  assert.equal(full.truncated, false);
});

test('fetch-pdf：从落地页的 citation_pdf_url 找到真 PDF', async () => {
  resetThrottle();
  stubFetch([
    {
      match: 'landing.example',
      respond: () => textResponse('<meta name="citation_pdf_url" content="https://landing.example/files/a.pdf">', { headers: { 'content-type': 'text/html' } }),
    },
  ]);
  const found = await discoverPdfFromLanding('https://landing.example/article/1', {});
  assert.equal(found, 'https://landing.example/files/a.pdf');
});
