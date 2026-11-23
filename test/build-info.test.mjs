import test from 'node:test';
import assert from 'node:assert/strict';
import { buildInfo, SERVER_STARTED_AT } from '../lib/build-info.js';

test('buildInfo：给出启动时间与代码新鲜度', () => {
  const info = buildInfo();
  assert.equal(info.startedAt, SERVER_STARTED_AT);
  assert.ok(!Number.isNaN(Date.parse(info.startedAt)), '启动时间是 ISO 时间');
  assert.equal(typeof info.stale, 'boolean', 'stale 用于提示是否需要重启');
  if (info.newestMtime) assert.ok(!Number.isNaN(Date.parse(info.newestMtime)));
});
