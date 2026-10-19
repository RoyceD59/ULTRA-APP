import { Platform } from 'react-native';
import { webAnalyticsLoader } from './umamiWeb';

export type AnalyticsEvent =
  | 'water_check_started'
  | 'water_check_completed'
  | 'guide_list_viewed'
  | 'guide_opened'
  | 'guide_media_started'
  | 'guide_media_completed'
  | 'guide_media_failed'
  | 'signup_completed'
  | 'product_viewed'
  | 'cart_item_added'
  | 'checkout_started'
  | 'order_submitted'
  | 'review_submitted'
  | 'support_ticket_submitted'
  | 'alison_message_sent'
  | 'alison_reply_received'
  | 'article_opened'
  | 'article_source_clicked'
  | 'wishlist_item_added'
  | 'wishlist_item_removed';

type GuidePayload = { guideId: string };
type GuideMediaPayload = { guideId: string; mediaKind: 'image' | 'video' };
type MediaCounts = { photoCount: number; videoCount: number };
export type AnalyticsPayloadMap = {
  water_check_started: { countryCode: string };
  water_check_completed: { countryCode: string };
  guide_list_viewed: { guideCount: number };
  guide_opened: GuidePayload;
  guide_media_started: GuideMediaPayload;
  guide_media_completed: GuideMediaPayload;
  guide_media_failed: GuideMediaPayload;
  signup_completed: { countryCode: string };
  product_viewed: { productId: number };
  cart_item_added: { productId: number; quantity: number };
  checkout_started: { itemCount: number };
  order_submitted: { paymentMethod: 'paystack' | 'mpesa' | 'cod' | 'stripe'; itemCount: number };
  review_submitted: { rating: number } & MediaCounts;
  support_ticket_submitted: MediaCounts;
  alison_message_sent: Record<string, never>;
  alison_reply_received: Record<string, never>;
  article_opened: { articleId: string };
  article_source_clicked: { articleId: string; placement: 'body' | 'sources' };
  wishlist_item_added: { productId: number };
  wishlist_item_removed: { productId: number };
};

declare global {
  interface Window {
    umami?: {
      track(name: string, data?: AnalyticsPayloadMap[AnalyticsEvent]): void | Promise<void>;
    };
    companionUmami?: {
      track(name: string, data?: Record<string, unknown>): void | Promise<void>;
    };
  }
}

export const ANALYTICS_EVENT_NAMES: readonly AnalyticsEvent[] = [
  'water_check_started', 'water_check_completed', 'guide_list_viewed',
  'guide_opened', 'guide_media_started', 'guide_media_completed',
  'guide_media_failed', 'signup_completed', 'product_viewed',
  'cart_item_added', 'checkout_started', 'order_submitted',
  'review_submitted', 'support_ticket_submitted', 'alison_message_sent',
  'alison_reply_received',
  'article_opened', 'article_source_clicked', 'wishlist_item_added', 'wishlist_item_removed',
];
const SAFE_EVENT_NAMES = new Set<AnalyticsEvent>(ANALYTICS_EVENT_NAMES);

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function sanitizePayload<E extends AnalyticsEvent>(
  name: E,
  data: unknown,
): AnalyticsPayloadMap[E] | undefined {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return undefined;
  const input = data as Record<string, unknown>;
  const pickCounts = (): MediaCounts | undefined =>
    isCount(input.photoCount) && isCount(input.videoCount)
      ? { photoCount: input.photoCount, videoCount: input.videoCount }
      : undefined;

  switch (name) {
    case 'water_check_started':
    case 'water_check_completed':
    case 'signup_completed':
      return typeof input.countryCode === 'string' && /^[A-Z]{2}$/.test(input.countryCode)
        ? { countryCode: input.countryCode } as AnalyticsPayloadMap[E]
        : undefined;
    case 'guide_list_viewed':
      return isCount(input.guideCount)
        ? { guideCount: input.guideCount } as AnalyticsPayloadMap[E]
        : undefined;
    case 'guide_opened':
      return typeof input.guideId === 'string'
        ? { guideId: input.guideId } as AnalyticsPayloadMap[E]
        : undefined;
    case 'guide_media_started':
    case 'guide_media_completed':
    case 'guide_media_failed':
      return typeof input.guideId === 'string' &&
        (input.mediaKind === 'image' || input.mediaKind === 'video')
        ? { guideId: input.guideId, mediaKind: input.mediaKind } as AnalyticsPayloadMap[E]
        : undefined;
    case 'article_opened':
      return typeof input.articleId === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(input.articleId)
        ? { articleId: input.articleId } as AnalyticsPayloadMap[E]
        : undefined;
    case 'article_source_clicked':
      return typeof input.articleId === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(input.articleId) &&
        (input.placement === 'body' || input.placement === 'sources')
        ? { articleId: input.articleId, placement: input.placement } as AnalyticsPayloadMap[E]
        : undefined;
    case 'wishlist_item_added':
    case 'wishlist_item_removed':
    case 'product_viewed':
      return Number.isSafeInteger(input.productId) && (input.productId as number) > 0
        ? { productId: input.productId as number } as AnalyticsPayloadMap[E]
        : undefined;
    case 'cart_item_added':
      return Number.isSafeInteger(input.productId) && (input.productId as number) > 0 &&
        isCount(input.quantity) && input.quantity > 0
        ? { productId: input.productId as number, quantity: input.quantity } as AnalyticsPayloadMap[E]
        : undefined;
    case 'checkout_started':
      return isCount(input.itemCount) && input.itemCount > 0
        ? { itemCount: input.itemCount } as AnalyticsPayloadMap[E]
        : undefined;
    case 'order_submitted':
      return (input.paymentMethod === 'paystack' || input.paymentMethod === 'mpesa' ||
        input.paymentMethod === 'cod' || input.paymentMethod === 'stripe') &&
        isCount(input.itemCount) && input.itemCount > 0
        ? { paymentMethod: input.paymentMethod, itemCount: input.itemCount } as AnalyticsPayloadMap[E]
        : undefined;
    case 'review_submitted':
      {
        const counts = pickCounts();
        return isCount(input.rating) && input.rating >= 1 && input.rating <= 5 && counts
          ? ({ rating: input.rating, ...counts } as AnalyticsPayloadMap[E])
          : undefined;
      }
    case 'support_ticket_submitted':
      return pickCounts() as AnalyticsPayloadMap[E] | undefined;
    case 'alison_message_sent':
    case 'alison_reply_received':
      return undefined;
  }
}

/**
 * Companion loads its separate Umami tracker on its public browser domain.
 * Native builds and local development remain safe no-ops; only explicitly
 * allowlisted scalar fields can leave this wrapper.
 */
type PayloadEvent = Exclude<AnalyticsEvent, 'alison_message_sent' | 'alison_reply_received'>;
export function trackEvent<E extends PayloadEvent>(
  name: E,
  data: AnalyticsPayloadMap[E],
): void;
export function trackEvent(name: 'alison_message_sent' | 'alison_reply_received'): void;
export function trackEvent(
  name: AnalyticsEvent,
  data?: AnalyticsPayloadMap[AnalyticsEvent],
): void {
  if (Platform.OS !== 'web' || typeof window === 'undefined' || !SAFE_EVENT_NAMES.has(name)) return;
  try {
    const payload = sanitizePayload(name, data);
    if (name !== 'alison_message_sent' && name !== 'alison_reply_received' && !payload) return;
    const send = () => {
      try {
        const result = window.companionUmami?.track(name, payload);
        if (result && typeof (result as Promise<void>).then === 'function') {
          void Promise.resolve(result).catch(() => {
            // A rejected analytics request must never interrupt a customer action.
          });
        }
      } catch { /* Analytics must never interrupt a customer action. */ }
    };
    if (!webAnalyticsLoader.queueUntilReady(send)) send();
  } catch {
    // Analytics must never interrupt a customer action.
  }
}
