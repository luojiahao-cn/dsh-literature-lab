/**
 * Zotero 联动测试：读取/缓存/档案、检索、入库、自动入库策略。
 * 假 fetch，不联网；凭据是测试用的假值。
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  syncZotero, buildProfile, queryLibrary, findItem, importPapers,
  shouldAutoImport, zoteroItemOf, readZoteroCache,
  authorizeLocalWrites, readLocalKey,
} from '../lib/zotero.js';
import { readState, writeState, emptyState } from '../lib/state.js';
import {
  makeBase, stubFetch, textResponse,
} from './helpers.mjs';

const items = [
  {
    key: 'AAA111',
    data: {
      itemType: 'journalArticle',
      title: 'Graph Representation for Molecular Systems',
      abstractNote: 'We present a flexible graph feature encoder for molecular systems.',
      date: '2024-05-01',
      publicationTitle: 'IEEE Sensors Journal',
      DOI: '10.1109/XYZ.2024.1',
      tags: [{ tag: 'graph representation' }, { tag: 'soft robotics' }],
      collections: ['COL1'],
    },
  },
  {
    key: 'BBB222',
    data: {
      itemType: 'preprint',
      title: 'Calibration of Flexible Graph Encoders',
      abstractNote: 'A calibration method for graph feature encoders.',
      date: '2025-01-01',
      repository: 'arXiv',
      archiveID: 'arXiv:2501.00001',
      DOI: '',
      tags: [{ tag: 'calibration' }],
      collections: [],
    },
  },
  { key: 'ATT999', data: { itemType: 'attachment', title: '' } },
  { key: 'NOTE1', data: { itemType: 'note', title: '' } },
];

const collections = [
  { key: 'COL1', data: { name: 'Sensing' } },
];

function makeConfig(extra = {}) {
  return {
    integrations: {
      zotero: {
        enabled: true,
        mode: 'web',
        userId: '1234',
        groupId: '',
        apiKey: 'test-key',
        ...extra,
      },
    },
  };
}

function stubZotero({ onPost } = {}) {
  return stubFetch([
    {
      match: 'api.zotero.org/users/1234/items',
      respond: (url, init) => {
        if (init.method === 'POST') {
          const created = onPost ? onPost(init) : { key: 'NEWKEY1' };
          return textResponse(JSON.stringify(created));
        }
        return textResponse(JSON.stringify(items), { headers: { 'total-results': '2' } });
      },
    },
    {
      match: 'api.zotero.org/users/1234/collections',
      respond: () => textResponse(JSON.stringify(collections)),
    },
  ]);
}

test('zotero：读取、过滤附件/笔记、缓存与刷新', async () => {
  const base = await makeBase();
  const calls = stubZotero();
  const config = makeConfig();

  const cache = await syncZotero(base, config);
  assert.equal(cache.items.length, 2, '附件与笔记被过滤');
  assert.equal(cache.total, 2);
  assert.equal(cache.collections[0].name, 'Sensing');
  assert.equal(cache.source.mode, 'web');
  assert.equal(calls.length, 2);

  await syncZotero(base, config);
  assert.equal(calls.length, 2, '24h 内用缓存，不重复请求');

  await syncZotero(base, config, { refresh: true });
  assert.equal(calls.length, 4, 'refresh 强制重新拉取');
});

test('zotero：档案（标签、词频、样本）', async () => {
  const base = await makeBase();
  stubZotero();
  const cache = await syncZotero(base, makeConfig());
  const profile = buildProfile(cache, { limit: 5, withAbstracts: true });

  assert.equal(profile.library.cached, 2);
  assert.ok(profile.topTags.some((t) => t.tag === 'graph representation'));
  assert.ok(profile.terms.unigrams.some((t) => t.term === 'graph' && t.df === 2));
  assert.ok(profile.terms.bigrams.some((t) => t.term === 'flexible graph'));
  assert.equal(profile.sample.length, 2);
  assert.ok(profile.sample[0].abstract, '默认带摘要');
  assert.ok(profile.collections.find((c) => c.name === 'Sensing').count === 1);
});

test('zotero：检索与按 DOI 查找', async () => {
  const base = await makeBase();
  stubZotero();
  const cache = await syncZotero(base, makeConfig());

  const search = queryLibrary(cache, { q: 'calibration' });
  assert.equal(search.total, 1);
  assert.equal(search.items[0].key, 'BBB222');

  const byTag = queryLibrary(cache, { tag: 'soft robotics' });
  assert.equal(byTag.total, 1);

  const byCollection = queryLibrary(cache, { collection: 'Sensing' });
  assert.equal(byCollection.total, 1);

  const found = findItem(cache, { doi: '10.1109/xyz.2024.1' });
  assert.equal(found.key, 'AAA111');
});

test('zotero：映射 item 与入库（含跳过、dryRun、去重）', async () => {
  const base = await makeBase();
  const posted = [];
  stubZotero({ onPost: (init) => { posted.push(JSON.parse(init.body)); return { key: 'NEWKEY1' }; } });
  const config = makeConfig();
  await syncZotero(base, config);

  const state = emptyState();
  state.papers = {
    'arxiv:2502.00001': {
      title: 'A New Sensor Paper',
      arxiv_id: '2502.00001',
      doi: null,
      stage: 'L1',
      grade: 'A',
      grade_history: [],
      first_seen: '2026-11-20',
      sources: ['arxiv'],
      meta: { authors: ['Alice Wang'], year: '2026' },
      abstract: 'A new flexible sensor.',
    },
    'doi:10.1109/xyz.2024.1': {
      title: 'Already In Zotero',
      doi: '10.1109/xyz.2024.1',
      stage: 'L1',
      grade: null,
      grade_history: [],
      first_seen: '2026-11-20',
      sources: [],
    },
  };
  await writeState(base, state);

  // dryRun 不写
  const preview = await importPapers(base, config, state, [state.papers['arxiv:2502.00001']], { dryRun: true });
  assert.equal(preview.results[0].dryRun, true);
  assert.equal(posted.length, 0);

  const result = await importPapers(base, config, state, [
    state.papers['arxiv:2502.00001'],
    state.papers['doi:10.1109/xyz.2024.1'],
  ]);
  assert.equal(result.results.length, 2);
  assert.equal(result.results[0].ok, true);
  assert.equal(result.results[0].key, 'NEWKEY1');
  assert.equal(posted.length, 1, '库里已有 DOI 的跳过，不重复 POST');
  assert.equal(result.results[1].skipped, 'already-in-zotero');
  assert.equal(posted[0].itemType, 'preprint');
  assert.equal(posted[0].repository, 'arXiv');

  const saved = await readState(base);
  assert.equal(saved.papers['arxiv:2502.00001'].zotero_key, 'NEWKEY1');
  assert.equal(saved.papers['doi:10.1109/xyz.2024.1'].zotero_key, 'AAA111');
});

test('zotero：本地模式未授权时拒绝入库；未配置时报错', async () => {
  const base = await makeBase();
  stubLocal();
  const state = emptyState();
  const paper = { title: 'X', stage: 'L1', grade_history: [], sources: [] };
  await assert.rejects(
    () => importPapers(base, makeConfig({ mode: 'local' }), state, [paper]),
    /本机写未授权/,
  );
  await assert.rejects(
    () => syncZotero(base, makeConfig({ apiKey: '' })),
    /需要 userId 与只读 API key/,
  );
});

test('zotero：自动入库策略', () => {
  const enabled = makeConfig({ autoImport: { enabled: true, minGrade: 'B', requirePdf: false } });
  assert.equal(shouldAutoImport(enabled, { grade: 'A', sources: [] }), true);
  assert.equal(shouldAutoImport(enabled, { grade: 'C', sources: [] }), false);
  assert.equal(shouldAutoImport(enabled, { grade: 'B', zotero_key: 'X' }), false);
  assert.equal(shouldAutoImport(makeConfig({ autoImport: { enabled: false } }), { grade: 'S' }), false);

  const needPdf = makeConfig({ autoImport: { enabled: true, minGrade: 'B', requirePdf: true } });
  assert.equal(shouldAutoImport(needPdf, { grade: 'A' }), false);
  assert.equal(shouldAutoImport(needPdf, { grade: 'A', pdf: 'pdfs/x.pdf' }), true);
});

test('zotero：item 映射字段', () => {
  const item = zoteroItemOf({
    title: 'Paper',
    arxiv_id: '2501.12345',
    abstract: 'Abstract.',
    meta: { authors: ['Alice Wang', 'Solo'], year: '2026' },
  });
  assert.equal(item.itemType, 'preprint');
  assert.equal(item.archiveID, 'arXiv:2501.12345');
  assert.equal(item.creators[0].lastName, 'Wang');
  assert.equal(item.creators[1].name, 'Solo');
});

const localConfig = {
  integrations: {
    zotero: { enabled: true, mode: 'local', localPort: 23119, userId: '', groupId: '', apiKey: '' },
  },
};

function stubLocal({ remember = true, key = 'k'.repeat(32) } = {}) {
  return stubFetch([
    {
      match: '/local/authorize',
      respond: (url, init) => {
        assert.equal(init.headers['Zotero-Server-ID'], 'SRV1');
        assert.deepEqual(JSON.parse(init.body), { appName: 'DeepSeek Harness 文献实验室' });
        return textResponse(JSON.stringify({ key, remember }));
      },
    },
    {
      match: '/users/0/items?limit=1',
      respond: () => textResponse('[]', { headers: { 'Zotero-Server-ID': 'SRV1' } }),
    },
    {
      match: '/users/0/items',
      respond: (url, init) => {
        if (init.method === 'POST') return textResponse(JSON.stringify({ key: 'LOCALKEY1' }));
        return textResponse('[]', { headers: { 'Zotero-Server-ID': 'SRV1' } });
      },
    },
  ]);
}

test('zotero 本机写：授权、写请求头、复用 key', async () => {
  const base = await makeBase();
  const calls = stubLocal();
  const info = await authorizeLocalWrites(base, localConfig);
  assert.equal(info.remember, true);
  assert.equal(info.serverId, 'SRV1');
  const saved = await readLocalKey(base);
  assert.equal(saved.key, 'k'.repeat(32));
  assert.equal(saved.serverId, 'SRV1');

  const state = emptyState();
  state.papers = {
    'arxiv:2503.00001': {
      title: 'Local Write Paper', arxiv_id: '2503.00001', stage: 'L1',
      grade: null, grade_history: [], first_seen: '2026-11-20', sources: [],
    },
  };
  await writeState(base, state);
  const result = await importPapers(base, localConfig, state, [state.papers['arxiv:2503.00001']]);
  assert.equal(result.results[0].ok, true);
  assert.equal(result.results[0].key, 'LOCALKEY1');
  assert.equal((await readState(base)).papers['arxiv:2503.00001'].zotero_key, 'LOCALKEY1');

  const writes = calls.filter((c) => c.url.endsWith('/items') && c.headers['Zotero-API-Key']);
  assert.equal(writes.length, 1, '写请求带本地 key');
  assert.equal(writes[0].headers['Zotero-Server-ID'], 'SRV1', '写请求带 Server-ID');
});

test('zotero 本机写：未授权直接入库会拒绝；单次授权不落盘', async () => {
  const base = await makeBase();
  stubLocal();
  const state = emptyState();
  state.papers = { 'arxiv:1': { title: 'X', stage: 'L1', grade_history: [], sources: [] } };
  await assert.rejects(
    () => importPapers(base, localConfig, state, [state.papers['arxiv:1']]),
    /本机写未授权/,
  );

  const once = await makeBase();
  stubLocal({ remember: false });
  const info = await authorizeLocalWrites(once, localConfig);
  assert.equal(info.remember, false);
  assert.equal(await readLocalKey(once), null, 'Allow 只用一次，不保存');
});

test('zotero：缓存文件可读', async () => {
  const base = await makeBase();
  stubZotero();
  await syncZotero(base, makeConfig());
  const cache = await readZoteroCache(base);
  assert.ok(cache.items.length === 2);
});
