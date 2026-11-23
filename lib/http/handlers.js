/**
 * HTTP handler 层：只做请求解析、参数校验、响应序列化；
 * 业务动作逐步下沉到 usecase/repo。ctx/baseDir 由 configureHttp 注入。
 */
import { buildInfo } from '../build-info.js';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import {
  readState, updateState, viewOf, paperView, advance, applyGrade,
  setL1, recordLookup, summarize, today, STAGES, GRADES,
} from '../state.js';
import { validateL1, checkGradeDomain, resolveBasis } from '../judge.js';
import { readConfig, writeUserConfig, networkOf, interestQueryTerms } from '../config.js';
import { updatePaper } from '../repo/papers.js';
import { itemHomeUrl } from '../links.js';
import { discover, ingest } from '../discover.js';
import { searchItems } from '../search.js';
import { download } from '../download.js';
import { lookup } from '../metadata.js';
import { suggestKeywords, calibrateThreshold } from '../ai.js';
import { listJobs, cancelJob, startJob } from '../jobs.js';
import { newRunId, appendRun } from '../runs.js';
import { startHarvest, listHarvests, resumeHarvest } from '../harvest.js';
import { queryCandidates, readCandidates, promoteCandidate, updateCandidates, rescoreCandidates } from '../candidates.js';
import { analyzeCandidates, analyzeL2Papers, analyzeL3Papers } from '../analysis-run.js';
import { appliedToday } from '../analysis-apply.js';
import { analysisStats } from '../analysis-stats.js';
import { analysisPromptState, resolveAnalysisModel } from '../analysis.js';
import { digestFor } from '../digest.js';
import { armSchedule, readScheduleState, stopSchedule } from '../schedule.js';
import { runEmail } from '../email.js';
import { addManualPaper } from '../manual.js';
import { saveUploadedPdf } from '../upload.js';
import { readPdfTextMeta } from '../pdf.js';
import { migrateLegacyTriage } from '../migrate.js';
import { healRuntime } from '../heal.js';
import { ensureStateSchemas } from '../schema.js';
import { startWatch } from '../watch.js';
import { startBridgeServer } from '../bridge-server.js';
import {
  syncZotero, buildProfile, queryLibrary, findItem, importPapers, zoteroSummary,
  shouldAutoImport, authorizeLocalWrites,
} from '../zotero.js';
import {
  hasZoteroKey, setZoteroKey, migrateZoteroKey, readConfigWithSecrets,
  hasEasyScholarKey, setEasyScholarKey,
  hasInstitutionalCookie, setInstitutionalCookie, getInstitutionalCookie,
} from '../secrets.js';
import { accessOf } from '../access.js';
import { fetchPdf } from '../fetch-pdf.js';
import { hintOf } from '../guard.js';
import { migrateKeyToCredentials } from '../easyscholar.js';
import { translatePaper } from '../text-translate.js';
import { createTools } from '../tools.js';


let BASE_DIR = '';
let serviceCtx = null;

export function configureHttp({ baseDir, ctx } = {}) {
  if (baseDir) BASE_DIR = baseDir;
  if (ctx) serviceCtx = ctx;
}

export async function handleSuggest(request) {
  if (request.method !== 'POST') return json(405, { ok: false, error: 'method not allowed' });
  try {
    const config = await readConfigWithSecrets(serviceCtx, BASE_DIR);
    const cache = await syncZotero(BASE_DIR, config, {});
    const profile = buildProfile(cache, { limit: 24, withAbstracts: true });
    // 关键词分析是摘要级任务：跟随「判读模型 · 摘要判读（L1）」这一档，
    // 不再单独维护一套模型配置（原来这里永远走默认 provider 的第一个模型）。
    const { llm, provider, model } = await resolveAnalysisModel(serviceCtx, config, 'L1');
    const suggestion = await suggestKeywords({ llm, provider, model, profile });

    // 用 Zotero 库校准：优先评过 A/B 的条目（它们代表「真正想要的论文」）。
    // 新词不保证是旧词的超集，所以先把「当前已保存的词」并进来，
    // 否则模型漏掉某个旧词就会让覆盖率倒退。
    const cached = Array.isArray(cache?.items) ? cache.items : [];
    const graded = cached.filter((item) => (item.tags || []).some((tag) => /评级(A|B)/.test(String(tag))));
    const calibrationItems = graded.length >= 20 ? graded : cached;
    const saved = config?.relevance || {};
    const mergeUnique = (base, extra, cap) => [...new Set([...base, ...extra])].slice(0, cap);
    suggestion.keywords = mergeUnique(
      suggestion.keywords,
      Array.isArray(saved.keywords) ? saved.keywords : [],
      32,
    );
    suggestion.contextKeywords = mergeUnique(
      suggestion.contextKeywords,
      Array.isArray(saved.contextKeywords) ? saved.contextKeywords : [],
      40,
    );

    let calibration = calibrateThreshold(calibrationItems, suggestion);
    let added = [];
    // 覆盖不到目标就带着「打 0 分的库内题名」再补一轮；补进来的词优先保留，
    // 不再受第一轮上限影响（上限只截旧词，不截新补的词）。
    if (calibration && calibration.coverage < (calibration.target || 0.85) && calibration.uncovered.length) {
      try {
        const extra = await suggestKeywords({
          llm, provider, model, profile,
          coverage: { uncovered: calibration.uncovered },
        });
        const fresh = (extra.keywords || []).filter((word) => !suggestion.keywords.includes(word));
        added = fresh;
        suggestion.keywords = mergeUnique(fresh, suggestion.keywords, 40);
        suggestion.contextKeywords = mergeUnique(extra.contextKeywords || [], suggestion.contextKeywords, 48);
        if (added.length) suggestion.reason = `${suggestion.reason}（补充 ${added.length} 个词以覆盖库内论文）`;
        calibration = calibrateThreshold(calibrationItems, suggestion);
      } catch { /* 补词失败就保留第一轮结果，不阻塞保存 */ }
    }
    if (calibration) suggestion.minScore = calibration.minScore;
    return json(200, {
      ok: true, provider, model, suggestion, calibration, added, library: profile.library,
    });
  } catch (error) {
    return json(400, { ok: false, error: String(error?.message || error) });
  }
}

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

async function readBody(request) {
  try { return await request.json(); } catch { return null; }
}

/** 取整并夹到 [min, max]；非法值用 fallback。 */
function clampInt(value, fallback, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(n)));
}

export async function handleState(request) {
  if (request.method !== 'GET') return json(405, { ok: false, error: 'method not allowed' });
  try {
    const url = new URL(request.url);
    const options = {
      stage: url.searchParams.get('stage') || undefined,
      q: url.searchParams.get('q') || undefined,
      limit: url.searchParams.get('limit') || 50,
      offset: url.searchParams.get('offset') || undefined,
    };
    const state = await readState(BASE_DIR);
    const view = viewOf(state, options);
    // 候选计数并进 summary：UI 的 tab 徽标与四数卡都用它，避免两处口径不一致
    const { counts } = await queryCandidates(BASE_DIR, { status: 'all', limit: 1 });
    view.summary = { ...view.summary, counts };
    return json(200, { ok: true, date: today(), ...view, build: buildInfo(), zotero: await zoteroSummary(BASE_DIR) });
  } catch (error) {
    return json(500, { ok: false, error: String(error?.message || error) });
  }
}

export async function handleConfig(request, ctx = serviceCtx, baseDir = BASE_DIR) {
  try {
    if (request.method === 'GET') {
      const config = await readConfig(baseDir);
      if (config.integrations?.zotero) delete config.integrations.zotero.apiKey;
      config.interest_terms = interestQueryTerms(config, 8);
      return json(200, {
        ok: true, config, hasApiKey: await hasZoteroKey(ctx), hasEasyScholarKey: await hasEasyScholarKey(ctx),
        hasInstitutionalCookie: await hasInstitutionalCookie(ctx, config?.download?.access?.browserSession?.cookieSecret || ''),
      });
    }
    if (request.method === 'POST') {
      const patch = await readBody(request);
      if (!patch || typeof patch !== 'object') return json(400, { ok: false, error: '需要 JSON 对象' });
      // 只允许改这几块，避免客户端覆盖 schema 之类的元数据
      const allowed = ['window', 'sources', 'relevance', 'quota', 'integrations', 'schedule', 'network', 'corpus', 'radar', 'analysis', 'download', 'bridge', 'digest', 'views', 'ui'];
      const safe = {};
      for (const k of allowed) if (k in patch) safe[k] = patch[k];
      // 密钥不进 config：必须走 /credentials
      if (safe.integrations?.zotero) delete safe.integrations.zotero.apiKey;
      const config = await writeUserConfig(baseDir, safe);
      if (config.integrations?.zotero) delete config.integrations.zotero.apiKey;
      config.interest_terms = interestQueryTerms(config, 8);
      // 配置变了（可能改了定时），重新挂 timer
      await armSchedule(ctx, baseDir).catch(() => {});
      return json(200, {
        ok: true, config, hasApiKey: await hasZoteroKey(ctx), hasEasyScholarKey: await hasEasyScholarKey(ctx),
        hasInstitutionalCookie: await hasInstitutionalCookie(ctx, config?.download?.access?.browserSession?.cookieSecret || ''),
      });
    }
    return json(405, { ok: false, error: 'method not allowed' });
  } catch (error) {
    return json(500, { ok: false, error: String(error?.message || error) });
  }
}

export async function handleCredentials(request) {
  try {
    const access = accessOf(await readConfig(BASE_DIR));
    const cookieRef = access.cookieSecret;
    if (request.method === 'GET') {
      return json(200, {
        ok: true,
        hasApiKey: await hasZoteroKey(serviceCtx),
        hasEasyScholarKey: await hasEasyScholarKey(serviceCtx),
        hasInstitutionalCookie: await hasInstitutionalCookie(serviceCtx, cookieRef),
      });
    }
    if (request.method !== 'POST') return json(405, { ok: false, error: 'method not allowed' });
    const body = await readBody(request);
    if (!body || typeof body !== 'object' || (
      typeof body.zoteroApiKey !== 'string'
      && typeof body.easyScholarKey !== 'string'
      && typeof body.institutionalCookie !== 'string'
    )) {
      return json(400, { ok: false, error: '需要 { zoteroApiKey?: string, easyScholarKey?: string, institutionalCookie?: string }（空串表示清除）' });
    }
    if (typeof body.zoteroApiKey === 'string') await setZoteroKey(serviceCtx, body.zoteroApiKey);
    if (typeof body.easyScholarKey === 'string') await setEasyScholarKey(serviceCtx, body.easyScholarKey);
    if (typeof body.institutionalCookie === 'string') await setInstitutionalCookie(serviceCtx, body.institutionalCookie, cookieRef);
    return json(200, {
      ok: true,
      hasApiKey: await hasZoteroKey(serviceCtx),
      hasEasyScholarKey: await hasEasyScholarKey(serviceCtx),
      hasInstitutionalCookie: await hasInstitutionalCookie(serviceCtx, cookieRef),
    });
  } catch (error) {
    return json(500, { ok: false, error: String(error?.message || error) });
  }
}

export async function handleEmail(request) {
  if (request.method !== 'POST') return json(405, { ok: false, error: 'method not allowed' });
  try {
    const body = (await readBody(request)) || {};
    return json(200, await runEmail(serviceCtx, BASE_DIR, { limit: body.limit }));
  } catch (error) {
    return json(500, { ok: false, error: String(error?.message || error) });
  }
}

function localDay(iso) {
  const time = Date.parse(iso || '');
  if (!Number.isFinite(time)) return null;
  return new Date(time + 8 * 3600 * 1000).toISOString().slice(0, 10);
}

async function downloadWithQuota(body = {}) {
  const state = await readState(BASE_DIR);
  const config = await readConfig(BASE_DIR);
  const max = Math.max(1, Number(config?.download?.maxPerDay) || 10);
  const used = Object.values(state.papers || {})
    .filter((paper) => paper.pdf && paper.download?.ok && localDay(paper.download.at) === today())
    .length;
  if (used >= max) {
    return { ok: false, error: `今日下载已达上限 ${used}/${max}`, used, max };
  }
  const remaining = max - used;
  const explicit = Array.isArray(body.ids) ? body.ids.filter(Boolean) : null;
  const take = Math.min(Math.max(1, Number(body.limit) || 3), remaining);
  const ids = explicit ? explicit.slice(0, take) : undefined;
  const result = await download(BASE_DIR, {
    ids,
    limit: take,
    overwrite: body.overwrite === true,
    ctx: serviceCtx,
  });
  return {
    ...result,
    quota: {
      used, max, take, remaining,
      skippedIds: explicit && explicit.length > take ? explicit.slice(take) : [],
    },
  };
}

export async function handleNeedDownload(request) {
  if (request.method !== 'GET') return json(405, { ok: false, error: 'method not allowed' });
  try {
    const state = await readState(BASE_DIR);
    const url = new URL(request.url);
    const limit = Math.min(200, Math.max(1, Number(url.searchParams.get('limit')) || 50));
    const all = Object.entries(state.papers || {})
      .filter(([, paper]) => !paper.pdf && paper.stage !== 'dropped');
    const rows = all
      .slice(0, limit)
      .map(([id, paper]) => ({
        id,
        title: paper.title,
        grade: paper.grade || null,
        reason: paper.download?.reason || null,
        url: paper.url || (paper.doi ? `https://doi.org/${paper.doi}` : null),
      }));
    return json(200, { ok: true, total: all.length, items: rows });
  } catch (error) {
    return json(500, { ok: false, error: String(error?.message || error) });
  }
}

export async function handleAnalyze(request, baseDir = BASE_DIR) {
  if (request.method !== 'POST') return json(405, { ok: false, error: 'method not allowed' });
  try {
    const body = (await readBody(request)) || {};
    // 总开关：和定时任务同一个开关，关掉后手动「运行本轮」也不再调用模型
    const config = await readConfig(baseDir);
    if (config?.analysis?.enabled === false) {
      return json(409, { ok: false, error: 'AI 判读已关闭：到「设置 → 判读」打开，或改用来源页手动采集' });
    }
    const job = await startAnalysisJob(body);
    return json(200, { ok: true, job, appliedToday: await appliedToday(baseDir) });
  } catch (error) {
    return json(500, { ok: false, error: String(error?.message || error) });
  }
}

/**
 * 给设置页的「判读模型」用：列出可选的 provider/model，并给出每层当前生效的默认值。
 * 只是读列表，不调用模型、不产生费用。
 */
export async function handleLlmModels(request, ctx = serviceCtx, baseDir = BASE_DIR) {
  if (request.method !== 'GET') return json(405, { ok: false, error: 'method not allowed' });
  try {
    const llm = ctx?.get?.('llm');
    if (!llm || typeof llm.listProviders !== 'function') {
      return json(503, { ok: false, error: 'LLM 服务不可用' });
    }
    const providers = (await llm.listProviders()) || [];
    const list = [];
    for (const provider of providers) {
      let models = [];
      try { models = (await llm.listModels(provider.id)) || []; } catch { models = []; }
      list.push({
        id: provider.id,
        name: provider.name || provider.id,
        models: models.map((m) => ({ id: m.id, name: m.name || m.id })),
      });
    }
    const config = await readConfig(baseDir);
    const defaults = {};
    for (const stage of ['l1', 'l2', 'l3']) {
      try {
        const resolved = await resolveAnalysisModel(ctx, config, stage);
        defaults[stage] = { provider: resolved.provider, model: resolved.model };
      } catch (error) {
        defaults[stage] = { provider: null, model: null, error: String(error?.message || error) };
      }
    }
    return json(200, { ok: true, providers: list, defaults, config: config.analysis?.models || {} });
  } catch (error) {
    return json(500, { ok: false, error: String(error?.message || error) });
  }
}


/** 每日摘要：资格/分组/排序/时间边界都在后端算，前端只渲染。 */
export async function handleDigest(request, baseDir = BASE_DIR) {
  if (request.method !== 'GET') return json(405, { ok: false, error: 'method not allowed' });
  try {
    const url = new URL(request.url);
    const config = await readConfig(baseDir);
    const date = url.searchParams.get('date') || undefined;
    return json(200, { ok: true, ...(await digestFor(baseDir, config, { date })) });
  } catch (error) {
    return json(500, { ok: false, error: String(error?.message || error) });
  }
}

/** 稍后：把一篇移出当前清单，到期自动回到队列。 */
export async function handleSnooze(request, baseDir = BASE_DIR) {
  if (request.method !== 'POST') return json(405, { ok: false, error: 'method not allowed' });
  try {
    const body = (await readBody(request)) || {};
    const id = String(body.id || '').trim();
    if (!id) return json(400, { ok: false, error: '缺少论文 id' });
    const cleared = body.clear === true || body.until === null;
    let until = null;
    if (!cleared) {
      if (body.until) until = new Date(body.until).toISOString();
      else {
        const days = Number(body.days);
        if (!Number.isFinite(days) || days <= 0 || days > 365) {
          return json(400, { ok: false, error: '稍后时长需要在 1–365 天之间' });
        }
        until = new Date(Date.now() + days * 86400000).toISOString();
      }
    }
    const result = await updatePaper(baseDir, id, (paper) => {
      if (cleared) delete paper.snooze;
      else paper.snooze = { until, at: new Date().toISOString(), by: 'user' };
      return paperView(id, paper);
    });
    if (!result) throw new Error('论文不存在');
    return json(200, { ok: true, paper: result });
  } catch (error) {
    return json(500, { ok: false, error: String(error?.message || error) });
  }
}

/**
 * 优先读：把一篇排到同分段最前。value='next' 标记，value=null 取消。
 * 只是排序偏好，不改阶段，也不影响判读顺序。
 */
export async function handlePriority(request, baseDir = BASE_DIR) {
  if (request.method !== 'POST') return json(405, { ok: false, error: 'method not allowed' });
  try {
    const body = (await readBody(request)) || {};
    const id = String(body.id || '').trim();
    if (!id) return json(400, { ok: false, error: '缺少论文 id' });
    const value = body.value === undefined ? 'next' : body.value;
    if (value !== null && value !== 'next') return json(400, { ok: false, error: 'value 只能是 next 或 null' });
    const paper = await updatePaper(baseDir, id, (target) => {
      if (value === null) delete target.priority;
      else target.priority = value;
      return paperView(id, target);
    });
    if (!paper) throw new Error('论文不存在');
    return json(200, { ok: true, paper });
  } catch (error) {
    return json(500, { ok: false, error: String(error?.message || error) });
  }
}

export async function handleLlmModelsPlaceholder() {}

export async function handleAnalysisPrompts(request) {
  if (request.method !== 'GET') return json(405, { ok: false, error: 'method not allowed' });
  try {
    return json(200, { ok: true, ...analysisPromptState(await readConfig(BASE_DIR)) });
  } catch (error) {
    return json(500, { ok: false, error: String(error?.message || error) });
  }
}

export async function handleAnalysisStats(request) {
  if (request.method !== 'GET') return json(405, { ok: false, error: 'method not allowed' });
  try {
    return json(200, { ok: true, stats: await analysisStats(BASE_DIR, await readConfig(BASE_DIR)) });
  } catch (error) {
    return json(500, { ok: false, error: String(error?.message || error) });
  }
}

/**
 * 推进阶段（只推进，不写 manual_override）。
 * 用于「论文 L1 → 进入初筛」这类纯流程动作：改判会冻结 AI，这里不能走改判。
 */
/**
 * 单篇重跑：清掉人工改判，再按指定阶段起一个分析任务。
 * 合成一个请求，避免前端两步调用（清标记成功、提交失败时状态不一致）。
 */
export async function handlePaperRerun(request, baseDir = BASE_DIR) {
  if (request.method !== 'POST') return json(405, { ok: false, error: 'method not allowed' });
  try {
    const body = (await readBody(request)) || {};
    const id = String(body.id || '').trim();
    if (!id) return json(400, { ok: false, error: '需要论文 id' });
    const state = await readState(baseDir);
    const paper = state.papers?.[id];
    if (!paper) return json(404, { ok: false, error: '未知论文 id' });
    const stage = STAGES.includes(body.stage) ? body.stage : paper.stage;
    if (!['L2', 'L3'].includes(stage)) return json(400, { ok: false, error: '重跑只支持初筛或精读层' });
    await updateState(baseDir, (latest) => {
      const target = latest.papers?.[id];
      if (!target) return null;
      target.manual_override = false;
      target.manual_at = null;
      // 已完成/待确认的论文要重跑某一层，必须先回到该层，否则不在分析池里
      advance(target, stage);
      return null;
    });
    const job = await startAnalysisJob({ stage, ids: [id], limit: 1 });
    return json(200, { ok: true, job });
  } catch (error) {
    return json(500, { ok: false, error: String(error?.message || error) });
  }
}

export async function handlePaperStage(request, baseDir = BASE_DIR) {
  if (request.method !== 'POST') return json(405, { ok: false, error: 'method not allowed' });
  try {
    const body = (await readBody(request)) || {};
    const id = String(body.id || '').trim();
    const stage = String(body.stage || '').trim();
    if (!id) return json(400, { ok: false, error: '需要 id' });
    if (!STAGES.includes(stage)) return json(400, { ok: false, error: `未知阶段：${stage}` });
    const outcome = await updateState(baseDir, (state) => {
      const paper = state.papers?.[id];
      if (!paper) return { ok: false, error: '未知论文 id' };
      advance(paper, stage);
      return { ok: true, paper: { id, stage } };
    });
    return json(outcome.ok ? 200 : 404, outcome);
  } catch (error) {
    return json(500, { ok: false, error: String(error?.message || error) });
  }
}

/** 标已读 / 未读：阅读队列靠它把读过的移出队列。支持单条与批量。 */
export async function handlePaperRead(request, baseDir = BASE_DIR) {
  if (request.method !== 'POST') return json(405, { ok: false, error: 'method not allowed' });
  try {
    const body = (await readBody(request)) || {};
    const ids = Array.isArray(body.ids) ? body.ids.filter(Boolean) : (body.id ? [body.id] : []);
    if (!ids.length) return json(400, { ok: false, error: '需要 id' });
    const read = body.read !== false;
    const outcome = await updateState(baseDir, (state) => {
      const now = new Date().toISOString();
      let updated = 0;
      for (const id of ids) {
        const paper = state.papers?.[id];
        if (!paper) continue;
        if (read) paper.read_at = now; else paper.read_at = null;
        paper.updated_at = now;
        updated += 1;
      }
      if (!updated) return { ok: false, error: '未知论文 id' };
      return { ok: true, updated };
    });
    return json(200, outcome);
  } catch (error) {
    return json(500, { ok: false, error: String(error?.message || error) });
  }
}

export async function handlePaperOverride(request, baseDir = BASE_DIR) {
  if (request.method !== 'POST') return json(405, { ok: false, error: 'method not allowed' });
  try {
    const body = (await readBody(request)) || {};
    const id = String(body.id || '').trim();
    const reason = String(body.reason || '').trim();
    if (!id) return json(400, { ok: false, error: '需要 id' });
    const outcome = await updateState(baseDir, (state) => {
      const paper = state.papers?.[id];
      if (!paper) return { ok: false, error: '未知论文 id' };
      if (body.reset === true) {
        paper.manual_override = false;
        paper.manual_at = null;
        paper.updated_at = new Date().toISOString();
        return { ok: true };
      }
      const stage = body.stage || paper.stage;
      if (!STAGES.includes(stage)) return { ok: false, error: '未知 stage' };
      if (body.grade != null && !GRADES.includes(body.grade)) return { ok: false, error: '未知 grade' };
      if (body.grade && !reason) return { ok: false, error: '改等级必须写 reason' };
      if (body.grade && paper.l1) {
        const consistent = checkGradeDomain(body.grade, paper.l1.domain);
        if (!consistent.ok) return { ok: false, error: consistent.error };
      }
      const now = new Date().toISOString();
      if (body.l1) {
        const checked = validateL1(body.l1);
        if (!checked.ok) return { ok: false, error: checked.error };
        if (paper.grade) {
          const consistent = checkGradeDomain(paper.grade, checked.value.domain);
          if (!consistent.ok) return { ok: false, error: consistent.error };
        }
        setL1(paper, checked.value, now);
      }
      advance(paper, stage);
      if (body.grade) {
        applyGrade(paper, body.grade, {
          stage,
          reason,
          basis: ['abstract', 'triage', 'fulltext'].includes(body.basis) ? body.basis : (paper.grade_basis || 'abstract'),
          l1: paper.l1 || null,
          at: now,
        });
      }
      paper.manual_override = true;
      paper.manual_at = now;
      paper.updated_at = now;
      return { ok: true };
    });
    if (!outcome.ok) return json(400, outcome);
    const state = await readState(baseDir);
    return json(200, { ok: true, paper: paperView(id, state.papers[id], { fullHistory: true }) });
  } catch (error) {
    return json(500, { ok: false, error: String(error?.message || error) });
  }
}

export async function handleTextTranslate(request) {
  if (request.method !== 'POST') return json(405, { ok: false, error: 'method not allowed' });
  try {
    const body = (await readBody(request)) || {};
    const id = String(body.id || '').trim();
    if (!id) return json(400, { ok: false, error: '需要 id' });
    const result = await translatePaper(BASE_DIR, id, serviceCtx, { force: body.force === true });
    return json(200, { ok: true, ...result });
  } catch (error) {
    return json(500, { ok: false, error: String(error?.message || error) });
  }
}

/** 按当前关键词配置重算候选的 T0 分数（只动还没进流程的候选）。 */
export async function handleRescoreCandidates(request, baseDir = BASE_DIR) {
  if (request.method !== 'POST') return json(405, { ok: false, error: 'method not allowed' });
  try {
    const config = await readConfig(baseDir);
    return json(200, await rescoreCandidates(baseDir, config));
  } catch (error) {
    return json(500, { ok: false, error: String(error?.message || error) });
  }
}

export async function handleCandidateAction(request) {
  if (request.method !== 'POST') return json(405, { ok: false, error: 'method not allowed' });
  try {
    const body = (await readBody(request)) || {};
    const id = String(body.id || '').trim();
    const action = String(body.action || '').trim();
    if (!id) return json(400, { ok: false, error: '需要 id' });
    const status = action === 'rerun' ? 'new' : action === 'drop' ? 'dropped' : action === 'park' ? 'parked' : null;
    if (!status) return json(400, { ok: false, error: 'action 只能是 rerun / drop / park' });
    let found = false;
    await updateCandidates(BASE_DIR, (items) => {
      if (items[id]) { items[id].status = status; items[id].updated_at = new Date().toISOString(); found = true; }
      return items;
    });
    if (!found) return json(404, { ok: false, error: '未知候选' });
    return json(200, { ok: true, id, status });
  } catch (error) {
    return json(500, { ok: false, error: String(error?.message || error) });
  }
}

export async function handleUpload(request, baseDir = BASE_DIR) {
  if (request.method !== 'POST') return json(405, { ok: false, error: 'method not allowed' });
  try {
    if (typeof request.formData !== 'function') return json(400, { ok: false, error: '需要 multipart/form-data' });
    const form = await request.formData();
    const file = form.get('file');
    if (!file || typeof file.arrayBuffer !== 'function') return json(400, { ok: false, error: '缺少 PDF 文件' });
    const config = await readConfig(baseDir);
    const maxMb = Math.max(1, Number(config?.analysis?.pdf?.maxMb) || 20);
    const buffer = Buffer.from(await file.arrayBuffer());
    const result = await saveUploadedPdf(baseDir, {
      buffer,
      filename: file.name || '',
      title: form.get('title') || '',
      doi: form.get('doi') || '',
      paperId: form.get('paperId') || '',
      maxBytes: maxMb * 1024 * 1024,
    });
    return json(200, { ok: true, paper: result });
  } catch (error) {
    return json(400, { ok: false, error: String(error?.message || error) });
  }
}

export async function handleAdd(request) {
  if (request.method !== 'POST') return json(405, { ok: false, error: 'method not allowed' });
  try {
    const body = (await readBody(request)) || {};
    if (!body.query) return json(400, { ok: false, error: '需要论文标题、DOI 或 arXiv id' });
    return json(200, await addManualPaper(BASE_DIR, {
      query: body.query,
      stage: body.stage,
      fetchPdf: body.fetchPdf !== false,
      ctx: serviceCtx,
    }));
  } catch (error) {
    return json(400, { ok: false, error: String(error?.message || error) });
  }
}

export async function handleDownload(request) {
  if (request.method !== 'POST') return json(405, { ok: false, error: 'method not allowed' });
  try {
    return json(200, await downloadWithQuota((await readBody(request)) || {}));
  } catch (error) {
    return json(500, { ok: false, error: String(error?.message || error) });
  }
}

export async function handleSchedule(request) {
  try {
    if (request.method === 'GET') {
      const state = await readScheduleState(BASE_DIR);
      const config = await readConfig(BASE_DIR);
      return json(200, { ok: true, schedule: { ...state, autoAnalyze: config?.schedule?.autoAnalyze === true } });
    }
    if (request.method !== 'POST') return json(405, { ok: false, error: 'method not allowed' });
    const body = (await readBody(request)) || {};
    if (typeof body.enabled !== 'boolean') {
      return json(400, { ok: false, error: '需要 { enabled: boolean, time?: "HH:MM" }' });
    }
    const current = await readConfig(BASE_DIR);
    const scope = ['A', 'C'].includes(body.scope)
      ? body.scope
      : (current?.schedule?.scope === 'C' ? 'C' : 'A');
    const schedule = {
      enabled: body.enabled,
      time: /^\d{1,2}:\d{2}$/.test(String(body.time || '')) ? String(body.time) : '07:00',
      scope,
      autoAnalyze: typeof body.autoAnalyze === 'boolean'
        ? body.autoAnalyze
        : (current?.schedule?.autoAnalyze === true),
    };
    await writeUserConfig(BASE_DIR, { schedule });
    const state = await armSchedule(serviceCtx, BASE_DIR);
    return json(200, { ok: true, schedule: { ...state, autoAnalyze: schedule.autoAnalyze } });
  } catch (error) {
    return json(500, { ok: false, error: String(error?.message || error) });
  }
}

export async function handleHarvest(request) {
  try {
    if (request.method === 'GET') {
      return json(200, { ok: true, harvests: await listHarvests(BASE_DIR) });
    }
    if (request.method !== 'POST') return json(405, { ok: false, error: 'method not allowed' });
    const body = (await readBody(request)) || {};
    if (!body || typeof body !== 'object') {
      return json(400, { ok: false, error: '需要 { kind, spec } 或 { resumeId }' });
    }
    if (body.resumeId) {
      return json(200, { ok: true, harvest: await resumeHarvest(BASE_DIR, body.resumeId) });
    }
    if (!body.spec) return json(400, { ok: false, error: '需要 { kind, spec }' });
    const record = await startHarvest(BASE_DIR, { kind: body.kind, ...body.spec });
    return json(200, { ok: true, harvest: record });
  } catch (error) {
    return json(500, { ok: false, error: String(error?.message || error) });
  }
}

export async function handleCandidates(request) {
  if (request.method !== 'GET') return json(405, { ok: false, error: 'method not allowed' });
  try {
    const url = new URL(request.url);
    const result = await queryCandidates(BASE_DIR, {
      status: url.searchParams.get('status') || 'new',
      q: url.searchParams.get('q') || '',
      source: url.searchParams.get('source') || '',
      since: url.searchParams.get('since') || '',
      until: url.searchParams.get('until') || '',
      limit: url.searchParams.get('limit') || 20,
      offset: url.searchParams.get('offset') || 0,
      sort: url.searchParams.get('sort') || 'score',
    });
    return json(200, { ok: true, ...result });
  } catch (error) {
    return json(500, { ok: false, error: String(error?.message || error) });
  }
}

export async function handlePromote(request) {
  if (request.method !== 'POST') return json(405, { ok: false, error: 'method not allowed' });
  try {
    const body = (await readBody(request)) || {};
    if (!body.id) return json(400, { ok: false, error: '需要 id' });
    const stage = ['L1', 'L2', 'L3'].includes(body.stage) ? body.stage : 'L2';
    return json(200, await promoteCandidate(BASE_DIR, body.id, { stage }));
  } catch (error) {
    return json(500, { ok: false, error: String(error?.message || error) });
  }
}

export async function handleJobs(request) {
  if (request.method !== 'GET') return json(405, { ok: false, error: 'method not allowed' });
  try {
    return json(200, { ok: true, jobs: await listJobs(BASE_DIR) });
  } catch (error) {
    return json(500, { ok: false, error: String(error?.message || error) });
  }
}

async function startAnalysisJob(body = {}) {
  const stage = ['L2', 'L3'].includes(body.stage) ? body.stage : 'L1';
  const runId = newRunId(`analysis-${stage}`);
  const job = await startJob(BASE_DIR, {
    name: `analysis:${stage}`,
    meta: { stage, targets: Array.isArray(body.ids) ? body.ids : [], run_id: runId },
    run: async ({ signal, jobId, report } = {}) => {
      try {
        const config = await readConfig(BASE_DIR);
        let result;
        if (stage === 'L2') {
          result = await analyzeL2Papers(serviceCtx, BASE_DIR, config, {
            ids: Array.isArray(body.ids) ? body.ids : undefined,
            limit: body.limit,
            signal,
            onProgress: (progress) => report?.(progress),
          });
        } else if (stage === 'L3') {
          result = await analyzeL3Papers(serviceCtx, BASE_DIR, config, {
            ids: Array.isArray(body.ids) ? body.ids : undefined,
            limit: body.limit,
            signal,
            onProgress: (progress) => report?.(progress),
          });
        } else {
          result = await analyzeCandidates(serviceCtx, BASE_DIR, config, {
            stage: 'L1',
            ids: Array.isArray(body.ids) ? body.ids : undefined,
            limit: body.limit,
            sort: body.sort || 'score',
            signal,
            onProgress: (progress) => report?.(progress),
          });
        }
        await appendRun(BASE_DIR, {
          id: runId,
          kind: 'analysis',
          stage,
          job_id: jobId,
          at: new Date().toISOString(),
          processed: Number(result?.processed) || 0,
          admitted: Number(result?.admitted) || 0,
          parked: Number(result?.parked) || 0,
          dropped: Number(result?.dropped) || 0,
          failed: Number(result?.failed) || 0,
          closeRead: Number(result?.closeRead) || 0,
          skim: Number(result?.skim) || 0,
          skip: Number(result?.skip) || 0,
          needsPdf: Number(result?.needsPdf) || 0,
          done: Number(result?.done) || 0,
          zotero: Number(result?.zotero) || 0,
        });
        return result;
      } catch (error) {
        await appendRun(BASE_DIR, {
          id: runId,
          kind: 'analysis',
          stage,
          job_id: jobId,
          at: new Date().toISOString(),
          status: 'failed',
          error: String(error?.message || error),
        });
        throw error;
      }
    },
  });
  return job;
}

export async function handleCancelJob(request) {
  if (request.method !== 'POST') return json(405, { ok: false, error: 'method not allowed' });
  try {
    const body = (await readBody(request)) || {};
    if (!body.id) return json(400, { ok: false, error: '需要 id' });
    const job = await cancelJob(BASE_DIR, body.id);
    return job ? json(200, { ok: true, job }) : json(404, { ok: false, error: '未知 job' });
  } catch (error) {
    return json(500, { ok: false, error: String(error?.message || error) });
  }
}

export async function handlePaper(request) {
  if (request.method !== 'GET') return json(405, { ok: false, error: 'method not allowed' });
  try {
    const url = new URL(request.url);
    const id = url.searchParams.get('id');
    if (!id) return json(400, { ok: false, error: '需要 id' });
    const state = await readState(BASE_DIR);
    const paper = state.papers?.[id];
    if (!paper) return json(404, { ok: false, error: `未知论文 id：${id}` });
    const textMeta = await readPdfTextMeta(BASE_DIR, id).catch(() => null);
    return json(200, {
      ok: true,
      paper: paperView(id, paper, { fullHistory: true }),
      text: textMeta
        ? {
          chars: textMeta.chars ?? 0,
          pages: textMeta.pages ?? 0,
          scanned: Boolean(textMeta.scanned),
          truncated: Boolean(textMeta.truncated),
          extracted_at: textMeta.extracted_at || null,
        }
        : null,
    });
  } catch (error) {
    return json(500, { ok: false, error: String(error?.message || error) });
  }
}

/** 关键图：只服务当前论文 l3.figures 里登记过的文件，禁止任意路径。 */
export async function handleFigure(request, baseDir = BASE_DIR) {
  if (request.method !== 'GET') return json(405, { ok: false, error: 'method not allowed' });
  try {
    const url = new URL(request.url);
    const paperId = url.searchParams.get('paper');
    const file = url.searchParams.get('file');
    if (!paperId || !file) return json(400, { ok: false, error: '需要 paper 与 file' });
    const state = await readState(baseDir);
    const paper = state.papers?.[paperId];
    const figure = (paper?.l3?.figures || []).find((item) => item.file === file);
    if (!figure) return json(404, { ok: false, error: '找不到这张关键图' });
    const root = path.resolve(baseDir, 'state', 'figures');
    const full = path.resolve(baseDir, figure.file);
    if (!full.startsWith(`${root}${path.sep}`)) return json(403, { ok: false, error: '路径越界' });
    const info = await stat(full).catch(() => null);
    if (!info || !info.isFile()) return json(404, { ok: false, error: '图片文件不存在' });
    const buffer = await readFile(full);
    return new Response(buffer, {
      status: 200,
      headers: { 'content-type': 'image/png', 'content-length': String(buffer.length), 'cache-control': 'private, max-age=3600' },
    });
  } catch (error) {
    return json(500, { ok: false, error: String(error?.message || error) });
  }
}

/**
 * 只读原文：浏览器无法从 http 页面打开 file://，所以由 Host 回源。
 * 只服务 pdfs/ 目录内的文件，避免越界读盘。
 */
export async function handlePdf(request, baseDir = BASE_DIR) {
  if (request.method !== 'GET') return json(405, { ok: false, error: 'method not allowed' });
  try {
    const url = new URL(request.url);
    const id = url.searchParams.get('id');
    if (!id) return json(400, { ok: false, error: '需要 id' });
    const state = await readState(baseDir);
    const paper = state.papers?.[id];
    if (!paper?.pdf) return json(404, { ok: false, error: '这篇还没有原文' });
    const root = path.resolve(baseDir, 'pdfs');
    const file = path.resolve(baseDir, String(paper.pdf));
    if (file !== root && !file.startsWith(`${root}${path.sep}`)) {
      return json(403, { ok: false, error: '路径越界' });
    }
    const info = await stat(file).catch(() => null);
    if (!info || !info.isFile()) return json(404, { ok: false, error: '原文文件不存在' });
    if (info.size > 200 * 1024 * 1024) return json(413, { ok: false, error: '文件过大' });
    const buffer = await readFile(file);
    return new Response(buffer, {
      status: 200,
      headers: {
        'content-type': 'application/pdf',
        'content-length': String(buffer.length),
        'content-disposition': 'inline',
        'cache-control': 'private, max-age=60',
      },
    });
  } catch (error) {
    return json(500, { ok: false, error: String(error?.message || error) });
  }
}

/** 用系统默认阅读器打开本地 PDF；浏览器不再内嵌 PDF 视图。 */
/**
 * 打开条目网页（DOI / arXiv / 已存 url）：按 id 在本地状态里解析，
 * 不接受客户端传来的任意 URL；只放行 http(s)。
 */
export async function handleOpenUrl(request, baseDir = BASE_DIR) {
  if (request.method !== 'POST') return json(405, { ok: false, error: 'method not allowed' });
  try {
    const body = (await readBody(request)) || {};
    const id = String(body.id || '').trim();
    if (!id) return json(400, { ok: false, error: '需要 id' });
    const [state, candidates] = await Promise.all([readState(baseDir), readCandidates(baseDir)]);
    const item = state.papers?.[id] || candidates?.[id];
    if (!item) return json(404, { ok: false, error: '找不到这个条目' });
    const url = itemHomeUrl(item);
    if (!url) return json(400, { ok: false, error: '这个条目没有可打开的网页' });
    const command = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'explorer' : 'xdg-open';
    const child = spawn(command, [url], { detached: true, stdio: 'ignore' });
    child.on('error', () => {});
    child.unref();
    return json(200, { ok: true, opened: true, url });
  } catch (error) {
    return json(500, { ok: false, error: String(error?.message || error) });
  }
}

export async function handleOpenPdf(request, baseDir = BASE_DIR) {
  if (request.method !== 'POST') return json(405, { ok: false, error: 'method not allowed' });
  try {
    const body = (await readBody(request)) || {};
    const id = String(body.id || '').trim();
    if (!id) return json(400, { ok: false, error: '需要 id' });
    const state = await readState(baseDir);
    const paper = state.papers?.[id];
    if (!paper?.pdf) return json(404, { ok: false, error: '这篇还没有原文' });
    const root = path.resolve(baseDir, 'pdfs');
    const file = path.resolve(baseDir, String(paper.pdf));
    if (file !== root && !file.startsWith(`${root}${path.sep}`)) {
      return json(403, { ok: false, error: '路径越界' });
    }
    const info = await stat(file).catch(() => null);
    if (!info || !info.isFile()) return json(404, { ok: false, error: '原文文件不存在' });
    const command = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'explorer' : 'xdg-open';
    const child = spawn(command, [file], { detached: true, stdio: 'ignore' });
    child.on('error', () => {});
    child.unref();
    return json(200, { ok: true, opened: true });
  } catch (error) {
    return json(500, { ok: false, error: String(error?.message || error) });
  }
}

/**
 * 抽屉「入库 Zotero」：等同工具 action=import 的单篇路径，只是入口在界面。
 * 已入库（zotero_key 存在）或库里已有同 DOI/arXiv 的，由 importPapers 自己跳过。
 */
export async function handleZoteroImport(request, baseDir = BASE_DIR) {
  if (request.method !== 'POST') return json(405, { ok: false, error: 'method not allowed' });
  try {
    const body = (await readBody(request)) || {};
    const id = body.id;
    if (!id) return json(400, { ok: false, error: '需要 id' });
    const state = await readState(baseDir);
    const paper = state.papers?.[id];
    if (!paper) {
      // 候选还没变成论文：补摘要按候选处理，否则「补全摘要」按钮只能 404
      const candidates = await readCandidates(baseDir);
      const candidate = candidates[id];
      if (!candidate) return json(404, { ok: false, error: `未知论文或候选 id：${id}` });
      const candMeta = await lookup({ doi: candidate.doi, arxivId: candidate.arxiv_id, title: candidate.title });
      const candMatched = Boolean(candMeta.matched);
      const candAbstract = candMeta.abstract && String(candMeta.abstract).trim() ? String(candMeta.abstract).trim() : '';
      const candReason = candMatched ? (candAbstract ? null : 'no-abstract') : (candMeta.reason || 'not-matched');
      await updateCandidates(baseDir, (db) => {
        const target = db[id];
        if (!target) return db;
        target.abstract_lookup = {
          at: new Date().toISOString(),
          matched: candMatched,
          has_abstract: Boolean(candAbstract),
          via: candMatched ? (candMeta.via || null) : null,
          reason: candReason,
        };
        if (candAbstract) {
          target.abstract = candAbstract;
          // 上一次判读按截断摘要给了 abstract-short/no-abstract；摘要补齐后这些理由作废。
          const stale = (target.analysis?.confidence_reasons || [])
            .some((reason) => reason === 'no-abstract' || reason === 'abstract-short');
          if (stale) {
            target.analysis_prev = target.analysis;
            delete target.analysis;
            delete target.analysis_at;
            if (['parked', 'failed'].includes(target.status)) target.status = 'new';
          }
        }
        if (candMeta.venue && !target.venue) target.venue = candMeta.venue;
        if (candMeta.year && !target.year) target.year = candMeta.year;
        if (!target.doi && candMeta.doi) target.doi = candMeta.doi;
        if (!target.arxiv_id && candMeta.arxiv_id) target.arxiv_id = candMeta.arxiv_id;
        return db;
      });
      return json(200, {
        ok: true,
        matched: candMatched,
        has_abstract: Boolean(candAbstract),
        via: candMatched ? (candMeta.via || null) : null,
        reason: candReason,
        candidate_id: id,
      });
    }
    const config = await readConfigWithSecrets(serviceCtx, baseDir);
    const result = await importPapers(baseDir, config, state, [paper], { dryRun: body.dryRun === true });
    const after = await readState(baseDir);
    return json(200, {
      ok: true,
      result,
      paper: paperView(id, after.papers[id], { fullHistory: true }),
    });
  } catch (error) {
    return json(500, { ok: false, error: String(error?.message || error) });
  }
}

/**
 * 抽屉「重取摘要」：走和工具一样的 lookup 链路（DOI → arXiv → 题名），
 * 取不到就把原因记进 abstract_lookup，不硬改已有摘要。
 */
export async function handleRefetch(request, baseDir = BASE_DIR) {
  if (request.method !== 'POST') return json(405, { ok: false, error: 'method not allowed' });
  try {
    const body = (await readBody(request)) || {};
    const id = body?.id;
    if (!id) return json(400, { ok: false, error: '需要 id' });
    const state = await readState(baseDir);
    const paper = state.papers?.[id];
    if (!paper) {
      // 候选还没变成论文：补摘要按候选处理，否则「补全摘要」按钮只能 404
      const candidates = await readCandidates(baseDir);
      const candidate = candidates[id];
      if (!candidate) return json(404, { ok: false, error: `未知论文或候选 id：${id}` });
      const candMeta = await lookup({ doi: candidate.doi, arxivId: candidate.arxiv_id, title: candidate.title });
      const candMatched = Boolean(candMeta.matched);
      const candAbstract = candMeta.abstract && String(candMeta.abstract).trim() ? String(candMeta.abstract).trim() : '';
      const candReason = candMatched ? (candAbstract ? null : 'no-abstract') : (candMeta.reason || 'not-matched');
      await updateCandidates(baseDir, (db) => {
        const target = db[id];
        if (!target) return db;
        target.abstract_lookup = {
          at: new Date().toISOString(),
          matched: candMatched,
          has_abstract: Boolean(candAbstract),
          via: candMatched ? (candMeta.via || null) : null,
          reason: candReason,
        };
        if (candAbstract) {
          target.abstract = candAbstract;
          // 上一次判读按截断摘要给了 abstract-short/no-abstract；摘要补齐后这些理由作废。
          const stale = (target.analysis?.confidence_reasons || [])
            .some((reason) => reason === 'no-abstract' || reason === 'abstract-short');
          if (stale) {
            target.analysis_prev = target.analysis;
            delete target.analysis;
            delete target.analysis_at;
            if (['parked', 'failed'].includes(target.status)) target.status = 'new';
          }
        }
        if (candMeta.venue && !target.venue) target.venue = candMeta.venue;
        if (candMeta.year && !target.year) target.year = candMeta.year;
        if (!target.doi && candMeta.doi) target.doi = candMeta.doi;
        if (!target.arxiv_id && candMeta.arxiv_id) target.arxiv_id = candMeta.arxiv_id;
        return db;
      });
      return json(200, {
        ok: true,
        matched: candMatched,
        has_abstract: Boolean(candAbstract),
        via: candMatched ? (candMeta.via || null) : null,
        reason: candReason,
        candidate_id: id,
      });
    }
    const meta = await lookup({ doi: paper.doi, arxivId: paper.arxiv_id, title: paper.title });
    const matched = Boolean(meta.matched);
    const abstract = meta.abstract && String(meta.abstract).trim() ? String(meta.abstract).trim() : '';
    const reason = matched ? (abstract ? null : 'no-abstract') : (meta.reason || 'not-matched');
    await updateState(baseDir, (latest) => {
      const target = latest.papers?.[id];
      if (!target) return null;
      target.abstract_lookup = {
        at: new Date().toISOString(),
        matched,
        has_abstract: Boolean(abstract),
        via: matched ? (meta.via || null) : null,
        reason,
      };
      if (abstract) target.abstract = abstract;
      if (matched) {
        target.meta = {
          ...(target.meta || {}),
          source: meta.source || target.meta?.source || null,
          via: meta.via || null,
          venue: meta.venue || target.meta?.venue || null,
          year: meta.year || target.meta?.year || null,
          authors: meta.authors || target.meta?.authors || [],
        };
        if (!target.doi && meta.doi) target.doi = meta.doi;
        if (!target.arxiv_id && meta.arxiv_id) target.arxiv_id = meta.arxiv_id;
      }
      target.updated_at = new Date().toISOString();
      return null;
    });
    const after = await readState(baseDir);
    return json(200, {
      ok: true,
      matched,
      has_abstract: Boolean(abstract),
      via: matched ? (meta.via || null) : null,
      reason,
      paper: paperView(id, after.papers[id], { fullHistory: true }),
    });
  } catch (error) {
    return json(500, { ok: false, error: String(error?.message || error) });
  }
}

export async function handleDiscover(request) {
  if (request.method !== 'POST') return json(405, { ok: false, error: 'method not allowed' });
  try {
    const body = (await readBody(request)) || {};
    const result = await discover(BASE_DIR, {
      ...(body.hours ? { hours: Number(body.hours) } : {}),
      ...(Array.isArray(body.only) && body.only.length ? { only: body.only } : {}),
    });
    return json(200, result);
  } catch (error) {
    return json(500, { ok: false, error: String(error?.message || error) });
  }
}


/**
 * 机构访问自检：按当前配置真的去取一次，回报「能不能拿到 PDF」。
 * 只读探测：不写 state、不落盘、不记账。
 */
export async function handleAccessTest(request) {
  if (request.method !== 'POST') return json(405, { ok: false, error: 'method not allowed' });
  try {
    const body = (await readBody(request)) || {};
    const target = String(body.url || '').trim();
    if (!/^https?:\/\//i.test(target)) {
      return json(400, { ok: false, error: '需要一个 http(s) 链接：出版社文章页或 PDF 地址都行' });
    }
    const config = await readConfig(BASE_DIR);
    const access = accessOf(config);
    const cookie = access.enabled ? await getInstitutionalCookie(serviceCtx, access.cookieSecret) : '';
    const maxMb = Number(config?.download?.maxMb) || 80;
    const startedAt = Date.now();
    try {
      const got = await fetchPdf(target, {
        access,
        cookie,
        maxBytes: Math.max(1, maxMb) * 1024 * 1024,
        allowPrivateHosts: access.allowPrivateHosts || [],
        timeoutMs: 45000,
      });
      return json(200, {
        ok: true,
        isPdf: true,
        bytes: got.bytes,
        truncated: Boolean(got.truncated),
        hops: got.hops.length,
        ms: Date.now() - startedAt,
        note: got.truncated ? '能取到 PDF，但文件尾不完整' : '能取到 PDF',
      });
    } catch (error) {
      const code = error?.code || 'failed';
      return json(200, {
        ok: true,
        isPdf: false,
        code,
        hint: error?.hint || hintOf(code),
        hops: (error?.hops || []).length,
        ms: Date.now() - startedAt,
        note: access.enabled ? '按当前机构访问设置没取到' : '未启用机构访问，按匿名访问尝试',
      });
    }
  } catch (error) {
    return json(500, { ok: false, error: String(error?.message || error) });
  }
}

