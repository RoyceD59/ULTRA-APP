/// <reference lib="dom" />

export type ArticleLinkSource = { url: string; title?: string };
export type ArticleInlinePart =
  | { kind: "text"; text: string }
  | { kind: "link"; text: string; url: string };

/** Article content is untrusted text, never executable HTML. */
export function safeArticleLink(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname && !url.username && !url.password
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

function trimBareLink(value: string): string {
  let result = value.replace(/[.,;:!?]+$/, "");
  for (const [open, close] of [["(", ")"], ["[", "]"], ["{", "}"]]) {
    while (result.endsWith(close!)
      && result.split(close!).length > result.split(open!).length) {
      result = result.slice(0, -1);
    }
  }
  return result.replace(/[.,;:!?]+$/, "");
}

/**
 * Parse named Markdown links, HTTPS autolinks and older bare URLs.
 * A small text-only subset deliberately avoids HTML/image execution.
 */
export function articleInlineLinks(
  text: string,
  sources: readonly ArticleLinkSource[] = [],
): ArticleInlinePart[] {
  const names = new Map<string, string>();
  for (const source of sources) {
    const url = safeArticleLink(source.url);
    const title = source.title?.trim();
    if (url && title && !/^(?:https?:\/\/|www\.)/i.test(title)) names.set(url, title);
  }
  const pattern = /`[^`\n]*`|!?\[([^\]\n]+)\]\(\s*(<?[^()\s<>]+(?:\([^()\s]*\)[^()\s]*)*>?)(?:\s+["'][^"'\n]*["'])?\s*\)|<(https:\/\/[^<>\s]+)>|https:\/\/[^\s<>"`]+/gi;
  const parts: ArticleInlinePart[] = [];
  const appendText = (value: string) => {
    if (!value) return;
    const previous = parts.at(-1);
    if (previous?.kind === "text") previous.text += value;
    else parts.push({ kind: "text", text: value });
  };
  let offset = 0;
  for (const match of text.matchAll(pattern)) {
    const start = match.index!;
    appendText(text.slice(offset, start));
    const raw = match[0];
    offset = start + raw.length;
    if (raw.startsWith("`")) { appendText(raw); continue; }
    const named = match[1];
    const target = named
      ? match[2]!.replace(/^<|>$/g, "")
      : match[3] ?? trimBareLink(raw);
    const url = safeArticleLink(target);
    if (!url) {
      // Preserve the readable label, but never make an unsafe target clickable.
      appendText(named ?? raw);
      continue;
    }
    const fallback = names.get(url) ?? new URL(url).hostname.replace(/^www\./, "");
    const label = named && !/^(?:https?:\/\/|www\.)/i.test(named) ? named : fallback;
    parts.push({ kind: "link", text: label, url });
    if (!named && !match[3]) appendText(raw.slice(target.length));
  }
  appendText(text.slice(offset));
  return parts;
}