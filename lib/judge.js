/**
 * L1 判断层：三问（同域性 / 增量 / 用途）的枚举与校验。
 *
 * 设计原则：
 * - 判断结果是事实，写进 state；这里只回答「这个词能不能用」「这个组合合不合法」
 * - grade_basis 只记录这次评级依据的是什么证据，不构成「状态」，也不影响等级本身
 * - 增量不接受空话：「更准」「better」「state of the art」这类没有信息量的说法直接拒绝
 * - 等级与同域性必须自洽：无关论文不可能给 S，方法可迁移也撑不起 S
 */

export const DOMAINS = ['core', 'edge', 'transferable', 'irrelevant'];
export const USES = ['method', 'baseline', 'citation', 'landscape'];
export const BASES = ['abstract', 'triage', 'fulltext'];

export const DOMAIN_LABEL = {
  core: '同域核心',
  edge: '同域边缘',
  transferable: '方法可迁移',
  irrelevant: '无关',
};

export const USE_LABEL = {
  method: '改进方法',
  baseline: '当对比基线',
  citation: '写作引用',
  landscape: '了解现状',
};

/** 增量至少要写这么多个字符（去空白后），否则等于没说。 */
export const MIN_INCREMENT = 6;

/** 没有信息量的说法：单独出现或只由它们拼成的句子一律拒绝。 */
const VACUOUS = [
  '更准', '更准确', '更好', '更优', '更快', '更强', '更先进', '更新颖', '更全面',
  '更有创新', '有创新', '有创新性', '新颖', '重要', '有一定价值', '值得一读', '还不错',
  '新方法', '新框架', '新思路', 'novel', 'novelty', 'better', 'improved', 'improvement',
  'more accurate', 'more efficient', 'faster', 'stronger', 'state of the art', 'sota',
  'interesting', 'significant', 'new method', 'new framework',
];

/** 与空话一起出现时不算信息量的连接词 / 旧说法。 */
const FILLERS = [
  '现有方法', '已有方法', '传统方法', '之前的方法', '相比现有方法', '比现有方法',
  'previous work', 'existing method', 'existing methods', 'current methods', 'baseline method',
  'the', 'a', 'an', 'of', 'and', 'is', 'are', 'in', 'on', 'with', 'to', 'for', 'by', 'than', 'more',
];

function squash(text) {
  return String(text ?? '')
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]+/gu, '');
}

/** 去掉所有空话与填充词后还剩多少「实义」字符。 */
function residue(text) {
  let s = squash(text);
  for (const term of [...VACUOUS, ...FILLERS]) {
    const t = squash(term);
    if (t) s = s.split(t).join('');
  }
  return s;
}

/** 是否只是空话（「更准」「state of the art」以及它们的排列组合）。 */
export function isVacuous(text) {
  const raw = squash(text);
  if (!raw) return true;
  return residue(text).length < 2;
}

/** 校验 basis，省略时按「仅摘要」记录。 */
export function resolveBasis(basis) {
  if (basis === undefined || basis === null || basis === '') return { ok: true, basis: 'abstract' };
  if (!BASES.includes(basis)) {
    return { ok: false, error: `basis 只能是 ${BASES.join(' / ')}；省略时按 abstract 处理` };
  }
  return { ok: true, basis };
}

/**
 * 校验三问。返回 { ok:true, value } 或 { ok:false, error }。
 * value 里只有四个允许的字段，其余一律丢掉，避免把 agent 的临时想法写进状态。
 */
export function validateL1(l1) {
  if (!l1 || typeof l1 !== 'object' || Array.isArray(l1)) {
    return { ok: false, error: 'l1 必须是一个对象：{ domain, increment, use, note? }' };
  }
  if (!DOMAINS.includes(l1.domain)) {
    return { ok: false, error: `domain 必须是 ${DOMAINS.join(' / ')} 之一（core=同域核心，edge=同域边缘，transferable=方法可迁移，irrelevant=无关）` };
  }
  if (!USES.includes(l1.use)) {
    return { ok: false, error: `use 必须是 ${USES.join(' / ')} 之一（method=改进方法，baseline=当对比基线，citation=写作引用，landscape=了解现状）` };
  }
  if (typeof l1.increment !== 'string') {
    return { ok: false, error: 'increment 必须是字符串：相对最近文献具体多了什么' };
  }
  const increment = l1.increment.trim();
  if (!increment) return { ok: false, error: 'increment 不能为空：要写清相对最近文献具体多了什么' };
  // 空话先于长度判断，避免「更准」只被当成「太短」而没说清问题
  if (isVacuous(increment)) {
    return { ok: false, error: `increment 只是空话（如「更准」「better」「state of the art」），请写具体：多了什么能力、在什么条件下、相对谁` };
  }
  if (increment.length < MIN_INCREMENT) {
    return { ok: false, error: `increment 太短（去空白后至少 ${MIN_INCREMENT} 个字符），要写清相对最近文献具体多了什么` };
  }
  if (l1.note !== undefined && l1.note !== null && typeof l1.note !== 'string') {
    return { ok: false, error: 'note 必须是字符串' };
  }
  return {
    ok: true,
    value: {
      domain: l1.domain,
      increment,
      use: l1.use,
      note: typeof l1.note === 'string' ? l1.note.trim() : '',
    },
  };
}

/** 每个等级允许的同域性；「无关只能 D」「S 只能核心」「A 不能可迁移」都由这张表覆盖。 */
const ALLOWED_DOMAINS = {
  S: ['core'],
  A: ['core', 'edge'],
  B: ['core', 'edge', 'transferable'],
  C: DOMAINS,
  D: DOMAINS,
};

/** 等级与同域性是否自洽。 */
export function checkGradeDomain(grade, domain) {
  const allowed = ALLOWED_DOMAINS[grade];
  if (!allowed) return { ok: false, error: `未知等级：${grade}` };
  if (!DOMAINS.includes(domain)) return { ok: false, error: `未知同域性：${domain}` };
  if (allowed.includes(domain)) return { ok: true };
  const cn = allowed.map((d) => DOMAIN_LABEL[d]).join(' 或 ');
  return {
    ok: false,
    error: `等级 ${grade} 不能用于「${DOMAIN_LABEL[domain]}」：${grade} 只允许 ${cn}。无关论文只能是 D；S 只给同域核心；A 只给同域核心或同域边缘。`,
  };
}

/**
 * 等级与「引用核验状态」是否自洽。
 *
 * 只做一件事：不让未经核实的条目拿走 S/A/B。核验缺失时放行（老数据、离线场景），
 * 但 fabricated（DOI 指向另一篇）一律拒绝，并提示先补正或丢弃。
 */
export function checkVerification(grade, verification) {
  const status = typeof verification === 'string' ? verification : verification?.status;
  if (!status) return { ok: true, warning: 'unverified' };
  if (status === 'fabricated') {
    return {
      ok: false,
      error: `核验显示 ${verification?.reason || 'DOI 指向另一篇论文'}：这条引文不可信，先补正标识符或直接丢弃，不能定级`,
    };
  }
  // unindexed 只是「没核到」，不构成反证：放行但标注未核验
  if (status === 'unindexed') return { ok: true, warning: 'unverified' };
  if (['S', 'A'].includes(grade)) {
    const label = { 'title-ok': '题名可对上但缺正式 DOI 记录' }[status] || status;
    return { ok: false, error: `核验状态「${label}」不足以支持 ${grade} 级：S/A 需要 Crossref/DataCite/arXiv 有记录，这类最多给 B` };
  }
  return { ok: true, warning: null };
}

