/// <reference lib="dom" />
import {
  safeArticleLink as safeLink,
  articleInlineLinks as parseLinks,
} from "./blog-inline-links-core.cjs";

export type ArticleLinkSource = { url: string; title?: string };
export type ArticleInlinePart =
  | { kind: "text"; text: string }
  | { kind: "link"; text: string; url: string };

/** Article content is untrusted text, never executable HTML. */
export function safeArticleLink(value: string): string | null {
  return safeLink(value);
}

/**
 * Parse named Markdown links, HTTPS autolinks and older bare URLs.
 * A small text-only subset deliberately avoids HTML/image execution.
 */
export function articleInlineLinks(
  text: string,
  sources: readonly ArticleLinkSource[] = [],
): ArticleInlinePart[] {
  return parseLinks(text, sources);
}