import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { calculateRemainingLife, resolveCapacityCycle } from '../filterRemainingLife';
import { effectiveLifespanDays } from '../../hooks/useNotifications';
import notifications from 'expo-notifications';
import { _storage as storage } from '@react-native-async-storage/async-storage';

const start = Date.parse('2026-01-01T00:00:00.000Z');
const day = 86_400_000;
const activation = {
  productId: 1, productName: 'Filter', activatedAt: new Date(start).toISOString(),
  lifespanDays: 100, sourceOrderId: 5, notifIds: ['unchanged'],
  cleanCount: 1, adjustedOffsets: { replace30: 50, replace15: 65 },
};
const filter = {
  id: 9, userId: 123, productId: 1, sourceOrderId: 5, activatedAt: activation.activatedAt,
  ratedCapacityLitres: 100, usedLitres: 0, verificationStatus: 'approved', capacityUsageValid: true,
};
const life = (elapsed: number, used = 0) =>
  calculateRemainingLife(activation, 100, { ...filter, usedLitres: used }, start + elapsed * day);

describe('display-only filter remaining life', () => {
  for (const [elapsed, percent, status] of [[0, 100, 'green'], [30, 70, 'green'],
    [30.01, 69.99, 'amber'], [60, 40, 'amber'], [60.01, 39.99, 'red'],
    [100, 0, 'red'], [150, 0, 'red']] as const) {
    it(`${percent}% remaining is ${status}`, () => {
      assert.ok(Math.abs(life(elapsed).percent! - percent) < 0.000001);
      assert.equal(life(elapsed).status, status);
    });
  }
  it('uses whichever of time and capacity is more depleted', () => {
    assert.equal(life(10, 60).percent, 40);
    assert.equal(life(70, 10).percent, 30);
    assert.equal(life(0, 100).percent, 0);
    assert.equal(life(0, 150).percent, 0);
    assert.equal(life(0, 30).status, 'green');
    assert.equal(life(0, 30.001).status, 'amber');
    assert.equal(life(0, 60).status, 'amber');
    assert.equal(life(0, 60.001).status, 'red');
  });
  it('invalid and missing inputs do not invent full capacity or time', () => {
    for (const used of [NaN, Infinity, -1]) {
      const result = calculateRemainingLife(activation, 100, { ...filter, usedLitres: used }, start + 60 * day);
      assert.equal(result.percent, 40);
      assert.equal(result.capacityPercent, null);
      assert.equal(result.basis, 'Time-based status');
    }
    for (const ratedCapacityLitres of [NaN, Infinity, -1, 0]) {
      assert.equal(calculateRemainingLife(activation, 100, { ...filter, ratedCapacityLitres }, start).capacityPercent, null);
    }
    for (const activatedAt of ['bad date', '2026-02-30T00:00:00Z', new Date(start + day).toISOString()]) {
      assert.equal(calculateRemainingLife({ ...activation, activatedAt }, 100, filter, start).percent, null);
    }
    assert.equal(calculateRemainingLife({ ...activation, lifespanDays: 0 }, 21, null, start).status, 'unavailable');
    assert.equal(calculateRemainingLife(activation, NaN, null, start).percent, null);
    assert.equal(calculateRemainingLife(activation, NaN, filter, start).basis, 'Recorded litres only · time unavailable');
  });
  it('updates over time without touching activation, cleaning, storage or notifications', () => {
    const snapshot = JSON.stringify(activation);
    // The existing effective-life calculation is used without altering it.
    assert.equal(effectiveLifespanDays(activation), 80);
    assert.equal(calculateRemainingLife(activation, 80, null, start + 24 * day).percent, 70);
    const scheduledBefore = (notifications as any)._scheduled.length;
    const cancelledBefore = (notifications as any)._cancelled.length;
    const storageBefore = JSON.stringify([...storage.entries()]);
    for (let d = 0; d <= 101; d++) life(d, d);
    assert.equal(life(100).percent, 0);
    assert.equal(JSON.stringify(activation), snapshot);
    assert.equal((notifications as any)._scheduled.length, scheduledBefore);
    assert.equal((notifications as any)._cancelled.length, cancelledBefore);
    assert.equal(JSON.stringify([...storage.entries()]), storageBefore);
  });
});

describe('capacity cycle identity', () => {
  it('resolves only authenticated, approved exact purchase and date links', () => {
    assert.deepEqual(resolveCapacityCycle(activation, [filter], 123), filter);
    for (const patch of [{ userId: 456 }, { productId: 2 }, { sourceOrderId: 6 },
      { activatedAt: new Date(start - day).toISOString() }, { verificationStatus: 'pending_review' },
      { capacityUsageValid: false }, { capacityUsageValid: undefined }]) {
      assert.equal(resolveCapacityCycle(activation, [{ ...filter, ...patch }], 123), null);
    }
    assert.equal(resolveCapacityCycle(activation, [filter], 456), null);
    assert.equal(resolveCapacityCycle(activation, [filter], undefined), null);
    assert.equal(resolveCapacityCycle({ ...activation, sourceOrderId: undefined }, [filter], 123), null);
    assert.equal(resolveCapacityCycle({ ...activation, registeredFilterId: 10 }, [filter], 123), null);
    assert.equal(resolveCapacityCycle(activation, undefined, 123), null);
  });
  it('ambiguous legacy links fall back rather than pick a product or newest row', () => {
    assert.equal(resolveCapacityCycle(activation, [filter, { ...filter, id: 10 }], 123), null);
    assert.equal(resolveCapacityCycle({ ...activation, registeredFilterId: 9 }, [filter, { ...filter, id: 10 }], 123), null);
    assert.equal(resolveCapacityCycle(activation, [filter, { ...filter, id: 10, sourceOrderId: 6 }], 123)?.id, 9);
  });
});