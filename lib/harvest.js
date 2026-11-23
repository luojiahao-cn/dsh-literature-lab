/**
 * 回溯采集：年份区间检索 + 从 Zotero 种子做引文雪球。
 *
 * 命中先进候选池（candidates），不直接进 papers；由 T0/T1 漏斗决定是否提升。
 * 采集是长任务：记录游标/进度到 harvests，由 lib/jobs.js 后台执行。
 */
import { randomBytes } from 'node:crypto';
import * as store from './store.js';
import { startJob } from './jobs.js';
import { absorbCandidates } from './candidates.js';
import { searchWorks as openalexSearch, workByDoi, worksByIds, citingWorks } from './openalex.js';
import { searchWorks as crossrefSearch } from './crossref.js';
import { fetchArxiv } from './arxiv.js';
import { recommendations } from './s2.js';
import { readConfig } from './config.js';
import { readZoteroCache } from './zotero.js';

function harvestFile(baseDir) {
  return store.statePaths(baseDir).harvests;
}

export async function readHarvests(baseDir) {
  const db = await store.readJson(harvestFile(baseDir), { items: {} });
  return db.items && typeof db.items === 'object' ? db.items : {};
}

async function updateHarvest(baseDir, id, patch) {
  return store.updateJson('harvests', harvestFile(baseDir), { items: {} }, (db) => {
    db.items = db.items || {};
    db.items[id] = { ...(db.items[id] || { id }), ...patch };
    return db;
  });
}

export async function listHarvests(baseDir, { limit = 20 } = {}) {
  const items = Object.values(await readHarvests(baseDir))
    .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
  return items.slice(0, Math.min(50, Math.max(1, Number(limit) || 20)));
}

function mailtoOf(config) {
  return config?.sources?.arxiv?.mailto || config?.network?.mailto || '';
}

async function runYear(baseDir, config, id, spec, signal) {
  const query = String(spec.query || '').trim();
  if (!query) throw new Error('年份检索需要 query');
  const yearFrom = Number(spec.yearFrom) || null;
  const yearTo = Number(spec.yearTo) || null;
  const maxItems = Math.min(2000, Math.max(1, Number(spec.maxItems) || 500));
  const mailto = mailtoOf(config);
  const sources = (Array.isArray(spec.sources) && spec.sources.length
    ? spec.sources
    : ['openalex', 'crossref', 'arxiv'])
    .filter((source) => ['openalex', 'crossref', 'arxiv'].includes(source));
  const cursors = { ...(spec.cursors || {}) };
  let fetched = 0;
  let total = null;
  const used = [];

  for (const source of sources) {
    if (signal?.aborted) throw new Error('cancelled');
    if (fetched >= maxItems) break;
    used.push(source);

    if (source === 'arxiv') {
      const since = Date.UTC(yearFrom || 1990, 0, 1);
      const until = Date.UTC(yearTo || new Date().getUTCFullYear(), 11, 31, 23, 59);
      const res = await fetchArxiv({ queries: [query], categories: [], mailto }, {
        since,
        until,
        isKnown: () => false,
        maxPages: 10,
      });
      const items = res.entries.map((entry) => ({
        ...entry,
        publishedAt: entry.published,
        abstract: entry.summary || '',
        abstractVia: 'arxiv-feed',
      }));
      const take = items.slice(0, Math.max(0, maxItems - fetched));
      if (take.length) {
        const stats = await absorbCandidates(baseDir, config, take, { source: `harvest:${id}:arxiv` });
        fetched += take.length;
        total = total === null ? items.length : total;
        await updateHarvest(baseDir, id, {
          fetched,
          total,
          cursors,
          last_run_at: new Date().toISOString(),
          last_stats: stats,
        });
      }
      continue;
    }

    if (source === 'crossref') {
      let cursor = cursors.crossref || '*';
      while (fetched < maxItems) {
        if (signal?.aborted) throw new Error('cancelled');
        const page = await crossrefSearch({ query, yearFrom, yearTo, cursor, rows: 100, mailto });
        if (!page.items.length) break;
        total = page.count;
        cursors.crossref = page.nextCursor;
        const take = page.items.slice(0, Math.max(0, maxItems - fetched));
        if (!take.length) break;
        const stats = await absorbCandidates(baseDir, config, take, { source: `harvest:${id}:crossref` });
        fetched += take.length;
        await updateHarvest(baseDir, id, {
          fetched,
          total,
          cursors,
          last_run_at: new Date().toISOString(),
          last_stats: stats,
        });
        if (!page.nextCursor || fetched >= page.count) break;
        cursor = page.nextCursor;
      }
      continue;
    }

    let cursor = spec.cursor || cursors.openalex || '*';
    while (fetched < maxItems) {
      if (signal?.aborted) throw new Error('cancelled');
      const page = await openalexSearch({ query, yearFrom, yearTo, cursor, perPage: 100, mailto });
      if (!page.items.length) break;
      total = page.count;
      cursors.openalex = page.nextCursor;
      const take = page.items.slice(0, Math.max(0, maxItems - fetched));
      if (!take.length) break;
      const stats = await absorbCandidates(baseDir, config, take, { source: `harvest:${id}` });
      fetched += take.length;
      await updateHarvest(baseDir, id, {
        fetched,
        total,
        cursors,
        last_run_at: new Date().toISOString(),
        last_stats: stats,
      });
      if (!page.nextCursor || fetched >= page.count) break;
      cursor = page.nextCursor;
    }
  }

  return { fetched, total, sources: used };
}

export async function resumeHarvest(baseDir, id) {
  const record = (await readHarvests(baseDir))[id];
  if (!record) throw new Error(`未知采集任务：${id}`);
  const spec = {
    ...record.spec,
    cursor: record.cursors?.openalex || record.cursor || '*',
    cursors: record.cursors || {},
    resume_of: id,
  };
  return startHarvest(baseDir, spec);
}

async function runSnowball(baseDir, config, id, spec, signal) {
  const direction = ['refs', 'cites', 'both', 'recommend', 'related'].includes(spec.direction) ? spec.direction : 'both';
  const maxItems = Math.min(2000, Math.max(1, Number(spec.maxItems) || 500));
  const mailto = mailtoOf(config);
  const options = { mailto };

  let seeds = Array.isArray(spec.seeds) ? spec.seeds.filter((s) => s?.doi).map((s) => ({ doi: s.doi })) : [];
  if (!seeds.length) {
    const cache = await readZoteroCache(baseDir);
    let items = cache?.items || [];
    const zotero = spec.zotero || {};
    if (zotero.tag) {
      const needle = String(zotero.tag).toLowerCase();
      items = items.filter((item) => (item.tags || []).some((tag) => String(tag).toLowerCase() === needle));
    }
    if (zotero.collection) {
      const match = (cache?.collections || []).find((col) => col.key === zotero.collection || col.name === zotero.collection);
      items = match ? items.filter((item) => (item.collections || []).includes(match.key)) : [];
    }
    if (zotero.yearFrom) items = items.filter((item) => Number(item.year) >= Number(zotero.yearFrom));
    items = items.slice().sort((a, b) => String(b.dateModified || '').localeCompare(String(a.dateModified || ''))
      || (Number(b.year) || 0) - (Number(a.year) || 0));
    seeds = items.filter((item) => item.doi).map((item) => ({ doi: item.doi }));
  }
  seeds = seeds.slice(0, Math.min(50, Number(spec.maxSeeds) || 20));
  if (!seeds.length) throw new Error('没有可用的种子（需要带 DOI 的 Zotero 条目，或显式 seeds）');

  let fetched = 0;
  let resolved = 0;
  for (const seed of seeds) {
    if (signal?.aborted) throw new Error('cancelled');
    if (fetched >= maxItems) break;
    const work = await workByDoi(seed.doi, options);
    if (!work) continue;
    resolved += 1;

    if (direction === 'related') {
      try {
        const items = await worksByIds(work.relatedWorks || [], options);
        const take = items.slice(0, Math.max(0, maxItems - fetched));
        if (take.length) {
          await absorbCandidates(baseDir, config, take, { source: 'snowball:related' });
          fetched += take.length;
        }
      } catch {
        // related_works 是补充，失败不阻断
      }
      await updateHarvest(baseDir, id, {
        fetched,
        seeds_resolved: resolved,
        last_run_at: new Date().toISOString(),
      });
      continue;
    }

    if (direction === 'recommend') {
      try {
        const items = await recommendations(seed.doi, { limit: 100 });
        const take = items.slice(0, Math.max(0, maxItems - fetched));
        if (take.length) {
          await absorbCandidates(baseDir, config, take, { source: 'snowball:recommend' });
          fetched += take.length;
        }
      } catch {
        // 推荐是补充，失败不阻断
      }
      await updateHarvest(baseDir, id, {
        fetched,
        seeds_resolved: resolved,
        last_run_at: new Date().toISOString(),
      });
      continue;
    }

    if (direction !== 'cites' && work.referencedWorks.length) {
      for (let i = 0; i < work.referencedWorks.length && fetched < maxItems; i += 50) {
        const items = await worksByIds(work.referencedWorks.slice(i, i + 50), options);
        if (!items.length) continue;
        await absorbCandidates(baseDir, config, items, { source: 'snowball:refs' });
        fetched += items.length;
      }
    }

    if (direction !== 'refs' && work.citedByUrl && fetched < maxItems) {
      const page = await citingWorks(work.citedByUrl, { perPage: 100, mailto });
      if (page.items.length) {
        await absorbCandidates(baseDir, config, page.items.slice(0, maxItems - fetched), { source: 'snowball:cites' });
        fetched += page.items.length;
      }
    }

    await updateHarvest(baseDir, id, {
      fetched,
      seeds_resolved: resolved,
      last_run_at: new Date().toISOString(),
    });
  }
  return { fetched, seeds: seeds.length, resolved };
}

export async function startHarvest(baseDir, spec = {}) {
  const kind = spec.kind === 'snowball' ? 'snowball' : 'year';
  const id = `harvest_${randomBytes(6).toString('hex')}`;
  const record = {
    id,
    kind,
    spec,
    status: 'running',
    fetched: 0,
    resume_of: spec.resume_of || null,
    created_at: new Date().toISOString(),
  };
  await store.updateJson('harvests', harvestFile(baseDir), { items: {} }, (db) => {
    db.items = db.items || {};
    db.items[id] = record;
    return db;
  });

  await startJob(baseDir, {
    name: `${kind}:${id}`,
    run: async ({ signal }) => {
      const config = await readConfig(baseDir);
      try {
        const result = kind === 'year'
          ? await runYear(baseDir, config, id, spec, signal)
          : await runSnowball(baseDir, config, id, spec, signal);
        await updateHarvest(baseDir, id, {
          status: 'done',
          finished_at: new Date().toISOString(),
          result,
        });
        return result;
      } catch (error) {
        await updateHarvest(baseDir, id, {
          status: signal?.aborted ? 'cancelled' : 'error',
          finished_at: new Date().toISOString(),
          error: String(error?.message || error),
        });
        throw error;
      }
    },
  });
  return record;
}

