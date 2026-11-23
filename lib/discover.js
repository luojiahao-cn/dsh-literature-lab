/**
 * L0 发现：arXiv API + RSS + 查询式检索。
 *
 * P0 起：网络全部在锁外完成，最后只做一次锁内的「读-合并-写」，
 * 避免与 set_stage / ingest 并发时互相覆盖。
 */
import { readConfig, enabledFeeds, arxivSource, networkOf, searchQueries, autoSearchSpecs, interestQueryTerms } from './config.js';
import { newRunId } from './runs.js';
import { readState, readSeen, updateState, today } from './state.js';
import { politeFetch } from './http.js';
import { parseFeed } from './feed.js';
import { fetchArxiv } from './arxiv.js';
import { searchItems } from './search.js';
import { buildIndex } from './pipeline.js';
import { absorbCandidates } from './candidates.js';
import { searchPubmed } from './pubmed.js';
import { searchDblp } from './dblp.js';
import { searchPreprints } from './preprint.js';
import { aliasesOf } from './dedup.js';

const RSS_UA = 'dsh-literature-lab/0.1 (literature discovery)';

function markOk(status, patch = {}) {
  Object.assign(status, {
    last_ok_at: new Date().toISOString(),
    last_error: null,
    consecutive_failures: 0,
    ...patch,
  });
}

function markFail(status, error) {
  status.last_error = String(error?.message || error);
  status.consecutive_failures = (status.consecutive_failures || 0) + 1;
  status.last_failed_at = new Date().toISOString();
}

/** 起始时间：窗口与「上次成功」取更早者，并受 backfillDays 限制。 */
function sinceOf({ lastOkAt, now, windowHours, maxBackfillMs }) {
  let since = now - windowHours * 3600 * 1000;
  const last = Date.parse(lastOkAt || '');
  if (Number.isFinite(last) && last < since) since = last;
  let truncated = false;
  if (now - since > maxBackfillMs) {
    since = now - maxBackfillMs;
    truncated = true;
  }
  return { since, truncated };
}

/**
 * 跑一轮 L0。
 * @returns {Promise<object>} 统计 + 每源明细 + 新增论文
 */
export async function discover(baseDir, { hours, only } = {}) {
  const config = await readConfig(baseDir);
  const net = networkOf(config);

  const windowHours = Number(hours) || Number(config?.window?.hours) || 48;
  const backfillDays = Number(config?.window?.backfillDays) || 14;
  const maxBackfillMs = backfillDays * 86400 * 1000;
  const now = Date.now();
  const windowStart = now - windowHours * 3600 * 1000;

  // 快照只用于「是否见过」的早停判断；最终去重仍在锁内做
  const snapshot = await readState(baseDir);
  const seenSnapshot = await readSeen(baseDir);
  const index = buildIndex(snapshot, seenSnapshot);
  const isKnown = (entry) => aliasesOf({ doi: entry.doi, arxivId: entry.arxivId, title: entry.title })
    .some((alias) => index.has(alias));

  const batches = [];
  const reports = [];
  let arxivSince = null;

  // ── arXiv API（可回填）──────────────────────────────────
  const arxiv = arxivSource(config);
  const wants = (key) => !Array.isArray(only) || only.length === 0 || only.includes(key);
  if (arxiv && wants('arxiv')) {
    const status = snapshot.sources?.arxiv || {};
    const { since, truncated } = sinceOf({
      lastOkAt: status.last_ok_at,
      now,
      windowHours,
      maxBackfillMs,
    });
    arxivSince = since;
    try {
      const res = await fetchArxiv(arxiv, {
        since,
        until: now,
        isKnown,
        timeoutMs: net.timeoutMs,
        retries: net.retries,
        intervalMs: net.arxivIntervalMs,
        maxPages: net.arxivMaxPages,
      });
      const items = res.entries.map((entry) => ({
        ...entry,
        publishedAt: entry.published,
        abstract: entry.summary || '',
        abstractVia: 'arxiv-feed',
        sourceId: 'arxiv',
      }));
      batches.push({
        sourceId: 'arxiv',
        items,
        statusKey: 'arxiv',
        ok: true,
        statusPatch: { last_count: items.length, backfill_from: new Date(since).toISOString() },
      });
      reports.push({
        key: 'arxiv',
        label: arxiv.queries?.length
          ? `arXiv 查询 ${arxiv.queries.join(' OR ')}`
          : `arXiv ${arxiv.categories.join(' / ')}`,
        ok: true,
        count: items.length,
        pages: res.pages,
        backfill_from: new Date(since).toISOString(),
        backfill_truncated: truncated || res.truncated,
      });
    } catch (error) {
      batches.push({
        sourceId: 'arxiv',
        items: [],
        statusKey: 'arxiv',
        ok: false,
        error,
      });
      reports.push({ key: 'arxiv', label: 'arXiv API', ok: false, error: String(error?.message || error) });
    }
  }

  // ── RSS（只按窗口）──────────────────────────────────────
  for (const feed of (wants('rss') ? enabledFeeds(config) : [])) {
    const key = `rss:${feed.id}`;
    const status = snapshot.sources?.[key] || {};
    const headers = {
      'user-agent': RSS_UA,
      accept: 'application/rss+xml, application/atom+xml, application/xml;q=0.9, */*;q=0.8',
    };
    if (status.etag) headers['if-none-match'] = status.etag;
    if (status.last_modified) headers['if-modified-since'] = status.last_modified;
    try {
      const res = await politeFetch(feed.url, {
        timeoutMs: net.timeoutMs,
        retries: net.retries,
        minIntervalMs: net.rssIntervalMs,
        headers,
      });
      if (res.status === 304) {
        batches.push({
          sourceId: feed.id,
          items: [],
          statusKey: key,
          ok: true,
          statusPatch: { last_count: 0, unchanged: true },
        });
        reports.push({ key, label: feed.name, ok: true, unchanged: true, count: 0 });
        continue;
      }
      const entries = parseFeed(res.body);
      const inWindow = entries.filter((entry) => {
        const time = Date.parse(entry.published);
        return !Number.isFinite(time) || time >= windowStart;
      });
      const items = inWindow.map((entry) => ({
        ...entry,
        publishedAt: entry.published,
        sourceId: feed.id,
      }));
      batches.push({
        sourceId: feed.id,
        items,
        statusKey: key,
        ok: true,
        statusPatch: {
          last_count: items.length,
          unchanged: false,
          etag: res.headers.get('etag') || null,
          last_modified: res.headers.get('last-modified') || null,
        },
      });
      reports.push({ key, label: feed.name, ok: true, count: items.length, total: entries.length });
    } catch (error) {
      batches.push({ sourceId: feed.id, items: [], statusKey: key, ok: false, error });
      reports.push({ key, label: feed.name, ok: false, error: String(error?.message || error) });
    }
  }

  // ── 查询式检索（arXiv / OpenAlex / Crossref）──────────────
  const configuredSearch = searchQueries(config);
  const searchSpecs = configuredSearch.length ? configuredSearch : autoSearchSpecs(config);
  for (const spec of (wants('search') ? searchSpecs : [])) {
    const key = `search:${spec.id}`;
    try {
      const res = await searchItems(config, spec, net);
      batches.push({
        sourceId: key,
        items: res.items,
        statusKey: key,
        ok: true,
        statusPatch: { last_count: res.items.length },
      });
      reports.push({
        key,
        label: `检索「${spec.text}」`,
        ok: true,
        count: res.items.length,
        sources: res.sources,
      });
    } catch (error) {
      batches.push({ sourceId: key, items: [], statusKey: key, ok: false, error });
      reports.push({ key, label: `检索「${spec.text}」`, ok: false, error: String(error?.message || error) });
    }
  }

  // ── PubMed / Europe PMC ───────────────────────────────────
  const pubmed = config?.sources?.pubmed || {};
  if (pubmed.enabled === true && wants('pubmed')) {
    const autoTerms = interestQueryTerms(config, 5);
    const queries = (Array.isArray(pubmed.queries) && pubmed.queries.length) ? pubmed.queries : autoTerms;
    for (const text of queries) {
      const query = String(text || '').trim();
      if (!query) continue;
      const key = `pubmed:${query}`;
      try {
        const res = await searchPubmed({
          query,
          sinceDays: pubmed.sinceDays,
          limit: pubmed.limit,
          timeoutMs: net.timeoutMs,
          retries: net.retries,
        });
        batches.push({
          sourceId: key,
          items: res.items,
          statusKey: key,
          ok: true,
          statusPatch: { last_count: res.items.length },
        });
        reports.push({ key, label: `PubMed「${query}」`, ok: true, count: res.items.length, total: res.hitCount });
      } catch (error) {
        batches.push({ sourceId: key, items: [], statusKey: key, ok: false, error });
        reports.push({ key, label: `PubMed「${query}」`, ok: false, error: String(error?.message || error) });
      }
    }
  }

  // ── DBLP（CS / 机器人会议与期刊）─────────────────────────
  const dblp = config?.sources?.dblp || {};
  if (dblp.enabled === true && wants('dblp')) {
    const autoTerms = interestQueryTerms(config, 5);
    const queries = (Array.isArray(dblp.queries) && dblp.queries.length) ? dblp.queries : autoTerms;
    for (const text of queries) {
      const query = String(text || '').trim();
      if (!query) continue;
      const key = `dblp:${query}`;
      try {
        const res = await searchDblp({
          query,
          sinceYears: dblp.sinceYears,
          limit: dblp.limit,
          timeoutMs: net.timeoutMs,
          retries: net.retries,
        });
        batches.push({
          sourceId: key,
          items: res.items,
          statusKey: key,
          ok: true,
          statusPatch: { last_count: res.items.length },
        });
        reports.push({ key, label: `DBLP「${query}」`, ok: true, count: res.items.length });
      } catch (error) {
        batches.push({ sourceId: key, items: [], statusKey: key, ok: false, error });
        reports.push({ key, label: `DBLP「${query}」`, ok: false, error: String(error?.message || error) });
      }
    }
  }

  // ── bioRxiv / medRxiv 预印本 ──────────────────────────────
  const preprint = config?.sources?.preprint || {};
  if (preprint.enabled === true && wants('preprint')) {
    const serverOnly = Array.isArray(only) && only.some((key) => key === 'biorxiv' || key === 'medrxiv');
    const servers = (Array.isArray(preprint.servers) && preprint.servers.length
      ? preprint.servers
      : ['biorxiv', 'medrxiv'])
      .filter((server) => !serverOnly || only.includes(server === 'medrxiv' ? 'medrxiv' : 'biorxiv'));
    for (const server of servers) {
      const key = server === 'medrxiv' ? 'medrxiv' : 'biorxiv';
      try {
        const res = await searchPreprints({
          server: key,
          sinceDays: preprint.sinceDays,
          limit: preprint.limit,
          categories: preprint.categories,
          timeoutMs: net.timeoutMs,
          retries: net.retries,
        });
        batches.push({
          sourceId: key,
          items: res.items,
          statusKey: key,
          ok: true,
          statusPatch: { last_count: res.items.length },
        });
        reports.push({ key, label: key === 'medrxiv' ? 'medRxiv' : 'bioRxiv', ok: true, count: res.items.length });
      } catch (error) {
        batches.push({ sourceId: key, items: [], statusKey: key, ok: false, error });
        reports.push({ key, label: key === 'medrxiv' ? 'medRxiv' : 'bioRxiv', ok: false, error: String(error?.message || error) });
      }
    }
  }

  // ── 全部来源先进候选池，不直接写 papers ─────────────────
  const totals = {
    scanned: 0, added: 0, merged: 0, filtered: 0, excluded: 0, owned: 0, known: 0,
  };
  for (const batch of batches) {
    if (!batch.items.length) continue;
    const stats = await absorbCandidates(baseDir, config, batch.items, { source: batch.sourceId });
    totals.scanned += stats.scanned || 0;
    totals.added += stats.added || 0;
    totals.merged += stats.merged || 0;
    totals.filtered += stats.filtered || 0;
    totals.excluded += stats.excluded || 0;
    totals.owned += stats.owned || 0;
    totals.known += stats.known || 0;
  }

  const outcome = await updateState(baseDir, (state) => {
    for (const batch of batches) {
      state.sources[batch.statusKey] = state.sources[batch.statusKey] || {};
      if (batch.ok) markOk(state.sources[batch.statusKey], batch.statusPatch || {});
      else markFail(state.sources[batch.statusKey], batch.error);
    }

    const at = new Date().toISOString();
    if (reports.some((report) => report.ok)) state.last_success_at = at;

    const run = {
      id: newRunId('L0'),
      date: today(),
      kind: 'L0',
      at,
      windowHours,
      backfillDays,
      backfillFrom: arxivSince ? new Date(arxivSince).toISOString() : null,
      scanned: totals.scanned,
      added: totals.added,
      merged: totals.merged,
      filtered: totals.filtered,
      excluded: totals.excluded,
      owned: totals.owned,
      skippedKnown: totals.known,
      invalid: 0,
      sources: reports,
    };
    state.runs = [run, ...(state.runs || [])].slice(0, 30);
    return { run };
  });

  return {
    ok: true,
    date: today(),
    windowHours,
    backfillFrom: outcome.run.backfillFrom,
    scanned: totals.scanned,
    added: totals.added,
    merged: totals.merged,
    filtered: totals.filtered,
    excluded: totals.excluded,
    owned: totals.owned,
    skippedKnown: totals.known,
    sources: reports,
  };
}

/**
 * 把外部来源（手工清单、其他工具导出）的条目并入候选池。
 * 与 discover 共用去重、T0 过滤与 seen；只有 promote/T1 才进 papers。
 */
export async function ingest(baseDir, { source = 'manual', items = [] } = {}) {
  if (!Array.isArray(items)) return { ok: false, error: 'items 必须是数组' };
  const config = await readConfig(baseDir);
  const stats = await absorbCandidates(baseDir, config, items, { source: `ingest:${source}` });
  await updateState(baseDir, (state) => {
    const run = {
      id: newRunId('ingest'),
      date: today(),
      kind: 'ingest',
      at: new Date().toISOString(),
      scanned: stats.scanned,
      added: stats.added,
      merged: stats.merged,
      filtered: stats.filtered,
      excluded: stats.excluded,
      owned: stats.owned,
      skippedKnown: stats.known,
      sources: [{ key: `ingest:${source}`, label: source, ok: true, count: stats.scanned }],
    };
    state.runs = [run, ...(state.runs || [])].slice(0, 30);
    return state;
  });
  return {
    ok: true,
    source,
    received: items.length,
    added: stats.added,
    merged: stats.merged,
    filtered: stats.filtered,
    excluded: stats.excluded,
    owned: stats.owned,
    skippedKnown: stats.known,
    candidates: stats.candidates,
  };
}
