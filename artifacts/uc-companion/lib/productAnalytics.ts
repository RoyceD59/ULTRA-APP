import { Platform } from 'react-native';

export type ProductEvent = 'view_item' | 'add_to_cart' | 'begin_checkout' | 'purchase' |
  'add_to_wishlist' | 'share' | 'compare_opened' | 'pay_link_opened' | 'pay_link_paid';
type Data = { productId?: number; sku?: string; quantity?: number; method?: string; itemCount?: number; transactionId?: string; value?: number };
type Adapter = (event: ProductEvent, data: Data) => void;
let configured: Adapter | null = null;
const events = new Set<ProductEvent>(['view_item','add_to_cart','begin_checkout','purchase',
  'add_to_wishlist','share','compare_opened','pay_link_opened','pay_link_paid']);

/** Explicit opt-in, not a loader. The approved Umami wrapper is untouched.
 * No GA script or collection is activated by merging this feature. */
export function configureProductAnalytics(adapter: Adapter | null) { configured = adapter; }
export function configureGoogleProductAnalytics(
  measurementId: string,
  gtag: (command: 'event', event: string, parameters: Record<string, unknown>) => void,
) {
  if (!/^G-[A-Z0-9]+$/.test(measurementId) || typeof gtag !== 'function') throw new Error('An explicit Google Analytics measurement ID and adapter are required');
  configureProductAnalytics((event, data) => gtag('event', event, {
    send_to: measurementId,
    ...(data.transactionId ? { transaction_id: data.transactionId } : {}),
    ...(data.value !== undefined ? { value: data.value, currency: 'KES' } : {}),
    ...(data.method ? { method: data.method } : {}),
    ...(data.itemCount ? { item_count: data.itemCount } : {}),
    ...(data.productId || data.sku ? { items: [{ item_id: data.sku || String(data.productId), quantity: data.quantity || 1 }] } : {}),
  }));
}
/** No script installation, default activation, or replacement of Umami. */
export function installConfiguredGoogleProductAnalytics(): 'disabled' | 'configured' | 'invalid' {
  if (Platform.OS !== 'web' || process.env.EXPO_PUBLIC_PRODUCT_GA_ENABLED !== 'true') return 'disabled';
  const id = process.env.EXPO_PUBLIC_PRODUCT_GA_MEASUREMENT_ID || '';
  if (!/^G-[A-Z0-9]+$/.test(id)) return 'invalid';
  configureGoogleProductAnalytics(id, (command, event, parameters) => {
    const gtag = (typeof window !== 'undefined' ? window as Window & { gtag?: (command: string, event: string, params: unknown) => void } : null)?.gtag;
    if (typeof gtag === 'function') gtag(command, event, parameters);
  });
  return 'configured';
}
export function trackProductEvent(event: ProductEvent, data: Data = {}) {
  if (Platform.OS !== 'web' || !configured || !events.has(event)) return;
  const safe: Data = {};
  if (Number.isSafeInteger(data.productId) && data.productId! > 0) safe.productId = data.productId;
  if (data.sku && /^[A-Za-z0-9_-]{1,100}$/.test(data.sku)) safe.sku = data.sku;
  if (Number.isInteger(data.quantity) && data.quantity! > 0 && data.quantity! <= 1000) safe.quantity = data.quantity;
  if (Number.isInteger(data.itemCount) && data.itemCount! > 0 && data.itemCount! <= 100000) safe.itemCount = data.itemCount;
  if (['copy', 'whatsapp'].includes(data.method ?? '')) safe.method = data.method;
  if (data.transactionId && /^UC-[1-9][0-9]*$/.test(data.transactionId)) safe.transactionId = data.transactionId;
  if (typeof data.value === 'number' && Number.isFinite(data.value) && data.value >= 0) safe.value = data.value;
  try { configured(event, safe); } catch { /* Measurement cannot block commerce. */ }
}

/** Call only from a verified-payment branch. The adapter cannot turn order
 * creation or a COD confirmation into a purchase event. */
const purchases = new Set<string>();
export function trackVerifiedPurchase(verified: boolean, data: Data) {
  if (!verified || !data.transactionId || !/^UC-[1-9][0-9]*$/.test(data.transactionId) || purchases.has(data.transactionId)) return;
  if (Platform.OS !== 'web' || !configured) return;
  purchases.add(data.transactionId);
  trackProductEvent('purchase', data);
}
