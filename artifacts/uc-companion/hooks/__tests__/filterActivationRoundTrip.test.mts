/**
 * Round-trip tests for the filter activation record (useNotifications.ts):
 * scheduleAllFilterNotifications → getFilterActivation → clearFilterActivation.
 *
 * Also serves as the regression check that every native module imported by
 * the hooks (react-native, expo-notifications,
 * @react-native-async-storage/async-storage) is stubbed in
 * hooks/node_modules/ — a missing stub crashes this suite at import time.
 *
 * Run with: pnpm --filter @workspace/uc-companion test
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// @ts-ignore — stubs export private helpers not present in real package types
import notifStub from 'expo-notifications';
// @ts-ignore
import AsyncStorageStub from '@react-native-async-storage/async-storage';

import {
  scheduleAllFilterNotifications,
  getFilterActivation,
  clearFilterActivation,
} from '../useNotifications.js';

const stubState = notifStub as unknown as {
  _scheduled: string[];
  _cancelled: string[];
  _reset: () => void;
};
const storage = AsyncStorageStub as unknown as {
  _storage: Map<string, string>;
  _reset: () => void;
};

describe('filter activation round-trip', () => {
  beforeEach(() => {
    stubState._reset();
    storage._reset();
  });

  it('returns null when nothing is stored', async () => {
    assert.equal(await getFilterActivation(), null);
  });

  it('persists an activation and reads it back unchanged', async () => {
    const activatedAt = new Date().toISOString();
    const saved = await scheduleAllFilterNotifications({
      activatedAt,
      productId: 11,
      productName: 'Sweet Home',
      lifespanDays: 120,
      sourceOrderId: 4711,
    });

    const loaded = await getFilterActivation();
    assert.ok(loaded, 'activation should be readable after scheduling');
    assert.equal(loaded!.productId, 11);
    assert.equal(loaded!.productName, 'Sweet Home');
    assert.equal(loaded!.lifespanDays, 120);
    assert.equal(loaded!.activatedAt, activatedAt);
    assert.equal(loaded!.sourceOrderId, 4711);
    assert.deepEqual(loaded!.notifIds, saved.notifIds);
  });

  it('clearFilterActivation removes the record and cancels notifications', async () => {
    const saved = await scheduleAllFilterNotifications({
      activatedAt: new Date().toISOString(),
      productId: 7,
      productName: 'Survivor Straw',
      lifespanDays: 120,
    });

    await clearFilterActivation();

    assert.equal(await getFilterActivation(), null);
    for (const id of saved.notifIds) {
      assert.ok(
        stubState._cancelled.includes(id),
        `scheduled notification ${id} should be cancelled on clear`
      );
    }
  });

  it('keeps complete filter state isolated when switching between accounts', async () => {
    const userA = 101;
    const userB = 202;
    const activatedAt = '2026-08-01T10:00:00.000Z';
    const checkIn = {
      date: '2026-08-20T10:00:00.000Z',
      flowRate: 'slow' as const,
      taste: 'slight' as const,
      waterSource: 'borehole' as const,
      recommendation: 'clean' as const,
    };

    const savedA = await scheduleAllFilterNotifications({
      activatedAt,
      productId: 11,
      productName: 'Sweet Home',
      lifespanDays: 120,
      cleanCount: 2,
      lastCleanedAt: '2026-08-21T10:00:00.000Z',
      lastWaterSource: 'borehole',
      lastCheckIn: checkIn,
      checkIns: [checkIn],
      adjustedOffsets: { replace30: 70, replace15: 85 },
    }, userA);

    assert.equal(await getFilterActivation(userB), null);
    assert.deepEqual(await getFilterActivation(userA), savedA);

    const savedB = await scheduleAllFilterNotifications({
      activatedAt: '2026-09-01T10:00:00.000Z',
      productId: 7,
      productName: 'Survivor Straw',
      lifespanDays: 90,
    }, userB);

    assert.deepEqual(
      await getFilterActivation(userB),
      JSON.parse(JSON.stringify(savedB)),
    );
    assert.deepEqual(await getFilterActivation(userA), savedA);
  });

  it('migrates the complete legacy activation to only the first signed-in account', async () => {
    const legacy = {
      activatedAt: '2026-07-01T08:30:00.000Z',
      productId: 11,
      productName: 'Sweet Home',
      lifespanDays: 120,
      notifIds: ['legacy-1', 'legacy-2'],
      cleanCount: 1,
      lastCleanedAt: '2026-07-20T08:30:00.000Z',
      lastWaterSource: 'surface' as const,
      lastCheckIn: {
        date: '2026-07-19T08:30:00.000Z',
        flowRate: 'very_slow' as const,
        taste: 'strong' as const,
        waterSource: 'surface' as const,
        recommendation: 'replace' as const,
      },
      checkIns: [{
        date: '2026-07-19T08:30:00.000Z',
        flowRate: 'very_slow' as const,
        taste: 'strong' as const,
        waterSource: 'surface' as const,
        recommendation: 'replace' as const,
      }],
      adjustedOffsets: { replace30: 45, replace15: 60 },
    };
    storage._storage.set('uc_filter_activation', JSON.stringify(legacy));
    storage._storage.set('uc_filter_last_changed', '1782894600000');

    assert.deepEqual(await getFilterActivation(303), legacy);
    assert.deepEqual(
      JSON.parse(storage._storage.get('uc_filter_activation_303')!),
      legacy,
    );
    assert.equal(storage._storage.get('uc_filter_last_changed_303'), '1782894600000');
    assert.equal(storage._storage.has('uc_filter_activation'), false);
    assert.equal(storage._storage.has('uc_filter_last_changed'), false);
    assert.equal(await getFilterActivation(404), null);
    assert.deepEqual(await getFilterActivation(303), legacy);
  });

  it('allows only one account to claim legacy state when first loads overlap', async () => {
    const legacy = {
      activatedAt: '2026-07-01T08:30:00.000Z',
      productId: 11,
      productName: 'Sweet Home',
      lifespanDays: 120,
      notifIds: ['legacy-1'],
    };
    storage._storage.set('uc_filter_activation', JSON.stringify(legacy));

    const [accountA, accountB] = await Promise.all([
      getFilterActivation(505),
      getFilterActivation(606),
    ]);

    assert.deepEqual(accountA, legacy);
    assert.equal(accountB, null);
    assert.deepEqual(await getFilterActivation(505), legacy);
    assert.equal(await getFilterActivation(606), null);
  });
});
