/**
 * Regression tests: replacement reminders for a product that gains a
 * `filter_lifespan_days` meta value AFTER customers already purchased it
 * (e.g. the Ultra Clear Wireless Dispenser Filter, product 8574).
 *
 * The reminder pipeline is catalogue-driven and mobile-side:
 *   - /api/uc/products maps the Woo meta to `lifespanDays` (API tests cover this)
 *   - the picker only offers products with lifespanDays > 0 (toFilterProducts)
 *   - registering a filter calls scheduleAllFilterNotifications with
 *     activatedAt = purchase date (backdated via day offset) and the
 *     catalogue lifespan — so pre-meta purchasers get a correct schedule
 *   - syncActivationWithCatalogue reschedules an existing registration when
 *     the catalogue lifespan changes, preserving the original activation date
 *
 * Covers:
 *   1. Picker: lifespan 0 product (Portable Pump 8147) excluded; Dispenser
 *      Filter included once its lifespan is set
 *   2. New purchaser (activated today): full 5-stage cycle at the correct
 *      day offsets for the newly set lifespan
 *   3. Existing purchaser (backdated activation): past notifications skipped,
 *      remaining ones land at purchase_date + offset
 *   4. Catalogue lifespan change: sync reschedules from the ORIGINAL
 *      activation date, so the cycle still ends at purchase_date + lifespan
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
} from '../useNotifications.js';
import { toFilterProducts } from '../useFilterProducts.js';

const DAY = 86_400_000;
const DISPENSER = { id: 8574, name: 'Ultra Clear Wireless Dispenser Filter' };
const PUMP      = { id: 8147, name: 'Ultra Clear Portable Water Filter Pump' };

/** Day offsets (from activation) of every scheduled notification, sorted. */
function scheduledOffsetsDays(activatedAt: string): number[] {
  const activationMs = new Date(activatedAt).getTime();
  const now = Date.now();
  return _requests
    .map(r => (now + r.trigger.seconds * 1000 - activationMs) / DAY)
    .sort((a, b) => a - b);
}

function assertOffsets(actual: number[], expected: number[], tolDays = 0.01) {
  assert.equal(actual.length, expected.length,
    `expected ${expected.length} notifications, got ${actual.length}: [${actual.map(n => n.toFixed(2))}]`);
  expected.forEach((e, i) => {
    assert.ok(Math.abs(actual[i] - e) < tolDays,
      `notification ${i}: expected day ${e}, got ${actual[i].toFixed(3)}`);
  });
}

describe('replacement reminders for a newly set lifespan', () => {
  beforeEach(() => { _resetStorage(); _resetNotifs(); });

  it('picker excludes the lifespan-0 Pump and includes the Dispenser once its lifespan is set', () => {
    const catalogue = toFilterProducts([
      { ...DISPENSER, lifespanDays: 60 } as any,
      { ...PUMP,      lifespanDays: 0  } as any,
      { id: 9999, name: 'No-meta live product' } as any, // lifespan undefined
    ]);
    assert.deepEqual(catalogue.map(p => p.id), [DISPENSER.id]);
    assert.equal(catalogue[0]!.lifespanDays, 60);
  });

  it('new purchaser (activated today, lifespan 60): activation +2h, day-30 check, offers at day 30 and 45', async () => {
    const activatedAt = new Date().toISOString();
    const a = await scheduleAllFilterNotifications({
      activatedAt, productId: DISPENSER.id, productName: DISPENSER.name, lifespanDays: 60,
    });
    // +2h activation nudge, day-30 check-in (60 > 45), no day-60 check (60 ≤ 75),
    // offer at lifespan−30 = 30, urgent at max(31, lifespan−15) = 45
    assertOffsets(scheduledOffsetsDays(activatedAt), [2 / 24, 30, 30, 45]);
    assert.equal(a.notifIds.length, 4);
    assert.equal(a.lifespanDays, 60);
  });

  it('existing purchaser (bought 20 days before meta was set, lifespan 60): past stages skipped, cycle still keyed to purchase date', async () => {
    const activatedAt = new Date(Date.now() - 20 * DAY).toISOString();
    await scheduleAllFilterNotifications({
      activatedAt, productId: DISPENSER.id, productName: DISPENSER.name, lifespanDays: 60,
    });
    // +2h nudge skipped (>2 days old); day-30 check, day-30 offer, day-45 urgent
    // all still relative to the ORIGINAL purchase date, not "now".
    assertOffsets(scheduledOffsetsDays(activatedAt), [30, 30, 45]);
  });

  it('existing purchaser deep into the cycle (bought 50 days ago, lifespan 60): offers clamp to the near future instead of the past', async () => {
    const activatedAt = new Date(Date.now() - 50 * DAY).toISOString();
    await scheduleAllFilterNotifications({
      activatedAt, productId: DISPENSER.id, productName: DISPENSER.name, lifespanDays: 60,
    });
    // day-30 stages are in the past → skipped; offer clamps to ceil(50)+1 = 51,
    // urgent to 52 — both before the day-60 replacement point.
    assertOffsets(scheduledOffsetsDays(activatedAt), [51, 52]);
  });

  it('current live lifespan (90 days): new purchaser gets offers at day 60 and 75', async () => {
    const activatedAt = new Date().toISOString();
    await scheduleAllFilterNotifications({
      activatedAt, productId: DISPENSER.id, productName: DISPENSER.name, lifespanDays: 90,
    });
    // +2h nudge, day-30 check (90 > 45), day-60 check (90 > 75),
    // offer at 90−30 = 60, urgent at 90−15 = 75
    assertOffsets(scheduledOffsetsDays(activatedAt), [2 / 24, 30, 60, 60, 75]);
  });

  it('catalogue lifespan change reschedules from the ORIGINAL purchase date', async () => {
    const activatedAt = new Date(Date.now() - 10 * DAY).toISOString();
    _storage.set('uc_filter_activation', JSON.stringify({
      productId: DISPENSER.id, productName: DISPENSER.name,
      activatedAt, lifespanDays: 60, notifIds: ['old-1'],
    }));

    const updated = await syncActivationWithCatalogue([
      { ...DISPENSER, lifespanDays: 90 },
    ]);

    assert.ok(updated, 'expected a reschedule for the lifespan change');
    assert.equal(updated!.lifespanDays, 90);
    assert.equal(updated!.activatedAt, activatedAt, 'purchase date must be preserved');
    // Rescheduled cycle relative to the original purchase date:
    // day-30 check (in 20 days), day-60 check, offer day 60, urgent day 75.
    assertOffsets(scheduledOffsetsDays(activatedAt), [30, 60, 60, 75]);
  });

  it('lifespan-0 product never reaches the scheduler through the sync path either', async () => {
    _storage.set('uc_filter_activation', JSON.stringify({
      productId: DISPENSER.id, productName: DISPENSER.name,
      activatedAt: new Date().toISOString(), lifespanDays: 60, notifIds: [],
    }));
    // Pump (lifespan 0) is a different product — no activation for it → no-op.
    const res = await syncActivationWithCatalogue([{ ...PUMP, lifespanDays: 0 }]);
    assert.equal(res, null);
    assert.equal(_requests.length, 0);
  });
});
