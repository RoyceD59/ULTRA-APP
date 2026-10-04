import { FIELD_VITAL_EVENT, sanitizeVitalPayload } from './fieldVitalsPolicy';

// Public tracking configuration supplied by the website owner; not credentials.
export const UMAMI_SCRIPT_URL = 'https://cloud.umami.is/script.js';
export const UMAMI_WEBSITE_ID = '77362539-d1a3-4668-913a-c115c512fa09';
// Umami Cloud's current official tracker sends here. No private API key needed.
export const UMAMI_COLLECT_URL = 'https://gateway.umami.is/api/send';
const PUBLIC_HOST = 'app.ucfilters.com';
const MAX_PENDING_EVENTS = 50;

declare global {
  interface Window {
    companionAnalyticsBeforeSend?: (type: string, payload: Record<string, unknown>) => Record<string, unknown> | false;
  }
}

/** Tracker metadata must not expose reset tokens, search text, or page titles. */
export function sanitizeTrackerMetadata(_type: string, payload: Record<string, unknown>) {
  if (payload.name === FIELD_VITAL_EVENT) {
    const data = sanitizeVitalPayload(payload.data);
    if (_type !== 'event' || !data) return false;
    // Reconstruct, do not spread: discard Umami URL/referrer, screen resolution,
    // language, distinct ID, tags, titles and any unexpected tracker metadata.
    return {
      website: UMAMI_WEBSITE_ID, hostname: PUBLIC_HOST,
      url: `/field-vitals/${data.routeClass}`, referrer: '',
      title: 'Companion field vitals', name: FIELD_VITAL_EVENT, data,
    };
  }
  const clean = { ...payload, title: 'Ultra-Clear Companion' };
  for (const key of ['url', 'referrer'] as const) {
    if (typeof payload[key] !== 'string') continue;
    if (payload[key] === '') continue;
    try {
      const url = new URL(payload[key], `https://${PUBLIC_HOST}`);
      Object.assign(clean, { [key]: key === 'referrer' ? url.origin : url.pathname });
    } catch {
      Object.assign(clean, { [key]: '' });
    }
  }
  return clean;
}

/**
 * Dedicated Umami Cloud sender, independent of Replit's window.umami.
 * No script/global replacement, cookies, persistent IDs, retries or native work.
 */
export function createWebAnalyticsLoader(getWindow: () => Window | undefined) {
  let initialized = false;
  let inFlight = 0;

  function eligible(browser: Window | undefined): browser is Window {
    return !!browser?.document && browser.location?.hostname === PUBLIC_HOST &&
      !['1', 'yes'].includes(browser.navigator?.doNotTrack ?? '') &&
      !browser.localStorage?.getItem('umami.disabled') && typeof browser.fetch === 'function';
  }

  async function track(name: string, data?: Record<string, unknown>): Promise<void> {
    let counted = false;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      const browser = getWindow();
      if (!eligible(browser) || inFlight >= MAX_PENDING_EVENTS) return;
      const payload = sanitizeTrackerMetadata('event', {
        website: UMAMI_WEBSITE_ID, hostname: PUBLIC_HOST,
        // Event-only collection: never send account/reset paths or URL tokens.
        url: `/events/${name}`, referrer: '',
        title: 'Ultra-Clear Companion', name, ...(data ? { data } : {}),
      });
      if (!payload) return;
      counted = true;
      inFlight++;
      const controller = new AbortController();
      timeout = setTimeout(() => controller.abort(), 10_000);
      await browser.fetch(UMAMI_COLLECT_URL, {
        method: 'POST', mode: 'cors', credentials: 'omit', referrerPolicy: 'no-referrer',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'event', payload }),
        signal: controller.signal, keepalive: true,
      });
    } catch {
      // Blocked requests, storage and provider failures never affect the app.
    } finally {
      if (timeout !== undefined) clearTimeout(timeout);
      if (counted) inFlight--;
    }
  }

  function initialize(): boolean {
    try {
      const browser = getWindow();
      if (!eligible(browser)) return false;
      if (!initialized) {
        browser.companionUmami = { track };
        initialized = true;
      }
      return true;
    } catch {
      return false;
    }
  }

  return {
    initialize,
    // Compatibility with existing callers: no script loading or replay queue.
    queueUntilReady(_callback: () => void): boolean {
      initialize();
      return false;
    },
  };
}

export const webAnalyticsLoader = createWebAnalyticsLoader(
  () => typeof window === 'undefined' ? undefined : window,
);