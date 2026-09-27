import assert from 'node:assert/strict';
import test from 'node:test';
import { ANALYTICS_EVENT_NAMES, trackEvent } from '../analytics';

test('analytics exposes only the privacy-safe event contract', () => {
  assert.deepEqual([...ANALYTICS_EVENT_NAMES], [
    'water_check_started',
    'water_check_completed',
    'guide_list_viewed',
    'guide_opened',
    'guide_media_started',
    'guide_media_completed',
    'guide_media_failed',
    'signup_completed',
  ]);
});

test('analytics forwards only typed, allowlisted payloads and remains safe when absent', () => {
  const calls: unknown[] = [];
  Object.assign(globalThis, {
    window: { umami: { track: (...args: unknown[]) => calls.push(args) } },
  });
  trackEvent('signup_completed', { countryCode: 'KE' });
  assert.deepEqual(calls, [['signup_completed', { countryCode: 'KE' }]]);
  delete (globalThis as { window?: unknown }).window;
  assert.doesNotThrow(() => trackEvent('water_check_started', { countryCode: 'KE' }));
});