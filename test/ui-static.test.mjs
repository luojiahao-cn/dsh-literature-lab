/**
 * client.js 静态检查：把几条"容易回潮"的约定变成测试。
 *
 * 这些不是行为测试，而是防止后续改动把已经修好的问题又改回去：
 * 未定义的颜色键、越界主题 token、原生弹窗、静默失败、重复模块注册、中文文案膨胀。
 */
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import assert from 'node:assert/strict';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = await readFile(path.join(ROOT, 'client.js'), 'utf8');

/** 已经核实存在于宿主主题里的 token（新增前先核对 design-platform.css / base.css）。 */
const KNOWN_TOKENS = new Set([
  '--dsw-alias-label-primary',
  '--dsw-alias-label-secondary',
  '--dsw-alias-label-tertiary',
  '--dsw-alias-label-caption',
  '--dsw-alias-border-l1',
  '--dsw-alias-border-l2',
  '--dsw-alias-bg-layer-1',
  '--dsw-alias-bg-layer-2',
  '--dsw-alias-state-business-primary',
  '--dsw-alias-state-warn-primary',
  '--dsw-alias-state-success-primary',
  '--dsw-alias-state-error-primary',
  '--dsw-alias-interactive-bg-hover',
  '--dsw-alias-brand-primary',
  '--dsw-alias-border-l3',
  '--dsw-alias-bg-overlay',
  '--dsw-alias-label-on-color',
]);

/**
 * 中文行数上限：新增界面文案时同步上调，避免一次性膨胀。
 * 2026-11-21 P0b：420 → 470（论文抽屉 + 阅读视图 + 四数卡实体标注）。
 * 2026-11-21 拆分到 client/src 后：470 → 480（视觉刻度 T 与语义 token 注释）。
 * 2026-11-21 IA 重排后：480 → 700（今日/流水线/来源/设置四页重写，文案随功能增加）。
 * 2026-11-21 i18n 通道：700 → 760（中文词典条目也算中文行）。
 * 2026-11-21 Markdown 渲染与调度卡改版：760 → 780。
 * 2026-11-21 设置页重构（四分区/模型/策略/系统）：780 → 900。
 * 2026-11-21 总览摘要 + 来源雷达 + 队列稍后/视图：900 → 1100。
 * 2026-11-21 待办阶段标签与操作列：1260 → 1290。
 * 2026-11-22 研究兴趣卡改版：1330 → 1340（分组布局、计数徽标与计分说明）。
 * 2026-11-22 清空匹配条件（含高级项与确认弹窗）：1340 → 1350。
 * 2026-11-22 采集概况（7/30 天双条账 + 来源柱）：1390 → 1423。
 * 2026-11-22 采集栏收起式设置 + 邮件并入立即采集：1423 → 1430。
 * 2026-11-22 邮件回执带失败原因：1430 → 1439。
 * 2026-11-22 采集历史卡：1439 → 1452。
 * 2026-11-22 渠道配置展开区表单化（ConfigRow / ListRow / ChipList）：1452 → 1500。
 * 2026-11-22 处理队列重排（概况表 + 人/AI 两框 + 历史子视图）：1500 → 1600。
 */
const CJK_LINE_BASELINE = 1600;

test('client.js 静态约定', async (t) => {
  await t.test('语法可解析（与宿主一样按脚本求值）', () => {
    assert.doesNotThrow(() => new Function('window', src));
  });

  await t.test('所有 C.* 颜色键都已定义', () => {
    const start = src.indexOf('const C = {');
    assert.ok(start > 0, '找不到 C 定义');
    const block = src.slice(start, src.indexOf('};', start));
    const defined = new Set([...block.matchAll(/^\s*([a-zA-Z0-9_]+):/gm)].map((m) => m[1]));
    const used = new Set([...src.matchAll(/\bC\.([a-zA-Z0-9_]+)/g)].map((m) => m[1]));
    const missing = [...used].filter((k) => !defined.has(k));
    assert.deepEqual(missing, [], `未定义的颜色键：${missing.join(', ')}`);
  });

  await t.test('只使用已核实的主题 token', () => {
    const tokens = new Set([...src.matchAll(/--dsw-[a-z0-9-]+/g)].map((m) => m[0]));
    const unknown = [...tokens].filter((tk) => !KNOWN_TOKENS.has(tk));
    assert.deepEqual(unknown, [], `未登记的主题 token：${unknown.join(', ')}`);
  });

  await t.test('不使用原生弹窗（Electron 不支持 prompt）', () => {
    assert.equal(/\bwindow\.(prompt|confirm|alert)\s*\(/.test(src), false);
  });

  await t.test('没有"catch 后返回 null"的静默失败', () => {
    assert.equal(/\.catch\(\s*\(\s*\)\s*=>\s*(null|\{\s*\})\s*\)/.test(src), false);
  });

  await t.test('模块只注册一次，且只注册 main slot 一次', () => {
    assert.equal((src.match(/__ModuleLoader__\.load/g) || []).length, 1);
    assert.equal((src.match(/name: 'main'/g) || []).length, 1);
  });

  await t.test('不 require 宿主 Client 包', () => {
    assert.equal(/require\(\s*['"]@deepseek-ai\/dsh-client/.test(src), false);
  });

  await t.test('颜色不硬编码（#fff 属白名单例外）', () => {
    const hex = [...src.matchAll(/'(#[0-9a-fA-F]{3,8})'/g)].map((m) => m[1]);
    const extra = hex.filter((x) => x.toLowerCase() !== '#fff');
    assert.deepEqual(extra, [], `出现硬编码颜色：${extra.join(', ')}`);
  });

  await t.test('渠道配置用共享表单组件（标签主色 + 可折行）', () => {
    const start = src.indexOf('function ConfigRow(');
    assert.ok(start > 0, '缺少 ConfigRow：渠道配置应复用共享配置行，而不是各渠道各拼一套');
    const body = src.slice(start, src.indexOf('function ConfigEmpty('));
    assert.match(body, /color: C\.label1/, '配置行标签要用主文字色，不能拿 caption 灰字当字段名');
    assert.match(body, /flexWrap: 'wrap'/, '配置行要能折行：窄屏靠 flex-basis 堆叠，不读 window.innerWidth');
    assert.match(body, /function ListRow\(/, '缺少 ListRow：RSS / 检索式这类可编辑列表应共用行组件');
    assert.match(body, /function ChipList\(/, '缺少 ChipList：兴趣词要显示成可核对的词，而不是一句灰话');
  });

  await t.test('界面文案不出现 L1/L2/L3 这种内部编号', async () => {
    // 阶段值（'L2'）、比较（p.stage === 'L3'）是代码，允许；
    // 中文紧贴编号（「已过 L3」「L2/L3 结论」）说明它混进了给人看的文案。
    // 注释不扫：维护者需要知道内部层名。
    const dir = path.join(ROOT, 'client/src');
    const hits = [];
    for (const name of (await readdir(dir)).filter((n) => n.endsWith('.js')).sort()) {
      const lines = (await readFile(path.join(dir, name), 'utf8')).split('\n');
      lines.forEach((line, i) => {
        const body = line.trim();
        if (body.startsWith('//') || body.startsWith('*') || body.startsWith('/*')) return;
        if (/[\u4e00-\u9fff]\s*L[0-3]|L[0-3]\s*[\u4e00-\u9fff]/.test(line)) {
          hits.push(`${name}:${i + 1} ${body.slice(0, 60)}`);
        }
      });
    }
    assert.deepEqual(hits, [], `界面文案里出现内部阶段编号：\n${hits.join('\n')}`);
  });

  await t.test(`中文行数不超过基线 ${CJK_LINE_BASELINE}`, () => {
    const count = src.split('\n').filter((line) => /[\u4e00-\u9fa5]/.test(line)).length;
    assert.ok(count <= CJK_LINE_BASELINE, `中文行数 ${count} 超过基线 ${CJK_LINE_BASELINE}`);
  });
});
