/**
 * 原文获取：把「候选位置 → 抓取 → 校验 → 落盘 → 记账」串成一条可解释的链路。
 *
 * 顺序：Zotero 已有 PDF → 记录自带/arXiv/出版商模板 → 反查（OpenAlex/EPMC/OpenAIRE/Unpaywall/S2）
 *      → 落地页找 citation_pdf_url → 网页全文兜底（另见 fulltext 模块）。
 *
 * 硬约束不变：不碰任何第三方镜像站；只用开放获取、机构授权会话（用户自己的 EZproxy/WebVPN/CARSI
 * 或浏览器已登录的 Cookie）与人工补件。拿不到就记原因，交给人处理。
 *
 * 失败不再是一句 not-a-pdf：每个候选每次尝试都记 host/status/耗时，最终归到
 * no-candidate / paywalled / blocked / not-pdf / truncated / too-large / failed 七类之一，并带一句下一步建议。
 */
import { createHash } from 'node:crypto';
import { mkdir, writeFile, rename, unlink } from 'node:fs/promises';
import path from 'node:path';
import { readState, updateState, isSnoozed } from './state.js';
import { readConfig, networkOf } from './config.js';
import { lookup } from './metadata.js';
import { pdfFromZotero } from './zotero-pdf.js';
import { FAILURE, hintOf, looksLikePdf } from './guard.js';
import { fetchPdf, discoverPdfFromLanding, PdfError } from './fetch-pdf.js';
import { accessOf } from './access.js';
import { getInstitutionalCookie } from './secrets.js';
import {
  landingLocations, lookupLocations, metadataLocations, rankLocations,
} from './oa.js';

const MIN_PDF_BYTES = 1024;
const DEFAULT_MAX_MB = 80;

export function pdfFileName(id) {
  const safe = String(id || '').replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 120);
  return `${safe || 'paper'}.pdf`;
}

/** 只接受真 PDF：魔数 + 不至于小到是一张错误页（是否完整由抓取层另判）。 */
export function isPdfBuffer(buffer) {
  if (!buffer || buffer.length < MIN_PDF_BYTES) return false;
  return looksLikePdf(buffer.subarray(0, 64));
}

/** 论文是否还挂着「缺原文 / 原文抽取失败」的旧标记。 */
export function hasStalePdfFlags(paper) {
  const flags = Array.isArray(paper?.review_flags) ? paper.review_flags : [];
  return flags.includes('needs_pdf') || flags.includes('pdf_error');
}

/**
 * PDF 到位后的统一收尾。
 *
 * - 记录 pdf / pdf_bytes / pdf_sha256 / pdf_source / updated_at（download=true 时也写 download 收据）；
 * - 清掉 needs_pdf、pdf_error 与上次失败的 pdf_failure；
 * - 还没走完初筛的论文放回 L2；done / dropped 不回退（stage=false 时完全不动 stage）。
 */
export function applyPdfArrival(target, {
  pdf, bytes, source, sha, truncated, via, download, at, stage,
} = {}) {
  if (!target) return target;
  const when = at || new Date().toISOString();
  if (pdf) target.pdf = pdf;
  if (Number.isFinite(bytes)) target.pdf_bytes = bytes;
  if (source) target.pdf_source = source;
  if (sha) target.pdf_sha256 = sha;
  target.updated_at = when;
  if (download) {
    target.download = {
      at: when, ok: true, via: via || source || null, bytes: Number.isFinite(bytes) ? bytes : null, reason: null, code: null, hint: null,
    };
  }
  if (target.pdf_failure) delete target.pdf_failure;
  const flags = new Set(Array.isArray(target.review_flags) ? target.review_flags : []);
  flags.delete('needs_pdf');
  flags.delete('pdf_error');
  if (truncated) flags.add('pdf_truncated');
  else flags.delete('pdf_truncated');
  target.review_flags = [...flags];
  // 只把「还没进初筛」的论文往前推；L3 已经在精读，不能因为补到一份 PDF 就退回初筛
  if (stage !== false && stage && ['L0', 'L1', 'L2'].includes(target.stage)) target.stage = 'L2';
  return target;
}

function failureReasonOf(code) {
  return {
    [FAILURE.NO_CANDIDATE]: '没有可用入口',
    [FAILURE.PAYWALLED]: '出版社要求订阅或登录',
    [FAILURE.BLOCKED]: '对方拦截了自动请求',
    [FAILURE.NOT_PDF]: '返回的不是 PDF',
    [FAILURE.TRUNCATED]: 'PDF 不完整（缺少文件尾）',
    [FAILURE.TOO_LARGE]: '文件超过大小上限',
    [FAILURE.FAILED]: '网络或服务器错误',
  }[code] || '取原文失败';
}

const CODE_PRIORITY = [FAILURE.PAYWALLED, FAILURE.BLOCKED, FAILURE.TOO_LARGE, FAILURE.TRUNCATED, FAILURE.NOT_PDF, FAILURE.FAILED];

function dominantCode(attempts) {
  const codes = new Set(attempts.map((a) => a.code).filter(Boolean));
  for (const code of CODE_PRIORITY) if (codes.has(code)) return code;
  return attempts.length ? FAILURE.FAILED : FAILURE.NO_CANDIDATE;
}

/** 候选链：记录自带 + arXiv + 出版商模板 + 反查四源。 */
async function collectCandidates(paper, { email, templates }) {
  const found = (paper?.doi || paper?.pmcid)
    ? await lookupLocations({ doi: paper.doi, pmcid: paper.pmcid, email }).catch(() => ({ locations: [], errors: [] }))
    : { locations: [], errors: [] };
  const ranked = rankLocations([...metadataLocations(paper, { templates }), ...found.locations]);
  return { ranked, lookupErrors: found.errors || [] };
}

/**
 * 对一篇论文跑完整条链路。
 * @returns {Promise<{ok:boolean, buffer?:Buffer, via?:string, hops?:Array, attempts:Array, code:string, reason:string, hint:string}>}
 */
async function resolvePdf(paper, {
  access, cookie, email, templates, maxBytes, net, logger,
}) {
  const { ranked } = await collectCandidates(paper, { email, templates });
  const attempts = [];
  let truncatedFallback = null;

  const tryUrl = async (loc) => {
    try {
      const got = await fetchPdf(loc.url, {
        access,
        cookie,
        maxBytes,
        timeoutMs: Math.max(30000, Number(net?.timeoutMs) || 0),
        allowPrivateHosts: access?.allowPrivateHosts || [],
        referer: loc.referer || null,
      });
      return { ok: true, got };
    } catch (error) {
      const code = error?.code || FAILURE.FAILED;
      attempts.push({
        url: loc.url,
        source: loc.source || null,
        code,
        status: error?.status ?? null,
        hops: (error?.hops || []).length,
        error: String(error?.message || error),
      });
      logger?.(id_(loc), code);
      return { ok: false, code, error };
    }
  };

  for (const loc of ranked) {
    if (loc.kind !== 'pdf') continue;
    // eslint-disable-next-line no-await-in-loop
    const tried = await tryUrl(loc);
    if (!tried.ok) continue;
    if (tried.got.truncated) {
      if (!truncatedFallback) truncatedFallback = { loc, got: tried.got };
      continue;
    }
    return { ok: true, buffer: tried.got.buffer, via: loc.source, hops: tried.got.hops, attempts, code: null, reason: null, hint: null };
  }

  // 落地页兜底：从出版社页面的 citation_pdf_url 里找真正的 PDF（机构会话下这条路最有用）
  for (const loc of landingLocations(paper)) {
    // eslint-disable-next-line no-await-in-loop
    const found = await discoverPdfFromLanding(loc.url, {
      access, cookie, allowPrivateHosts: access?.allowPrivateHosts || [], timeoutMs: Math.max(20000, Number(net?.timeoutMs) || 0),
    }).catch(() => null);
    if (!found) continue;
    // eslint-disable-next-line no-await-in-loop
    const tried = await tryUrl({ url: found, kind: 'pdf', oa: null, source: 'landing' });
    if (!tried.ok) continue;
    if (tried.got.truncated) {
      if (!truncatedFallback) truncatedFallback = { loc: { url: found, source: 'landing' }, got: tried.got };
      continue;
    }
    return { ok: true, buffer: tried.got.buffer, via: 'landing', hops: tried.got.hops, attempts, code: null, reason: null, hint: null };
  }

  if (truncatedFallback) {
    // 有完整头但没有文件尾：先落到盘上并标记，比让人重新找一遍强
    return {
      ok: true,
      buffer: truncatedFallback.got.buffer,
      via: truncatedFallback.loc.source,
      truncated: true,
      hops: truncatedFallback.got.hops,
      attempts,
      code: FAILURE.TRUNCATED,
      reason: null,
      hint: null,
    };
  }

  const code = dominantCode(attempts);
  return { ok: false, attempts, code, reason: failureReasonOf(code), hint: hintOf(code) };
}

function id_(loc) {
  return loc?.source || loc?.url || 'unknown';
}

/**
 * 批量取原文。
 * 默认挑还没有 pdf 的非 dropped 论文；显式给 ids 时按给定顺序处理。
 */
export async function download(baseDir, {
  ids, limit = 3, overwrite = false, ctx = null,
} = {}) {
  const snapshot = await readState(baseDir);
  const config = await readConfig(baseDir);
  const net = networkOf(config);
  const access = accessOf(config);
  const cookie = access.enabled ? await getInstitutionalCookie(ctx, access.cookieSecret).catch(() => '') : '';
  const email = config?.network?.mailto || config?.sources?.arxiv?.mailto || '';
  const templates = config?.download?.publisherTemplates !== false;
  const maxMb = Number(config?.download?.maxMb) || Number(config?.analysis?.pdf?.maxMb) || DEFAULT_MAX_MB;
  const maxBytes = Math.max(1, maxMb) * 1024 * 1024;

  const papers = snapshot.papers || {};
  const size = Math.min(10, Math.max(1, Math.trunc(Number(limit)) || 3));
  const explicit = Array.isArray(ids) && ids.length
    ? [...new Set(ids.map((id) => String(id).trim()).filter(Boolean))]
    : null;
  const gradeRank = { S: 5, A: 4, B: 3, C: 2, D: 1 };
  const missing = explicit ? explicit.filter((id) => !papers[id]) : [];
  const targets = explicit
    ? explicit.filter((id) => papers[id])
    : Object.entries(papers)
      .filter(([, p]) => !p.pdf && p.stage !== 'dropped' && !isSnoozed(p))
      .sort((a, b) => Number(Boolean(b[1].priority)) - Number(Boolean(a[1].priority))
        || (gradeRank[b[1].grade] || 0) - (gradeRank[a[1].grade] || 0)
        || (Number(b[1].relevance?.score) || 0) - (Number(a[1].relevance?.score) || 0)
        || String(a[1].first_seen || '').localeCompare(String(b[1].first_seen || '')))
      .slice(0, size)
      .map(([id]) => id);

  if (!targets.length) {
    return { ok: true, requested: missing.length, fetched: 0, skipped: 0, missing, results: [] };
  }

  const dir = path.join(baseDir, 'pdfs');
  await mkdir(dir, { recursive: true });
  const results = [];
  const patches = {};
  const arrivals = {};
  /** 已有 PDF 却残留 needs_pdf/pdf_error 的旧记录：顺手清掉，不动 stage。 */
  const staleFlags = new Set();

  for (const id of targets) {
    const source = papers[id];
    const paper = { ...source, meta: { ...(source.meta || {}) } };
    if (paper.pdf && !overwrite) {
      if (hasStalePdfFlags(source)) staleFlags.add(id);
      results.push({ id, ok: true, skipped: 'has-pdf', pdf: paper.pdf });
      continue;
    }

    const fromZotero = await pdfFromZotero(baseDir, { ...paper, id }, { config }).catch(() => null);
    if (fromZotero?.ok) {
      arrivals[id] = {
        pdf: fromZotero.pdf,
        bytes: fromZotero.bytes,
        source: 'zotero',
        via: 'zotero',
        download: true,
        at: new Date().toISOString(),
      };
      results.push({ id, ok: true, pdf: fromZotero.pdf, bytes: fromZotero.bytes, via: 'zotero' });
      continue;
    }

    // 连标识符都没有时先补一次元数据，再谈原文
    if (!paper.doi && !paper.arxiv_id && !paper.pmcid) {
      try {
        const meta = await lookup({ title: paper.title });
        if (meta.matched) {
          if (!paper.arxiv_id && meta.arxiv_id) paper.arxiv_id = meta.arxiv_id;
          if (!paper.doi && meta.doi) paper.doi = meta.doi;
          paper.meta = {
            ...paper.meta,
            source: meta.source,
            via: meta.via,
            oa_url: meta.oa_url || paper.meta.oa_url || null,
            is_oa: meta.is_oa ?? paper.meta.is_oa ?? null,
          };
        }
      } catch { /* 查不到就继续走 no-candidate */ }
    }

    const patch = {};
    if (paper.arxiv_id !== source.arxiv_id) patch.arxiv_id = paper.arxiv_id;
    if (paper.doi !== source.doi) patch.doi = paper.doi;
    if (JSON.stringify(paper.meta) !== JSON.stringify(source.meta || {})) patch.meta = paper.meta;

    const resolved = await resolvePdf(paper, {
      access, cookie, email, templates, maxBytes, net,
    });

    if (!resolved.ok) {
      const at = new Date().toISOString();
      patch.download = {
        at,
        ok: false,
        via: null,
        bytes: null,
        reason: resolved.code === FAILURE.NO_CANDIDATE ? 'no-oa' : resolved.reason,
        code: resolved.code,
        hint: resolved.hint,
        attempts: resolved.attempts.slice(0, 8),
      };
      patch.pdf_failure = {
        at,
        code: resolved.code,
        reason: resolved.reason,
        hint: resolved.hint,
        attempts: resolved.attempts.map((a) => ({ url: a.url, source: a.source, code: a.code, status: a.status })),
      };
      patch.review_flags = [...new Set([...(paper.review_flags || []), 'needs_pdf'])];
      patch.updated_at = at;
      patches[id] = patch;
      results.push({ id, ok: false, reason: patch.download.reason, code: resolved.code, hint: resolved.hint });
      continue;
    }

    const file = path.join(dir, pdfFileName(id));
    const tmp = `${file}.part-${process.pid}-${Date.now()}`;
    let sha = '';
    try {
      await writeFile(tmp, resolved.buffer);
      sha = createHash('sha256').update(resolved.buffer).digest('hex');
      await rename(tmp, file);
    } catch (error) {
      await unlink(tmp).catch(() => {});
      const at = new Date().toISOString();
      patch.download = { at, ok: false, via: null, bytes: null, reason: '写入失败', code: FAILURE.FAILED, hint: String(error?.message || error), attempts: [] };
      patch.review_flags = [...new Set([...(paper.review_flags || []), 'needs_pdf'])];
      patch.updated_at = at;
      patches[id] = patch;
      results.push({ id, ok: false, reason: '写入失败', code: FAILURE.FAILED });
      continue;
    }

    const rel = path.relative(baseDir, file).split(path.sep).join('/');
    arrivals[id] = {
      pdf: rel,
      bytes: resolved.buffer.length,
      source: resolved.via,
      via: resolved.via,
      sha,
      truncated: Boolean(resolved.truncated),
      download: true,
      at: new Date().toISOString(),
    };
    results.push({
      id,
      ok: true,
      pdf: rel,
      bytes: resolved.buffer.length,
      via: resolved.via,
      sha256: sha,
      truncated: Boolean(resolved.truncated),
    });
    patches[id] = patch;
  }

  if (Object.keys(patches).length || Object.keys(arrivals).length || staleFlags.size) {
    await updateState(baseDir, (state) => {
      for (const [id, patch] of Object.entries(patches)) {
        const target = state.papers?.[id];
        if (target) Object.assign(target, patch);
      }
      for (const [id, facts] of Object.entries(arrivals)) {
        applyPdfArrival(state.papers?.[id], facts);
      }
      for (const id of staleFlags) {
        applyPdfArrival(state.papers?.[id], { pdf: state.papers?.[id]?.pdf, stage: false });
      }
    });
  }

  return {
    ok: true,
    requested: targets.length + missing.length,
    fetched: results.filter((r) => r.ok && !r.skipped).length,
    skipped: results.filter((r) => r.skipped).length,
    missing,
    results,
  };
}
