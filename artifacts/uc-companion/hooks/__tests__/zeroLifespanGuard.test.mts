/**
 * Regression tests: a filter with no lifespan (lifespanDays <= 0) must never
 * produce replacement-offer notifications, even if it slips past the picker
 * (which already excludes such products) and reaches the scheduler directly
 * or via syncActivationWithCatalogue.
 *
 * Scenario: a registered product's `filter_lifespan_days` meta is removed
 * from the store, so the catalogue reports lifespanDays = 0. Without a guard,
 * the offset math (offset4/offset5 clamping) would still schedule "replace in
 * ~30 days" offers at nonsensical dates.
 *
 * Also covers the zero-lifespan notice flag (uc_zero_lifespan_notice) that the
 * UI reads to show a non-blocking "reminder accuracy can't be confirmed" banner.
 *
 * Run with: pnpm --filter @workspace/uc-companion test
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// @ts-ignore — stubs export private helpers not present in real package types
import notifStub from 'expo-notifications';
// @ts-ignore
import AsyncStorageStub from '@react-native-async-storage/async-storage';

const _requests: Array<{ id: string; content: any; trigger: any }> =
  (notifStub as any)._requests;
const _resetNotifs: () => void = (notifStub as any)._reset;
const _storage: Map<string, string> = (AsyncStorageStub as any)._storage;
const _resetStorage: () => void = (AsyncStorageStub as any)._reset;

import {
  scheduleAllFilterNotifications,
  syncActivationWithCatalogue,
  getZeroLifespanNotice,
  clearFilterActivation,
} from '../useNotifications.js';

const ZERO_LIFESPAN_KEY = 'uc_zero_lifespan_notice';

const DAY = 86_400_000;
const DISPENSER = { id: 8574, name: 'Ultra Clear Wireless Dispenser Filter' };

describe('zero-lifespan guard', () => {
  beforeEach(() => { _resetStorage(); _resetNotifs(); });

  it('scheduleAllFilterNotifications with lifespanDays = 0 persists the activation but schedules nothing', async () => {
    const activatedAt = new Date().toISOString();
    const a = await scheduleAllFilterNotifications({
      activatedAt, productId: DISPENSER.id, productName: DISPENSER.name, lifespanDays: 0,
    });
    assert.equal(_requests.length, 0, 'no notifications must be scheduled');
    assert.deepEqual(a.notifIds, []);
    // Activation still persisted so the app state stays consistent.
    const stored = JSON.parse(_storage.get('uc_filter_activation')!);
    assert.equal(stored.lifespanDays, 0);
    assert.deepEqual(stored.notifIds, []);
  });

  it('scheduleAllFilterNotifications with a negative lifespan schedules nothing', async () => {
    await scheduleAllFilterNotifications({
      activatedAt: new Date().toISOString(),
      productId: DISPENSER.id, productName: DISPENSER.name, lifespanDays: -5,
    });
    assert.equal(_requests.length, 0);
  });

  it('rescheduling with lifespan 0 cancels the previously scheduled cycle', async () => {
    const activatedAt = new Date().toISOString();
    const first = await scheduleAllFilterNotifications({
      activatedAt, productId: DISPENSER.id, productName: DISPENSER.name, lifespanDays: 60,
    });
    assert.ok(first.notifIds.length > 0, 'sanity: healthy lifespan schedules notifications');

    const before = _requests.length;
    const rescheduled = await scheduleAllFilterNotifications({
      activatedAt, productId: DISPENSER.id, productName: DISPENSER.name, lifespanDays: 0,
    });
    // Previous cycle cancelled (stub records cancels), no new ones scheduled.
    const _cancelled: string[] = (notifStub as any)._cancelled;
    for (const id of first.notifIds) {
      assert.ok(_cancelled.includes(id), `previous notification ${id} must be cancelled`);
    }
    assert.equal(_requests.length, before, 'no new notifications scheduled');
    assert.deepEqual(rescheduled.notifIds, []);
  });

  it('syncActivationWithCatalogue refuses a catalogue lifespan dropping to 0 and keeps the existing schedule', async () => {
    const activatedAt = new Date(Date.now() - 10 * DAY).toISOString();
    const existing = await scheduleAllFilterNotifications({
      activatedAt, productId: DISPENSER.id, productName: DISPENSER.name, lifespanDays: 60,
    });
    const before = _requests.length;
    assert.ok(before > 0, 'sanity: existing registration has a schedule');

    const res = await syncActivationWithCatalogue([{ ...DISPENSER, lifespanDays: 0 }]);
    assert.equal(res, null, 'sync must refuse a zero lifespan');
    assert.equal(_requests.length, before, 'existing schedule must be untouched');
    const stored = JSON.parse(_storage.get('uc_filter_activation')!);
    assert.equal(stored.lifespanDays, 60, 'stored lifespan must not be overwritten with 0');
    assert.deepEqual(stored.notifIds, existing.notifIds);
  });

  it('syncActivationWithCatalogue still applies a valid lifespan correction', async () => {
    const activatedAt = new Date().toISOString();
    await scheduleAllFilterNotifications({
      activatedAt, productId: DISPENSER.id, productName: DISPENSER.name, lifespanDays: 60,
    });
    const res = await syncActivationWithCatalogue([{ ...DISPENSER, lifespanDays: 90 }]);
    assert.ok(res, 'a positive lifespan change must still sync');
    assert.equal(res!.lifespanDays, 90);
  });

  // ── Zero-lifespan notice flag ───────────────────────────────────────────────

  it('scheduleAllFilterNotifications with lifespan 0 sets the notice flag', async () => {
    await scheduleAllFilterNotifications({
      activatedAt: new Date().toISOString(),
      productId: DISPENSER.id, productName: DISPENSER.name, lifespanDays: 0,
    });
    assert.equal(_storage.get(ZERO_LIFESPAN_KEY), 'true', 'notice flag must be set');
    assert.equal(await getZeroLifespanNotice(), true);
  });

  it('scheduleAllFilterNotifications with a positive lifespan clears the notice flag', async () => {
    // Pre-seed the notice as if it was set by a prior bad sync
    _storage.set(ZERO_LIFESPAN_KEY, 'true');
    await scheduleAllFilterNotifications({
      activatedAt: new Date().toISOString(),
      productId: DISPENSER.id, productName: DISPENSER.name, lifespanDays: 60,
    });
    assert.equal(_storage.has(ZERO_LIFESPAN_KEY), false, 'notice flag must be cleared');
    assert.equal(await getZeroLifespanNotice(), false);
  });

  it('syncActivationWithCatalogue sets the notice flag when catalogue lifespan drops to 0', async () => {
    const activatedAt = new Date(Date.now() - 10 * DAY).toISOString();
    await scheduleAllFilterNotifications({
      activatedAt, productId: DISPENSER.id, productName: DISPENSER.name, lifespanDays: 60,
    });
    // Reset the notice that scheduleAllFilterNotifications may have already cleared
    _storage.delete(ZERO_LIFESPAN_KEY);

    await syncActivationWithCatalogue([{ ...DISPENSER, lifespanDays: 0 }]);
    assert.equal(_storage.get(ZERO_LIFESPAN_KEY), 'true', 'notice flag must be set after a zero-lifespan sync');
    assert.equal(await getZeroLifespanNotice(), true);
  });

  it('syncActivationWithCatalogue sets the notice flag idempotently (no duplicate writes)', async () => {
    const activatedAt = new Date(Date.now() - 5 * DAY).toISOString();
    await scheduleAllFilterNotifications({
      activatedAt, productId: DISPENSER.id, productName: DISPENSER.name, lifespanDays: 60,
    });
    _storage.delete(ZERO_LIFESPAN_KEY);

    // Call sync twice with zero lifespan
    await syncActivationWithCatalogue([{ ...DISPENSER, lifespanDays: 0 }]);
    await syncActivationWithCatalogue([{ ...DISPENSER, lifespanDays: 0 }]);
    assert.equal(_storage.get(ZERO_LIFESPAN_KEY), 'true', 'notice flag must still be set after repeated zero-lifespan syncs');
  });

  it('syncActivationWithCatalogue clears the notice flag when the catalogue restores a valid lifespan', async () => {
    const activatedAt = new Date(Date.now() - 10 * DAY).toISOString();
    await scheduleAllFilterNotifications({
      activatedAt, productId: DISPENSER.id, productName: DISPENSER.name, lifespanDays: 60,
    });
    // Simulate a prior bad sync having set the notice
    _storage.set(ZERO_LIFESPAN_KEY, 'true');

    // Now the catalogue has a valid lifespan again (same as stored — no rescheduling)
    const res = await syncActivationWithCatalogue([{ ...DISPENSER, lifespanDays: 60 }]);
    assert.equal(res, null, 'no rescheduling needed when lifespan matches');
    assert.equal(_storage.has(ZERO_LIFESPAN_KEY), false, 'notice flag must be cleared when catalogue lifespan is valid');
    assert.equal(await getZeroLifespanNotice(), false);
  });

  it('syncActivationWithCatalogue clears the notice flag when a lifespan correction is applied', async () => {
    const activatedAt = new Date().toISOString();
    await scheduleAllFilterNotifications({
      activatedAt, productId: DISPENSER.id, productName: DISPENSER.name, lifespanDays: 60,
    });
    _storage.set(ZERO_LIFESPAN_KEY, 'true');

    const res = await syncActivationWithCatalogue([{ ...DISPENSER, lifespanDays: 90 }]);
    assert.ok(res, 'lifespan correction must apply');
    assert.equal(_storage.has(ZERO_LIFESPAN_KEY), false, 'notice flag must be cleared after a valid sync');
    assert.equal(await getZeroLifespanNotice(), false);
  });

  it('clearFilterActivation clears the notice flag', async () => {
    const activatedAt = new Date().toISOString();
    await scheduleAllFilterNotifications({
      activatedAt, productId: DISPENSER.id, productName: DISPENSER.name, lifespanDays: 0,
    });
    assert.equal(await getZeroLifespanNotice(), true, 'sanity: notice is set before clear');
    await clearFilterActivation();
    assert.equal(await getZeroLifespanNotice(), false, 'notice flag must be cleared after clearFilterActivation');
  });
});
