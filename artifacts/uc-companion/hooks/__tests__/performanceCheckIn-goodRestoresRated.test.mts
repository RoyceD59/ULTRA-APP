/**
 * Regression tests: a good check-in cancels previously adjusted local
 * notifications and reschedules at rated-lifespan dates, keeping the handset
 * and server reminder schedules in step.
 *
 * Before the fix, recordPerformanceCheckIn cleared adjustedOffsets and synced
 * the server to rated dates but LEFT the old (earlier) adjusted phone
 * notifications intact — diverging from the email/SMS/WhatsApp schedule.
 *
 * Run with: pnpm --filter @workspace/uc-companion test
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// @ts-ignore
import {
  _scheduled,
  _cancelled,
  _reset as _resetNotifs,
} from 'expo-notifications';
// @ts-ignore
import AsyncStorageStub from '@react-native-async-storage/async-storage';

const _storage: Map<string, string> = (AsyncStorageStub as any)._storage;
const _resetStorage: () => void     = (AsyncStorageStub as any)._reset;

import { recordPerformanceCheckIn } from '../useNotifications.js';

const FILTER_ACTIVATION_KEY = 'uc_filter_activation';
const DAY = 86_400_000;

// Suppress syncReminderToServer network calls.
const syncedBodies: string[] = [];
(globalThis as any).fetch = async (_url: string, opts?: { body?: string }) => {
  if (opts?.body) syncedBodies.push(opts.body);
  return { ok: true };
};

/** Seed an activation that already has adjusted notifications from a prior check-in. */
function seedAdjustedActivation(daysAgo = 30, lifespanDays = 90): void {
  const activatedAt = new Date(Date.now() - daysAgo * DAY).toISOString();
  const adjustedOffsets = { replace30: 40, replace15: 50 }; // earlier than rated (60, 75)
  _storage.set(FILTER_ACTIVATION_KEY, JSON.stringify({
    productId:       1,
    productName:     'Hydra Flux',
    activatedAt,
    lifespanDays,
    cleanCount:      2,
    lastWaterSource: 'borehole',  // degraded source that caused the original adjustment
    notifIds:        ['adjusted-notif-1', 'adjusted-notif-2'], // previously scheduled adjusted alerts
    adjustedOffsets,
  }));
}

describe('recordPerformanceCheckIn — good check-in restores rated schedule', () => {
  beforeEach(() => {
    _resetNotifs();
    _resetStorage();
    syncedBodies.length = 0;
    // Seed the consolidated authenticated session so syncReminderToServer fires.
    _storage.set('uc_auth_session', JSON.stringify({
      token: 'test-token',
      user: { id: 1, email: 'test@example.com', firstName: 'Test', lastName: 'User' },
    }));
    (globalThis as any).fetch = async (_url: string, opts?: { body?: string }) => {
      if (opts?.body) syncedBodies.push(opts.body);
      return { ok: true };
    };
  });

  it('cancels previously adjusted notifications on a good check-in', async () => {
    seedAdjustedActivation(30); // 30 days in, replace30 was at day 40 (not yet fired)

    const result = await recordPerformanceCheckIn({
      date:           new Date().toISOString(),
      flowRate:       'normal',
      taste:          'none',
      waterSource:    'tap',
      recommendation: 'good',
    });

    assert.ok(result !== null, 'recordPerformanceCheckIn must succeed');
    assert.ok(
      (_cancelled as string[]).includes('adjusted-notif-1') &&
      (_cancelled as string[]).includes('adjusted-notif-2'),
      'previously adjusted notification IDs must be cancelled on a good check-in — ' +
      `cancelled: ${JSON.stringify(_cancelled)}`,
    );
  });

  it('reschedules replacement alerts at rated-lifespan dates after a good check-in', async () => {
    // 30 days into a 90-day filter; rated replace30 = day 60 (30 days away).
    seedAdjustedActivation(30, 90);

    await recordPerformanceCheckIn({
      date:           new Date().toISOString(),
      flowRate:       'normal',
      taste:          'none',
      waterSource:    'tap',
      recommendation: 'good',
    });

    // The rated replace30 for a 90-day filter at day 30 is day 60 (30 days away).
    // At least one new notification should be scheduled (replace30 or replace15).
    assert.ok(
      (_scheduled as string[]).length > 0,
      'rated-lifecycle notifications must be scheduled after a good check-in replaces adjusted ones',
    );
  });

  it('clears adjustedOffsets from AsyncStorage after a good check-in', async () => {
    seedAdjustedActivation(30, 90);

    const result = await recordPerformanceCheckIn({
      date:           new Date().toISOString(),
      flowRate:       'normal',
      taste:          'none',
      waterSource:    'tap',
      recommendation: 'good',
    });

    assert.ok(result !== null);
    assert.equal(
      result!.adjustedOffsets,
      undefined,
      'adjustedOffsets must be undefined in the returned activation after a good check-in',
    );

    const stored = JSON.parse(_storage.get(FILTER_ACTIVATION_KEY) ?? 'null');
    assert.ok(stored !== null, 'activation must be written to AsyncStorage');
    assert.ok(
      stored.adjustedOffsets == null,
      'adjustedOffsets must be absent from the persisted AsyncStorage activation',
    );
  });

  it('sends a server sync payload with no adjustedReplaceOffsets and no effectiveLifespanDays after a good check-in', async () => {
    seedAdjustedActivation(30, 90);

    await recordPerformanceCheckIn({
      date:           new Date().toISOString(),
      flowRate:       'normal',
      taste:          'none',
      waterSource:    'tap',
      recommendation: 'good',
    });
    // Server sync is deliberately fire-and-forget so local filter scheduling
    // remains available offline. Allow its storage read/fetch microtasks to run.
    await new Promise(resolve => setTimeout(resolve, 0));

    assert.ok(syncedBodies.length > 0, 'syncReminderToServer must fire at least one fetch');

    const payload = JSON.parse(syncedBodies[syncedBodies.length - 1]!);
    const act = payload?.activation ?? {};
    assert.ok(
      !('adjustedReplaceOffsets' in act),
      'adjustedReplaceOffsets must NOT be sent after a good check-in — ' +
      `got: ${JSON.stringify(act)}`,
    );
    assert.ok(
      !('effectiveLifespanDays' in act),
      'effectiveLifespanDays must NOT be sent after a good check-in — ' +
      `got: ${JSON.stringify(act)}`,
    );
  });
});
