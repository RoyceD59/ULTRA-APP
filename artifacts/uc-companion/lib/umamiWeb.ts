// Public tracking configuration supplied by the website owner; not credentials.
export const UMAMI_SCRIPT_URL = 'https://cloud.umami.is/script.js';
export const UMAMI_WEBSITE_ID = '77362539-d1a3-4668-913a-c115c512fa09';
const PUBLIC_HOST = 'app.ucfilters.com';
const SCRIPT_ID = 'companion-umami';
const MAX_PENDING_EVENTS = 50;

declare global {
  interface Window {
    companionAnalyticsBeforeSend?: (type: string, payload: Record<string, unknown>) => Record<string, unknown> | false;
  }
}

/** Tracker metadata must not expose reset tokens, search text, or page titles. */
export function sanitizeTrackerMetadata(_type: string, payload: Record<string, unknown>) {
  const clean = { ...payload, title: 'Ultra-Clear Companion' };
  for (const key of ['url', 'referrer'] as const) {
    if (typeof payload[key] !== 'string') continue;
    try {
      const url = new URL(payload[key], `https://${PUBLIC_HOST}`);
      Object.assign(clean, { [key]: key === 'referrer' ? url.origin : url.pathname });
    } catch {
      Object.assign(clean, { [key]: '' });
    }
  }
  return clean;
}

/** One loader per browser document, independent of React remounts. */
export function createWebAnalyticsLoader(getWindow: () => Window | undefined) {
  let state: 'idle' | 'loading' | 'ready' | 'failed' = 'idle';
  let pending: Array<() => void> = [];

  function initialize(): boolean {
    const browser = getWindow();
    if (!browser?.document || browser.location?.hostname !== PUBLIC_HOST ||
      browser.navigator?.doNotTrack === '1') return false;
    if (state !== 'idle') return state !== 'failed';
    browser.companionAnalyticsBeforeSend = (type, payload) =>
      state === 'failed' ? false : sanitizeTrackerMetadata(type, payload);
    if (browser.umami) {
      state = 'ready';
      return true;
    }
    state = 'loading';
    const script = browser.document.createElement('script');
    script.id = SCRIPT_ID;
    script.src = UMAMI_SCRIPT_URL;
    script.defer = true;
    script.setAttribute('data-website-id', UMAMI_WEBSITE_ID);
    script.setAttribute('data-domains', PUBLIC_HOST);
    script.setAttribute('data-exclude-search', 'true');
    script.setAttribute('data-exclude-hash', 'true');
    script.setAttribute('data-do-not-track', 'true');
    script.setAttribute('data-before-send', 'companionAnalyticsBeforeSend');
    script.referrerPolicy = 'no-referrer';
    const timeout = browser.setTimeout(() => fail(), 10_000);
    function fail() {
      browser!.clearTimeout(timeout);
      state = 'failed';
      pending = [];
      // The before-send hook also blocks a timed-out script if it executes late.
      script.remove();
    }
    script.onerror = fail;
    script.onload = () => {
      if (state !== 'loading') return;
      browser.clearTimeout(timeout);
      if (!browser.umami) return fail();
      state = 'ready';
      const callbacks = pending;
      pending = [];
      for (const callback of callbacks) {
        try { callback(); } catch { /* Analytics cannot break customer actions. */ }
      }
    };
    try {
      browser.document.head.appendChild(script);
    } catch {
      fail();
      return false;
    }
    return true;
  }

  function safelyInitialize(): boolean {
    try { return initialize(); } catch {
      state = 'failed';
      pending = [];
      return false;
    }
  }

  return {
    initialize: safelyInitialize,
    queueUntilReady(callback: () => void): boolean {
      if (!safelyInitialize() || state !== 'loading') return false;
      if (pending.length < MAX_PENDING_EVENTS) pending.push(callback);
      return true;
    },
  };
}

export const webAnalyticsLoader = createWebAnalyticsLoader(
  () => typeof window === 'undefined' ? undefined : window,
);