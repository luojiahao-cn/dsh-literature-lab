/**
 * L0 发现层测试：解析、去重、增量、回填、过滤、失败隔离、ingest、分页。
 * 全部在临时 baseDir 里跑，假 fetch 不联网。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readFile } from 'node:fs/promises';

import { parseFeed } from '../lib/feed.js';
import { normalizeDoi, normalizeArxiv, workId, titleKey } from '../lib/dedup.js';
import { discover, ingest } from '../lib/discover.js';
import { readState, writeState, readSeen, emptyState, viewOf, advance } from '../lib/state.js';
import { readCandidates } from '../lib/candidates.js';
import {
  makeBase, fastNetwork, stubFetch, textResponse, statusResponse,
  arxivEntry, arxivFeed, rssItem, rssFeed, isoAgo, rfcAgo,
} from './helpers.mjs';

test('feed：解析 arXiv Atom（CDATA/实体/命名空间/多 link）', () => {
  const xml = arxivFeed([
    arxivEntry({
      id: '2611.11111',
      title: 'Robot Calibration <![CDATA[with Long-Horizon Data]]>',
      published: '2026-11-20T00:00:00Z',
      summary: 'We propose a method &amp; benchmark.',
      doi: '10.1234/ABC.2026.1',
      authors: ['Alice', 'Bob'],
    }),
  ]);
  const [entry] = parseFeed(xml);
  assert.equal(entry.title, 'Robot Calibration with Long-Horizon Data');
  assert.equal(entry.summary, 'We propose a method & benchmark.');
  assert.equal(entry.arxivId, '2611.11111');
  assert.equal(entry.doi, '10.1234/ABC.2026.1');
  assert.equal(entry.url, 'http://arxiv.org/abs/2611.11111v1');
  assert.deepEqual(entry.authors, ['Alice', 'Bob']);
});

test('feed：解析 RSS（CDATA 摘要、guid 里的 DOI）', () => {
  const xml = rssFeed([
    rssItem({
      title: 'A Journal Paper',
      link: 'https://example.com/a',
      description: 'Abstract <b>text</b> here.',
      pubDate: 'Thu, 20 Nov 2026 00:00:00 GMT',
      guid: 'https://doi.org/10.5555/XYZ.9',
    }),
  ]);
  const [entry] = parseFeed(xml);
  assert.equal(entry.title, 'A Journal Paper');
  assert.equal(entry.summary, 'Abstract text here.');
  assert.equal(entry.doi, '10.5555/XYZ.9');
  assert.equal(entry.url, 'https://example.com/a');
});

test('dedup：arXiv 版本、DOI 前缀与后缀、题名归一化', () => {
  assert.equal(normalizeArxiv('2611.12345v3'), '2611.12345');
  assert.equal(normalizeArxiv('arXiv:2611.12345'), '2611.12345');
  assert.equal(normalizeDoi('https://doi.org/10.1109/TMECH.2026.1.'), '10.1109/tmech.2026.1');
  assert.equal(workId({ arxivId: '2611.12345v1' }), 'arxiv:2611.12345');
  assert.equal(workId({ doi: '10.1109/TMECH.2026.1' }), 'doi:10.1109/tmech.2026.1');
  assert.equal(
    titleKey('Ｆｕｌｌ－Width  Sensing!'),
    titleKey('full width sensing'),
  );
});

test('discover：新增、跨源合并、幂等', async () => {
  const base = await makeBase({
    network: fastNetwork(),
    sources: {
      arxiv: { enabled: true, categories: ['cs.RO'], queries: [], mailto: '' },
      rss: [{ id: 'feed-a', name: 'Feed A', url: 'https://feed.example/rss', enabled: true }],
    },
  });
  const published = isoAgo(2 * 3600 * 1000);
  const feedXml = rssFeed([
    rssItem({ title: 'RSS Only Paper', link: 'https://example.com/rss-only', pubDate: rfcAgo(3600 * 1000) }),
    rssItem({ title: 'Robot Arm Paper', link: 'https://arxiv.org/abs/2611.22222', pubDate: rfcAgo(3600 * 1000) }),
  ]);
  const calls = stubFetch([
    {
      match: 'export.arxiv.org/api/query',
      respond: () => textResponse(arxivFeed([
        arxivEntry({ id: '2611.22222', title: 'Robot Arm Paper', published, summary: 'Robot arm abstract.' }),
        arxivEntry({ id: '2611.33333', title: 'Field Sensing Paper', published, summary: 'Sensing abstract.' }),
      ])),
    },
    { match: 'feed.example/rss', respond: () => textResponse(feedXml) },
  ]);

  const first = await discover(base);
  assert.equal(first.ok, true);
  assert.equal(first.added, 3, '三条新论文（RSS-only + 两条 arXiv）');
  assert.equal(first.merged, 1, 'RSS 里同 arXiv id 的一条被合并');
  assert.equal(first.scanned, 4);
  assert.equal(calls.length, 2);

  const second = await discover(base);
  assert.equal(second.added, 0, '第二次运行不重复入库');
  assert.equal(second.merged, 4);

  const state = await readState(base);
  assert.equal(Object.keys(state.papers).length, 0, '发现阶段不直接写 papers');
  const candidates = await readCandidates(base);
  assert.equal(Object.keys(candidates).length, 3);
  const robot = candidates['arxiv:2611.22222'];
  assert.ok(robot.sources.includes('arxiv'));
  assert.ok(robot.sources.includes('feed-a'));
  assert.equal(robot.abstract, 'Robot arm abstract.', 'arXiv Atom 的摘要进候选');
  assert.ok(state.last_success_at);
  assert.ok(state.sources.arxiv?.last_ok_at);
  assert.ok(state.sources['rss:feed-a']?.last_ok_at);

  const seen = await readSeen(base);
  assert.equal(Object.keys(seen).length, 3);
});

test('discover：时间窗口过滤 RSS 旧条目', async () => {
  const base = await makeBase({
    window: { hours: 24, backfillDays: 14 },
    network: fastNetwork(),
    sources: {
      arxiv: { enabled: false },
      rss: [{ id: 'feed-a', name: 'Feed A', url: 'https://feed.example/rss', enabled: true }],
    },
  });
  stubFetch([
    {
      match: 'feed.example/rss',
      respond: () => textResponse(rssFeed([
        rssItem({ title: 'Fresh', link: 'https://example.com/fresh', pubDate: rfcAgo(3600 * 1000) }),
        rssItem({ title: 'Stale', link: 'https://example.com/stale', pubDate: rfcAgo(3 * 86400 * 1000) }),
      ])),
    },
  ]);
  const result = await discover(base);
  assert.equal(result.added, 1);
  const candidates = await readCandidates(base);
  assert.equal(Object.keys(candidates).length, 1);
  assert.equal(Object.values(candidates)[0].title, 'Fresh');
  const state = await readState(base);
  assert.equal(state.sources['rss:feed-a'].last_count, 1);
});

test('discover：arXiv 回填（从该源上次成功算起）', async () => {
  const base = await makeBase({
    window: { hours: 24, backfillDays: 14 },
    network: fastNetwork(),
    sources: {
      arxiv: { enabled: true, categories: ['cs.RO'], queries: [], mailto: 'test@example.com' },
      rss: [],
    },
  });
  const state = emptyState();
  state.sources = { arxiv: { last_ok_at: isoAgo(3 * 86400 * 1000) } };
  await writeState(base, state);

  let queried = '';
  stubFetch([
    {
      match: 'export.arxiv.org/api/query',
      respond: (url) => {
        queried = decodeURIComponent(url);
        return textResponse(arxivFeed([]));
      },
    },
  ]);

  const result = await discover(base);
  assert.equal(result.ok, true);
  assert.ok(queried.includes('submittedDate:['), '带日期区间');
  const threeDaysAgo = new Date(Date.now() - 3 * 86400 * 1000);
  const stamp = `${threeDaysAgo.getUTCFullYear()}${String(threeDaysAgo.getUTCMonth() + 1).padStart(2, '0')}`;
  assert.ok(queried.includes(stamp), `回填起点约为 3 天前：${queried}`);
  assert.ok(result.backfillFrom);
});

test('discover：回填天数上限', async () => {
  const base = await makeBase({
    window: { hours: 24, backfillDays: 2 },
    network: fastNetwork(),
    sources: { arxiv: { enabled: true, categories: ['cs.RO'] }, rss: [] },
  });
  const state = emptyState();
  state.sources = { arxiv: { last_ok_at: isoAgo(30 * 86400 * 1000) } };
  await writeState(base, state);

  let queried = '';
  stubFetch([{
    match: 'export.arxiv.org/api/query',
    respond: (url) => { queried = decodeURIComponent(url); return textResponse(arxivFeed([])); },
  }]);

  await discover(base);
  const twoDaysAgo = new Date(Date.now() - 2 * 86400 * 1000);
  const stamp = `${twoDaysAgo.getUTCFullYear()}${String(twoDaysAgo.getUTCMonth() + 1).padStart(2, '0')}${String(twoDaysAgo.getUTCDate()).padStart(2, '0')}`;
  assert.ok(queried.includes(stamp), `起点被夹到 backfillDays 内：${queried}`);
});

test('discover：RSS 304 不重复解析、不计数', async () => {
  const base = await makeBase({
    network: fastNetwork(),
    sources: {
      arxiv: { enabled: false },
      rss: [{ id: 'feed-a', name: 'Feed A', url: 'https://feed.example/rss', enabled: true }],
    },
  });
  const state = emptyState();
  state.sources = { 'rss:feed-a': { etag: '"abc"' } };
  await writeState(base, state);

  const calls = stubFetch([
    {
      match: 'feed.example/rss',
      respond: (url, init) => {
        assert.equal(init.headers['if-none-match'], '"abc"');
        return statusResponse(304);
      },
    },
  ]);
  const result = await discover(base);
  assert.equal(calls.length, 1);
  assert.equal(result.added, 0);
  assert.equal(result.sources[0].unchanged, true);
});

test('discover：单个源失败不影响其他源，并记录连续失败', async () => {
  const base = await makeBase({
    network: fastNetwork(),
    sources: {
      arxiv: { enabled: true, categories: ['cs.RO'] },
      rss: [
        { id: 'bad', name: 'Bad Feed', url: 'https://bad.example/rss', enabled: true },
        { id: 'good', name: 'Good Feed', url: 'https://good.example/rss', enabled: true },
      ],
    },
  });
  stubFetch([
    {
      match: 'export.arxiv.org/api/query',
      respond: () => textResponse(arxivFeed([
        arxivEntry({ id: '2611.44444', title: 'Arxiv Good', published: isoAgo(3600 * 1000) }),
      ])),
    },
    { match: 'bad.example/rss', respond: () => statusResponse(500) },
    {
      match: 'good.example/rss',
      respond: () => textResponse(rssFeed([
        rssItem({ title: 'RSS Good', link: 'https://example.com/good', pubDate: rfcAgo(3600 * 1000) }),
      ])),
    },
  ]);

  const first = await discover(base);
  assert.equal(first.added, 2);
  const bad = first.sources.find((s) => s.key === 'rss:bad');
  assert.equal(bad.ok, false);
  assert.ok(bad.error);

  const state = await readState(base);
  assert.equal(state.sources['rss:bad'].consecutive_failures, 1);
  assert.ok(state.sources['rss:bad'].last_error);

  const second = await discover(base);
  assert.equal((await readState(base)).sources['rss:bad'].consecutive_failures, 2);
});

test('discover：关键词与排除词', async () => {
  const base = await makeBase({
    network: fastNetwork(),
    relevance: { keywords: ['robot'], contextKeywords: [], excludeKeywords: ['survey'], minScore: 3 },
    sources: {
      arxiv: { enabled: true, categories: ['cs.RO'] },
      rss: [],
    },
  });
  stubFetch([
    {
      match: 'export.arxiv.org/api/query',
      respond: () => textResponse(arxivFeed([
        arxivEntry({ id: '2611.55555', title: 'Robot Learning', published: isoAgo(3600 * 1000) }),
        arxivEntry({ id: '2611.66666', title: 'Unrelated Topic', published: isoAgo(3600 * 1000) }),
        arxivEntry({ id: '2611.77777', title: 'A Robot Survey', published: isoAgo(3600 * 1000) }),
      ])),
    },
  ]);

  const result = await discover(base);
  assert.equal(result.added, 1);
  assert.equal(result.filtered, 1);
  assert.equal(result.excluded, 1);
  const candidates = await readCandidates(base);
  assert.equal(Object.values(candidates)[0].title, 'Robot Learning');
  assert.deepEqual(Object.values(candidates)[0].t0.hits, ['robot']);
});

test('ingest：写入、去重与过滤', async () => {
  const base = await makeBase({
    relevance: { keywords: ['sensor'], contextKeywords: [], excludeKeywords: [], minScore: 3 },
  });
  const first = await ingest(base, {
    source: 'scholar-alert',
    items: [
      { title: 'A Sensor Paper', doi: '10.1234/abc.1' },
      { title: 'No Keyword Here', doi: '10.1234/abc.2' },
    ],
  });
  assert.equal(first.added, 1);
  assert.equal(first.filtered, 1);

  const second = await ingest(base, {
    source: 'scholar-alert',
    items: [{ title: 'A Sensor Paper', doi: 'https://doi.org/10.1234/ABC.1.' }],
  });
  assert.equal(second.added, 0);
  assert.equal(second.merged, 1);
  const candidates = await readCandidates(base);
  assert.equal(Object.keys(candidates).length, 2, '新候选 + T0 过滤掉的候选都留在池里');
  assert.equal(candidates['doi:10.1234/abc.1'].status, 'new');
  assert.equal(candidates['doi:10.1234/abc.2'].status, 'filtered');
  assert.deepEqual(candidates['doi:10.1234/abc.1'].sources, ['ingest:scholar-alert']);
});

test('viewOf：分页与关键字过滤', async () => {
  const state = emptyState();
  for (const [index, title] of ['Alpha', 'Beta', 'Gamma'].entries()) {
    const paper = { title, stage: 'L1', first_seen: '2026-11-20', sources: [], grade_history: [] };
    advance(paper, 'L1');
    state.papers[`arxiv:2611.${index}0000`] = paper;
  }
  const page = viewOf(state, { limit: 2, offset: 1 });
  assert.equal(page.total, 3);
  assert.equal(page.papers.length, 2);
  assert.equal(page.offset, 1);
  assert.equal(page.limit, 2);

  const filtered = viewOf(state, { q: 'beta' });
  assert.equal(filtered.total, 1);
  assert.equal(filtered.papers[0].title, 'Beta');

  const all = viewOf(state);
  assert.equal(all.total, 3);
  assert.equal(all.papers.length, 3);
});
