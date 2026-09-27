/**
 * Regression tests: recordPerformanceCheckIn stores adjustedOffsets even when
 * the user has denied push-notification permission or disabled local reminders.
 *
 * Why: the task requires server-side email/SMS/WhatsApp reminders to fire on
 * the adjusted dates. Those channels have their own opt-in model and are
 * independent of local push-notification permission. Before this fix, the
 * adjusted offsets (and effectiveLifespanDays) were only persisted inside the
 * `status === 'granted'` branch, leaving server reminders on the rated schedule
 * for users who denied notifications.
 *
 * Run with: pnpm --filter @workspace/uc-companion test
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// @ts-ignore
import {
  _scheduled as _scheduledIds,
  _reset as _resetNotifs,
  _setPermissionStatus as _setPermission,
} from 'expo-notifications';
// @ts-ignore
import AsyncStorageStub from '@react-native-async-storage/async-storage';

const _storage: Map<string, string> = (AsyncStorageStub as any)._storage;
const _resetStorage: () => void     = (AsyncStorageStub as any)._reset;

import { recordPerformanceCheckIn } from '../useNotifications.js';

const FILTER_ACTIVATION_KEY = 'uc_filter_activation';
const DAY = 86_400_000;

/** Seed a trackable activation (surface water → effective lifespan < rated). */
function seedActivation(override: Record<string, unknown> = {}): void {
  const base: Record<string, unknown> = {
    productId:       1,
    productName:     'Hydra Flux',
    activatedAt:     new Date(Date.now() - 30 * DAY).toISOString(),
    lifespanDays:    90,
    cleanCount:      0,
    lastWaterSource: 'surface',   // 0.55× factor → effDays ≈ 49 < 90
    notifIds:        ['old-1', 'old-2'],
  };
  _storage.set(FILTER_ACTIVATION_KEY, JSON.stringify({ ...base, ...override }));
}

// Suppress syncReminderToServer network calls — fire-and-forget, token check short-circuits.
(globalThis as any).fetch = async () => ({ ok: true });

describe('recordPerformanceCheckIn — denied push permission', () => {
  beforeEach(() => {
    _resetNotifs();
    _resetStorage();
    _setPermission('denied');
    (globalThis as any).fetch = async () => ({ ok: true });
  });

  it('stores adjustedOffsets in AsyncStorage even when push permission is denied', async () => {
    seedActivation();

    const result = await recordPerformanceCheckIn({
      date:           new Date().toISOString(),
      flowRate:       'slow',
      taste:          'slight',
      waterSource:    'surface',
      recommendation: 'clean',
    });

    assert.ok(result !== null, 'recordPerformanceCheckIn must return updated activation');
    assert.ok(
      result!.adjustedOffsets != null,
      'adjustedOffsets must be stored even when notification permission is denied — ' +
      'server reminders (email/SMS/WhatsApp) use these offsets independently of push permission',
    );
    assert.ok(
      typeof result!.adjustedOffsets!.replace30 === 'number' &&
      result!.adjustedOffsets!.replace30 > 0,
      `replace30 must be a positive number, got: ${JSON.stringify(result!.adjustedOffsets)}`,
    );

    // Verify AsyncStorage also has the offsets persisted.
    const stored = JSON.parse(_storage.get(FILTER_ACTIVATION_KEY) ?? 'null');
    assert.ok(stored !== null, 'activation must be written to AsyncStorage');
    assert.deepEqual(
      stored.adjustedOffsets,
      result!.adjustedOffsets,
      'AsyncStorage activation must match the returned activation.adjustedOffsets',
    );
  });

  it('schedules no local phone notifications when push permission is denied', async () => {
    seedActivation();

    await recordPerformanceCheckIn({
      date:           new Date().toISOString(),
      flowRate:       'slow',
      taste:          'slight',
      waterSource:    'surface',
      recommendation: 'clean',
    });

    assert.equal(
      _scheduledIds.length,
      0,
      'no phone notifications must be scheduled when push permission is denied',
    );
  });

  it('clears adjustedOffsets on a good recommendation regardless of permission', async () => {
    // Seed an activation that already has stale adjustedOffsets from a previous
    // check-in — a good check-in should clear them even with denied permission.
    seedActivation({ adjustedOffsets: { replace30: 40, replace15: 50 } });

    const result = await recordPerformanceCheckIn({
      date:           new Date().toISOString(),
      flowRate:       'normal',
      taste:          'none',
      waterSource:    'surface',
      recommendation: 'good',
    });

    assert.ok(result !== null);
    assert.equal(
      result!.adjustedOffsets,
      undefined,
      'adjustedOffsets must be cleared on a good recommendation',
    );
  });
});
