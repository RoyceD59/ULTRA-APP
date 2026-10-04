import { memo, useMemo } from 'react';

/** Compile once per filter change, not once per entry. Terms are literal phrases. */
export function createHighlightPattern(terms: (string | null)[]): RegExp | null {
  const active = [...new Set(terms.map(term => term?.trim().toLowerCase()).filter(
    (term): term is string => !!term,
  ))].sort((a, b) => b.length - a.length);
  if (!active.length) return null;
  return new RegExp(`(${active.map(term => term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'gi');
}

/** React escapes every fragment; feedback and search terms are never HTML. */
export const HighlightedText = memo(function HighlightedText({
  text, pattern,
}: { text: string; pattern: RegExp | null }) {
  const content = useMemo(() => {
    if (!pattern || !text) return text;
    // String.split clones the regex internally; shared lastIndex is not mutated.
    return text.split(pattern).map((part, i) => i % 2 === 1 ? (
      <mark
        key={i}
        className="bg-amber-200/80 text-amber-900 font-semibold rounded-sm px-0.5 not-italic"
      >
        {part}
      </mark>
    ) : part);
  }, [text, pattern]);
  return <>{content}</>;
});