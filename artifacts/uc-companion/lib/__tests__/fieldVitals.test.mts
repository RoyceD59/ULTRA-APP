import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { browserProfile, fieldVitalsAllowed, routeClass, sanitizeVitalPayload, FIELD_VITAL_EVENT } from '../fieldVitalsPolicy';
import type { VitalPayload } from '../fieldVitalsPolicy';
import { createVitalBuffer } from '../fieldVitalsBuffer';
import { sanitizeTrackerMetadata, UMAMI_WEBSITE_ID } from '../umamiWeb';

const dimensions = {
  schema: 1 as const, environment: 'production' as const, build: 'release-20261004',
  routeClass: 'home' as const, browserProfile: 'chromium-mobile' as const,
};
const valid = { ...dimensions, metric: 'LCP', value: 1234.56 };
function browser(overrides: Record<string, unknown> = {}): Window {
  return {
    location: { hostname: 'app.ucfilters.com' },
    navigator: { doNotTrack: '0', webdriver: false },
    ...overrides,
  } as unknown as Window;
}

test('collection fails closed outside approved production and for privacy/fixture signals', () => {
  assert.equal(fieldVitalsAllowed(browser(), 'true', true), true);
  for (const flag of [undefined, 'false', '1']) assert.equal(fieldVitalsAllowed(browser(), flag, true), false);
  assert.equal(fieldVitalsAllowed(browser(), 'true', false), false);
  for (const hostname of ['localhost', 'app.ucfilters.com.evil.test', 'preview.replit.dev']) {
    assert.equal(fieldVitalsAllowed(browser({ location: { hostname } }), 'true', true), false);
  }
  for (const navigator of [{ doNotTrack: '1' }, { doNotTrack: 'yes' }, { globalPrivacyControl: true }, { webdriver: true }]) {
    assert.equal(fieldVitalsAllowed(browser({ navigator }), 'true', true), false);
  }
  assert.equal(fieldVitalsAllowed(browser({ companionPerformanceFixture: true }), 'true', true), false);
});

test('routes and browser profiles are fixed classes, not identifiers or raw user agents', () => {
  assert.equal(routeClass('/uc-companion/product/private-customer-id'), 'product');
  assert.equal(routeClass('/guide/private-slug'), 'guide');
  assert.equal(routeClass('/blog/private-article-slug'), 'article');
  assert.equal(routeClass('/auth/reset-password'), 'other');
  assert.equal(routeClass('/arbitrary/private'), 'other');
  assert.equal(routeClass('/uc-companion/'), 'home');
  assert.equal(browserProfile('Mozilla Android Chrome/123 Mobile'), 'chromium-mobile');
  assert.equal(browserProfile('Mozilla iPhone CriOS/123 Mobile Safari'), 'webkit-mobile');
  assert.equal(browserProfile('Firefox/123 desktop'), 'firefox-desktop');
  assert.equal(browserProfile('private-user-agent'), 'other-desktop');
});

test('metrics are rounded, allowlisted, finite and drop unexpected fields', () => {
  assert.deepEqual(sanitizeVitalPayload({ ...valid, customerId: 'private', token: 'private', url: '/secret' }),
    { ...valid, value: 1235 });
  assert.equal(sanitizeVitalPayload({ ...valid, metric: 'CLS', value: 0.12345 })?.value, 0.123);
  for (const value of [-1, NaN, Infinity, '123']) assert.equal(sanitizeVitalPayload({ ...valid, value }), undefined);
  for (const mutation of [
    { environment: 'fixture' }, { metric: 'FCP' }, { routeClass: '/account/private' },
    { build: 'release?token=private' }, { build: '' }, { schema: 2 }, { browserProfile: 'raw-ua' },
  ]) assert.equal(sanitizeVitalPayload({ ...valid, ...mutation }), undefined);
});

test('field transport reconstructs metadata and excludes every identity/URL/attribution field', () => {
  const payload = sanitizeTrackerMetadata('event', {
    website: 'wrong', hostname: 'wrong', name: FIELD_VITAL_EVENT,
    url: '/auth/reset?resetToken=private', referrer: 'https://private.test/path',
    id: 'customer', tag: 'private', title: 'input text', screen: '1111x2222', language: 'private',
    data: { ...valid, entries: [{ target: 'private-input' }], interactionId: 123, customerId: 'private' },
  });
  assert.deepEqual(payload, {
    website: UMAMI_WEBSITE_ID, hostname: 'app.ucfilters.com',
    url: '/field-vitals/home', referrer: '', title: 'Companion field vitals',
    name: FIELD_VITAL_EVENT, data: { ...valid, value: 1235 },
  });
  assert.equal(sanitizeTrackerMetadata('identify', { name: FIELD_VITAL_EVENT, data: valid }), false);
  assert.equal(sanitizeTrackerMetadata('event', { name: FIELD_VITAL_EVENT, data: { ...valid, value: NaN } }), false);
});

test('latest reading sent once per metric lifecycle; missing INP is not zero, BFCache can report again', () => {
  const samples: VitalPayload[] = [];
  const buffer = createVitalBuffer(dimensions, payload => samples.push(payload));
  buffer.report({ name: 'LCP', id: 'internal-1', value: 100 });
  buffer.report({ name: 'LCP', id: 'internal-1', value: 200 });
  buffer.report({ name: 'CLS', id: 'internal-2', value: 0 });
  assert.equal(samples.length, 0);
  buffer.flush();
  buffer.flush();
  buffer.report({ name: 'LCP', id: 'internal-1', value: 300 });
  buffer.flush();
  assert.deepEqual(samples.map(s => [s.metric, s.value]), [['LCP', 200], ['CLS', 0]]);
  buffer.report({ name: 'INP', id: 'internal-3', value: 176 });
  buffer.report({ name: 'LCP', id: 'bfcache-new-id', value: 60 });
  buffer.flush();
  assert.deepEqual(samples.slice(2).map(s => [s.metric, s.value]), [['INP', 176], ['LCP', 60]]);
  assert.ok(samples.every(s => !JSON.stringify(s).includes('internal')));
});

test('failed sends never replay or throw', () => {
  let sends = 0;
  const buffer = createVitalBuffer(dimensions, () => { sends++; throw new Error('offline'); });
  buffer.report({ name: 'INP', id: 'private', value: 150 });
  assert.doesNotThrow(() => buffer.flush());
  buffer.flush();
  assert.equal(sends, 1);
});

test('native collector is empty; root uses platform resolution and lab script suppresses analytics', () => {
  const native = readFileSync(new URL('../companionFieldVitals.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(native, /import |PerformanceObserver|window\.|web-vitals/);
  const web = readFileSync(new URL('../companionFieldVitals.web.ts', import.meta.url), 'utf8');
  assert.match(web, /import\('web-vitals'\)/);
  assert.match(web, /EXPO_PUBLIC_COMPANION_FIELD_VITALS_ENABLED/);
  assert.match(web, /EXPO_PUBLIC_PREVIEW_SAFE_MODE/);
  assert.match(web, /queueMicrotask\(buffer.flush\)/);
  const lab = readFileSync(new URL('../../scripts/measure-canonical.cjs', import.meta.url), 'utf8');
  assert.match(lab, /window.companionPerformanceFixture = true/);
  assert.match(lab, /route => route.abort\(\)/);
  assert.match(lab, /evidence: 'lab', analyticsSuppressed: true/);
});