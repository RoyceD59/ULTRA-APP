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
});
