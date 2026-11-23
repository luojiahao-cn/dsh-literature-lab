/**
 * 构建一致性测试：这个测试防什么？
 *
 * 本插件的 Web 端没有打包器，client.js 是把 client/src/*.js 按文件名排序、
 * 塞进同一个 `factory(require)` 闭包后拼出来的单一文件。这带来三类"静默回潮"：
 *
 * 1. 忘了 build：改了片段却没重新生成 client.js，宿主加载的还是旧代码；
 * 2. wrapper 重复：片段里也写 window.__ModuleLoader__.load(...) 会让模块重复注册，
 *    破坏加载；
 * 3. 顶层标识符重复：所有片段共享同一个闭包，重复的顶层 function 声明会静默覆盖
 *    （const 会直接抛错，function 不会），只有跨文件统计才能发现。
 *
 * 另外守着片段完整性：文件名必须两位序号开头、全小写，且数量不能太少。
 *
 * 这里只做静态约束，不执行界面代码。
 */
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import assert from 'node:assert/strict';

import { buildClient } from '../scripts/build-client.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'client', 'src');
const CLIENT = path.join(ROOT, 'client.js');

/** 片段文件名：两位序号 + 小写名，例如 70-sources.js。 */
const FRAGMENT_NAME = /^\d{2}-[a-z0-9-]+\.js$/;
/** 片段最少数量：低于此值说明有片段被误删或合并。 */
const MIN_FRAGMENTS = 8;

/**
 * 顶层声明：行首"恰好 4 个空格"（片段就整体缩进 4 格）。
 * 嵌套代码会缩进 8 格以上，因此这个锚点天然排除了对象字面量内部的方法和嵌套函数。
 * const 必须带 `= NAME =` 形式，避免把 `const X = {` 后面的多行内容当成新声明。
 */
const TOP_DECL =
  /^ {4}(?:(?:async )?function\s+([A-Za-z0-9_$]+)\s*\(|const\s+([A-Za-z0-9_$]+)\s*=|class\s+([A-Za-z0-9_$]+)(?=[\s{(]))/;

/** 出现次数（不用正则拼字符串，避免特殊字符转义问题）。 */
function count(haystack, needle) {
  return haystack.split(needle).length - 1;
}

/** 找第一处不同的行，返回 1-based 行号；完全相同时返回 0。 */
function firstDiffLine(actual, expected) {
  const a = actual.split('\n');
  const b = expected.split('\n');
  const max = Math.max(a.length, b.length);
  for (let i = 0; i < max; i += 1) {
    if (a[i] !== b[i]) return i + 1;
  }
  return 0;
}

/** 取行号附近的上下文，供断言失败时定位。 */
function context(lines, line, radius = 3) {
  const start = Math.max(0, line - 1 - radius);
  const end = Math.min(lines.length, line - 1 + radius + 1);
  return lines
    .slice(start, end)
    .map((text, i) => {
      const n = start + i + 1;
      const shown = text.length > 120 ? `${text.slice(0, 120)}…` : text;
      return `    ${String(n).padStart(5)} | ${shown}`;
    })
    .join('\n');
}

/** 拼一条"请先 build"的可读失败信息。 */
function buildMismatchMessage(actual, expected) {
  const line = firstDiffLine(actual, expected);
  const a = actual.split('\n');
  const b = expected.split('\n');
  const show = (v) => (v === undefined ? '（文件已结束，没有这一行）' : `「${v}」`);
  return [
    'client.js 与 client/src 的构建结果不一致。',
    '原因通常是改了 client/src/*.js 但忘了重新生成 —— 请先运行 npm run build:client。',
    '',
    `第一处不同在第 ${line} 行：`,
    `  client.js（图盘上，${actual.length} 字节）${show(a[line - 1])}`,
    `  buildClient() 的输出（${expected.length} 字节）${show(b[line - 1])}`,
    '',
    '上下文（client.js）：',
    context(a, line),
    '',
    '上下文（buildClient 输出）：',
    context(b, line),
  ].join('\n');
}

/** 读取全部片段（文件名、源码），供顶层声明测试复用。 */
async function readFragments() {
  const names = (await readdir(SRC)).filter((n) => n.endsWith('.js')).sort();
  const fragments = [];
  for (const name of names) {
    fragments.push({ name, code: await readFile(path.join(SRC, name), 'utf8') });
  }
  return fragments;
}

test('构建产物与片段结构约束', async (t) => {
  await t.test('client.js 与 buildClient() 的输出逐字节一致', async () => {
    const { output } = await buildClient();

    let actual;
    try {
      actual = await readFile(CLIENT, 'utf8');
    } catch (err) {
      if (err.code === 'ENOENT') {
        assert.fail('client.js 不存在：请先运行 npm run build:client');
      }
      throw err;
    }

    assert.ok(
      actual === output,
      buildMismatchMessage(actual, output),
    );
  });

  await t.test('wrapper 只出现一次：window.__ModuleLoader__.load', async () => {
    const src = await readFile(CLIENT, 'utf8');
    const times = count(src, 'window.__ModuleLoader__.load');
    assert.equal(
      times,
      1,
      `client.js 里 window.__ModuleLoader__.load 应恰好出现 1 次，实际 ${times} 次——`
        + '片段不要自己写 wrapper，包装由构建脚本统一生成',
    );
  });

  await t.test("模块 id 只出现一次：id: 'dsh-literature-lab'", async () => {
    const src = await readFile(CLIENT, 'utf8');
    const times = count(src, "id: 'dsh-literature-lab'");
    assert.equal(
      times,
      1,
      `client.js 里 id: 'dsh-literature-lab' 应恰好出现 1 次，实际 ${times} 次——`
        + '片段里不要复制模块声明',
    );
  });

  await t.test('client/src 片段之间没有重复的顶层声明', async () => {
    const fragments = await readFragments();
    const decls = [];
    for (const { name, code } of fragments) {
      code.split('\n').forEach((line, i) => {
        const m = line.match(TOP_DECL);
        if (!m) return;
        const id = m[1] || m[2] || m[3];
        decls.push({ name: id, file: name, line: i + 1 });
      });
    }

    // 解析器退化保护：正则失效会让"没有重复"变成假通过。
    assert.ok(
      decls.length > 10,
      `只从 client/src 提取到 ${decls.length} 个顶层声明，正则可能已失效`,
    );

    const byName = new Map();
    for (const d of decls) {
      if (!byName.has(d.name)) byName.set(d.name, []);
      byName.get(d.name).push(`${d.file}:${d.line}`);
    }
    const duplicates = [...byName.entries()]
      .filter(([, where]) => where.length > 1)
      .map(([id, where]) => `「${id}」被声明 ${where.length} 次（${where.join('、')}）`);

    assert.deepEqual(
      duplicates,
      [],
      `拼接后同一个闭包里出现重复顶层声明，function 会被静默覆盖：\n  ${duplicates.join('\n  ')}`,
    );
  });

  await t.test('片段文件名规范且数量足够', async () => {
    const fragments = await readFragments();
    const names = fragments.map((f) => f.name);

    const bad = names.filter((n) => !FRAGMENT_NAME.test(n));
    assert.deepEqual(
      bad,
      [],
      `片段文件名必须匹配 ${FRAGMENT_NAME}（两位序号 + 小写名），不合格：${bad.join('、')}`,
    );

    assert.ok(
      names.length >= MIN_FRAGMENTS,
      `client/src 里只有 ${names.length} 个片段，至少应有 ${MIN_FRAGMENTS} 个——检查是否有片段被误删`,
    );
  });
});
