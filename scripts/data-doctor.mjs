#!/usr/bin/env node
/**
 * 只读对账：候选↔论文↔PDF↔run。
 * 用法：node scripts/data-doctor.mjs [--strict]
 * --strict 时 error 级问题返回 1；默认只输出报告。
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { dataDoctor } from '../lib/doctor.js';

const baseDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const report = await dataDoctor(baseDir);
console.log(JSON.stringify(report, null, 2));
if (process.argv.includes('--strict') && !report.ok) process.exit(1);
