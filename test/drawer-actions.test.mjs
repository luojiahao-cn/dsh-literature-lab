/**
 * 抽屉里的两个写动作：入库 Zotero、重取摘要。
 * 这里验证路由接线与失败可见；真正的 Zotero 写与元数据检索在各自单测里覆盖。
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { handleZoteroImport, handleRefetch, handlePaperRerun } from '../index.js';
import { readState, writeState, emptyState } from '../lib/state.js';
import { makeBase, stubFetch, textResponse } from './helpers.mjs';

function post(path, body) {
  return new Request(`http://127.0.0.1${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

test('入库 Zotero：未启用时给出可读错误，不抛 500 堆栈', async () => {
  const base = await makeBase();
  const state = emptyState();
  state.papers['doi:10.5555/a'] = { title: 'A', stage: 'L2', grade: 'B' };
  await writeState(base, state);
  const res = await handleZoteroImport(post('/api/dsh-literature-lab/zotero/import', { id: 'doi:10.5555/a' }), base);
  const data = await res.json();
  assert.equal(data.ok, false);
  assert.ok(typeof data.error === 'string' && data.error.length > 0, '错误信息不该为空');
  assert.match(data.error, /Zotero 未启用|凭据服务不可用/);
});

test('入库 Zotero：缺 id 400、未知 id 404、非 POST 405', async () => {
  const base = await makeBase();
  assert.equal((await handleZoteroImport(post('/x', {}), base)).status, 400);
  assert.equal((await handleZoteroImport(post('/x', { id: 'nope' }), base)).status, 404);
  assert.equal((await handleZoteroImport(new Request('http://127.0.0.1/x'), base)).status, 405);
});

test('重取摘要：按 DOI 命中后写回摘要与 abstract_lookup', async () => {
  const base = await makeBase();
  const state = emptyState();
  state.papers['doi:10.5555/b'] = {
    title: 'No abstract yet', stage: 'L1', doi: '10.5555/b', grade: null, grade_history: [],
  };
  await writeState(base, state);

  // OpenAlex 的 works/doi: 返回单条 work 对象（不是列表）
  stubFetch([
    {
      match: 'api.openalex.org/works/doi:',
      respond: () => textResponse(JSON.stringify({
        id: 'https://openalex.org/W1',
        display_name: 'No abstract yet',
        doi: 'https://doi.org/10.5555/b',
        publication_year: 2026,
        abstract_inverted_index: { Hello: [0], world: [1] },
        authorships: [],
      })),
    },
  ]);

  const res = await handleRefetch(post('/api/dsh-literature-lab/refetch', { id: 'doi:10.5555/b' }), base);
  const data = await res.json();
  assert.equal(data.ok, true);
  assert.equal(data.matched, true);
  assert.equal(data.has_abstract, true);

  const after = await readState(base);
  const paper = after.papers['doi:10.5555/b'];
  assert.ok(paper.abstract && paper.abstract.length > 0);
  assert.equal(paper.abstract_lookup.matched, true);
  assert.equal(paper.abstract_lookup.has_abstract, true);
});

test('重取摘要：取不到时只记原因，不改已有摘要', async () => {
  const base = await makeBase();
  const state = emptyState();
  state.papers['doi:10.5555/c'] = {
    title: 'Unknown work', stage: 'L1', doi: '10.5555/c', abstract: '旧摘要不动', grade_history: [],
  };
  await writeState(base, state);

  stubFetch([
    { match: 'api.openalex.org', respond: () => textResponse('{"results":[]}') },
    { match: 'api.crossref.org', respond: () => textResponse('{"message":{}}') },
    { match: 'export.arxiv.org', respond: () => textResponse('<feed></feed>') },
  ]);

  const res = await handleRefetch(post('/api/dsh-literature-lab/refetch', { id: 'doi:10.5555/c' }), base);
  const data = await res.json();
  assert.equal(data.ok, true);
  assert.equal(data.has_abstract, false);
  assert.ok(data.reason);

  const after = await readState(base);
  assert.equal(after.papers['doi:10.5555/c'].abstract, '旧摘要不动');
  assert.equal(after.papers['doi:10.5555/c'].abstract_lookup.has_abstract, false);
});

test('重跑：已完成的论文先放回目标层，再进分析任务', async () => {
  const base = await makeBase();
  const state = emptyState();
  state.papers['doi:10.5555/done'] = {
    title: 'Done Paper', stage: 'done', grade: 'B', manual_override: true,
    l3: { final_grade: 'B' }, has_pdf: false,
  };
  await writeState(base, state);
  const res = await handlePaperRerun(
    post('/api/dsh-literature-lab/paper/rerun', { id: 'doi:10.5555/done', stage: 'L3' }),
    base,
  );
  const data = await res.json();
  assert.equal(data.ok, true, data.error || '');
  const after = await readState(base);
  assert.equal(after.papers['doi:10.5555/done'].stage, 'L3', 'done 论文要回到 L3 才进得了精读池');
  assert.equal(after.papers['doi:10.5555/done'].manual_override, false);
});
