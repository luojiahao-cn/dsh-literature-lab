/**
 * 摘要补齐：快讯邮件只带片段，一手来源（arXiv / OpenAlex / Crossref）才有全文摘要。
 * 只有新摘要更长时才替换，避免用短摘要覆盖已有的完整版。
 */
export function fullerAbstract(current, meta) {
  const next = String(meta?.abstract || '').trim();
  if (!next) return null;
  const now = String(current || '').trim();
  return next.length > now.length ? next : null;
}

/**
 * 从 PDF 正文里抽摘要：全文已拿到却显示「未获取摘要」时兜底。
 * 常见版式是单独一行 Abstract，后接正文，直到 Introduction/Main/Keywords。
 */
export function abstractFromText(text) {
  const src = String(text || '').replace(/\r/g, '').replace(/\[Page \d+\]/g, ' ');
  const tidy = (s) => String(s || '')
    .replace(/\s+/g, ' ')
    .replace(/^(?:abstract|summary)\s*[:.—-]?\s*/i, '')
    .trim();
  const patterns = [
    /(?:^|\n)\s*(?:Abstract|ABSTRACT|Summary)\s*[:.—-]?\s*\n?([\s\S]{200,6000}?)(?=\n\s*(?:1\.?\s*)?(?:Introduction|Background|Keywords|Key words|Main|Methods|Results)\b)/i,
    /(?:^|\n)\s*(?:Abstract|ABSTRACT)\s*[:.—-]\s*([\s\S]{200,6000})/i,
  ];
  for (const re of patterns) {
    const match = src.match(re);
    const value = tidy(match?.[1]);
    if (value && value.length >= 120) return value.slice(0, 2000);
  }
  return null;
}
