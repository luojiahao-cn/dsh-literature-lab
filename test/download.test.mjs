/**
 * 原文获取测试：PDF 判定、落盘、跳过、失败记录、重试。
 * 全部在临时 baseDir + 假 fetch 里跑。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';

import { download, isPdfBuffer, pdfFileName } from '../lib/download.js';
import { readState, writeState, emptyState } from '../lib/state.js';
import { politeFetch } from '../lib/http.js';
import {
  makeBase, fastNetwork, stubFetch, bufferResponse, textResponse, statusResponse,
} from './helpers.mjs';

const goodPdf = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(2048, 0x20)]);
const html = Buffer.from(`<html>${'x'.repeat(2048)}</html>`);

function fixtureState(extra = {}) {
  const state = emptyState();
  state.papers = {
    'arxiv:fake-good': {
      title: 'Fixture good', stage: 'L1', grade: null, grade_history: [],
      first_seen: '2026-11-20', sources: [], arxiv_id: 'fake-good',
    },
    'arxiv:fake-html': {
      title: 'Fixture html', stage: 'L1', grade: null, grade_history: [],
      first_seen: '2026-11-20', sources: [], arxiv_id: 'fake-html',
    },
    ...extra,
  };
  return state;
}

test('download：纯函数', () => {
  assert.equal(pdfFileName('arxiv:2611.25005'), 'arxiv_2611.25005.pdf');
  assert.equal(pdfFileName('doi:10.1109/TMECH.2026.1'), 'doi_10.1109_TMECH.2026.1.pdf');
  assert.equal(isPdfBuffer(goodPdf), true);
  assert.equal(isPdfBuffer(html), false);
  assert.equal(isPdfBuffer(Buffer.from('%PDF-')), false);
});

test('download：下载、落盘、跳过与覆盖', async () => {
  const base = await makeBase({ network: fastNetwork() });
  await writeState(base, fixtureState());
  stubFetch([
    {
      match: 'arxiv.org/pdf/fake-good',
      respond: () => bufferResponse(goodPdf, { headers: { 'content-type': 'application/pdf' } }),
    },
  ]);

  const first = await download(base, { ids: ['arxiv:fake-good'] });
  assert.equal(first.fetched, 1);
  assert.equal(first.results[0].via, 'arxiv');
  assert.equal(first.results[0].bytes, goodPdf.length);

  const saved = path.join(base, first.results[0].pdf);
  assert.ok(existsSync(saved));
  assert.equal((await readFile(saved)).subarray(0, 5).toString('latin1'), '%PDF-');

  let paper = (await readState(base)).papers['arxiv:fake-good'];
  assert.equal(paper.pdf, 'pdfs/arxiv_fake-good.pdf');
  assert.equal(paper.pdf_bytes, goodPdf.length);
  assert.equal(paper.download.ok, true);

  const second = await download(base, { ids: ['arxiv:fake-good'] });
  assert.equal(second.skipped, 1);

  const third = await download(base, { ids: ['arxiv:fake-good'], overwrite: true });
  assert.equal(third.fetched, 1);
});

test('download：HTML 判 not-a-pdf，失败也记事实且不写 pdf', async () => {
  const base = await makeBase({ network: fastNetwork() });
  await writeState(base, fixtureState());
  stubFetch([
    { match: 'arxiv.org/pdf/fake-html', respond: () => textResponse(html.toString('utf8'), { headers: { 'content-type': 'text/html' } }) },
  ]);

  const result = await download(base, { ids: ['arxiv:fake-html'] });
  assert.equal(result.fetched, 0);
  assert.equal(result.results[0].code, 'not-pdf');
  assert.match(result.results[0].reason, /不是 PDF/);

  const paper = (await readState(base)).papers['arxiv:fake-html'];
  assert.equal(paper.download.ok, false);
  assert.equal(paper.download.code, 'not-pdf');
  assert.equal(paper.pdf, undefined);
  assert.ok(paper.pdf_failure?.hint, '失败要留下可行动的提示，而不是只有一句错误串');
  assert.equal(paper.pdf_failure.attempts.length, 1);
  assert.ok((paper.review_flags || []).includes('needs_pdf'), '尝试失败要给论文打 needs_pdf，才进人工补原文');
});

test('download：没有可用入口时记 no-candidate', async () => {
  const base = await makeBase({ network: fastNetwork() });
  const state = emptyState();
  state.papers = {
    'manual:noid': {
      title: 'Fixture without any identifier', stage: 'L1', first_seen: '2026-11-20', sources: [],
    },
  };
  await writeState(base, state);
  // 连元数据都查不到：任何网络请求都会被假 fetch 打回，链路应落到 no-candidate 而不是崩
  stubFetch([]);

  const result = await download(base, { ids: ['manual:noid'] });
  assert.equal(result.fetched, 0);
  assert.equal(result.results[0].code, 'no-candidate');
  assert.equal(result.results[0].reason, 'no-oa');
  const paper = (await readState(base)).papers['manual:noid'];
  assert.equal(paper.pdf_failure.code, 'no-candidate');
  assert.ok((paper.review_flags || []).includes('needs_pdf'));
});

test('http：5xx 会重试，4xx 不重试', async () => {
  let hits = 0;
  stubFetch([
    {
      match: 'retry.example',
      respond: () => {
        hits += 1;
        if (hits < 3) return statusResponse(500);
        return textResponse('ok');
      },
    },
  ]);
  const res = await politeFetch('https://retry.example/x', { retries: 2, minIntervalMs: 0, timeoutMs: 1000 });
  assert.equal(res.body, 'ok');
  assert.equal(hits, 3);

  hits = 0;
  globalThis.fetch = async () => { hits += 1; return statusResponse(404); };
  await assert.rejects(() => politeFetch('https://retry.example/y', { retries: 2, minIntervalMs: 0 }), /HTTP 404/);
  assert.equal(hits, 1);
});

test('download：付费墙候选跳过，换下一个来源仍能成功', async () => {
  const base = await makeBase({ network: fastNetwork() });
  const state = emptyState();
  state.papers = {
    'doi:10.1186/chain': {
      title: 'Chain fixture', stage: 'L1', grade: null, grade_history: [],
      first_seen: '2026-11-20', sources: [], doi: '10.1186/chain', arxiv_id: '2611.99999',
    },
  };
  await writeState(base, state);
  stubFetch([
    {
      match: 'arxiv.org/pdf/2611.99999',
      respond: () => ({
        ok: false, status: 302, headers: new Headers({ location: 'https://idp.school.edu/sso/login' }), text: async () => '', arrayBuffer: async () => new ArrayBuffer(0),
      }),
    },
    {
      match: 'api.openalex.org/works/doi',
      respond: () => textResponse(JSON.stringify({ best_oa_location: { pdf_url: 'https://repo.example.edu/a.pdf', is_oa: true } }), { headers: { 'content-type': 'application/json' } }),
    },
    { match: 'repo.example.edu/a.pdf', respond: () => bufferResponse(goodPdf, { headers: { 'content-type': 'application/pdf' } }) },
  ]);

  const result = await download(base, { ids: ['doi:10.1186/chain'] });
  assert.equal(result.fetched, 1);
  assert.equal(result.results[0].via, 'openalex', 'arXiv 落到登录页后要继续试下一个来源');
  const paper = (await readState(base)).papers['doi:10.1186/chain'];
  assert.equal(paper.download.ok, true);
  assert.equal(paper.pdf_failure, undefined);
});

test('download：截断 PDF 也落盘，但打上 pdf_truncated', async () => {
  const base = await makeBase({ network: fastNetwork() });
  const state = emptyState();
  state.papers = {
    'arxiv:semi': {
      title: 'Partial fixture', stage: 'L1', first_seen: '2026-11-20', sources: [], arxiv_id: 'semi',
    },
  };
  await writeState(base, state);
  const bare = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(2048, 0x20)]);
  stubFetch([{ match: 'arxiv.org/pdf/semi', respond: () => bufferResponse(bare) }]);

  const result = await download(base, { ids: ['arxiv:semi'] });
  assert.equal(result.fetched, 1);
  assert.equal(result.results[0].truncated, true);
  const paper = (await readState(base)).papers['arxiv:semi'];
  assert.equal(paper.pdf, 'pdfs/arxiv_semi.pdf');
  assert.ok((paper.review_flags || []).includes('pdf_truncated'));
  assert.ok(!(paper.review_flags || []).includes('needs_pdf'), '拿到文件就不再挂缺原文');
  assert.ok(paper.pdf_sha256, '要记 sha256 便于回读核对');
});

