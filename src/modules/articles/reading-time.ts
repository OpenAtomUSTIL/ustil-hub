/** 估算正文阅读时间：中文 300 字/分钟、其他语言 200 词/分钟，至少 1 分钟。 */
export function estimateReadingMinutes(markdown: string): number {
  // 只提取文字，不解析或执行 HTML。排除标签属性与不显示的 script/style 内容。
  const parts: string[] = [];
  const tags = /<[^<>]*>/g;
  let cursor = 0;
  let ignoredTag = '';
  for (const match of markdown.matchAll(tags)) {
    if (!ignoredTag) parts.push(markdown.slice(cursor, match.index));
    const opening = /^<\s*(script|style)\b/i.exec(match[0]);
    const closing = /^<\s*\/\s*(script|style)\s*>/i.exec(match[0]);
    if (ignoredTag && closing?.[1].toLowerCase() === ignoredTag) ignoredTag = '';
    else if (!ignoredTag && opening) ignoredTag = opening[1].toLowerCase();
    cursor = match.index + match[0].length;
  }
  if (!ignoredTag) parts.push(markdown.slice(cursor));
  const text = parts.join(' ')
    .replace(/^ {0,3}(?:`{3,}|~{3,})[^\n]*$/gm, ' ')
    .replace(/^ {0,3}\[[^\[\]\n]+\]:[^\n]*$/gm, ' ')
    .replace(/!\[[^\[\]\n]*\]\([^()\n]*\)/g, ' ')
    .replace(/!\[[^\[\]\n]*\](?:\[[^\[\]\n]*\])?/g, ' ')
    .replace(/\[([^\[\]\n]*)\]\([^()\n]*\)/g, '$1')
    .replace(/https?:\/\/[^\s<>]+/gi, ' ')
    .replace(/&(?:#[0-9]+|#x[0-9a-f]+|[a-z]+);/gi, ' ');
  const chineseCharacters = text.match(/\p{Script=Han}/gu)?.length ?? 0;
  const words = text.replace(/\p{Script=Han}/gu, ' ')
    .match(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu)?.length ?? 0;
  return Math.max(1, Math.ceil(chineseCharacters / 300 + words / 200));
}
