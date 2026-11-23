/**
 * 文献实验室 Host 侧。
 *
 * 对外提供：
 *   GET  /api/dsh-literature-lab/state   工作台数据
 *   GET  /api/dsh-literature-lab/config  当前配置（默认 + 用户覆盖）
 *   POST /api/dsh-literature-lab/config  保存用户配置补丁
 *   POST /api/dsh-literature-lab/discover 跑一轮 L0（也供 UI 的「立即扫描」用）
 *
 * 给 agent 的工具：
 *   literature-lab_state       读状态（分页 / 单篇完整字段，摘要不截断）
 *   literature-lab_set_stage   推进层级；写 L1 三问与评级
 *   literature-lab_fetch_metadata 取一手摘要（DOI/arXiv/题名），记录检索结果
 *   literature-lab_download    取开放获取原文（arXiv / OpenAlex OA）
 *   literature-lab_search      按关键词检索 arXiv / OpenAlex / Crossref
 *   literature-lab_discover    触发一轮 L0 发现（arXiv API + RSS，含回填）
 *   literature-lab_ingest      把邮件提醒/手工条目并入队列（共用去重与过滤）
 *   literature-lab_zotero      Zotero 只读联动（profile/search/item/collections/refresh）
 *   literature-lab_zotero_import 把论文写入 Zotero（显式 ids 或自动策略）
 *   literature-lab_set_keywords 写入 AI 分析出的关注关键词
 */
import path from 'node:path';
import { readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import {
  readState, updateState, viewOf, paperView, advance, applyGrade,
  setL1, recordLookup, summarize, today, STAGES, GRADES,
} from './lib/state.js';
import { validateL1, checkGradeDomain, resolveBasis } from './lib/judge.js';
import { readConfig, writeUserConfig, networkOf, interestQueryTerms } from './lib/config.js';
import { discover, ingest } from './lib/discover.js';
import { searchItems } from './lib/search.js';
import { download } from './lib/download.js';
import { lookup } from './lib/metadata.js';
import { suggestKeywords, calibrateThreshold } from './lib/ai.js';
import { listJobs, cancelJob, startJob } from './lib/jobs.js';
import { startHarvest, listHarvests, resumeHarvest } from './lib/harvest.js';
import { queryCandidates, readCandidates, promoteCandidate, updateCandidates, rescoreCandidates } from './lib/candidates.js';
import { analyzeCandidates, analyzeL2Papers, analyzeL3Papers } from './lib/analysis-run.js';
import { appliedToday } from './lib/analysis-apply.js';
import { analysisStats } from './lib/analysis-stats.js';
import { analysisPromptState, resolveAnalysisModel } from './lib/analysis.js';
import { digestFor } from './lib/digest.js';
import { armSchedule, readScheduleState, stopSchedule } from './lib/schedule.js';
import { runEmail } from './lib/email.js';
import { addManualPaper } from './lib/manual.js';
import { saveUploadedPdf } from './lib/upload.js';
import { readPdfTextMeta } from './lib/pdf.js';
import { migrateLegacyTriage } from './lib/migrate.js';
import { healRuntime } from './lib/heal.js';
import { ensureStateSchemas } from './lib/schema.js';
import { startWatch } from './lib/watch.js';
import { startBridgeServer } from './lib/bridge-server.js';
import {
  syncZotero, buildProfile, queryLibrary, findItem, importPapers, zoteroSummary,
  shouldAutoImport, authorizeLocalWrites,
} from './lib/zotero.js';
import {
  hasZoteroKey, setZoteroKey, migrateZoteroKey, readConfigWithSecrets,
  hasEasyScholarKey, setEasyScholarKey,
} from './lib/secrets.js';
import { migrateKeyToCredentials } from './lib/easyscholar.js';
import { translatePaper } from './lib/text-translate.js';
import { createTools } from './lib/tools.js';
import {
  configureHttp,
  handleFigure,
  handleSuggest,
  handleState,
  handleConfig,
  handleCredentials,
  handleAccessTest,
  handleEmail,
  handleNeedDownload,
  handleAnalyze,
  handleLlmModels,
  handleDigest,
  handleSnooze,
  handlePriority,
  handleLlmModelsPlaceholder,
  handleAnalysisPrompts,
  handleAnalysisStats,
  handlePaperRerun,
  handlePaperStage,
  handlePaperRead,
  handlePaperOverride,
  handleTextTranslate,
  handleRescoreCandidates,
  handleCandidateAction,
  handleUpload,
  handleAdd,
  handleDownload,
  handleSchedule,
  handleHarvest,
  handleCandidates,
  handlePromote,
  handleJobs,
  handleCancelJob,
  handlePaper,
  handlePdf,
  handleOpenPdf,
  handleOpenUrl,
  handleZoteroImport,
  handleRefetch,
  handleDiscover,
} from './lib/http/handlers.js';
export * from './lib/http/handlers.js';

export const name = 'literature-lab';
export const inject = ['tools'];

const BASE_DIR = path.dirname(fileURLToPath(import.meta.url));

export const STATE_ROUTE = '/api/dsh-literature-lab/state';
export const CONFIG_ROUTE = '/api/dsh-literature-lab/config';
export const DISCOVER_ROUTE = '/api/dsh-literature-lab/discover';
export const SUGGEST_ROUTE = '/api/dsh-literature-lab/zotero/suggest';
export const CREDENTIALS_ROUTE = '/api/dsh-literature-lab/credentials';
export const PAPER_ROUTE = '/api/dsh-literature-lab/paper';
export const JOBS_ROUTE = '/api/dsh-literature-lab/jobs';
export const JOBS_CANCEL_ROUTE = '/api/dsh-literature-lab/jobs/cancel';
export const HARVEST_ROUTE = '/api/dsh-literature-lab/harvest';
export const CANDIDATES_ROUTE = '/api/dsh-literature-lab/candidates';
export const PROMOTE_ROUTE = '/api/dsh-literature-lab/candidates/promote';
export const SCHEDULE_ROUTE = '/api/dsh-literature-lab/schedule';
export const EMAIL_ROUTE = '/api/dsh-literature-lab/email';
export const NEED_ROUTE = '/api/dsh-literature-lab/need_download';
export const DOWNLOAD_ROUTE = '/api/dsh-literature-lab/download';
export const ADD_ROUTE = '/api/dsh-literature-lab/add';
export const ANALYZE_ROUTE = '/api/dsh-literature-lab/analyze';
export const UPLOAD_ROUTE = '/api/dsh-literature-lab/upload';
export const PDF_ROUTE = '/api/dsh-literature-lab/pdf';
export const FIGURE_ROUTE = '/api/dsh-literature-lab/figure';
export const OPEN_PDF_ROUTE = '/api/dsh-literature-lab/paper/open-pdf';
export const OPEN_URL_ROUTE = '/api/dsh-literature-lab/open-url';
export const ZOTERO_IMPORT_ROUTE = '/api/dsh-literature-lab/zotero/import';
export const REFETCH_ROUTE = '/api/dsh-literature-lab/refetch';
export const LLM_MODELS_ROUTE = '/api/dsh-literature-lab/llm/models';
export const DIGEST_ROUTE = '/api/dsh-literature-lab/digest';
export const SNOOZE_ROUTE = '/api/dsh-literature-lab/snooze';
export const PRIORITY_ROUTE = '/api/dsh-literature-lab/priority';
export const CANDIDATE_ACTION_ROUTE = '/api/dsh-literature-lab/candidates/action';
export const PAPER_OVERRIDE_ROUTE = '/api/dsh-literature-lab/paper/override';
export const PAPER_READ_ROUTE = '/api/dsh-literature-lab/paper/read';
export const PAPER_STAGE_ROUTE = '/api/dsh-literature-lab/paper/stage';
export const PAPER_RERUN_ROUTE = '/api/dsh-literature-lab/paper/rerun';
export const CANDIDATES_RESCORE_ROUTE = '/api/dsh-literature-lab/candidates/rescore';
export const TEXT_TRANSLATE_ROUTE = '/api/dsh-literature-lab/paper/translate';
export const ANALYSIS_STATS_ROUTE = '/api/dsh-literature-lab/analysis/stats';
export const ANALYSIS_PROMPTS_ROUTE = '/api/dsh-literature-lab/analysis/prompts';
export const ACCESS_TEST_ROUTE = '/api/dsh-literature-lab/access/test';

// 路由回调不在 apply 的闭包里，用模块变量拿 ctx 以访问 llm 服务
let serviceCtx = null;

export function apply(ctx) {
  serviceCtx = ctx;
  configureHttp({ baseDir: BASE_DIR, ctx });
  // 定时任务：插件自己的 timer，不建会话
  armSchedule(ctx, BASE_DIR).catch((error) => {
    console.error('[literature-lab] 定时任务初始化失败：', error);
  });
  const stopWatch = startWatch(BASE_DIR, () => readConfig(BASE_DIR));
  let bridgeServer = null;
  readConfig(BASE_DIR).then((config) => {
    if (config?.bridge?.enabled !== false) {
      bridgeServer = startBridgeServer(BASE_DIR, {
        port: config?.bridge?.port || 27888,
        token: String(config?.bridge?.token || ''),
      });
    }
  }).catch((error) => console.error('[literature-lab] bridge 启动失败：', error));
  if (typeof ctx.effect === 'function') ctx.effect(() => () => { stopWatch(); stopSchedule(); bridgeServer?.close?.(); });
  // 旧版本把 key 放在 config 里：启动时迁到 credentials 并删除
  migrateZoteroKey(ctx, BASE_DIR).catch((error) => {
    console.error('[literature-lab] Zotero 凭据迁移失败：', error);
  });
  migrateKeyToCredentials(ctx, BASE_DIR).catch((error) => {
    console.error('[literature-lab] easyScholar 凭据迁移失败：', error);
  });
  migrateLegacyTriage(BASE_DIR).catch((error) => {
    console.error('[literature-lab] 旧 T1 候选迁移失败：', error);
  });
  ensureStateSchemas(BASE_DIR).catch((error) => {
    console.error('[literature-lab] 状态 schema 检查失败：', error);
  });
  healRuntime(BASE_DIR).catch((error) => {
    console.error('[literature-lab] 启动自愈失败：', error);
  });
  ctx.inject?.(['connection'], (host) => {
    const register = host.connection?.fetch?.register;
    if (typeof register !== 'function') return;
    const routes = [
      { path: STATE_ROUTE, methods: ['GET'], requestBody: 'buffered', fetch: (r) => handleState(r) },
      { path: CONFIG_ROUTE, methods: ['GET', 'POST'], requestBody: 'buffered', fetch: (r) => handleConfig(r) },
      { path: DISCOVER_ROUTE, methods: ['POST'], requestBody: 'buffered', fetch: (r) => handleDiscover(r) },
      { path: SUGGEST_ROUTE, methods: ['POST'], requestBody: 'buffered', fetch: (r) => handleSuggest(r) },
      { path: CREDENTIALS_ROUTE, methods: ['GET', 'POST'], requestBody: 'buffered', fetch: (r) => handleCredentials(r) },
      { path: ACCESS_TEST_ROUTE, methods: ['POST'], requestBody: 'buffered', fetch: (r) => handleAccessTest(r) },
      { path: PAPER_ROUTE, methods: ['GET'], requestBody: 'buffered', fetch: (r) => handlePaper(r) },
      { path: JOBS_ROUTE, methods: ['GET'], requestBody: 'buffered', fetch: (r) => handleJobs(r) },
      { path: JOBS_CANCEL_ROUTE, methods: ['POST'], requestBody: 'buffered', fetch: (r) => handleCancelJob(r) },
      { path: HARVEST_ROUTE, methods: ['GET', 'POST'], requestBody: 'buffered', fetch: (r) => handleHarvest(r) },
      { path: CANDIDATES_ROUTE, methods: ['GET'], requestBody: 'buffered', fetch: (r) => handleCandidates(r) },
      { path: PROMOTE_ROUTE, methods: ['POST'], requestBody: 'buffered', fetch: (r) => handlePromote(r) },
      { path: SCHEDULE_ROUTE, methods: ['GET', 'POST'], requestBody: 'buffered', fetch: (r) => handleSchedule(r) },
      { path: EMAIL_ROUTE, methods: ['POST'], requestBody: 'buffered', fetch: (r) => handleEmail(r) },
      { path: NEED_ROUTE, methods: ['GET'], requestBody: 'buffered', fetch: (r) => handleNeedDownload(r) },
      { path: DOWNLOAD_ROUTE, methods: ['POST'], requestBody: 'buffered', fetch: (r) => handleDownload(r) },
      { path: ADD_ROUTE, methods: ['POST'], requestBody: 'buffered', fetch: (r) => handleAdd(r) },
      { path: ANALYZE_ROUTE, methods: ['POST'], requestBody: 'buffered', fetch: (r) => handleAnalyze(r) },
      { path: UPLOAD_ROUTE, methods: ['POST'], requestBody: 'buffered', fetch: (r) => handleUpload(r) },
      { path: PDF_ROUTE, methods: ['GET'], requestBody: 'buffered', fetch: (r) => handlePdf(r) },
      { path: FIGURE_ROUTE, methods: ['GET'], requestBody: 'buffered', fetch: (r) => handleFigure(r) },
      { path: OPEN_PDF_ROUTE, methods: ['POST'], requestBody: 'buffered', fetch: (r) => handleOpenPdf(r) },
      { path: OPEN_URL_ROUTE, methods: ['POST'], requestBody: 'buffered', fetch: (r) => handleOpenUrl(r) },
      { path: ZOTERO_IMPORT_ROUTE, methods: ['POST'], requestBody: 'buffered', fetch: (r) => handleZoteroImport(r) },
      { path: REFETCH_ROUTE, methods: ['POST'], requestBody: 'buffered', fetch: (r) => handleRefetch(r) },
      { path: LLM_MODELS_ROUTE, methods: ['GET'], requestBody: 'buffered', fetch: (r) => handleLlmModels(r) },
      { path: DIGEST_ROUTE, methods: ['GET'], requestBody: 'buffered', fetch: (r) => handleDigest(r) },
      { path: SNOOZE_ROUTE, methods: ['POST'], requestBody: 'buffered', fetch: (r) => handleSnooze(r) },
      { path: PRIORITY_ROUTE, methods: ['POST'], requestBody: 'buffered', fetch: (r) => handlePriority(r) },
      { path: CANDIDATE_ACTION_ROUTE, methods: ['POST'], requestBody: 'buffered', fetch: (r) => handleCandidateAction(r) },
      { path: CANDIDATES_RESCORE_ROUTE, methods: ['POST'], requestBody: 'buffered', fetch: (r) => handleRescoreCandidates(r) },
      { path: PAPER_OVERRIDE_ROUTE, methods: ['POST'], requestBody: 'buffered', fetch: (r) => handlePaperOverride(r) },
      { path: PAPER_READ_ROUTE, methods: ['POST'], requestBody: 'buffered', fetch: (r) => handlePaperRead(r) },
      { path: PAPER_STAGE_ROUTE, methods: ['POST'], requestBody: 'buffered', fetch: (r) => handlePaperStage(r) },
      { path: PAPER_RERUN_ROUTE, methods: ['POST'], requestBody: 'buffered', fetch: (r) => handlePaperRerun(r) },
      { path: TEXT_TRANSLATE_ROUTE, methods: ['POST'], requestBody: 'buffered', fetch: (r) => handleTextTranslate(r) },
      { path: ANALYSIS_STATS_ROUTE, methods: ['GET'], requestBody: 'buffered', fetch: (r) => handleAnalysisStats(r) },
      { path: ANALYSIS_PROMPTS_ROUTE, methods: ['GET'], requestBody: 'buffered', fetch: (r) => handleAnalysisPrompts(r) },
    ];
    for (const route of routes) {
      try {
        register(route);
      } catch (error) {
        console.error(`[literature-lab] 注册路由失败 ${route.path}：`, error);
      }
    }
  });

  const tools = createTools({ baseDir: BASE_DIR, ctx: serviceCtx });

  // 保留 disposer：Creator mode 热重载时先注销旧工具，避免重名注册失败
  const disposers = [];
  for (const tool of tools) {
    try {
      const off = ctx.tools.register(tool);
      if (typeof off === 'function') disposers.push(off);
    } catch (error) {
      console.error(`[literature-lab] 注册工具失败 ${tool.name}：`, error);
    }
  }
  if (typeof ctx.effect === 'function') {
    ctx.effect(() => () => {
      for (const off of disposers) {
        try { off(); } catch { /* 已注销 */ }
      }
    });
  }
}
