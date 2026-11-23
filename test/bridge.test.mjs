import test from 'node:test';
import assert from 'node:assert/strict';
import { startBridgeServer } from '../lib/bridge-server.js';
import { writeUserConfig } from '../lib/config.js';
import { makeBase } from './helpers.mjs';

async function withServer(base, fn) {
  const server = startBridgeServer(base, { port: 0 });
  await new Promise((resolve) => server.once('listening', resolve));
  const port = server.address().port;
  try {
    return await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test('bridge：无 token 的 Chrome 扩展 Origin 也被拒绝', async () => {
  const base = await makeBase();
  await writeUserConfig(base, { bridge: { token: 'secret-token' } });
  await withServer(base, async (url) => {
    const res = await fetch(`${url}/import`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'chrome-extension://fake-id' },
      body: JSON.stringify({ file: '/tmp/nope.pdf' }),
    });
    assert.equal(res.status, 401);
  });
});

test('bridge：带正确 token 才进入导入流程', async () => {
  const base = await makeBase();
  await writeUserConfig(base, { bridge: { token: 'secret-token' } });
  await withServer(base, async (url) => {
    const ping = await fetch(`${url}/ping`);
    assert.equal(ping.status, 200);
    const res = await fetch(`${url}/import`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-dsh-token': 'secret-token' },
      body: JSON.stringify({ file: '/tmp/nope.pdf' }),
    });
    assert.notEqual(res.status, 401);
  });
});
