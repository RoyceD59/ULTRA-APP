/** No DOM nodes, metric IDs, attribution, URLs or free-text dimensions leave here. */
export const FIELD_VITAL_EVENT = 'companion_web_vital';
const routes = ['home', 'catalogue', 'product', 'blog', 'article', 'support', 'guide', 'other'] as const;
const profiles = ['chromium-mobile', 'chromium-desktop', 'webkit-mobile', 'webkit-desktop', 'firefox-mobile', 'firefox-desktop', 'other-mobile', 'other-desktop'] as const;
export type RouteClass = typeof routes[number];
export type BrowserProfile = typeof profiles[number];
export type VitalPayload = {
  schema: 1; environment: 'production'; build: string; routeClass: RouteClass;
  browserProfile: BrowserProfile; metric: 'LCP' | 'INP' | 'CLS'; value: number;
};

export function routeClass(pathname: string): RouteClass {
  const path = pathname.replace(/^\/uc-companion(?=\/|$)/, '').replace(/\/$/, '') || '/';
  if (path === '/') return 'home';
  if (path === '/products') return 'catalogue';
  for (const [prefix, category] of [
    ['/product/', 'product'], ['/blog/', 'article'], ['/guide/', 'guide'],
  ] as const) if (path.startsWith(prefix)) return category;
  if (path === '/blog') return 'blog';
  if (path === '/support') return 'support';
  return 'other';
}

/** User agent is read locally only; versions, model and the original string are discarded. */
export function browserProfile(ua: string): BrowserProfile {
  const mobile = /Mobile|Android|iPhone|iPad/i.test(ua);
  const family = /Firefox|FxiOS/i.test(ua) && !/FxiOS/i.test(ua) ? 'firefox'
    : /iPhone|iPad|iPod/i.test(ua) ? 'webkit'
    : /Chrome|Chromium|Edg|OPR/i.test(ua) ? 'chromium'
    : /Safari/i.test(ua) ? 'webkit' : 'other';
  return `${family}-${mobile ? 'mobile' : 'desktop'}`;
}

export function sanitizeVitalPayload(input: unknown): VitalPayload | undefined {
  if (!input || typeof input !== 'object') return;
  const p = input as Record<string, unknown>;
  if (p.schema !== 1 || p.environment !== 'production' ||
    typeof p.build !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(p.build) ||
    !routes.includes(p.routeClass as RouteClass) ||
    !profiles.includes(p.browserProfile as BrowserProfile) ||
    !['LCP', 'INP', 'CLS'].includes(p.metric as string) ||
    typeof p.value !== 'number' || !Number.isFinite(p.value) || p.value < 0) return;
  return {
    schema: 1, environment: 'production', build: p.build,
    routeClass: p.routeClass as RouteClass, browserProfile: p.browserProfile as BrowserProfile,
    metric: p.metric as VitalPayload['metric'],
    value: p.metric === 'CLS' ? Math.round(p.value * 1000) / 1000 : Math.round(p.value),
  };
}

export function fieldVitalsAllowed(browser: Window, enabled: string | undefined, production: boolean): boolean {
  return production && enabled === 'true' &&
    browser.location.hostname === 'app.ucfilters.com' &&
    browser.navigator.doNotTrack !== '1' && browser.navigator.doNotTrack !== 'yes' &&
    !(browser.navigator as Navigator & { globalPrivacyControl?: boolean }).globalPrivacyControl &&
    !browser.navigator.webdriver && !browser.companionPerformanceFixture;
}

declare global {
  interface Window { companionPerformanceFixture?: boolean }
}