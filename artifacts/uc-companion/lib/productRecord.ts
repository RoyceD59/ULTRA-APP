import { Platform } from 'react-native';
import { getApiBase } from '@/lib/apiBase';

export type RecordImage = { slot: number; src: string; alt: string; picturedColour?: string; childSku?: string };
export type RecordVariant = {
  childSku: string; label: string; variationId: number | null; price: number | null;
  stockStatus: string | null; diagnostic?: string;
};
export type RecordClaim = { text: string; status: string; conditions: string; reports: { lab: string; report: string }[] };
type Loose = Record<string, any>;
export type ProductRecord = {
  code: string; slug: string; name: string; parentSku: string; purchasable: boolean;
  price: number | null; currency: string; category?: string;
  specs?: Record<string, string>; suitability?: Loose; benefits?: Loose; package?: Loose;
  ownership?: Loose; service?: Loose; summary?: Loose; faq?: { q: string; a: string }[];
  claims?: RecordClaim[]; seo?: Loose; opening?: Loose; topics?: { name: string; slug: string }[];
  evidenceLimits?: string[];
  kind?: 'product' | 'replacement'; navGroup?: string | null; compareGroup?: string | null;
  compare?: Record<string, string | null> | null; fits?: string[] | null;
  fitPhotos?: { heading: string; items: { src: string; alt: string; caption: string }[] } | null;
  operation: {
    commerceId: number | null; availability: string | null; livePrice: number | null; priceAuthority?: 'companion'; images: RecordImage[];
    videoUrl: string | null; diagnostics: string[]; variants: RecordVariant[];
  };
};
export type RecordGroup = { id: string; label: string; products: string[]; replacements: string[] };
export type RecordCollection = { products: (Partial<ProductRecord> & { code: string; slug: string; name: string })[]; topics: unknown[]; groups?: RecordGroup[] };

/** Comparison rows authored per product, in display order. */
export const COMPARE_ROWS: [key: string, label: string][] = [
  ['type', 'Type'], ['capacity', 'Capacity'], ['body', 'Body'], ['hot_liquids', 'Hot liquids'],
  ['filter_life', 'Filter life'], ['flow_output', 'Flow / output'], ['power', 'Power'],
  ['installation', 'Installation'], ['replacement', 'Replacement'], ['warranty', 'Warranty'],
  ['tested_performance', 'Tested performance'],
];

export const SLOT_LABELS = ['Product', 'In use', 'Parts', 'Included', 'Colours', 'Size'];

const STOCK: Record<string, string> = { instock: 'instock', outofstock: 'outofstock', onbackorder: 'onbackorder' };
export function normalizeStock(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  return STOCK[v.replace(/[\s_-]/g, '').toLowerCase()] ?? null;
}
/** Flat public endpoint -> nested consumption type. */
export function normalizeRecord(raw: any): ProductRecord {
  const { commerceId, availability, livePrice, priceAuthority, images, videoUrl, diagnostics, variants, ...rest } = raw;
  return {
    ...rest,
    operation: {
      commerceId: Number.isSafeInteger(commerceId) ? commerceId : null,
      availability: normalizeStock(availability),
      livePrice: typeof livePrice === 'number' ? livePrice : null,
      priceAuthority: priceAuthority === 'companion' ? 'companion' : undefined,
      images: Array.isArray(images) ? images : [],
      videoUrl: typeof videoUrl === 'string' ? videoUrl : null,
      diagnostics: Array.isArray(diagnostics) ? diagnostics.filter((d: unknown) => typeof d === 'string') : [],
      variants: (Array.isArray(variants) ? variants : []).map((v: any) => ({ ...v, stockStatus: normalizeStock(v.stockStatus) })),
    },
  } as ProductRecord;
}

export async function fetchRecord(key: string, signal?: AbortSignal): Promise<ProductRecord> {
  const r = await fetch(`${getApiBase()}/api/uc/product-records/${encodeURIComponent(key)}`,
    { signal, headers: { Accept: 'application/json' } });
  if (!r.ok) {
    const body = await r.json().catch(() => ({}));
    throw Object.assign(new Error('Product record unavailable'), { status: r.status, legacy: body?.legacy === true });
  }
  return normalizeRecord(await r.json());
}
export async function fetchCollection(signal?: AbortSignal): Promise<RecordCollection> {
  const r = await fetch(`${getApiBase()}/api/uc/product-records`, { signal, headers: { Accept: 'application/json' } });
  if (!r.ok) throw Object.assign(new Error('Product records unavailable'), { status: r.status });
  return r.json();
}

export type Purchase =
  | { kind: 'buy'; price: number }
  | { kind: 'enquiry' }
  | { kind: 'out_of_stock' }
  | { kind: 'blocked'; reason: string };

/** Single decision point: purchase only an exact verified live variant at the record price. */
export function purchaseState(rec: ProductRecord, v: RecordVariant | null): Purchase {
  if (!rec.purchasable || rec.price === null) return { kind: 'enquiry' };
  const op = rec.operation;
  const hasVariants = op.variants.length > 0;
  if (hasVariants && !v) return { kind: 'blocked', reason: 'Choose an option to continue.' };
  if (hasVariants && v!.variationId === null) return { kind: 'blocked', reason: 'This option cannot be matched to live stock yet. Please enquire.' };
  if (!hasVariants && op.commerceId === null) return { kind: 'blocked', reason: 'Live stock is unavailable. Please enquire.' };
  const stock = hasVariants ? v!.stockStatus : op.availability;
  if (stock === 'outofstock') return { kind: 'out_of_stock' };
  const blocking = op.diagnostics.filter(d => !(op.priceAuthority === 'companion' && d === 'commerce-price-differs-from-approved'));
  if (blocking.length || v?.diagnostic) return { kind: 'blocked', reason: 'Live stock or product identity could not be confirmed. Please enquire or refresh.' };
  if (stock !== 'instock' && stock !== 'onbackorder') return { kind: 'blocked', reason: 'Live stock could not be confirmed. Please enquire before ordering.' };
  const live = op.priceAuthority === 'companion' ? rec.price : hasVariants ? v!.price : op.livePrice;
  if (live === null || live !== rec.price) return { kind: 'blocked', reason: 'The checkout price differs from this page. Refresh, or enquire.' };
  return { kind: 'buy', price: live };
}

export const kes = (n: number) => `KES ${n.toLocaleString('en-KE', { maximumFractionDigits: 2 })}`;

/** Expo artifact base path, taken from the server-declared public endpoint. */
function webBasePath(): string {
  if (typeof document === 'undefined') return '';
  const ep = document.querySelector<HTMLMetaElement>('meta[name="uc-public-meta-endpoint"]')?.content ?? '';
  const m = ep.match(/^(.*)\/public-page-meta$/);
  return m ? m[1].replace(/\/$/, '') : '';
}
/** Explicit configured public origin only; null means sharing is unavailable. */
export function shareBase(): string | null {
  if (Platform.OS === 'web' && typeof window !== 'undefined') return `${window.location.origin}${webBasePath()}`;
  const o = process.env.EXPO_PUBLIC_SHARE_ORIGIN?.trim().replace(/\/$/, '');
  return o && /^https:\/\//.test(o) ? o : null;
}
export function productShareUrl(slug: string, sku: string | undefined, method: 'whatsapp' | 'copy'): string | null {
  const base = shareBase();
  if (!base) return null;
  const q = new URLSearchParams();
  if (sku) q.set('sku', sku);
  q.set('utm_source', 'share'); q.set('utm_medium', method);
  return `${base}/product/${slug}?${q}`;
}
/** Plain text for copy; WhatsApp text encoded exactly once. */
export function shareText(name: string, url: string) {
  return `${name} - product link (not a payment link): ${url}`;
}
export const whatsappUrl = (text: string) => `https://wa.me/?text=${encodeURIComponent(text)}`;

export function specValue(rec: ProductRecord, ...names: string[]): string | null {
  const s = rec.specs || {};
  for (const k of Object.keys(s)) if (names.some(n => k.toLowerCase().includes(n)) && String(s[k]).trim()) return String(s[k]);
  return null;
}
