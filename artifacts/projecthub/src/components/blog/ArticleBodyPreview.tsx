import { articleInlineLinks, type ArticleLinkSource } from "@workspace/api-zod/blog-inline-links";

export function ArticleBodyPreview({
  content, sources = [],
}: { content: string; sources?: readonly ArticleLinkSource[] }) {
  const blocks = content.split(/\n\s*\n/).map(part => part.trim()).filter(Boolean);
  const inline = (text: string) => articleInlineLinks(text, sources).map((part, index) =>
    part.kind === "link"
      ? <a key={index} href={part.url} target="_blank" rel="noopener noreferrer"
          className="text-primary underline underline-offset-2 break-words">{part.text}</a>
      : part.text);
  if (!blocks.length) return <p className="text-sm text-muted-foreground">Your article preview will appear here.</p>;
  return <div className="space-y-4 text-sm leading-7">
    {blocks.map((block, index) => {
      const heading = block.match(/^(#{1,3})\s+(.+)$/);
      if (heading) {
        const Tag = heading[1]!.length === 1 ? "h2" : heading[1]!.length === 2 ? "h3" : "h4";
        return <Tag key={index} className="font-semibold leading-tight">{inline(heading[2]!)}</Tag>;
      }
      const lines = block.split("\n");
      if (lines.every(line => /^[-*]\s+/.test(line))) {
        return <ul key={index} className="list-disc space-y-1 pl-5">
          {lines.map((line, lineIndex) => <li key={lineIndex}>{inline(line.replace(/^[-*]\s+/, ""))}</li>)}
        </ul>;
      }
      return <p key={index} className="whitespace-pre-wrap">{inline(block)}</p>;
    })}
  </div>;
}