import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { articleInlineLinks } from "@workspace/api-zod/blog-inline-links";
import { ArticleBodyPreview } from "./ArticleBodyPreview";

describe("Article body linkpoints", () => {
  it("renders named links in paragraphs, headings and list items without exposing Markdown targets", () => {
    render(<ArticleBodyPreview content={"## [Water guidance](https://example.org/guide)\n\nRead [WHO guidance](https://www.who.int/water) before treatment.\n\n- [Source details](https://example.org/source)"} />);
    expect(screen.getByRole("link", { name: "Water guidance" })).toHaveAttribute("href", "https://example.org/guide");
    expect(screen.getByRole("link", { name: "WHO guidance" })).toHaveAttribute("href", "https://www.who.int/water");
    expect(screen.getByRole("link", { name: "Source details" })).toHaveAttribute("rel", "noopener noreferrer");
    expect(document.body.textContent).not.toContain("https://");
    expect(document.body.textContent).not.toContain("](https");
  });

  it("uses source titles for old bare URLs and host labels for unknown URLs", () => {
    render(<ArticleBodyPreview
      content="Read https://www.who.int/water. Also see <https://example.org/guide>."
      sources={[{ url: "https://www.who.int/water", title: "WHO drinking-water guidance" }]} />);
    expect(screen.getByRole("link", { name: "WHO drinking-water guidance" })).toHaveAttribute("href", "https://www.who.int/water");
    expect(screen.getByRole("link", { name: "example.org" })).toHaveAttribute("href", "https://example.org/guide");
    expect(document.body.textContent).toContain("guidance. Also see");
    expect(document.body.textContent).not.toContain("https://");
  });

  it("never enables unsafe targets or executes article HTML", () => {
    render(<ArticleBodyPreview content={'[Bad](javascript:alert(1)) [Login](https://user:password@example.org) [Insecure](http://example.org) <script>alert(1)</script>'} />);
    expect(screen.queryAllByRole("link")).toHaveLength(0);
    expect(document.querySelector("script")).toBeNull();
    expect(screen.getByText(/Bad Login Insecure/)).toBeInTheDocument();
  });
});

describe("Shared article link tokenizer", () => {
  it("supports parentheses in link paths and keeps surrounding punctuation", () => {
    expect(articleInlineLinks("See (https://example.org/guide_(water)).")).toEqual([
      { kind: "text", text: "See (" },
      { kind: "link", text: "example.org", url: "https://example.org/guide_(water)" },
      { kind: "text", text: ")." },
    ]);
    expect(articleInlineLinks('[Guide](https://example.org/guide_(water) "Source")')).toEqual([
      { kind: "link", text: "Guide", url: "https://example.org/guide_(water)" },
    ]);
  });

  it("keeps adjacent Markdown links distinct and replaces URL-shaped labels", () => {
    expect(articleInlineLinks("[First](https://example.org/a)[Second](https://example.org/b)")).toHaveLength(2);
    expect(articleInlineLinks("[https://example.org/a](https://example.org/a)")[0]).toEqual({
      kind: "link", text: "example.org", url: "https://example.org/a",
    });
  });

  it("preserves inline code as text, rejects credential URLs and tolerates empty bodies", () => {
    expect(articleInlineLinks("`https://example.org/code`")).toEqual([
      { kind: "text", text: "`https://example.org/code`" },
    ]);
    expect(articleInlineLinks("[Account](https://name:secret@example.org)")).toEqual([
      { kind: "text", text: "Account" },
    ]);
    expect(articleInlineLinks("")).toEqual([]);
  });
});