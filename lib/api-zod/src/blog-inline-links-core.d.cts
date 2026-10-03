export function safeArticleLink(value: string): string | null;
export function articleInlineLinks(
  text: string,
  sources?: readonly { url: string; title?: string }[],
): Array<{ kind: "text"; text: string } | { kind: "link"; text: string; url: string }>;