import { webAnalyticsLoader } from './umamiWeb';
import { browserProfile, FIELD_VITAL_EVENT, fieldVitalsAllowed, routeClass } from './fieldVitalsPolicy';
import type { VitalPayload } from './fieldVitalsPolicy';
import { createVitalBuffer } from './fieldVitalsBuffer';

let started = false;

/** Opt-in, browser-document collector; React remounts do not add observers. */
export function initializeCompanionFieldVitals(): void {
  if (started || typeof window === 'undefined') return;
  const enabled = process.env.EXPO_PUBLIC_COMPANION_FIELD_VITALS_ENABLED;
  const production = process.env.NODE_ENV === 'production' &&
    process.env.EXPO_PUBLIC_PREVIEW_SAFE_MODE !== '1';
  if (!fieldVitalsAllowed(window, enabled, production)) return;
  const build = document.querySelector<HTMLMetaElement>('meta[name="uc-build-id"]')?.content;
  if (!build || !/^[A-Za-z0-9_-]{1,64}$/.test(build)) return;
  started = true;
  const dimensions = {
    schema: 1 as const, environment: 'production' as const, build,
    routeClass: routeClass(window.location.pathname),
    browserProfile: browserProfile(window.navigator.userAgent),
  };
  const buffer = createVitalBuffer(dimensions, data => {
    if (!fieldVitalsAllowed(window, enabled, production)) return;
    const send = () => {
      if (!fieldVitalsAllowed(window, enabled, production)) return;
      try {
        // The dedicated sender reconstructs the entire field envelope.
        const tracker = window.companionUmami as unknown as {
          track(name: string, payload: VitalPayload): void | Promise<void>;
        } | undefined;
        void Promise.resolve(tracker?.track(FIELD_VITAL_EVENT, data)).catch(() => {});
      } catch { /* Observability must never interrupt the app. */ }
    };
    if (webAnalyticsLoader.initialize() && !webAnalyticsLoader.queueUntilReady(send)) send();
  });
  // Register after web-vitals so final hidden/pagehide readings precede flush.
  void import('web-vitals').then(({ onLCP, onINP, onCLS }) => {
    onLCP(buffer.report, { reportAllChanges: true });
    onINP(buffer.report, { reportAllChanges: true });
    onCLS(buffer.report, { reportAllChanges: true });
    const scheduleFlush = () => queueMicrotask(buffer.flush);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') scheduleFlush();
    });
    window.addEventListener('pagehide', scheduleFlush);
  }).catch(() => { /* No fallback approximations or customer-visible failures. */ });
}