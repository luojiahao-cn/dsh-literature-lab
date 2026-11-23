#!/usr/bin/env node
/**
 * 清空派生数据（候选池 + runs + seen + 来源健康 + email 处理账 + schedule 运行摘要），保留论文/卡片/配置。
 *
 * 用法：node scripts/reset-derived.mjs --yes [--keep-email] [--keep-source-health]
 * 必须带 --yes；执行前会备份到 state/backup/<时间>-reset/。
 * 建议在插件没有采集/判读任务时运行；运行中的宿主不会被这个独立进程锁住。
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resetDerived } from '../lib/reset.js';

const baseDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
if (!process.argv.includes('--yes')) {
  console.error('拒绝执行：这是破坏性操作。确认清空候选池、runs、seen、来源健康后，加 --yes 再跑。');
  process.exit(1);
}
const result = await resetDerived(baseDir, {
  keepEmailProcessed: process.argv.includes('--keep-email'),
  keepSourceHealth: process.argv.includes('--keep-source-health'),
});
console.log(JSON.stringify(result, null, 2));
