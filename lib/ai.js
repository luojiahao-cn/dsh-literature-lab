/**
 * 用 LLM 从 Zotero 档案里提炼关注关键词。
 *
 * 输入是 lib/zotero.js 的 profile（标签、词频、分类、样本），不是原始库；
 * 输出严格限定为三组关键词 + 一句依据，供 UI 填入草稿，用户确认后再保存。
 */
import { scorePaper } from './config.js';

const SYSTEM_PROMPT = `你是文献检索助手。根据用户 Zotero 库的统计，为其挑选用于每日文献发现的关键词。
只输出 JSON，不要解释，不要 Markdown 代码块。
JSON 结构：
{"keywords":["..."],"contextKeywords":["..."],"excludeKeywords":["..."],"reason":"中文说明依据"}
规则：
- 目标是「不要漏」：keywords 给 16-24 条，覆盖库里出现过的所有主要主题，宁可多给。
  每条是具体短语或正则（如 "graph neural network"），但不要只给同义词——
  领域级词（graph neural network、protein structure、climate model）也要给，
  只有单独一个泛词（model、method、system）不要。
- contextKeywords 给 20-30 条，放辅助词、方法词、材料词（如 calibration、ablation、benchmark、state estimation|kalman、synthetic data、uncertainty）。
- excludeKeywords 0-8 条，只放明显的非研究内容（erratum、retraction、editorial、corrigendum）。
  不要排除 review、survey、tutorial 这类文献类型——用户库里可能有评过 A/B 的综述。
- 全部小写；每条都要能作为正则编译；不要重复。
- 中文文献也要能命中：核心词与辅助词在给出英文短语的同时，补一条对应的中文正则
  （例："graph neural network" 配 "图神经网络"；"protein structure" 配 "蛋白质结构"）。
  中文正则不要加 \\b，直接用子串；没有合适中文写法的纯英文术语可以不补。
  英中两种写法各占一条，条数上限已经按成对给出放宽。
- 自检：假如库里一篇 A/B 论文只用了某主题词，它应该能被这组词打中；打不中就再补。
- reason 用中文，写清依据（哪些标签、bigram 或分类支撑这组词）。`;

export function buildPrompt(profile, coverage = null) {
  const lib = profile?.library || {};
  const list = (items, pick) => (items || []).map(pick).join('; ');
  const tags = list((profile?.topTags || []).slice(0, 20), (t) => `${t.tag} (${t.count})`);
  const unigrams = list((profile?.terms?.unigrams || []).slice(0, 48), (t) => `${t.term} (${t.df})`);
  const bigrams = list((profile?.terms?.bigrams || []).slice(0, 48), (t) => `${t.term} (${t.df})`);
  const collections = list(
    (profile?.collections || []).filter((c) => c.count > 0).slice(0, 15),
    (c) => `${c.name}:${c.count}`,
  );
  const samples = (profile?.sample || []).slice(0, 24)
    .map((s, i) => `${i + 1}. ${s.title}${s.abstract ? ` — ${String(s.abstract).slice(0, 320)}` : ''}`)
    .join('\n');
  return [
    `库规模：${lib.total ?? '?'} items（标题级 ${lib.cached ?? '?'}）`,
    `高频标签：${tags || '无'}`,
    `高频词：${unigrams || '无'}`,
    `高频二元组：${bigrams || '无'}`,
    `主要分类：${collections || '无'}`,
    `样本：\n${samples || '无'}`,
    coverage && Array.isArray(coverage.uncovered) && coverage.uncovered.length
      ? [
        '',
        `上一轮的词漏掉了这些库内论文（它们在你库里评过 A 或 B，按上一轮关键词打 0 分）：`,
        ...coverage.uncovered.slice(0, 20).map((title, i) => `${i + 1}. ${title}`),
        `请补充能覆盖这些主题的核心/辅助词（英文短语 + 中文写法各一条），已有能命中的词不要重复；只输出 JSON。`,
      ].join('\n')
      : null,
  ].filter(Boolean).join('\n');
}

/** 解析并清洗模型输出：只保留可编译的正则、去重、限长。 */
export function normalizeSuggestion(raw) {
  const text = String(raw || '').trim();
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('AI 没有返回 JSON');
  let parsed;
  try {
    parsed = JSON.parse(text.slice(start, end + 1));
  } catch {
    throw new Error('AI 返回的 JSON 无法解析');
  }
  const clean = (value, max) => {
    const out = [];
    for (const item of Array.isArray(value) ? value : []) {
      const term = String(item || '').trim().toLowerCase();
      if (!term || out.includes(term)) continue;
      try { new RegExp(term, 'i'); } catch { continue; }
      out.push(term);
      if (out.length >= max) break;
    }
    return out;
  };
  const suggestion = {
    keywords: clean(parsed.keywords, 24),
    contextKeywords: clean(parsed.contextKeywords, 30),
    excludeKeywords: clean(parsed.excludeKeywords, 8),
    reason: String(parsed.reason || '').trim() || '（AI 未写依据）',
  };
  if (suggestion.keywords.length < 3) throw new Error('AI 给出的核心关键词太少，请重试');
  return suggestion;
}

/**
 * 调一次模型并返回清洗后的关键词建议。
 * @param {{llm:object, provider:string, model:string, profile:object, signal?:AbortSignal}} options
 */
export async function suggestKeywords({ llm, provider, model, profile, coverage = null, signal, maxTokens = 6000 }) {
  if (!llm || typeof llm.stream !== 'function') throw new Error('LLM 服务不可用');

  const streamOnce = async (budget) => {
    const stream = llm.stream({
      provider,
      model,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: [{ type: 'text', text: buildPrompt(profile, coverage) }] }],
      temperature: 0.2,
      maxTokens: budget,
      signal,
    });
    let text = '';
    let finishKind = 'unknown';
    for await (const chunk of stream) {
      if (chunk?.type === 'text-delta') text += chunk.text || '';
      if (chunk?.type === 'finish') {
        finishKind = chunk.reason?.kind || 'unknown';
        if (chunk.reason?.kind === 'error') throw new Error(chunk.reason.failure?.message || '模型调用失败');
        if (chunk.reason?.kind === 'aborted') throw new Error('模型调用已取消');
      }
    }
    return { text, finishKind };
  };

  let { text, finishKind } = await streamOnce(maxTokens);
  // 推理型模型会把额度花在思考上，最后正文 0 字、finish=max-tokens。
  // 这种情况自动加倍重试一次，比直接报错更有用。
  if (!text.trim() && finishKind === 'max-tokens') {
    ({ text, finishKind } = await streamOnce(maxTokens * 2));
  }
  try {
    return normalizeSuggestion(text);
  } catch (error) {
    const head = text ? `，开头：${text.slice(0, 200)}` : '';
    const hint = !text.trim() && finishKind === 'max-tokens'
      ? '；模型把输出额度用在思考上了，换一个非推理模型，或调高分析额度'
      : '';
    throw new Error(`${error.message}（输出 ${text.length} 字，finish=${finishKind}${head}）${hint}`);
  }
}

/** 给一组 Zotero 条目算 T0 分数（题名 + 摘要 + 作者 + 期刊）。 */
export function scoreLibraryItems(items, relevance) {
  return (Array.isArray(items) ? items : []).map((item) => ({
    title: String(item?.title || ''),
    score: scorePaper({
      title: item?.title,
      summary: item?.abstract,
      authors: Array.isArray(item?.authors) ? item.authors : [],
      venue: item?.venue,
    }, { relevance }).score,
  }));
}

/**
 * 用 Zotero 库校准最低入队分数：关键词是从库里学出来的，
 * 库里的论文（尤其评过 A/B 的）本身就应该能被这组词打到及格线。
 *
 * 返回「能覆盖 target 比例库内论文的最低阈值」；覆盖不够时同时给出
 * 打 0 分的题名，交给下一步补词。
 *
 * @param {Array} items Zotero 条目
 * @param {object} relevance { keywords, contextKeywords, excludeKeywords, ... }
 * @param {{target?:number, maxScore?:number}} options
 */
export function calibrateThreshold(items, relevance, { target = 0.85, maxScore = 6 } = {}) {
  const scored = scoreLibraryItems(items, relevance);
  const excluded = (Array.isArray(items) ? items : []).filter((item) => scorePaper({
    title: item?.title,
    summary: item?.abstract,
    authors: Array.isArray(item?.authors) ? item.authors : [],
    venue: item?.venue,
  }, { relevance }).excluded).length;
  if (!scored.length) return null;
  const total = scored.length;
  const table = {};
  for (let t = 0; t <= maxScore; t += 1) {
    table[t] = scored.filter((row) => row.score >= t).length / total;
  }
  // 满足目标覆盖率的最大阈值（再高就开始掉太多库内论文）
  let coverageFloor = 1;
  for (let t = 1; t <= maxScore; t += 1) {
    if (table[t] >= target) coverageFloor = t;
    else break;
  }
  // 推荐阈值加下限 3：阈值 1 等于「任何弱命中都入队」，会把噪音放进来。
  // 覆盖率最终按推荐阈值报告，不按 coverageFloor 报告。
  const recommended = Math.max(3, coverageFloor);
  const uncovered = scored.filter((row) => row.score < recommended).map((row) => row.title).slice(0, 24);
  return {
    minScore: recommended,
    coverageFloor,
    items: total,
    coverage: table[recommended] || 0,
    zeroRate: table[1] == null ? 0 : 1 - table[1],
    excluded,
    excludedRate: total ? excluded / total : 0,
    meetsTarget: (table[recommended] || 0) >= target,
    target,
    table,
    uncovered,
  };
}
