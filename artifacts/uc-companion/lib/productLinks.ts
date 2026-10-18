/** Pure link helpers for authored product content. No javascript:/data: URLs ever. */

const SAFE_EXTERNAL = /^(https?:\/\/[^\s<>"']+|mailto:[^\s<>"'@]+@[^\s<>"']+|tel:\+?[\d\s()-]{5,20})$/i;

/** Returns the authored URL only when it uses an allowed protocol; otherwise null. */
export function safeExternalHref(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const v = raw.trim();
  if (!v || /[\u0000-\u001f]/.test(v)) return null;
  if (!SAFE_EXTERNAL.test(v)) return null;
  if (/^https?:/i.test(v)) {
    try { const u = new URL(v); if (!u.hostname) return null; } catch { return null; }
  }
  return v;
}

const seg = (s: string) => encodeURIComponent(s.trim());
const okSlug = (s: unknown): s is string => typeof s === 'string' && /^[a-z0-9][a-z0-9-_.]{0,159}$/i.test(s.trim());

/** App-internal paths are relative to the router root; expo-router applies the artifact base path. */
export const productHref = (slug: unknown, sku?: string | null): string | null =>
  okSlug(slug) ? `/product/${seg(slug)}${sku ? `?sku=${encodeURIComponent(sku)}` : ''}` : null;
export const topicHref = (slug: unknown): string | null => (okSlug(slug) ? `/topic/${seg(slug)}` : null);
export const categoryHref = (category: string | null | undefined): string =>
  `/products?category=${encodeURIComponent(category || 'All')}`;
export const enquiryHref = (productId: number | null, productName: string): string =>
  `/enquiry?productId=${productId ?? ''}&productName=${encodeURIComponent(productName)}`;

export const isNewTab = (href: string) => /^https?:/i.test(href);

export type TextPart = { text: string; href?: string };

// Only explicit authored URLs are linked; plain words, phone-looking digits and bare domains are not guessed.
const TOKEN = /(https?:\/\/[^\s<>"']+|mailto:[^\s<>"']+|tel:\+?[\d()-]{5,20})/gi;
const TRAIL = /[.,;:!?)\]]+$/;

export function linkifyText(text: string): TextPart[] {
  const out: TextPart[] = [];
  let last = 0;
  for (const m of text.matchAll(TOKEN)) {
    const start = m.index ?? 0;
    let raw = m[0];
    const trail = raw.match(TRAIL)?.[0] ?? '';
    if (trail) raw = raw.slice(0, -trail.length);
    if (start > last) out.push({ text: text.slice(last, start) });
    const href = safeExternalHref(raw);
    out.push(href ? { text: raw, href } : { text: raw });
    last = start + raw.length;
  }
  if (last < text.length) out.push({ text: text.slice(last) });
  return out.reduce<TextPart[]>((acc, p) => {
    const prev = acc[acc.length - 1];
    if (prev && !prev.href && !p.href) prev.text += p.text; else acc.push({ ...p });
    return acc;
  }, []);
}
