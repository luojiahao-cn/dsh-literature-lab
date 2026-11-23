import test from 'node:test';
import assert from 'node:assert/strict';
import { runEmail } from '../lib/email.js';
import { readState } from '../lib/state.js';
import { readCandidates } from '../lib/candidates.js';
import { writeUserConfig } from '../lib/config.js';
import { makeBase } from './helpers.mjs';
import { readFile } from 'node:fs/promises';
import * as store from '../lib/store.js';

function result(inner) {
  return { results: [{ callId: 'c1', result: inner }] };
}

test('邮件段：搜索→读取→模型解析→ingest，且已处理 uid 不重复', async () => {
  const base = await makeBase();
  await writeUserConfig(base, { sources: { mail: { enabled: true, senders: ['scholaralerts-noreply@google.com'] } } });

  const calls = [];
  const tools = {
    async execute({ calls: batch }) {
      const call = batch[0];
      calls.push(call.name);
      if (call.name === 'email_search') {
        return result({ isError: false, content: [], value: { messages: [{ uid: 77, subject: 'New articles' }] } });
      }
      if (call.name === 'email_read') {
        return result({
          isError: false,
          content: [{ type: 'text', text: 'Google Scholar alert: Graph-based structure prediction for protein complexes' }],
          value: {},
        });
      }
      throw new Error(`unexpected tool ${call.name}`);
    },
  };
  const llm = {
    async listProviders() { return [{ id: 'deepseek' }]; },
    async listModels() { return [{ id: 'deepseek-flash' }]; },
    stream() {
      return (async function* stream() {
        yield {
          type: 'text-delta',
          text: JSON.stringify([{
            title: 'Graph-based structure prediction for protein complexes',
            authors: ['A. Author'],
            venue: 'IEEE Sensors Journal',
            year: '2024',
            doi: '10.1234/mail.1',
            url: 'https://doi.org/10.1234/mail.1',
            summary: 'Graph-based structure prediction.',
          }]),
        };
        yield { type: 'finish', reason: { kind: 'stop' } };
      })();
    },
  };
  const ctx = { get: (name) => (name === 'tools' ? tools : name === 'llm' ? llm : undefined) };

  const first = await runEmail(ctx, base, { limit: 3, enrich: false });
  assert.equal(first.emails, 1);
  assert.equal(first.parsed, 1);
  assert.equal(first.added, 1);
  const candidates = await readCandidates(base);
  assert.equal(candidates['doi:10.1234/mail.1'].status, 'new');
  assert.equal((await readState(base)).papers['doi:10.1234/mail.1'], undefined, '邮件先进候选池，不直接进 papers');

  const second = await runEmail(ctx, base, { limit: 3, enrich: false });
  assert.equal(second.emails, 0, '已处理 uid 不再读');
  assert.deepEqual(calls, ['email_search', 'email_read', 'email_search']);
});

test('邮件段：未启用时直接跳过', async () => {
  const base = await makeBase();
  const out = await runEmail({ get: () => { throw new Error('should not be called'); } }, base);
  assert.equal(out.skipped, 'mail-disabled');
  assert.equal(out.emails, 0);
});


test('邮件段：并发两轮 processed 不互相覆盖', async () => {
  const base = await makeBase();
  await writeUserConfig(base, { sources: { mail: { enabled: true, senders: ['scholaralerts-noreply@google.com'] } } });
  const makeCtx = (uid, title) => ({
    get: (name) => (name === 'tools' ? {
      async execute({ calls }) {
        const call = calls[0];
        if (call.name === 'email_search') return result({ isError: false, content: [], value: { messages: [{ uid, subject: title }] } });
        if (call.name === 'email_read') return result({ isError: false, content: [{ type: 'text', text: `alert ${title}` }], value: {} });
        throw new Error(call.name);
      },
    } : name === 'llm' ? {
      async listProviders() { return [{ id: 'deepseek' }]; },
      async listModels() { return [{ id: 'deepseek-flash' }]; },
      stream() {
        return (async function* () {
          yield { type: 'text-delta', text: JSON.stringify([{ title, doi: `10.1234/${uid}`, summary: 'x' }]) };
          yield { type: 'finish', reason: { kind: 'stop' } };
        })();
      },
    } : undefined),
  });
  await Promise.all([
    runEmail(makeCtx(101, 'Concurrent Paper A'), base, { limit: 1, enrich: false }),
    runEmail(makeCtx(202, 'Concurrent Paper B'), base, { limit: 1, enrich: false }),
  ]);
  const email = JSON.parse(await readFile(store.statePaths(base).email, 'utf8'));
  assert.ok(email.processed['101']);
  assert.ok(email.processed['202']);
});

test('邮件段：失败 UID 记次数并在上限后跳过', async () => {
  const base = await makeBase();
  await writeUserConfig(base, { sources: { mail: { enabled: true, senders: ['scholaralerts-noreply@google.com'] } } });
  const ctx = {
    get: (name) => (name === 'tools' ? {
      async execute({ calls }) {
        const call = calls[0];
        if (call.name === 'email_search') return result({ isError: false, content: [], value: { messages: [{ uid: 909, subject: 'bad' }] } });
        if (call.name === 'email_read') throw new Error('read boom');
        throw new Error(call.name);
      },
    } : undefined),
  };
  for (let i = 0; i < 3; i += 1) await runEmail(ctx, base, { limit: 1, enrich: false });
  const email = JSON.parse(await readFile(store.statePaths(base).email, 'utf8'));
  assert.equal(email.failed['909'].attempts, 3);
  const after = await runEmail(ctx, base, { limit: 1, enrich: false });
  assert.equal(after.skippedFailed, 1);
});
