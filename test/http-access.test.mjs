import test from 'node:test';
import assert from 'node:assert/strict';
import { configureHttp, handleAccessTest, handleCredentials } from '../index.js';
import { resetThrottle } from '../lib/http.js';
import { bufferResponse, makeBase, stubFetch, textResponse } from './helpers.mjs';

function mockCtx(store = {}) {
  return {
    get: (name) => (name === 'credentials' ? {
      describe: async (ref) => ({ configured: Boolean(store[ref]) }),
      resolve: async (ref) => ({ value: store[ref] || '' }),
      set: async (ref, value) => { store[ref] = value; },
      unset: async (ref) => { delete store[ref]; },
    } : undefined),
  };
}

function post(path, body) {
  return new Request('http://127.0.0.1' + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const goodPdf = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(2048, 0x20), Buffer.from('\nstartxref\n9\n%%EOF\n')]);

test('credentials：机构会话 Cookie 只写不读回', async () => {
  const base = await makeBase();
  const store = {};
  configureHttp({ baseDir: base, ctx: mockCtx(store) });

  const before = await (await handleCredentials(new Request('http://127.0.0.1/api/dsh-literature-lab/credentials'))).json();
  assert.equal(before.hasInstitutionalCookie, false);

  const saved = await (await handleCredentials(post('/api/dsh-literature-lab/credentials', { institutionalCookie: 'SESS=abc' }))).json();
  assert.equal(saved.ok, true);
  assert.equal(saved.hasInstitutionalCookie, true);
  assert.equal(JSON.stringify(saved).includes('SESS=abc'), false, '接口不回传 Cookie 值');

  const cleared = await (await handleCredentials(post('/api/dsh-literature-lab/credentials', { institutionalCookie: '' }))).json();
  assert.equal(cleared.hasInstitutionalCookie, false);
});

test('access/test：按机构配置真的取一次 PDF', async () => {
  resetThrottle();
  const base = await makeBase({
    download: {
      access: {
        mode: 'direct',
        institutionalHosts: ['publisher.example'],
        browserSession: { cookieSecret: 'TEST_COOKIE_REF' },
      },
    },
  });
  const store = { TEST_COOKIE_REF: 'SESS=abc' };
  configureHttp({ baseDir: base, ctx: mockCtx(store) });
  const calls = stubFetch([{ match: 'publisher.example', respond: () => bufferResponse(goodPdf, { headers: { 'content-type': 'application/pdf' } }) }]);

  const res = await handleAccessTest(post('/api/dsh-literature-lab/access/test', { url: 'https://publisher.example/a.pdf' }));
  const data = await res.json();
  assert.equal(data.ok, true);
  assert.equal(data.isPdf, true);
  assert.equal(data.truncated, false);
  assert.ok(data.bytes > 1024);
  assert.equal(calls[0].headers.cookie, 'SESS=abc', '机构域名上要带会话 Cookie');
});

test('access/test：付费墙返回可行动的原因', async () => {
  resetThrottle();
  const base = await makeBase({
    download: { access: { mode: 'direct', institutionalHosts: ['wall.example'] } },
  });
  configureHttp({ baseDir: base, ctx: mockCtx({}) });
  stubFetch([{
    match: 'wall.example',
    respond: () => textResponse('<html>Sign in to access this article</html>', { headers: { 'content-type': 'text/html' } }),
  }]);

  const res = await handleAccessTest(post('/api/dsh-literature-lab/access/test', { url: 'https://wall.example/article/1' }));
  const data = await res.json();
  assert.equal(data.ok, true);
  assert.equal(data.isPdf, false);
  assert.equal(data.code, 'paywalled');
  assert.match(data.hint, /登录/);
});

test('access/test：非法链接直接拒绝', async () => {
  const base = await makeBase();
  configureHttp({ baseDir: base, ctx: mockCtx({}) });
  const res = await handleAccessTest(post('/api/dsh-literature-lab/access/test', { url: 'javascript:alert(1)' }));
  assert.equal(res.status, 400);
});
