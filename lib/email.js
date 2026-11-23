/**
 * 邮件提醒段（Google 学术快讯）：插件用 ctx.tools.execute 直接调 dsh-email 的只读工具，
 * 不创建 agent、不写会话；解析交给 host 的 llm 服务，最后走 ingest 入队。
 *
 * 邮件是「候选来源」：解析出的条目先进候选池（T0），不直接进 papers。
 * 只读：email_list/search/read；不发信、不改已读。
 */
import * as store from './store.js';
import { newRunId } from './runs.js';
import { readConfig } from './config.js';
import { absorbCandidates } from './candidates.js';
import { updateState, today } from './state.js';
import { lookup } from './metadata.js';
import { fullerAbstract } from './abstracts.js';

const MAX_EMAILS_PER_RUN = 50;
const EMAIL_TOOL_TIMEOUT_MS = 120000;
const MAX_EMAIL_FAILURES = 3;

function emailFile(baseDir) {
  return store.statePaths(baseDir).email;
}

async function readEmailState(baseDir) {
  return store.readJson(emailFile(baseDir), { processed: {}, failed: {}, last_run_at: null });
}

async function patchEmailState(baseDir, patch) {
  return store.updateJson('email', emailFile(baseDir), { processed: {}, failed: {}, last_run_at: null }, (db) => {
    const next = { ...db, ...patch };
    // processed / failed 只把本次新增的 UID 合并进来，不能拿开始时快照整表覆盖，
    // 否则定时与手动并发时后写者会丢掉先写者的 UID。
    next.processed = { ...(db.processed || {}), ...(patch.processed || {}) };
    const failed = { ...(db.failed || {}) };
    for (const [uid, value] of Object.entries(patch.failed || {})) {
      if (value === null) delete failed[uid];
      else failed[uid] = value;
    }
    next.failed = failed;
    const entries = Object.entries(next.processed || {});
    if (entries.length > 2000) {
      entries.sort((a, b) => String(b[1] || '').localeCompare(String(a[1] || '')));
      next.processed = Object.fromEntries(entries.slice(0, 2000));
    }
    return next;
  });
}

function textOf(result) {
  return (result?.content || [])
    .filter((block) => block?.type === 'text')
    .map((block) => block.text || '')
    .join('\n');
}

/** 调一个 dsh-email 只读工具；返回内层 result。 */
async function callEmailTool(ctx, name, args) {
  const tools = ctx?.get?.('tools');
  if (!tools || typeof tools.execute !== 'function') throw new Error('tools 服务不可用');
  const response = await tools.execute({
    calls: [{
      type: 'tool-call',
      id: `email-${name}-${Date.now().toString(36)}`,
      name,
      arguments: JSON.stringify(args || {}),
    }],
    signal: new AbortController().signal,
  });
  const inner = response?.results?.[0]?.result;
  if (!inner) throw new Error(`${name} 没有返回结果`);
  if (inner.isError) throw new Error(`${name} 失败：${textOf(inner).slice(0, 300)}`);
  return inner;
}

/** 邮件工具加超时：底层 socket 可能卡很久，超时后本轮要落账，不能一直挂着。 */
async function callEmailToolTimed(ctx, name, args) {
  let timer;
  try {
    return await Promise.race([
      callEmailTool(ctx, name, args),
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`${name} 超时（${Math.round(EMAIL_TOOL_TIMEOUT_MS / 1000)} 秒）`)),
          EMAIL_TOOL_TIMEOUT_MS,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function resolveModel(ctx, config) {
  const llm = ctx?.get?.('llm');
  if (!llm) throw new Error('LLM 服务不可用');
  const ai = config?.sources?.mail?.ai || config?.corpus?.ai || {};
  let provider = String(ai.provider || '').trim();
  let model = String(ai.model || '').trim();
  if (!provider) {
    const providers = await llm.listProviders();
    const picked = providers.find((p) => /deepseek/i.test(p.id)) || providers[0];
    if (!picked) throw new Error('没有可用的 LLM provider');
    provider = picked.id;
  }
  if (!model) {
    const models = await llm.listModels(provider);
    const picked = models.find((m) => /chat|flash|pro/i.test(m.id)) || models[0];
    if (!picked) throw new Error(`provider ${provider} 没有可用模型`);
    model = picked.id;
  }
  return { llm, provider, model };
}

const PARSE_PROMPT = `你是文献邮件解析器。用户会把一封 Google 学术快讯邮件的内容交给你。
只输出 JSON 数组，不要解释，不要 Markdown 代码块。
每项格式：{"title":"论文标题","authors":["作者"],"venue":"期刊或会议","year":"2024","url":"链接","doi":"DOI 或 null","arxivId":"arXiv id 或 null","summary":"摘要原文（照抄邮件里的内容，不要概括或省略；只有片段就照抄片段）或 null"}
摘要字段只做照抄：不要改写、不要总结、不要补全，长度可到 2000 字。
只提取真正的论文条目；没有论文就输出 []。不要编造标题、链接或 DOI。`;

/** 从邮件正文里用模型抽取论文条目。 */
export async function parseAlertEmail(ctx, config, body) {
  const { llm, provider, model } = await resolveModel(ctx, config);
  const stream = llm.stream({
    provider,
    model,
    system: PARSE_PROMPT,
    messages: [{ role: 'user', content: [{ type: 'text', text: String(body || '').slice(0, 12000) }] }],
    temperature: 0,
    maxTokens: 1600,
  });
  let text = '';
  for await (const chunk of stream) {
    if (chunk?.type === 'text-delta') text += chunk.text || '';
    if (chunk?.type === 'finish' && chunk.reason?.kind === 'error') {
      throw new Error(chunk.reason.failure?.message || '模型调用失败');
    }
  }
  const start = text.indexOf('[');
  const end = text.lastIndexOf(']');
  if (start < 0 || end <= start) throw new Error('模型没有返回 JSON 数组');
  let rows;
  try {
    rows = JSON.parse(text.slice(start, end + 1));
  } catch {
    throw new Error('模型返回的 JSON 无法解析');
  }
  return (Array.isArray(rows) ? rows : [])
    .map((row) => ({
      title: String(row?.title || '').trim(),
      authors: Array.isArray(row?.authors) ? row.authors.map(String).filter(Boolean) : [],
      venue: row?.venue ? String(row.venue) : null,
      year: row?.year ? String(row.year).slice(0, 4) : null,
      url: row?.url ? String(row.url) : null,
      doi: row?.doi ? String(row.doi) : null,
      arxivId: row?.arxivId ? String(row.arxivId) : null,
      summary: row?.summary ? String(row.summary).slice(0, 4000) : null,
      publishedAt: row?.year ? `${String(row.year).slice(0, 4)}-01-01` : null,
    }))
    .filter((row) => row.title);
}

/** 快讯条目补一手摘要：有 DOI/arXiv 时并行查，取到更长的就替换；取不到保留片段并标注。 */
export async function enrichSummaries(rows, lookupFn = lookup) {
  const out = new Array(rows.length);
  let cursor = 0;
  const worker = async () => {
    while (cursor < rows.length) {
      const index = cursor;
      cursor += 1;
      const row = rows[index];
      const summary = String(row.summary || '').trim();
      let next = row;
      if (row.doi || row.arxivId) {
        try {
          const meta = await lookupFn({ doi: row.doi, arxivId: row.arxivId, title: row.title });
          const better = fullerAbstract(summary, meta);
          if (better) next = { ...row, summary: better.slice(0, 4000), abstractSource: 'canonical' };
          else if (summary) next = { ...row, abstractSource: 'snippet' };
        } catch {
          if (summary) next = { ...row, abstractSource: 'snippet' };
        }
      } else if (summary) {
        next = { ...row, abstractSource: 'snippet' };
      }
      out[index] = next;
    }
  };
  await Promise.all(Array.from({ length: Math.min(4, rows.length) }, worker));
  return out;
}

/**
 * 跑一轮邮件提醒。返回解析/入队统计。
 */
export async function runEmail(ctx, baseDir, { limit, enrich = true } = {}) {
  const config = await readConfig(baseDir);
  const mail = config?.sources?.mail || {};
  if (mail.enabled !== true) {
    return { ok: true, skipped: 'mail-disabled', emails: 0, parsed: 0, added: 0 };
  }
  const account = mail.account ? String(mail.account) : undefined;
  const senders = Array.isArray(mail.senders) && mail.senders.length
    ? mail.senders
    : ['scholaralerts-noreply@google.com'];
  const maxEmails = Math.min(
    MAX_EMAILS_PER_RUN,
    Math.max(1, Number(limit) || Number(mail.maxBodiesPerRun) || 3),
  );

  const state = await readEmailState(baseDir);
  const processed = state.processed || {};
  const knownFailures = state.failed || {};
  const newlyProcessed = {};
  const failurePatch = {};
  const stats = {
    emails: 0, parsed: 0, scanned: 0, added: 0, merged: 0, filtered: 0, excluded: 0, owned: 0,
    skippedKnown: 0, skippedFailed: 0, errors: [],
  };

  for (const sender of senders) {
    if (stats.emails >= maxEmails) break;
    let messages = [];
    try {
      const result = await callEmailToolTimed(ctx, 'email_search', {
        query: sender,
        limit: maxEmails,
        account,
      });
      messages = result.value?.messages || result.value?.items || [];
    } catch (error) {
      stats.errors.push(`search ${sender}: ${error.message}`);
      continue;
    }
    for (const message of messages) {
      if (stats.emails >= maxEmails) break;
      const uid = message?.uid;
      if (uid === undefined || uid === null) continue;
      const uidKey = String(uid);
      if (processed[uidKey]) continue;
      if (Number(knownFailures[uidKey]?.attempts) >= MAX_EMAIL_FAILURES) {
        stats.skippedFailed += 1;
        continue;
      }
      try {
        const read = await callEmailToolTimed(ctx, 'email_read', { uid, account });
        const body = textOf(read) || JSON.stringify(read.value || {}).slice(0, 12000);
        const parsed = await parseAlertEmail(ctx, config, body);
        const items = enrich ? await enrichSummaries(parsed) : parsed;
        stats.emails += 1;
        stats.parsed += items.length;
        if (items.length) {
          const absorbed = await absorbCandidates(baseDir, config, items, { source: 'scholar-alert' });
          stats.scanned += absorbed.scanned || 0;
          stats.added += absorbed.added;
          stats.merged += absorbed.merged;
          stats.filtered += absorbed.filtered;
          stats.excluded += absorbed.excluded;
          stats.owned += absorbed.owned;
          stats.skippedKnown += absorbed.known || 0;
        }
        processed[uidKey] = new Date().toISOString();
        newlyProcessed[uidKey] = processed[uidKey];
        if (knownFailures[uidKey]) failurePatch[uidKey] = null;
        if (mail.markRead === true) {
          try {
            await callEmailToolTimed(ctx, 'email_mark', { uid, action: 'read', account });
          } catch (error) {
            stats.errors.push(`mark ${uid}: ${error.message}`);
          }
        }
      } catch (error) {
        const previous = knownFailures[uidKey];
        const attempts = (Number(previous?.attempts) || 0) + 1;
        failurePatch[uidKey] = {
          at: new Date().toISOString(),
          attempts,
          error: String(error?.message || error).slice(0, 300),
        };
        stats.errors.push(`read ${uid}: ${error.message}`);
      }
    }
  }

  await patchEmailState(baseDir, {
    processed: newlyProcessed,
    failed: failurePatch,
    last_run_at: new Date().toISOString(),
    last_result: { ...stats, errors: stats.errors.slice(0, 5) },
  });

  // 采集记账：邮件也是渠道，跑完要写 sources.email 与一条 runs（字段与 discover.js 一致），
  // UI 的渠道健康与「最近发生」直接读这里；失败也必须落账，不能永远显示绿色。
  const at = new Date().toISOString();
  const failed = stats.emails === 0 && stats.errors.length > 0;
  await updateState(baseDir, (latest) => {
    if (!latest.sources || typeof latest.sources !== 'object') latest.sources = {};
    latest.sources.email = {
      last_ok_at: null,
      last_error: null,
      last_count: null,
      consecutive_failures: 0,
      ...(latest.sources.email || {}),
    };
    const status = latest.sources.email;
    if (failed) {
      status.last_error = stats.errors.join('; ').slice(0, 300);
      status.last_failed_at = at;
      status.consecutive_failures = (status.consecutive_failures || 0) + 1;
    } else {
      status.last_ok_at = at;
      status.last_error = null;
      status.last_count = stats.parsed;
      status.consecutive_failures = 0;
      latest.last_success_at = at;
    }
    const run = {
      id: newRunId('email'),
      date: today(),
      kind: 'email',
      at,
      scanned: stats.scanned,
      added: stats.added,
      merged: stats.merged,
      filtered: stats.filtered,
      excluded: stats.excluded,
      owned: stats.owned,
      skippedKnown: stats.skippedKnown,
      sources: [{ key: 'email', label: '邮件快讯', ok: stats.emails > 0, count: stats.scanned }],
      emails: stats.emails,
      parsed: stats.parsed,
      errors: stats.errors.slice(0, 5),
    };
    latest.runs = [run, ...(latest.runs || [])].slice(0, 30);
  });

  return { ok: true, ...stats, errors: stats.errors.slice(0, 5) };
}
