export type AnalyticsEvent =
  | 'water_check_started'
  | 'water_check_completed'
  | 'guide_list_viewed'
  | 'guide_opened'
  | 'guide_media_started'
  | 'guide_media_completed'
  | 'guide_media_failed'
  | 'signup_completed';

type GuidePayload = { guideId: string };
type GuideMediaPayload = { guideId: string; mediaKind: 'image' | 'video' };
export type AnalyticsPayloadMap = {
  water_check_started: { countryCode: string };
  water_check_completed: { countryCode: string };
  guide_list_viewed: { guideCount: number };
  guide_opened: GuidePayload;
  guide_media_started: GuideMediaPayload;
  guide_media_completed: GuideMediaPayload;
  guide_media_failed: GuideMediaPayload;
  signup_completed: { countryCode: string };
};

declare global {
  interface Window {
    umami?: {
      track(name: string, data?: AnalyticsPayloadMap[AnalyticsEvent]): void;
    };
  }
}

export const ANALYTICS_EVENT_NAMES: readonly AnalyticsEvent[] = [
  'water_check_started', 'water_check_completed', 'guide_list_viewed',
  'guide_opened', 'guide_media_started', 'guide_media_completed',
  'guide_media_failed', 'signup_completed',
];
const SAFE_EVENT_NAMES = new Set<AnalyticsEvent>(ANALYTICS_EVENT_NAMES);

/**
 * Replit injects Umami only for published websites. Keeping this wrapper
 * platform-agnostic makes native builds and local development safe no-ops.
 */
export function trackEvent<E extends AnalyticsEvent>(
  name: E,
  data: AnalyticsPayloadMap[E],
): void {
  if (typeof window === 'undefined' || !SAFE_EVENT_NAMES.has(name)) return;
  try {
    window.umami?.track(name, data);
  } catch {
    // Analytics must never interrupt a customer action.
  }
}
