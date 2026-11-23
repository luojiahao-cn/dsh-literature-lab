/**
 * 把 client/src/*.js 按文件名排序拼成一个 client.js。
 *
 * 为什么不用打包器：DSH 插件按 package.json 的 exports["./client"] 只加载一个文件，
 * 而这里没有构建链。拼接是零依赖、可复现的做法：所有片段共享 factory 的同一个闭包。
 *
 * 约定（build 会检查）：
 * - 片段只写 `factory(require)` 函数体内部的内容，不要自己写 wrapper；
 * - 片段之间不 import/export，直接共享顶层声明；
 * - 顶层 function 声明会互相覆盖，所以重名要靠 test/build.test.mjs 兜住。
 */
import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'client', 'src');
const OUT = path.join(ROOT, 'client.js');

const HEADER = `window.__ModuleLoader__.load({
  id: 'dsh-literature-lab',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const { useState, useEffect, useCallback } = React;

`;

const FOOTER = `  },
});
`;

export async function buildClient() {
  const names = (await readdir(SRC))
    .filter((n) => n.endsWith('.js'))
    .sort();
  if (!names.length) throw new Error(`没有找到片段：${SRC}`);
  const parts = [];
  for (const name of names) {
    const body = await readFile(path.join(SRC, name), 'utf8');
    if (!body.endsWith('\n')) parts.push(`${body}\n`);
    else parts.push(body);
  }
  const output = `${HEADER}${parts.join('')}${FOOTER}`;
  return { output, names };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { output, names } = await buildClient();
  await writeFile(OUT, output, 'utf8');
  console.log(`build-client: ${names.length} 个片段 → client.js（${output.split('\n').length} 行）`);
}
