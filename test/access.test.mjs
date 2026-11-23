import test from 'node:test';
import assert from 'node:assert/strict';
import { accessOf, headersForAccess, rewriteForAccess } from '../lib/access.js';

const ez = accessOf({
  download: {
    access: {
      mode: 'ezproxy',
      ezproxy: { template: 'https://ezproxy.school.edu/login?url={url}' },
      institutionalHosts: ['sciencedirect.com'],
    },
  },
});

test('access：ezproxy 按模板改写并编码', () => {
  const out = rewriteForAccess('https://www.sciencedirect.com/science/article/pii/S1', ez);
  assert.equal(out.rewritten, true);
  assert.ok(out.url.startsWith('https://ezproxy.school.edu/login?url='));
  assert.ok(out.url.includes(encodeURIComponent('https://www.sciencedirect.com/science/article/pii/S1')));

  // 重定向后回落到代理域名：不能套第二层
  const again = rewriteForAccess('https://ezproxy.school.edu/login?url=https%3A%2F%2Fa.org%2Fb', ez);
  assert.equal(again.rewritten, false);
  assert.equal(again.note, 'already-proxied');

  const broken = rewriteForAccess('https://x.org/a', accessOf({ download: { access: { mode: 'ezproxy', ezproxy: { template: '' } } } }));
  assert.equal(broken.rewritten, false);
  assert.equal(broken.note, 'ezproxy-template-missing');
});

test('access：webvpn 按正则改写，规则非法不炸', () => {
  const vpn = accessOf({
    download: {
      access: {
        mode: 'webvpn',
        webvpn: {
          pattern: 'https://www\\.sciencedirect\\.com/',
          replacement: 'https://www-sciencedirect-com.webvpn.school.edu/',
        },
      },
    },
  });
  const out = rewriteForAccess('https://www.sciencedirect.com/science/article/pii/S1', vpn);
  assert.equal(out.rewritten, true);
  assert.ok(out.url.startsWith('https://www-sciencedirect-com.webvpn.school.edu/'));

  const bad = accessOf({ download: { access: { mode: 'webvpn', webvpn: { pattern: '([', replacement: 'x' } } } });
  assert.equal(rewriteForAccess('https://a.org/x', bad).note, 'webvpn-rule-invalid');
});

test('access：Cookie 只发给机构域名', () => {
  const carried = headersForAccess('https://www.sciencedirect.com/x', ez, { cookie: 'SESS=1' });
  assert.equal(carried.carriedCookie, true);
  assert.equal(carried.headers.cookie, 'SESS=1');
  assert.equal(carried.headers['user-agent'].includes('Mozilla'), true);

  const notCarried = headersForAccess('https://unrelated.example.org/x', ez, { cookie: 'SESS=1' });
  assert.equal(notCarried.carriedCookie, false);
  assert.equal(notCarried.headers.cookie, undefined);
});

test('access：默认关闭，不改变任何 URL', () => {
  const none = accessOf({});
  assert.equal(none.enabled, false);
  assert.deepEqual(rewriteForAccess('https://a.org/x', none), { url: 'https://a.org/x', rewritten: false, note: null });
});
