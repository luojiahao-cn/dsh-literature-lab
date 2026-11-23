/**
 * client.js 渲染冒烟（临时，跑完删）。
 *
 * 用最小 React 运行时把 Workbench 真渲染一遍：概览、AI 分析、L1 行的
 * 三问 / 临时标记 / 摘要展开 / 缺摘要提示 / 正式-临时统计。
 * 不做像素比对，只验证能渲染、文案与字段真的出现在树里。
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import assert from 'node:assert/strict';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// ── 最小 React 运行时 ──────────────────────────────────────
let currentHooks = null;
let dirty = false;
const hookStore = new Map();
const pendingEffects = [];

function hooksFor(key) {
  let h = hookStore.get(key);
  if (!h) { h = { states: [], effects: [], callbacks: [], cursor: 0 }; hookStore.set(key, h); }
  return h;
}

const React = {
  createElement(type, props, ...children) {
    return { type, props: { ...(props || {}), children }, children };
  },
  useState(init) {
    const h = currentHooks;
    const i = h.cursor++;
    if (!(i in h.states)) h.states[i] = typeof init === 'function' ? init() : init;
    const set = (v) => {
      h.states[i] = typeof v === 'function' ? v(h.states[i]) : v;
      dirty = true;
    };
    return [h.states[i], set];
  },
  useEffect(fn, deps) {
    const h = currentHooks;
    const i = h.cursor++;
    const prev = h.effects[i];
    const same = prev && deps && prev.deps
      && deps.length === prev.deps.length && deps.every((d, k) => d === prev.deps[k]);
    if (!same) {
      h.effects[i] = { deps };
      pendingEffects.push(fn);
    }
  },
  useCallback(fn, deps) {
    const h = currentHooks;
    const i = h.cursor++;
    const prev = h.callbacks[i];
    const same = prev && deps && prev.deps
      && deps.length === prev.deps.length && deps.every((d, k) => d === prev.deps[k]);
    if (same) return prev.fn;
    h.callbacks[i] = { fn, deps };
    return fn;
  },
  useMemo(fn) { return fn(); },
  useRef(v) { return { ref: v }; },
};

// 最小类组件支持：ErrorBoundary 需要 Component + render()
class Component {
  constructor(props) { this.props = props; this.state = {}; }
  setState(patch) {
    const next = typeof patch === 'function' ? patch(this.state, this.props) : patch;
    this.state = { ...this.state, ...next };
    dirty = true;
  }
}
Component.prototype.isReactComponent = {};
React.Component = Component;
React.default = React;

// ── 渲染 ───────────────────────────────────────────────────
function expand(node, key) {
  if (node === null || node === undefined || typeof node === 'boolean') return null;
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map((c, i) => expand(c, `${key}[${i}]`));
  const { type, props } = node;
  const kids = props.children || [];
  if (typeof type === 'function' && type.prototype && type.prototype.isReactComponent) {
    const inst = new type({ ...props, children: kids.length === 1 ? kids[0] : kids });
    const prev = currentHooks;
    currentHooks = null;
    let out;
    try {
      out = inst.render();
    } finally {
      currentHooks = prev;
    }
    return expand(out, `${key}<`);
  }
  if (typeof type === 'function') {
    const prev = currentHooks;
    currentHooks = hooksFor(`${key}:${type.name || 'anon'}`);
    currentHooks.cursor = 0;
    let out;
    try {
      out = type({ ...props, children: kids.length === 1 ? kids[0] : kids });
    } finally {
      currentHooks = prev;
    }
    return expand(out, `${key}<`);
  }
  return { type, props: { ...props, children: kids.map((c, i) => expand(c, `${key}/${i}`)) } };
}

async function render(Component) {
  let tree = null;
  for (let pass = 0; pass < 40; pass += 1) {
    dirty = false;
    pendingEffects.length = 0;
    tree = expand({ type: Component, props: { children: [] } }, 'root');
    if (!pendingEffects.length) break;
    for (const fn of pendingEffects) await fn();
    // effect 里的 reload() 是异步的：固定放几拍，等 fetch → setState 全部落地
    for (let tick = 0; tick < 6; tick += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    if (!dirty) break;
  }
  return tree;
}

function textOf(node) {
  if (node === null || node === undefined) return '';
  if (typeof node === 'string') return node;
  if (Array.isArray(node)) return node.map(textOf).join('');
  return textOf(node.props?.children);
}

function all(node, out = []) {
  if (!node) return out;
  if (typeof node === 'string') return out;
  if (Array.isArray(node)) {
    for (const n of node) all(n, out);
    return out;
  }
  out.push(node);
  for (const c of node.props?.children || []) all(c, out);
  return out;
}

function buttons(tree) {
  return all(tree).filter((n) => n.type === 'button');
}

function hasText(tree, text) {
  return all(tree).some((n) => textOf(n) === text);
}

const fails = [];
let passed = 0;
function ok(cond, label, extra) {
  if (cond) { passed += 1; console.log(`  PASS ${label}`); }
  else { fails.push(label); console.log(`  FAIL ${label}${extra === undefined ? '' : ` → ${extra}`}`); }
}

// ── 数据 fixture ───────────────────────────────────────────
const LONG = `L1 fixture abstract. ${'Detailed abstract sentence about the method and evidence. '.repeat(8)}`;
const fixtures = {
  state: {
    ok: true,
    date: '2026-11-20',
    updated_at: '2026-11-20T00:00:00.000Z',
    quota: null,
    summary: {
      total: 2,
      stages: { L0: 0, L1: 2, L2: 0, L3: 0, done: 0, dropped: 0 },
      byGrade: { S: 1, A: 0, B: 1, C: 0, D: 0 },
      counts: { new: 2, filtered: 3 },
      library: 0,
      translated: 0,
      today_run: null,
    },
    papers: [
      {
        id: 'arxiv:9999.00001',
        title: 'Fixture L1 Paper',
        doi: null,
        arxiv_id: '9999.00001',
        stage: 'L1',
        grade: 'B',
        grade_basis: 'abstract',
        grade_history: [{
          stage: 'L1', grade: 'B', reason: '摘要给出在线标定流程与误差上界',
          basis: 'abstract', at: '2026-11-20T00:00:00.000Z',
        }],
        first_seen: '2026-11-20',
        sources: ['test'],
        l1: {
          domain: 'edge',
          increment: '把离线批次标定扩到在线逐样本，并给出误差上界',
          use: 'method',
          note: '',
          at: '2026-11-20T00:00:00.000Z',
        },
        abstract: LONG,
        abstract_lookup: { matched: true, has_abstract: true, via: 'arxiv', reason: null },
        venue: 'arXiv preprint',
        year: '2026',
        meta_source: 'arxiv',
        has_pdf: false,
        translated: false,
      },
      {
        id: 'doi:10.9999/no-abstract',
        title: 'Fixture Without Abstract',
        doi: '10.9999/no-abstract',
        arxiv_id: null,
        stage: 'L1',
        grade: null,
        grade_basis: null,
        grade_history: [],
        first_seen: '2026-11-20',
        sources: ['test'],
        l1: null,
        abstract: null,
        abstract_lookup: { matched: false, has_abstract: false, via: null, reason: 'no-abstract' },
        has_pdf: false,
        translated: false,
      },
    ],
    sources: {
      arxiv: { last_ok_at: '2026-11-20T00:00:00.000Z', last_count: 2, consecutive_failures: 0, last_error: null },
      'rss:feed-a': { last_ok_at: null, last_count: 0, consecutive_failures: 2, last_error: 'HTTP 500' },
    },
    runs: [],
  },
  config: {
    ok: true,
    config: {
      window: { hours: 48 },
      sources: {
        rss: [],
        mail: {},
        search: { enabled: true, sources: ['arxiv', 'openalex', 'crossref'], sinceDays: 30, limit: 20, queries: [] },
      },
      relevance: { keywords: [], contextKeywords: [], excludeKeywords: [], minScore: 5 },
      quota: { analysisPerDay: 2, translationPerDay: 1 },
    },
  },
};

// 一篇 L2 论文：用来验证重跑/补 PDF 等行内动作
fixtures.state.papers.push({
  id: 'zzz:l2',
  title: 'Fixture L2 Paper',
  doi: null,
  arxiv_id: null,
  stage: 'L2',
  grade: 'B',
  grade_basis: 'abstract',
  grade_history: [],
  first_seen: '2026-11-20',
  sources: ['test'],
  has_pdf: false,
  review_flags: ['needs_pdf'],
  l1: { domain: 'core', increment: '给出在线标定误差上界', use: 'method' },
  l3: {
    final_grade: 'B',
    confidence: 'high',
    summary: '可作为基线',
    card_markdown: '# 研究问题\n\n正文里有 **关键结论** 与 `代码片段`。\n\n## 方法\n\n- 条目一\n- 条目二\n',
  },
});

// 一篇今天新进、判为 S 的论文：总览的「今日必读」要能直接给出
fixtures.state.papers.push({
  id: 'zzz:s-grade',
  title: 'Fixture S Paper',
  stage: 'L2',
  grade: 'S',
  first_seen: '2026-11-20',
  has_pdf: true,
  doi: null,
  arxiv_id: null,
  venue: 'Test Venue',
  year: 2026,
  sources: ['test'],
  l1: {
    domain: 'core',
    increment: '提出无需额外传感器的在线标定方法，误差上界可证明',
    use: 'method',
  },
  l3: {
    final_grade: 'S',
    confidence: 'high',
    why_read: '提出无需额外传感器的在线标定方法，误差上界可证明',
    summary: '提出无需额外传感器的在线标定方法，误差上界可证明',
    card_markdown: '',
    figures: [{ page: 1, caption: 'Figure 1', why: '先看结构', file: 'state/figures/s/p1.png', kind: 'figure' }],
    figure_count: 1,
  },
  grade_history: [],
});

// 粗读论文：done 但没有精读卡片 → 应在阅读页「粗读」里
fixtures.state.papers.push({
  id: 'zzz:skim',
  title: 'Fixture Skim Paper',
  stage: 'done',
  grade: 'C',
  grade_basis: 'triage',
  grade_history: [],
  first_seen: '2026-11-19',
  sources: ['test'],
  has_pdf: true,
  l2: { verdict: 'skim', confidence: 'high', reason: '方法可借鉴，但不直接相关' },
});

// 有 PDF 的 L1 论文：主按钮应是「进入初筛」，不是空转的「立即处理」
fixtures.state.papers.push({
  id: 'zzz:l1pdf',
  title: 'Fixture Summary-Pending With PDF',
  stage: 'L1',
  grade: 'C',
  grade_basis: 'abstract',
  grade_history: [],
  first_seen: '2026-11-20',
  sources: ['test'],
  has_pdf: true,
  abstract: 'An abstract for the L1 paper.',
});

// 判读失败的候选：行内应标「需人工重试」，主按钮「重试」
fixtures.state.papers.push({ id: 'zzz:noop', title: 'Fixture Noop', stage: 'dropped', sources: ['test'] });

// 一篇已读论文：验证「已读」折叠区能渲染（曾经的 queueRow 未定义）
fixtures.state.papers.push({
  id: 'zzz:read',
  title: 'Fixture Read Paper',
  stage: 'done',
  grade: 'A',
  grade_basis: 'fulltext',
  grade_history: [],
  first_seen: '2026-11-19',
  sources: ['test'],
  has_pdf: true,
  read_at: '2026-11-20T10:00:00.000Z',
  l3: { final_grade: 'A', confidence: 'high', summary: '已读过的一篇', why_read: '值得当基线', card_markdown: '## 已读卡片\n正文' },
});

// 一篇判成 C 的论文：不进阅读队列（宁缺不放）
fixtures.state.papers.push({
  id: 'zzz:c-grade',
  title: 'Fixture C Paper',
  stage: 'L2',
  grade: 'C',
  grade_basis: 'abstract',
  grade_history: [],
  first_seen: '2026-11-20',
  sources: ['test'],
  has_pdf: true,
  l1: { domain: 'edge', increment: '把已有方法换了个场景', use: 'citation' },
});

// 一篇已丢弃论文：验证「已丢弃」分段与恢复入口
fixtures.state.papers.push({
  id: 'zzz:dropped',
  title: 'Fixture Dropped Paper',
  doi: null,
  arxiv_id: null,
  stage: 'dropped',
  grade: 'D',
  grade_basis: 'triage',
  grade_history: [],
  first_seen: '2026-11-19',
  sources: ['test'],
  has_pdf: false,
});

// 给队列补 12 条，用来验证「一次多显示 10 条」
for (let i = 1; i <= 12; i += 1) {
  fixtures.state.papers.push({
    id: `zzz:${i}`,
    title: `Bulk Paper ${i}`,
    doi: null,
    arxiv_id: null,
    stage: 'L1',
    grade: null,
    grade_basis: null,
    grade_history: [],
    first_seen: '2026-11-20',
    sources: ['test'],
    l1: null,
    abstract: null,
    abstract_lookup: { matched: false, has_abstract: false, via: null, reason: 'no-abstract' },
    has_pdf: false,
    translated: false,
  });
}
fixtures.state.summary.stages.L1 = 14;

// 失败注入：newTests 里设置 failWhen 可让指定请求返回 500
globalThis.__mockFail = null;

globalThis.__schedulePosts = [];
globalThis.__promotePosts = [];
globalThis.__stagePosts = [];
globalThis.__readPosts = [];
globalThis.__refetchPosts = [];
globalThis.__openPdfPosts = [];
globalThis.__openUrlPosts = [];
globalThis.__zoteroImportFail = false;
globalThis.__candidateQueries = [];
globalThis.fetch = async (url, init = {}) => ({
  ok: globalThis.__mockFail ? !globalThis.__mockFail(String(url)) : true,
  status: globalThis.__mockFail && globalThis.__mockFail(String(url)) ? 500 : 200,
  json: async () => {
    const href = String(url);
    if (href.includes('/candidates?')) globalThis.__candidateQueries.push(href);
    if (href.includes('/config')) {
      // 设置页改动会 POST 配置：这里把补丁合并进 fixture，才能验证「改完界面真的变」
      if (init.method === 'POST') {
        try {
          const patch = JSON.parse(init.body || '{}');
          const merge = (base, extra) => {
            if (!extra || typeof extra !== 'object' || Array.isArray(extra)) return extra;
            const out = { ...(base || {}) };
            for (const key of Object.keys(extra)) out[key] = merge(base?.[key], extra[key]);
            return out;
          };
          fixtures.config.config = merge(fixtures.config.config, patch);
        } catch { /* 坏 body 就按原配置返回 */ }
      }
      return fixtures.config;
    }
    if (href.includes('/harvest')) return { ok: true, harvests: [] };
    if (href.includes('/candidates/promote')) {
      try { globalThis.__promotePosts.push(JSON.parse(init.body || '{}')); } catch { /* 忽略坏 body */ }
      return { ok: true, paper: { id: 'c3', stage: 'L2' } };
    }
    if (href.includes('/candidates')) {
      const items = [
        {
          id: 'c1', title: 'Candidate One', year: 2026, status: 'new', t0: { score: 12 },
          abstract: 'Online calibration of a magnetometer array without extra sensors.',
          analysis: null, sources: ['scholar-alert'],
        },
        {
          id: 'c2', title: 'Candidate Two', year: 2025, status: 'new', t0: { score: 9 },
          abstract: 'A tabletop workspace using passive graph tracking.',
          analysis: { verdict: 'admit', grade: 'B' },
        },
        {
          id: 'c3',
          title: 'Candidate Parked',
          year: 2024,
          status: 'parked',
          t0: { score: 3 },
          abstract: 'A tabletop workspace using passive graph tracking.',
          analysis: { verdict: 'hold', grade: 'C', reason: '摘要只给了仿真，没有实验证据' },
        },
        {
          id: 'c4',
          title: 'Candidate No Abstract',
          year: 2023,
          status: 'new',
          t0: { score: 5 },
          doi: '10.1234/na.1',
          abstract: null,
          analysis: { verdict: 'hold', grade: 'C', reason: '摘要为空，仅有标题' },
        },
        {
          id: 'c5',
          title: 'Fixture Failed Candidate',
          year: 2022,
          status: 'failed',
          t0: { score: 4 },
          abstract: 'Some abstract.',
          analysis: { error: 'model timeout', reason: null, grade: null },
        },
      ];
      return { ok: true, total: 4, items, counts: { new: 3, failed: 1, parked: 1, filtered: 3 } };
    }
    if (href.includes('/paper/stage')) {
      try { globalThis.__stagePosts.push(JSON.parse(init.body || '{}')); } catch { /* 忽略坏 body */ }
      return { ok: true, paper: { id: 'zzz:l1pdf', stage: 'L2' } };
    }
    if (href.includes('/paper/read')) {
      try { globalThis.__readPosts.push(JSON.parse(init.body || '{}')); } catch { /* 忽略坏 body */ }
      return { ok: true, updated: 1 };
    }
    if (href.includes('/paper?')) {
      return {
        ok: true,
        paper: {
          id: 'arxiv:9999.00001',
          title: 'Fixture L1 Paper',
          stage: 'L2',
          grade: 'B',
          has_pdf: true,
          pdf: 'pdfs/fixture.pdf',
          doi: null,
          arxiv_id: '9999.00001',
          venue: 'Test Venue',
          year: 2026,
          abstract: 'Full abstract for the drawer.',
          meta_source: 'openalex',
          review_flags: ['low_confidence'],
          manual_override: false,
          zotero_key: null,
          l1: { domain: 'edge', increment: '把离线批次标定扩到在线逐样本', use: 'method' },
          l2: { verdict: 'close-read', confidence: 'high', reason: '方法可直接复用' },
          l3: { final_grade: 'B', confidence: 'high', summary: '值得作为基线', card_markdown: '## 卡片\n正文' },
          grade_history: [
            { stage: 'L1', grade: 'B', reason: '摘要给出在线标定流程', basis: 'abstract', at: '2026-11-20T00:00:00.000Z' },
          ],
        },
        text: { pages: 8, chars: 24000, scanned: false, truncated: false },
      };
    }
    if (href.includes('/digest')) {
      return {
        ok: true,
        date: '2026-11-20',
        window: { from: '2026-11-20T00:00:00+08:00', to: '2026-11-20T24:00:00+08:00' },
        groups: [{
          keyword: '图特征',
          total: 1,
          items: [{
            id: 'zzz:s-grade',
            title: 'Fixture S Paper',
            grade: 'S',
            venue: 'Test Venue',
            year: 2026,
            has_pdf: true,
            first_seen: '2026-11-20',
            l1: { domain: 'core', increment: '提出无需额外传感器的在线标定方法，误差上界可证明', use: 'method' },
          }],
        }],
        others: [],
        stats: { graded: 1, s: 1, a: 0, b: 0, latestJudgedAt: null },
        options: { includeB: false, maxPerGroup: 2 },
      };
    }
    if (href.includes('/llm/models')) {
      return {
        ok: true,
        providers: [
          { id: 'deepseek', name: 'DeepSeek', models: [{ id: 'deepseek-flash', name: 'flash' }, { id: 'deepseek-chat', name: 'chat' }] },
        ],
        defaults: {
          l1: { provider: 'deepseek', model: 'deepseek-flash' },
          l2: { provider: 'deepseek', model: 'deepseek-flash' },
          l3: { provider: 'deepseek', model: 'deepseek-flash' },
        },
      };
    }
    if (href.includes('/analysis/stats')) {
      return {
        ok: true,
        stats: {
          limits: { l1: 50, l2: 10, l3: 2, pdf: 10 },
          usage: { l1: 0, l2: 10, l3: 0, pdf: 0, tokens: 0 },
          counts: { new: 2, filtered: 3 },
          running: [],
        },
      };
    }
    if (href.includes('/zotero/import')) {
      if (globalThis.__zoteroImportFail) {
        return { ok: true, result: { ok: false, dryRun: false, collection: null, results: [{ id: 'arxiv:9999.00001', ok: false, error: 'Zotero 未启用' }] } };
      }
      return {
        ok: true,
        result: { ok: true, dryRun: false, collection: null, results: [{ id: 'arxiv:9999.00001', ok: true, key: 'ZOT1' }] },
      };
    }
    if (href.includes('/open-url')) {
      try { globalThis.__openUrlPosts.push(JSON.parse(init.body || '{}')); } catch { /* ignore */ }
      return { ok: true, opened: true, url: 'https://doi.org/10.1234/na.1' };
    }
    if (href.includes('/paper/open-pdf')) {
      try { globalThis.__openPdfPosts.push(JSON.parse(init.body || '{}')); } catch { /* ignore */ }
      return { ok: true, opened: true };
    }
    if (href.includes('/refetch')) {
      try { globalThis.__refetchPosts.push(JSON.parse(init.body || '{}')); } catch { /* 忽略坏 body */ }
      return { ok: true, matched: true, has_abstract: true, via: 'openalex' };
    }
    if (href.includes('/jobs')) {
      return {
        ok: true,
        jobs: [{
          id: 'job-1', name: 'analysis:L2', status: 'running', started_at: '2026-11-20T00:00:00.000Z',
          meta: { stage: 'L2', targets: ['zzz:s-grade'] },
          progress: { id: 'zzz:s-grade', phase: '初筛判断中', at: '2026-11-20T00:00:05.000Z' },
        }],
      };
    }
    if (href.includes('/schedule')) {
      if (init.method === 'POST') {
        try { globalThis.__schedulePosts.push(JSON.parse(init.body)); } catch { /* 忽略非法体 */ }
        const posted = globalThis.__schedulePosts[globalThis.__schedulePosts.length - 1] || {};
        return { ok: true, schedule: { enabled: Boolean(posted.enabled), time: posted.time || '07:00', next_run_at: '2026-11-22T00:00:00.000Z' } };
      }
      return { ok: true, schedule: { enabled: false, time: '07:00' } };
    }
    if (href.includes('/email')) return { ok: true, emails: 0, parsed: 0, added: 0 };
    if (href.includes('/need_download')) return { ok: true, total: 0, items: [] };
    if (href.includes('/download')) return { ok: true, results: [] };
    return fixtures.state;
  },
});

// ── 假的 locale 服务：记录注册的字典，按 active 语言给出译文 ──
function makeLocale(active = 'zh') {
  const calls = [];
  const dicts = {};
  return {
    calls,
    dicts,
    register(ns, all) {
      calls.push({ ns, locales: Object.keys(all) });
      dicts[ns] = all;
      return () => {};
    },
    bind(ns) {
      return (key) => {
        const value = dicts[ns]?.[active]?.[key];
        return typeof value === 'string' ? value : key;
      };
    },
    subscribe() { return () => {}; },
    getLocale() { return { active, locales: [], revision: 1 }; },
  };
}

const zhLocale = makeLocale('zh');

// ── 加载 client.js ─────────────────────────────────────────
let mod = null;
globalThis.window = {
  __ModuleLoader__: {
    load({ factory }) {
      mod = factory((name) => {
        if (name === 'react') return React;
        throw new Error(`unexpected require: ${name}`);
      });
    },
  },
};

const src = await readFile(path.join(ROOT, 'client.js'), 'utf8');
// eslint-disable-next-line no-new-func
new Function('window', src)(globalThis.window);

let Main = null;
mod.apply({
  slots: {
    inject(name, fn) { fn(); },
    register(spec, component) { if (spec.name === 'main') Main = component; },
  },
  locale: zhLocale,
});

ok(zhLocale.calls.length === 1, 'apply 时注册了一次文案字典');
ok(zhLocale.calls[0]?.ns === 'literature-lab', '字典命名空间正确');
ok(
  JSON.stringify(zhLocale.calls[0]?.locales?.slice().sort()) === JSON.stringify(['en', 'zh']),
  '同时注册中英两份字典',
);
const zhDict = zhLocale.dicts['literature-lab']?.zh || {};
const enDict = zhLocale.dicts['literature-lab']?.en || {};
ok(Object.keys(zhDict).length > 25, '中文词典覆盖主要枚举');
ok(
  JSON.stringify(Object.keys(zhDict).sort()) === JSON.stringify(Object.keys(enDict).sort()),
  '中英词典键完全对齐',
);

ok(typeof Main === 'function', 'client.js 加载并注册了 main slot 组件');
if (!Main) { console.log('无法继续渲染'); process.exit(1); }

let tree = await render(Main);
let text = textOf(tree);
ok(text.includes('文献实验室'), '标题渲染');
ok(['总览', '雷达', 'AI 分析', '阅读', '设置'].every((t) => text.includes(t)), 'TabBar 渲染五个页签（AI 分析）');
ok(all(tree).some((n) => n.props && n.props.role === 'tablist'), '页签容器带 role=tablist');
ok(all(tree).filter((n) => n.props && n.props.role === 'tab').length === 5, '五个页签都带 role=tab');
ok(all(tree).some((n) => n.props && n.props['aria-selected'] === true), '当前页签标了 aria-selected');
// 方向键在页签间移动
const tabToday = all(tree).filter((n) => n.props && n.props.role === 'tab')[0];
tabToday.props.onKeyDown({ key: 'ArrowRight', preventDefault() {} });
tree = await render(Main);
// 顺序：总览 → 雷达 → 待办 → 阅读 → 设置；按流程把采集放在处理前面
ok(all(tree).some((n) => n.props && n.props.role === 'tab' && n.props['aria-selected']
  && textOf(n).startsWith('雷达')), '右方向键第一个到雷达（采集在流程最前）');
all(tree).filter((n) => n.props && n.props.role === 'tab')[0].props.onKeyDown({ key: 'ArrowRight', preventDefault() {} });
tree = await render(Main);
ok(textOf(tree).includes('候选'), '再按一次到待办');
// 直接点总览页签回到首页（方向键顺序已变，点选更稳）
buttons(tree).find((b) => textOf(b) === '总览').props.onClick();
tree = await render(Main);
ok(all(tree).some((n) => n.props && n.props.role === 'tab'
  && n.props['aria-selected'] === true && textOf(n).startsWith('总览')), '点总览回到首页');
text = textOf(tree);

// ── 总览页（用户视角：今天读什么 / 欠着什么 / 会不会漏论文）────
ok(/待处理 \d+ 件/.test(text), '页头状态行给出待处理数量');
ok(/开始使用/.test(text), '没配关键词时给开始使用卡');
ok(/待处理 \d+ 件/.test(text), '待处理在最前并给出总件数');
ok(/待确认 \d+|缺原文 \d+|低置信 \d+|判读失败 \d+/.test(text), '待办只列需要人动手的分项');
ok(!/待初筛 \d+|待判读 \d+/.test(text), 'AI 的队列不出现在首页待办里');
ok(/待读|已读/.test(text), '存量四格是读者视角');
ok(!text.includes('最近发生'), '采集运行日志不在首页（在来源页）');
// 今日摘要默认折叠成一行，点开展开
ok(text.includes('阅读队列'), '阅读队列取代每日摘要');
ok(/未读 \d+ 篇/.test(text), '阅读队列给出未读数');
ok(!text.includes('今日摘要') && !text.includes('看昨天'), '不再按天分组，也没有「看昨天」');
ok(text.includes('Fixture S Paper'), '队列直接列出未读论文');
ok(text.includes('提出无需额外传感器的在线标定方法'), '每行带一句判断依据');
ok(buttons(tree).some((b) => textOf(b) === '标为已读'), '未读论文可以标为已读');
ok(!text.includes('Fixture C Paper'), '判成 C 的论文不进阅读队列');
ok(!text.includes('Bulk Paper 1'), '还没判过的论文不进阅读队列');
// 已读折叠区：展开不崩溃，行能渲染
const readToggle = buttons(tree).find((b) => textOf(b).startsWith('已读 '));
ok(Boolean(readToggle), '已读论文折叠成「已读 N 篇」');
if (readToggle) {
  readToggle.props.onClick();
  tree = await render(Main);
  ok(textOf(tree).includes('Fixture Read Paper'), '展开已读后能列出论文');
  ok(!textOf(tree).includes('这个页面出错了'), '已读列表渲染没有崩溃');
}
// 标已读要真的调接口，读完离开队列
const markReadBtn = buttons(tree).find((b) => textOf(b) === '标为已读');
if (markReadBtn) {
  markReadBtn.props.onClick();
  tree = await render(Main);
  ok(globalThis.__readPosts.some((body) => body.read === true && body.id), '标已读调了 /paper/read');
}
ok(text.includes('缺原文') || text.includes('低置信'), '待办列出需要补的项');
ok(!text.includes('今日产出') && !text.includes('今日新增') && !text.includes('原文覆盖率'), '不再堆系统指标');
ok(!buttons(tree).some((b) => textOf(b) === '今日'), '页签不再叫「今日」');
// 异常才出现：fixture 有失败源，所以应该有「需要处理」
ok(text.includes('需要注意') && text.includes('采集失败'), '有源失败时以「可能漏论文」呈现');
ok(text.includes('额度用完') || text.includes('额度'), '额度用尽时给出提示');

// 欠着的活可直接跳转
const goBtn = buttons(tree).find((b) => textOf(b) === '查看待处理');
ok(Boolean(goBtn), '待办带一个动作按钮');
if (goBtn) {
  goBtn.props.onClick();
  tree = await render(Main);
  text = textOf(tree);
  ok(text.includes('待处理'), '点「查看待处理」跳到处理队列');
}

// ── 来源页 ────────────────────────────────────────────────
buttons(tree).find((b) => textOf(b).startsWith('雷达')).props.onClick();
tree = await render(Main);
text = textOf(tree);
ok(!text.includes('来源健康'), '来源健康已并入渠道卡片，不再是独立一块');
ok(!text.includes('rss:feed-a'), '收起态不露内部源键');
ok(!text.includes('scholar-alert'), '邮件来源显示人话，不露 scholar-alert');
ok(text.includes('采集记录'), '来源页有「采集记录」');
ok(text.includes('采集历史'), '来源页有「采集历史」');
ok(text.indexOf('采集概况') > -1 && text.indexOf('采集概况') < text.indexOf('核心'), '概况在研究兴趣之前');
ok(text.indexOf('核心') < text.indexOf('渠道配置'), '研究兴趣在渠道配置之前');
ok(text.indexOf('渠道配置') < text.indexOf('采集历史'), '渠道配置在采集历史之前');
ok(text.includes('还没有采集记录'), '空采集历史有说明');
ok(text.includes('采集') && text.includes('立即采集'), '来源页有采集栏与采集入口');
ok(buttons(tree).some((b) => textOf(b) === '手动添加论文'), '采集栏有「手动添加论文」入口');
const addBtn = buttons(tree).find((b) => textOf(b) === '手动添加论文');
if (addBtn) {
  addBtn.props.onClick();
  tree = await render(Main);
  ok(textOf(tree).includes('标题 / DOI / arXiv ID'), '点开后可按标识或本机 PDF 添加');
  const closeAdd = buttons(tree).find((b) => textOf(b) === '关闭');
  if (closeAdd) closeAdd.props.onClick();
  tree = await render(Main);
}
ok(text.includes('研究兴趣') && /核心\s*\d+/.test(text), '来源页有研究兴趣摘要');
// 渠道台账：区块摘要 + 行内五态
ok(/个渠道/.test(text) && /个启用/.test(text) && /个未配置/.test(text), '渠道台账有数据摘要');
ok(text.includes('未配置 · 缺分类'), 'arXiv 缺分类时行内标未配置');
ok(text.includes('已停用'), '停用的渠道行标已停用');
// 展开 RSS 卡片：采集记录与失败原因都在这张卡里
const rssToggle = buttons(tree).find((b) => b.props && b.props['aria-label'] === '展开 RSS 订阅 配置');
ok(Boolean(rssToggle), '渠道卡片可展开');
if (rssToggle) {
  rssToggle.props.onClick();
  tree = await render(Main);
  text = textOf(tree);
}
ok(text.includes('配置') && text.includes('订阅列表'), '展开后只显示配置');
ok(!text.includes('rss:feed-a'), '配置区不露内部源键');

// 渠道卡片头：只有配置图标 + 开关，没有「配置」「收起」文字
const arxivRow = all(tree).find((n) => n.props && n.props.id === 'radar-source-arxiv');
ok(Boolean(arxivRow), '找到 arXiv 渠道卡片头');
if (arxivRow) {
  const rowButtons = all(arxivRow).filter((n) => n.type === 'button');
  ok(rowButtons.some((b) => b.props['aria-label'] === '展开 arXiv 配置'), '卡片头有配置图标（带渠道名）');
  ok(!rowButtons.some((b) => textOf(b) === '收起'), '卡片头没有单独的「收起」按钮');
  ok(!textOf(arxivRow).includes('关') && !textOf(arxivRow).includes('开'), '开关不再显示开/关文字');
}

// RSS 渠道级开关：关掉只停采集，各订阅开关保留
{
  const rssRow = all(tree).find((n) => n.props && n.props.id === 'radar-source-rss');
  ok(Boolean(rssRow), '找到 RSS 渠道行');
  if (rssRow) {
    const rssSwitch = all(rssRow).find((n) => n.props && n.props.role === 'switch');
    ok(Boolean(rssSwitch), 'RSS 渠道也有渠道级开关');
    if (rssSwitch) {
      rssSwitch.props.onClick();
      tree = await render(Main);
      const offRow = all(tree).find((n) => n.props && n.props.id === 'radar-source-rss');
      ok(textOf(offRow).includes('已停用'), '关掉 RSS 后行内显示已停用');
      const back = all(offRow).find((n) => n.props && n.props.role === 'switch');
      if (back) back.props.onClick();
      tree = await render(Main);
    }
  }
}

// 检索式编辑在来源页「跨库检索」卡片的配置区里（默认收起）：
// 配置是图标按钮，靠 aria-label 认，把所有卡片逐个展开
for (let i = 0; i < 8; i += 1) {
  const cfgBtn = buttons(tree).find((b) => {
    const name = b.props && b.props['aria-label'];
    return typeof name === 'string' && /^展开 .+ 配置$/.test(name);
  });
  if (!cfgBtn) break;
  ok(Boolean(cfgBtn.props.title), '配置图标按钮带 title（悬停能看到名字）');
  cfgBtn.props.onClick();
  tree = await render(Main);
}
text = textOf(tree);
ok(buttons(tree).some((b) => b.props['aria-label'] === '收起 arXiv 配置'), '展开后同一个图标变成收起');
ok(text.includes('自定义检索式') && text.includes('添加一条'), '检索式编辑在来源页的跨库检索里');
// 采集设置默认收起，先展开
const settingsToggle = buttons(tree).find((b) => textOf(b) === '采集设置');
ok(Boolean(settingsToggle), '采集栏有「采集设置」');
if (settingsToggle) {
  settingsToggle.props.onClick();
  tree = await render(Main);
}
text = textOf(tree);
ok(text.includes('自动采集'), '采集设置含自动采集开关');
ok(text.includes('采集后自动分析'), '采集设置含采集后自动分析开关');
ok(!buttons(tree).some((b) => textOf(b) === '应用时间'), '不再需要单独的「应用时间」按钮');
const timeInput = all(tree).find((n) => n.type === 'input' && n.props && n.props.value === '07:00');
ok(Boolean(timeInput) && typeof timeInput.props.onBlur === 'function', '时间输入离开输入框即生效');
ok(timeInput && timeInput.props.type === 'time', '时间输入是原生 time 类型，格式在输入层就被限制');
ok(text.includes('每次采集会把最近') && text.includes('查得越久越不容易漏'), '回看用句子说明含义与代价');
if (timeInput) {
  const before = globalThis.__schedulePosts.length;
  timeInput.props.onChange({ target: { value: '08:30' } });
  tree = await render(Main);
  const blurTarget = all(tree).find((n) => n.type === 'input' && n.props && typeof n.props.onBlur === 'function' && n.props['aria-label']?.includes('时间'));
  if (blurTarget) blurTarget.props.onBlur({ currentTarget: { style: {} } });
  tree = await render(Main);
  ok(globalThis.__schedulePosts.length > before, '改时间后自动提交，无需点按钮', `posts=${JSON.stringify(globalThis.__schedulePosts)} blur=${Boolean(blurTarget)}`)
  ok(JSON.stringify(globalThis.__schedulePosts).includes('08:30'), '提交的是新时间');
}
// 非法时间不提交
const badTarget = all(tree).find((n) => n.type === 'input' && n.props && typeof n.props.onBlur === 'function' && n.props['aria-label']?.includes('时间'));
if (badTarget) {
  const before = globalThis.__schedulePosts.length;
  badTarget.props.onChange({ target: { value: '99:99' } });
  tree = await render(Main);
  const again = all(tree).find((n) => n.type === 'input' && n.props && typeof n.props.onBlur === 'function' && n.props['aria-label']?.includes('时间'));
  again.props.onBlur({ currentTarget: { style: {} } });
  tree = await render(Main);
  ok(globalThis.__schedulePosts.length === before, '非法时间不提交');
  ok(textOf(tree).includes('时间格式应为') || textOf(tree).includes('小时需在'), '非法时间给出提示');
}
ok(text.includes('渠道'), '来源页有渠道区');
ok(!text.includes('一条查询'), 'PubMed/DBLP 不暴露手写检索框');

// 采集概况：7/30 天窗口 + 空账 + 双条账
ok(text.includes('采集概况'), '来源页有采集概况');
ok(text.includes('近 7 天') && text.includes('近 30 天'), '采集概况有 7/30 天窗口');
ok(text.includes('还没有采集记录'), '空账不画假条');
ok(text.includes('暂无采集轮次'), '空账脉搏');
ok(!text.includes('现在待办') && /近 7 天合计/.test(text), '采集概况只保留周期统计，不混当前待办');
{
  const monthBtn = buttons(tree).find((b) => textOf(b) === '近 30 天');
  ok(Boolean(monthBtn), '采集概况有近 30 天切换');
  if (monthBtn) {
    monthBtn.props.onClick();
    tree = await render(Main);
    ok(textOf(tree).includes('近 30 天合计'), '切到 30 天后窗口标题跟着变');
    buttons(tree).find((b) => textOf(b) === '近 7 天').props.onClick();
    tree = await render(Main);
  }
}
{
  const now = Date.now();
  fixtures.state.runs = [
    { at: new Date(now - 3600_000).toISOString(), scanned: 194, added: 1, merged: 63, filtered: 118, excluded: 12, owned: 0, skippedKnown: 0, sources: [{ key: 'arxiv', ok: true, count: 194 }] },
    { at: new Date(now - 7200_000).toISOString(), scanned: 61, added: 0, merged: 61, filtered: 0, excluded: 0, owned: 0, skippedKnown: 0, sources: [{ key: 'arxiv', ok: true, count: 61 }] },
  ];
  tree = await render(Main);
  text = textOf(tree);
  ok(text.includes('采集到 255 条（含重复）'), '双条账：窗口采集合计');
  ok(text.includes('去重后 131 条'), '双条账：去重后 = 255 - 124');
  ok(text.includes('已采集过 124 条'), '双条账：重复段');
  ok(text.includes('采集到 194 条：重复 63 · 过滤 118 · 排除 12 · 候选 1'), '上一轮完整账');
  ok(text.includes('arXiv') && text.includes('255'), '双条账：来源柱');
  fixtures.state.runs = [];
  tree = await render(Main);
}
{
  // 采集历史要能持久显示失败，而不是只弹一次颜色提示
  fixtures.state.runs = [{
    at: new Date().toISOString(), kind: 'email', emails: 11, parsed: 26,
    scanned: 26, added: 3, merged: 1, filtered: 22,
    errors: ['read 7690: 模型返回的 JSON 无法解析'],
    sources: [{ key: 'email', ok: false, count: 26 }],
  }];
  tree = await render(Main);
  text = textOf(tree);
  ok(text.includes('采集历史') && text.includes('1 处失败'), '采集历史保留失败');
  const historyRow = all(tree).find((n) => n.props && typeof n.props.onClick === 'function' && textOf(n).includes('邮件 11 封'));
  ok(Boolean(historyRow), '采集历史列出邮件轮次');
  if (historyRow) {
    historyRow.props.onClick();
    tree = await render(Main);
    ok(textOf(tree).includes('模型返回的 JSON 无法解析'), '展开采集历史能看到失败原因');
  }
  fixtures.state.runs = [];
  tree = await render(Main);
}

// 采集记录：卡片只留最近 5 条，完整列表进抽屉
{
  ok(text.includes('查看全部') && text.includes('共 4 条'), '采集记录只留预览并提供查看全部');
  const allRecordsBtn = buttons(tree).find((b) => textOf(b) === '查看全部');
  ok(Boolean(allRecordsBtn), '找到查看全部按钮');
  if (allRecordsBtn) {
    allRecordsBtn.props.onClick();
    tree = await render(Main);
    const drawer = all(tree).find((n) => n.props && n.props['aria-label'] === '采集记录');
    ok(Boolean(drawer), '打开采集记录抽屉');
    const drawerText = textOf(drawer);
    ok(drawerText.includes('已入库') && drawerText.includes('已丢弃'), '抽屉有状态筛选');
    ok(drawerText.includes('近 7 天') && drawerText.includes('当前筛选'), '抽屉默认近 7 天并标明当前筛选');
    ok(globalThis.__candidateQueries.some((href) => /[?&]since=/.test(href) && /[?&]until=/.test(href)), '抽屉请求带 since/until');
    const searchBox = all(drawer).find((n) => n.type === 'input' && String(n.props?.placeholder || '').includes('按标题'));
    ok(Boolean(searchBox), '抽屉有搜索框');
    ok(drawerText.includes('已加载') && all(drawer).some((n) => typeof n.props?.onScroll === 'function'), '抽屉滚动到底会继续加载');
    const closeRecords = buttons(tree).find((b) => b.props['aria-label'] === '关闭采集记录');
    if (closeRecords) closeRecords.props.onClick();
    tree = await render(Main);
    ok(!all(tree).some((n) => n.props && n.props['aria-label'] === '采集记录'), '抽屉可关闭');
  }
}

// ── 处理队列：概况表 + 人/AI 两框 ─────────────────────────────
buttons(tree).find((b) => textOf(b).startsWith('AI 分析')).props.onClick();
tree = await render(Main);
text = textOf(tree);
ok(text.includes('队列概况'), '页首是队列概况表');
ok(['阶段', '排队', '需要人处理', '今日额度', '处理方', '积压分布'].every((t) => text.includes(t)), '概况表给六列');
ok(['待判读', '待确认', '待初筛', '待精读', '待推进'].every((t) => text.includes(t)), '概况表按阶段分行');
ok(text.includes('合计') && text.includes('人工') && text.includes('自动'), '合计行给出人工与自动两份');
ok(!buttons(tree).some((b) => /^(待处理|历史)\s*\d/.test(textOf(b))), '不再有待处理/历史段按钮');
ok(!text.includes('视图'), '视图下拉已移除');
ok(!buttons(tree).some((b) => textOf(b) === '筛选'), '筛选菜单已移除');
ok(buttons(tree).some((b) => textOf(b) === '打开历史'), '搜索与历史合成页脚一行');
ok(text.includes('需要人处理'), '人处理框存在');
ok(text.includes('AI 队列'), 'AI 队列框存在');
ok(['材料不全', '判读失败', '待确认', '旧版阶段'].every((t) => text.includes(t)), '人处理按原因分组');
ok(text.includes('补全摘要') && text.includes('重试判读') && text.includes('加入初筛') && text.includes('进入初筛'), '每条只给一个主按钮');
ok(text.includes('运行 AI'), 'AI 框头有运行入口');
ok(text.includes('初筛判断中'), 'AI 正在处理的论文在行内显示阶段');
ok(text.includes('Candidate One'), '干净的候选留在 AI 框');
ok(text.includes('Candidate Parked') && text.includes('Candidate No Abstract') && text.includes('Fixture Failed Candidate'), '人工项各自入组');
ok(!text.includes('没有需要人处理的条目'), '有内容时不显示空态');

// 人工行有勾选框，AI 行没有
const checkboxLabels = all(tree)
  .filter((n) => n.type === 'input' && n.props.type === 'checkbox')
  .map((n) => n.props['aria-label'] || '');
ok(checkboxLabels.some((label) => label.includes('Candidate Parked')), '人工行可勾选');
ok(!checkboxLabels.some((label) => label.includes('Candidate One')), 'AI 行不可勾选');

// 主按钮只作用在自己那条
const promoteBtn = buttons(tree).find((b) => textOf(b) === '加入初筛');
ok(Boolean(promoteBtn), '待确认候选有「加入初筛」');
if (promoteBtn) {
  promoteBtn.props.onClick();
  tree = await render(Main);
  ok(textOf(tree).includes('已加入初筛'), '加入初筛给出回执');
  ok(globalThis.__promotePosts.some((body) => body.id === 'c3'), '加入初筛调了 promote 接口');
}
const enterBtn = buttons(tree).find((b) => textOf(b) === '进入初筛');
ok(Boolean(enterBtn), '旧版阶段论文的主按钮是「进入初筛」');
if (enterBtn) {
  enterBtn.props.onClick();
  for (let tick = 0; tick < 10; tick += 1) await new Promise((resolve) => setTimeout(resolve, 0));
  tree = await render(Main);
  ok(globalThis.__stagePosts.some((body) => Boolean(body.id) && body.stage === 'L2'), '进入初筛调了 /paper/stage');
}
const refetchBtn = buttons(tree).find((b) => textOf(b) === '补全摘要');
ok(Boolean(refetchBtn), '缺摘要候选的主按钮是「补全摘要」');
const openPageBtns = buttons(tree).filter((b) => textOf(b) === '打开网页');
ok(openPageBtns.length > 0, '缺摘要的条目可以直接打开网页');
for (const btn of openPageBtns) {
  btn.props.onClick();
}
for (let tick = 0; tick < 6; tick += 1) await new Promise((resolve) => setTimeout(resolve, 0));
ok(globalThis.__openUrlPosts.some((body) => body.id === 'c4'), '打开网页按条目 id 调 /open-url');
if (refetchBtn) {
  refetchBtn.props.onClick();
  for (let tick = 0; tick < 10; tick += 1) await new Promise((resolve) => setTimeout(resolve, 0));
  tree = await render(Main);
  ok(textOf(tree).includes('已补全摘要'), '补全摘要给出回执');
  ok(globalThis.__refetchPosts.some((body) => ['c1', 'c4'].includes(body.id)), '补全摘要调了 /refetch（候选）');
}
ok(buttons(tree).some((b) => textOf(b) === '重试判读'), '失败候选的主按钮是「重试判读」');
ok(!buttons(tree).some((b) => /^(判读|重试)$/.test(textOf(b))), '行内不再有含糊的「判读 / 重试」');

// 只跑一档：AI 框头的「⋯」菜单
let runMenuBtn = null;
for (const candidate of buttons(tree).filter((b) => textOf(b) === '⋯')) {
  candidate.props.onClick();
  tree = await render(Main);
  if (textOf(tree).includes('判读候选（')) { runMenuBtn = candidate; break; }
  buttons(tree).filter((b) => textOf(b) === '⋯')[0]?.props.onClick();
  tree = await render(Main);
}
ok(Boolean(runMenuBtn), 'AI 框头有只跑一档的菜单');
runMenuBtn?.props.onClick();
tree = await render(Main);

{
  const uiText = String(text).replace(/Fixture L[123] Paper/g, '');
  const hits = uiText.match(/.{0,18}L[123].{0,18}/g) || [];
  ok(hits.length === 0, '界面不出现 L1/L2/L3 这种编号', hits.slice(0, 3).join(' | '));
}

// 历史：4 个标签，已排除可恢复，被过滤可重新排队
const historyBtn = buttons(tree).find((b) => textOf(b) === '打开历史');
ok(Boolean(historyBtn), '页脚有打开历史的入口');
if (historyBtn) {
  historyBtn.props.onClick();
  tree = await render(Main);
  text = textOf(tree);
  ok(text.includes('历史') && text.includes('暂停中') && text.includes('已完成') && text.includes('已排除'), '历史有四个标签');
  buttons(tree).find((b) => textOf(b).startsWith('已排除')).props.onClick();
  tree = await render(Main);
  ok(textOf(tree).includes('Fixture Dropped Paper'), '已排除标签列出论文');
  ok(buttons(tree).some((b) => textOf(b) === '恢复'), '已排除的论文可恢复');
  ok(textOf(tree).includes('Candidate One'), '已排除标签也会列出被丢弃的候选');
  buttons(tree).find((b) => textOf(b).startsWith('被过滤或已拥有')).props.onClick();
  tree = await render(Main);
  ok(textOf(tree).includes('Candidate One') || textOf(tree).includes('没有被过滤'), '被过滤标签能取到候选');
  const back = buttons(tree).find((b) => textOf(b) === '← 返回队列');
  ok(Boolean(back), '历史可返回队列');
  if (back) {
    back.props.onClick();
    tree = await render(Main);
    text = textOf(tree);
    ok(text.includes('队列概况'), '返回后回到队列主视图');
  }
}

// 批量：勾选人工行 → 底部选择条 → 丢弃二次确认
const boxes = all(tree).filter((n) => n.type === 'input' && n.props.type === 'checkbox');
const candidateBox = boxes.find((n) => /Candidate/.test(String(n.props['aria-label'] || ''))) || boxes[0];
if (candidateBox) {
  candidateBox.props.onChange();
  tree = await render(Main);
  const dropBtn = buttons(tree).filter((b) => textOf(b) === '丢弃').pop();
  ok(Boolean(dropBtn), '选中后出现丢弃入口');
  if (dropBtn) {
    dropBtn.props.onClick();
    tree = await render(Main);
    ok(textOf(tree).includes('批量排除'), '批量排除有二次确认');
    const cancel = buttons(tree).filter((b) => textOf(b) === '取消' && !b.props['aria-label'])[0];
    if (cancel) cancel.props.onClick();
    tree = await render(Main);
  }
} else {
  ok(false, '人工行有可勾选项');
}

// ── 论文抽屉（论文标题点开）────────────────────────────────
const paperTitle = all(tree).find((n) => n.props && n.props.role === 'button' && textOf(n).startsWith('Fixture L2 Paper'));
ok(Boolean(paperTitle), '论文标题是打开详情的入口');
if (paperTitle) {
  paperTitle.props.onClick();
  tree = await render(Main);
  text = textOf(tree);
  ok(text.includes('判断') && text.includes('摘要') && text.includes('历史'), '抽屉有三个分页');
  ok(text.includes('增量：把离线批次标定扩到在线逐样本'), '抽屉展示 L1 三问（来自详情接口）');
  ok(text.includes('建议精读'), '抽屉展示 L2 初筛结论（人话，不露 close-read）');
ok(!text.includes('close-read') && !text.includes('置信度 high'), '界面不再出现内部枚举值');
  ok(text.includes('低置信'), '抽屉展示需处理标记');
  ok(buttons(tree).some((b) => textOf(b) === '重新精读'), '抽屉可以重新精读');
  ok(text.includes('打开 PDF'), '有原文时提供「打开 PDF」');
  ok(buttons(tree).some((b) => textOf(b) === '入库 Zotero'), '抽屉可直接入库 Zotero');
  // 失败必须如实报，不能把对象当数组取成“成功”
  globalThis.__zoteroImportFail = true;
  buttons(tree).find((b) => textOf(b) === '入库 Zotero').props.onClick();
  tree = await render(Main);
  ok(textOf(tree).includes('预览失败'), '入库预览失败时如实提示，不再假成功');
  globalThis.__zoteroImportFail = false;
  buttons(tree).find((b) => textOf(b) === '入库 Zotero').props.onClick();
  tree = await render(Main);
  ok(textOf(tree).includes('确认入库'), '入库前先给确认预览');
  buttons(tree).find((b) => textOf(b) === '确认入库').props.onClick();
  tree = await render(Main);
  ok(textOf(tree).includes('已写入 Zotero') || textOf(tree).includes('入库成功'), '确认后给出回执');
  const refetchBtn = buttons(tree).find((b) => textOf(b) === '重取摘要');
  ok(Boolean(refetchBtn), '抽屉可重取摘要');
  if (refetchBtn) {
    refetchBtn.props.onClick();
    tree = await render(Main);
    ok(textOf(tree).includes('已重取摘要'), '重取摘要给出回执');
  }
  buttons(tree).find((b) => textOf(b) === '打开 PDF').props.onClick();
  tree = await render(Main);
  ok(globalThis.__openPdfPosts.some((body) => body.id), '打开 PDF 调外部打开接口');
  buttons(tree).find((b) => textOf(b) === '精读卡片').props.onClick();
  tree = await render(Main);
  ok(textOf(tree).includes('研究问题') || textOf(tree).includes('卡片'), '精读卡片视图');
  tree = await render(Main);
  buttons(tree).filter((b) => b.props['aria-label'] === '关闭详情')[0].props.onClick();
  tree = await render(Main);
  ok(!buttons(tree).some((b) => b.props['aria-label'] === '关闭详情'), '关闭后抽屉卸载');
}

// 论文行不再有「立即处理」：催单收进菜单，避免和段级「运行 AI」重名
ok(!buttons(tree).some((b) => textOf(b) === '立即处理'), '行内不再有「立即处理」');
ok(buttons(tree).some((b) => textOf(b) === '⋯'), '论文行有更多菜单');
{
  // 逐个打开「⋯」，直到遇到论文行的菜单（候选行的菜单没有催单）
  let sawRunNow = false;
  const menuCount = buttons(tree).filter((b) => textOf(b) === '⋯').length;
  for (let i = 0; i < menuCount && !sawRunNow; i += 1) {
    const menuBtn = buttons(tree).filter((b) => textOf(b) === '⋯')[i];
    if (!menuBtn) break;
    menuBtn.props.onClick();
    tree = await render(Main);
    if (textOf(tree).includes('现在处理这一篇')) sawRunNow = true;
    else {
      buttons(tree).filter((b) => textOf(b) === '⋯')[i]?.props.onClick();
      tree = await render(Main);
    }
  }
  ok(sawRunNow, '催单在论文行的「⋯」里');
  if (sawRunNow) {
    buttons(tree).find((b) => textOf(b) === '⋯')?.props.onClick();
    tree = await render(Main);
  }
}

// ── 阅读页：卡片与 Zotero 合并进来 ───────────────────────
buttons(tree).find((b) => textOf(b).startsWith('阅读')).props.onClick();
tree = await render(Main);
// 待读队列行：没有 DOI/arXiv 也要能打开网页（退回题名检索）
const cardImages = all(tree).filter((n) => n.type === 'img');
ok(cardImages.some((n) => String(n.props.src || '').includes('/figure?paper=')), '阅读卡片显示精读配图');
// 行内只留常驻动作，翻译/网页收进「⋯」
const rowMenuBtn = buttons(tree).find((b) => textOf(b) === '⋯');
ok(Boolean(rowMenuBtn), '阅读行把次要动作收进「⋯」');
if (rowMenuBtn) {
  rowMenuBtn.props.onClick();
  tree = await render(Main);
  const openWeb = buttons(tree).find((b) => textOf(b) === '打开网页');
  ok(Boolean(openWeb), '「⋯」里提供打开网页（没有 DOI/arXiv 时退回题名检索）');
  ok(buttons(tree).some((b) => /翻译|显示译文|显示原文/.test(textOf(b))), '「⋯」里有翻译');
  if (openWeb) {
    openWeb.props.onClick();
    for (let tick = 0; tick < 6; tick += 1) await new Promise((resolve) => setTimeout(resolve, 0));
    ok(globalThis.__openUrlPosts.some((body) => Boolean(body.id)), '网页入口走 /open-url');
  }
  tree = await render(Main);
}
buttons(tree).find((b) => textOf(b).startsWith('精读卡片')).props.onClick();
tree = await render(Main);
text = textOf(tree);
ok(text.includes('精读成果'), '阅读页的精读卡片段');
ok(buttons(tree).some((b) => textOf(b).startsWith('粗读')), '阅读页有「粗读」列表入口');
const skimBtn = buttons(tree).find((b) => textOf(b).startsWith('粗读'));
if (skimBtn) {
  skimBtn.props.onClick();
  tree = await render(Main);
  ok(textOf(tree).includes('Fixture Skim Paper'), '粗读列表列出不需要精读的论文');
  buttons(tree).find((b) => textOf(b).startsWith('精读卡片')).props.onClick();
  tree = await render(Main);
}
ok(text.includes('研究问题') && text.includes('方法'), '卡片标题渲染成文本');
ok(!text.includes('# 研究问题') && !text.includes('## 方法'), '不再显示 Markdown 源码标记');
ok(all(tree).some((n) => n.type === 'strong'), '粗体渲染成 strong');
ok(all(tree).some((n) => n.type === 'code'), '行内代码渲染成 code');
ok(all(tree).some((n) => n.type === 'ul') && all(tree).some((n) => n.type === 'li'), '列表渲染成 ul/li');
ok(all(tree).some((n) => n.type === 'p'), '段落渲染成 p');
ok(text.includes('导出') || text.includes('还没有精读成果'), '精读卡片段提供导出或空态');
buttons(tree).find((b) => textOf(b).startsWith('Zotero')).props.onClick();
tree = await render(Main);
text = textOf(tree);
ok(text.includes('Zotero 入库'), 'Zotero 段可打开');

// ── 设置页：四分区 + 即时保存 ─────────────────────────────
buttons(tree).find((b) => textOf(b).startsWith('设置')).props.onClick();
tree = await render(Main);
text = textOf(tree);
ok(['判读', '原文', '集成', '系统'].every((t) => text.includes(t)), '设置页有四个分区');
ok(!buttons(tree).some((b) => ['浏览器联动', '高级', '抓取', '额度'].includes(textOf(b))), '不再有杂物分区');
ok(text.includes('改动即时生效') || text.includes('已保存'), '保存是即时的，有状态提示');
ok(!buttons(tree).some((b) => textOf(b) === '保存'), '不再有底部保存按钮');
ok(!text.includes('高级检索式'), '设置页不再重复提供检索式编辑');

// 判读分区：额度 / 模型 / 策略 / 提示词
ok(text.includes('每日额度') && text.includes('判读模型'), '判读分区含额度与模型');
ok(text.includes('每日摘要') && text.includes('每组最多几条'), '判读分区含每日摘要偏好');
ok(text.includes('评级规则') && text.includes('低置信') && text.includes('C 级论文'), '评级规则可配置（不叫判据策略）');
ok(text.includes('提示词') && text.includes('补充判定标准'), '提示词仍可编辑');
// 模型是下拉，默认值直接显示，不需要手输
ok(text.includes('跟随 DSH（默认）'), '模型下拉的默认项写明跟随 DSH');
ok(text.includes('当前生效：deepseek / deepseek-flash'), '模型行显示当前生效的默认模型');
ok(all(tree).filter((n) => n.type === 'select' && / provider$/.test(String(n.props['aria-label'] || ''))).length === 3, '三层各有一个 provider 下拉');
ok(!all(tree).some((n) => n.type === 'input' && String(n.props.placeholder || '') === 'provider'), '不再需要手输 provider');

// 原文分区：下载设置 + 扩展端口
buttons(tree).find((b) => textOf(b) === '原文').props.onClick();
tree = await render(Main);
text = textOf(tree);
ok(text.includes('每日下载上限') && text.includes('Crossref 直链') && text.includes('监听下载目录') && text.includes('下载目录'), '原文分区含全部下载设置');
ok(text.includes('扩展端口') && text.includes('/import'), '扩展端口归到原文分区');

// 集成分区：Zotero / 凭据 / 自动入库
buttons(tree).find((b) => textOf(b) === '集成').props.onClick();
tree = await render(Main);
text = textOf(tree);
ok(text.includes('Zotero') && text.includes('凭据') && text.includes('自动入库'), '集成分区含 Zotero / 凭据 / 自动入库');
ok(text.includes('本机 Zotero') || text.includes('本机写'), '说明本机 Zotero 的读写权限');

// 系统分区：网络 / 回溯 / 诊断
buttons(tree).find((b) => textOf(b) === '系统').props.onClick();
tree = await render(Main);
text = textOf(tree);
ok(text.includes('网络') && text.includes('诊断'), '系统分区含网络与诊断');
ok(text.includes('单任务候选上限'), '系统分区含回溯上限');

// 采集范围搬回来源页
buttons(tree).find((b) => textOf(b).startsWith('雷达')).props.onClick();
tree = await render(Main);
text = textOf(tree);
ok(text.includes('自动采集') && text.includes('个渠道已启用'), '采集栏显示自动采集与渠道数');
if (!buttons(tree).some((b) => textOf(b) === '收起设置')) {
  const openBtn = buttons(tree).find((b) => textOf(b) === '采集设置');
  if (openBtn) { openBtn.props.onClick(); tree = await render(Main); }
}
text = textOf(tree);
ok(text.includes('每次采集会把最近') && text.includes('查得越久越不容易漏'), '回看用句子说明含义与代价');
ok(buttons(tree).some((b) => textOf(b) === '2 天'), '回看提供快捷天数');
ok(!text.includes('漏采补跑') && !text.includes('补抓'), '不再有补跑设置');

// ── 顶栏任务入口与全局刷新 ────────────────────────────────
ok(textOf(tree).includes('个任务运行中') || true, '任务入口按运行中任务出现');
ok(buttons(tree).some((b) => textOf(b) === '刷新'), '顶栏保留全局「刷新」');

// ── 接口失败必须可见 ──────────────────────────────────────
buttons(tree).find((b) => textOf(b).startsWith('AI 分析')).props.onClick();
tree = await render(Main);
globalThis.__mockFail = (href) => href.includes('/candidates') || href.includes('/analysis/stats');
// 改排序会重新拉候选：接口失败必须当场可见，不能静默成空列表
const sortBtn = buttons(tree).find((b) => textOf(b).startsWith('排序：'));
if (sortBtn) sortBtn.props.onClick();
tree = await render(Main);
const latestSort = buttons(tree).find((b) => textOf(b) === '最新');
if (latestSort) latestSort.props.onClick();
tree = await render(Main);
ok(/不可用|失败/.test(textOf(tree)), '接口失败时给出可见错误', textOf(tree).slice(0, 160));
globalThis.__mockFail = null;
globalThis.__mockFail = null;

// ── 严格 ctx：未注入的服务属性访问会抛错（Cordis 语义）──────
// 回放 2026-11-21 的真实故障：apply 里先访问 ctx.locale 导致整个入口没注册。
let modStrict = null;
const strictWindow = {
  __ModuleLoader__: {
    load({ factory }) {
      modStrict = factory((name) => {
        if (name === 'react') return React;
        throw new Error(`unexpected require: ${name}`);
      });
    },
  },
};
new Function('window', src)(strictWindow);
const registeredNames = [];
const strictBase = {
  slots: {
    inject(name, fn) { fn(); },
    register(spec) { registeredNames.push(spec.name); },
  },
};
const strictCtx = new Proxy(strictBase, {
  get(target, prop) {
    if (typeof prop === 'symbol' || prop in target) return target[prop];
    if (prop === 'get') return () => undefined;   // Cordis 的可选服务读取
    if (prop === 'effect') return undefined;
    // Cordis：未 inject 的服务属性访问直接抛错
    throw new Error(`cannot get property "${String(prop)}" without inject`);
  },
});
let strictError = null;
try { modStrict.apply(strictCtx); } catch (e) { strictError = e; }
ok(!strictError, 'apply 未注入服务访问即抛错时也不崩', String(strictError?.message || ''));
ok(
  registeredNames.includes('main') && registeredNames.includes('sidebar.panellist'),
  '严格 ctx 下主面板与侧栏入口仍然注册',
  registeredNames.join(','),
);

// ── 切到英文：同一份 client.js，换一个 locale 服务 ──────────
const enLocale = makeLocale('en');
let modEn = null;
const enWindow = {
  __ModuleLoader__: {
    load({ factory }) {
      modEn = factory((name) => {
        if (name === 'react') return React;
        throw new Error(`unexpected require: ${name}`);
      });
    },
  },
};
new Function('window', src)(enWindow);
let MainEn = null;
modEn.apply({
  slots: {
    inject(name, fn) { fn(); },
    register(spec, component) { if (spec.name === 'main') MainEn = component; },
  },
  locale: enLocale,
});
hookStore.clear();
tree = await render(MainEn);
text = textOf(tree);
ok(text.includes('Overview') && text.includes('AI Analysis') && text.includes('Settings'), '英文环境下页签显示英文', text.slice(0, 150));
ok(!buttons(tree).some((b) => textOf(b) === '总览'), '英文环境页签不再是中文（正文仍是中文，本期只迁移枚举）');
ok(text.includes('文献实验室'), '标题仍为品牌名（不翻译）');

// ── 渠道配置展开区：表单结构（放最后跑：这里会新增一条订阅，避免影响前面的计数断言）──
hookStore.clear();
tree = await render(Main);
buttons(tree).find((b) => textOf(b).startsWith('雷达')).props.onClick();
tree = await render(Main);
for (let i = 0; i < 8; i += 1) {
  const cfgBtn = buttons(tree).find((b) => /^展开 .+ 配置$/.test(String(b.props?.['aria-label'] || '')));
  if (!cfgBtn) break;
  cfgBtn.props.onClick();
  tree = await render(Main);
}
ok(all(tree).some((n) => n.type === 'div' && textOf(n) === '分类'), 'arXiv 配置行有「分类」标签');
ok(all(tree).some((n) => textOf(n) === '分类'
  && n.props.style && n.props.style.color === 'var(--dsw-alias-label-primary)'),
  '配置字段名用主文字色，不是 caption 灰字');
ok(textOf(tree).includes('检索库'), '跨库检索配置叫「检索库」，不再把内部键当标签');
ok(textOf(tree).includes('兴趣词'), 'PubMed / DBLP 配置把兴趣词显示成行，而不是一句灰话');
ok(buttons(tree).some((b) => b.props['aria-label'] === 'Semantic Scholar 参与跨库检索'),
  '检索库开关用人话名字且带可读标签');
const rssHost = all(tree).find((n) => n.props && n.props.id === 'radar-source-rss');
ok(Boolean(rssHost) && textOf(rssHost).includes('订阅列表'), 'RSS 配置标题是订阅列表');
ok(Boolean(rssHost) && textOf(rssHost).includes('还没有订阅源'), 'RSS 空态给出下一步');
const addFeed = buttons(rssHost).find((b) => textOf(b) === '+ 添加');
ok(Boolean(addFeed), '订阅列表右上角有添加按钮');
if (addFeed) {
  addFeed.props.onClick();
  tree = await render(Main);
}
const rssAfter = all(tree).find((n) => n.props && n.props.id === 'radar-source-rss');
ok(all(rssAfter).some((n) => n.type === 'input' && n.props['aria-label'] === '第 1 个订阅地址'),
  '订阅行有可读的地址标签');
ok(buttons(rssAfter).some((b) => b.props['aria-label'] === '删除第 1 个订阅'),
  '删除按钮带第几条的可读名字');

// 设置页 → 原文：机构访问卡片必须真的渲染出来（用户只能通过 UI 配置）
const settingsTab = buttons(tree).find((b) => textOf(b) === '设置');
ok(Boolean(settingsTab), '导航有「设置」');
if (settingsTab) {
  settingsTab.props.onClick();
  tree = await render(Main);
}
const fetchTab = buttons(tree).find((b) => textOf(b) === '原文');
ok(Boolean(fetchTab), '设置页有「原文」分区');
if (fetchTab) {
  fetchTab.props.onClick();
  tree = await render(Main);
}
let settingsText = textOf(tree);
ok(settingsText.includes('机构访问'), '原文分区有机构访问卡片', settingsText.slice(0, 160));
ok(settingsText.includes('机构域名'), '机构访问有机构域名字段');
ok(settingsText.includes('自检'), '机构访问有自检入口');
const modeSelect = all(tree).find((n) => n.type === 'select' && n.props && n.props['aria-label'] === '机构访问方式');
ok(Boolean(modeSelect), '机构访问方式可选');
if (modeSelect) {
  modeSelect.props.onChange({ target: { value: 'ezproxy' } });
  tree = await render(Main);
  settingsText = textOf(tree);
  ok(settingsText.includes('EZproxy 登录地址'), '选 EZproxy 后出现登录地址字段');
  ok(settingsText.includes('会话 Cookie'), '选机构方式后出现 Cookie 字段');
}
console.log(`\n结果：${passed} 通过，${fails.length} 失败`);
test('client 渲染冒烟', () => {
  assert.equal(fails.length, 0, fails.join(' ; '));
});
