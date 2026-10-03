/** Shared browser/server text-only article link parser. No HTML execution. */
function safeArticleLink(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname && !url.username && !url.password
      ? url.toString() : null;
  } catch { return null; }
}
function trimBareLink(value) {
  let result = value.replace(/[.,;:!?]+$/, '');
  for (const [open, close] of [['(', ')'], ['[', ']'], ['{', '}']]) {
    while (result.endsWith(close) && result.split(close).length > result.split(open).length) {
      result = result.slice(0, -1);
    }
  }
  return result.replace(/[.,;:!?]+$/, '');
}
function articleInlineLinks(text, sources = []) {
  const names = new Map();
  for (const source of sources) {
    const url = safeArticleLink(source.url);
    const title = source.title?.trim();
    if (url && title && !/^(?:https?:\/\/|www\.)/i.test(title)) names.set(url, title);
  }
  const pattern = /`[^`\n]*`|!?\[([^\]\n]+)\]\(\s*(<?[^()\s<>]+(?:\([^()\s]*\)[^()\s]*)*>?)(?:\s+["'][^"'\n]*["'])?\s*\)|<(https:\/\/[^<>\s]+)>|https:\/\/[^\s<>"`]+/gi;
  const parts = [];
  const appendText = value => {
    if (!value) return;
    const previous = parts.at(-1);
    if (previous?.kind === 'text') previous.text += value;
    else parts.push({ kind: 'text', text: value });
  };
  let offset = 0;
  for (const match of text.matchAll(pattern)) {
    const start = match.index;
    appendText(text.slice(offset, start));
    const raw = match[0];
    offset = start + raw.length;
    if (raw.startsWith('`')) { appendText(raw); continue; }
    const named = match[1];
    const target = named ? match[2].replace(/^<|>$/g, '') : match[3] ?? trimBareLink(raw);
    const url = safeArticleLink(target);
    if (!url) { appendText(named ?? raw); continue; }
    const fallback = names.get(url) ?? new URL(url).hostname.replace(/^www\./, '');
    const label = named && !/^(?:https?:\/\/|www\.)/i.test(named) ? named : fallback;
    parts.push({ kind: 'link', text: label, url });
    if (!named && !match[3]) appendText(raw.slice(target.length));
  }
  appendText(text.slice(offset));
  return parts;
}
module.exports = { articleInlineLinks, safeArticleLink };