/**
 * Unit tests for syncActivationWithCatalogue (useNotifications.ts)
 *
 * Covers:
 *   1. Empty catalogue → returns null
 *   2. No activation stored → returns null
 *   3. Product not in catalogue → returns null
 *   4. Lifespan matches → no-op, returns null
 *   5. Lifespan mismatch → reschedules; activatedAt preserved; old notifIds replaced
 *   6. All non-lifespan fields are preserved across a sync update
 *
 * Run with: pnpm --filter @workspace/uc-companion test
 * Uses Node.js built-in test runner (node:test) — no extra test deps needed.
 *
 * Native dependencies are shadowed by stub packages in hooks/node_modules/,
 * which Node.js resolves before the real packages when the import originates
 * from the hooks/ directory.  The stubs export mutable state so this file can
 * inspect calls and reset between tests.
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// ── Stub state (shared via module cache with the module under test) ────────────
// Both useNotifications.ts and this file resolve to the same stub packages in
// hooks/node_modules/, so they share the same module instances.

// @ts-ignore — stubs export private helpers not present in real package types
import notifStub from 'expo-notifications';
// @ts-ignore
import AsyncStorageStub from '@react-native-async-storage/async-storage';

const _scheduledIds: string[] = (notifStub as any)._scheduled;
const _cancelledIds: string[] = (notifStub as any)._cancelled;
const _resetNotifs: () => void = (notifStub as any)._reset;

const _storage: Map<string, string> = (AsyncStorageStub as any)._storage;
const _resetStorage: () => void     = (AsyncStorageStub as any)._reset;

// ── Module under test ─────────────────────────────────────────────────────────
import {
  getZeroLifespanNotice,
  syncActivationWithCatalogue,
} from '../useNotifications.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

const FILTER_ACTIVATION_KEY = 'uc_filter_activation';
const ZERO_LIFESPAN_KEY = 'uc_zero_lifespan_notice';

/** ISO timestamp for N days ago. */
function daysAgo(n: number): string {
  return new Date(Date.now() - n * 86_400_000).toISOString();
}

/** Seed AsyncStorage with a FilterActivation record. */
function seedActivation(override: Record<string, unknown> = {}): string {
  const base: Record<string, unknown> = {
    productId:    1,
    productName:  'Hydra Flux',
    activatedAt:  daysAgo(1),          // yesterday → future notifications exist
    lifespanDays: 90,
    notifIds:     ['old-notif-1', 'old-notif-2'],
  };
  const merged = { ...base, ...override };
  _storage.set(FILTER_ACTIVATION_KEY, JSON.stringify(merged));
  return merged['activatedAt'] as string;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('syncActivationWithCatalogue', () => {
  beforeEach(() => {
    _resetStorage();
    _resetNotifs();
  });

  it('returns null for an empty catalogue', async () => {
    seedActivation();
    const result = await syncActivationWithCatalogue([]);
    assert.equal(result, null);
  });

  it('returns null when no activation is stored', async () => {
    // _storage is empty — getFilterActivation() returns null
    const result = await syncActivationWithCatalogue([
      { id: 1, lifespanDays: 90, name: 'Hydra Flux' },
    ]);
    assert.equal(result, null);
  });

  it('returns null when the product is not found in the catalogue', async () => {
    seedActivation({ productId: 999 });
    const result = await syncActivationWithCatalogue([
      { id: 1, lifespanDays: 90, name: 'Hydra Flux' },
    ]);
    assert.equal(result, null);
  });

  it('returns null when the catalogue lifespan matches the stored value (no-op guard)', async () => {
    seedActivation({ lifespanDays: 90 });
    const result = await syncActivationWithCatalogue([
      { id: 1, lifespanDays: 90, name: 'Hydra Flux' },
    ]);
    assert.equal(result, null);
  });

  it('persists the untrackable notice after a bad sync and clears it after store data is fixed', async () => {
    seedActivation({ lifespanDays: 90 });

    const badSync = await syncActivationWithCatalogue([
      { id: 1, lifespanDays: 0, name: 'Hydra Flux' },
    ]);

    assert.equal(badSync, null, 'a zero lifespan must not replace the valid activation');
    assert.equal(
      _storage.get(ZERO_LIFESPAN_KEY),
      'true',
      'the bad sync must persist the notice for a later app session',
    );
    assert.equal(
      await getZeroLifespanNotice(),
      true,
      'a fresh notice read after the sync must see the persisted flag',
    );

    const correctiveSync = await syncActivationWithCatalogue([
      { id: 1, lifespanDays: 90, name: 'Hydra Flux' },
    ]);

    assert.equal(correctiveSync, null, 'matching restored data needs no reschedule');
    assert.equal(
      _storage.has(ZERO_LIFESPAN_KEY),
      false,
      'the corrective sync must remove the persisted notice flag',
    );
    assert.equal(
      await getZeroLifespanNotice(),
      false,
      'a fresh notice read must reflect that the store data is valid again',
    );
  });

  it('reschedules and returns an updated activation when the lifespan has changed', async () => {
    const originalActivatedAt = daysAgo(1);
    seedActivation({ lifespanDays: 90, activatedAt: originalActivatedAt });

    const result = await syncActivationWithCatalogue([
      { id: 1, lifespanDays: 120, name: 'Hydra Flux Pro' },
    ]);

    assert.ok(result !== null, 'expected a non-null result for a lifespan change');
    assert.equal(result.lifespanDays, 120,
      'lifespanDays must reflect the catalogue correction');
    assert.equal(result.productName, 'Hydra Flux Pro',
      'productName must be updated from the catalogue');
    assert.equal(result.activatedAt, originalActivatedAt,
      'activatedAt must be unchanged so elapsed-time calculations stay correct');
  });

  it('cancels old notifIds and schedules fresh ones after a lifespan change', async () => {
    seedActivation({ lifespanDays: 90, notifIds: ['old-notif-1', 'old-notif-2'] });

    const result = await syncActivationWithCatalogue([
      { id: 1, lifespanDays: 120, name: 'Hydra Flux Pro' },
    ]);

    assert.ok(result !== null, 'expected a non-null result');

    // Old IDs must have been cancelled
    assert.ok(
      _cancelledIds.includes('old-notif-1') && _cancelledIds.includes('old-notif-2'),
      `old notifIds must be cancelled; got cancelledIds=${JSON.stringify(_cancelledIds)}`,
    );

    // result.notifIds must not contain the old IDs
    const oldSet = new Set(['old-notif-1', 'old-notif-2']);
    const anyOldKept = (result.notifIds ?? []).some(id => oldSet.has(id));
    assert.ok(!anyOldKept,
      `result.notifIds must not contain old IDs; got ${JSON.stringify(result.notifIds)}`);

    // At least one new notification must have been scheduled
    assert.ok(
      (result.notifIds ?? []).length > 0,
      'at least one replacement notification must be scheduled',
    );

    // Every ID in result.notifIds must have come from the stub scheduler
    const scheduledSet = new Set(_scheduledIds);
    for (const id of (result.notifIds ?? [])) {
      assert.ok(
        scheduledSet.has(id),
        `result.notifIds contains '${id}' which was not returned by scheduleNotificationAsync`,
      );
    }
  });

  it('preserves adjustedOffsets from a check-in when the catalogue lifespan changes', async () => {
    // After a performance check-in shortens the effective schedule, a catalogue
    // lifespan correction must not silently erase the check-in-derived offsets.
    // Both handset (scheduleAllFilterNotifications) and server must keep using the
    // same replace30/replace15 dates — otherwise they drift apart.
    const offsets = { replace30: 50, replace15: 60 };
    seedActivation({ lifespanDays: 90, adjustedOffsets: offsets });

    const result = await syncActivationWithCatalogue([
      { id: 1, lifespanDays: 120, name: 'Hydra Flux Pro' },
    ]);

    assert.ok(result !== null, 'expected a non-null result for a lifespan change');
    assert.deepEqual(
      result.adjustedOffsets,
      offsets,
      'adjustedOffsets must survive a catalogue lifespan correction so server and handset fire on the same dates',
    );
  });

  it('preserves all non-lifespan fields across a sync update', async () => {
    const originalActivatedAt = daysAgo(2);
    seedActivation({
      lifespanDays:    90,
      activatedAt:     originalActivatedAt,
      productId:       1,
      registeredFilterId: 91,
      cleanCount:      2,
      lastCleanedAt:   daysAgo(5),
      lastWaterSource: 'borehole',
      checkIns: [
        {
          date:           daysAgo(10),
          flowRate:       'slow',
          taste:          'slight',
          waterSource:    'borehole',
          recommendation: 'clean',
        },
      ],
    });

    const result = await syncActivationWithCatalogue([
      { id: 1, lifespanDays: 120, name: 'Hydra Flux Pro' },
    ]);

    assert.ok(result !== null, 'expected a non-null result');
    assert.equal(result.activatedAt,     originalActivatedAt, 'activatedAt must be preserved');
    assert.equal(result.productId,       1,                   'productId must be preserved');
    assert.equal(result.registeredFilterId, 91, 'capacity cycle identity must survive catalogue sync');
    assert.equal(result.cleanCount,      2,                   'cleanCount must be preserved');
    assert.equal(result.lastWaterSource, 'borehole',          'lastWaterSource must be preserved');
    assert.ok(
      Array.isArray(result.checkIns) && result.checkIns.length === 1,
      'checkIns history must be preserved',
    );
  });
});
