/**
 * 判读模型解析：调用方传 'L1'，配置键是小写 l1。
 * 这条曾经真的写错——配置里的模型永远不生效，所以用单测钉住两种写法。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveAnalysisModel } from '../lib/analysis.js';

function fakeCtx(models = [{ id: 'deepseek-flash' }, { id: 'deepseek-chat' }]) {
  return {
    get: (name) => (name === 'llm' ? {
      listProviders: async () => [{ id: 'deepseek' }, { id: 'other' }],
      listModels: async () => models,
    } : undefined),
  };
}

test('模型：配置用大写 stage 也能生效（回归）', async () => {
  const ctx = fakeCtx();
  const resolved = await resolveAnalysisModel(ctx, {
    analysis: { models: { L1: { provider: 'other', model: 'big-model' } } },
  }, 'L1');
  assert.equal(resolved.provider, 'other');
  assert.equal(resolved.model, 'big-model');
});

test('模型：配置用小写 l1/l2/l3 生效', async () => {
  const ctx = fakeCtx();
  for (const stage of ['L1', 'L2', 'L3']) {
    const key = stage.toLowerCase();
    const resolved = await resolveAnalysisModel(ctx, {
      analysis: { models: { [key]: { provider: 'deepseek', model: `m-${key}` } } },
    }, stage);
    assert.equal(resolved.provider, 'deepseek');
    assert.equal(resolved.model, `m-${key}`);
  }
});

test('模型：配置为空时回落到 deepseek + flash', async () => {
  const ctx = fakeCtx();
  const resolved = await resolveAnalysisModel(ctx, { analysis: {} }, 'L2');
  assert.equal(resolved.provider, 'deepseek');
  assert.equal(resolved.model, 'deepseek-flash');
});

test('模型：没有 LLM 服务时报错而不是静默', async () => {
  await assert.rejects(
    () => resolveAnalysisModel({ get: () => undefined }, {}, 'L1'),
    /LLM 服务不可用/,
  );
});
