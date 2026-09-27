import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { MapLocation } from '@/hooks/useApi';
import { filterMapLocations } from '../locationMap';
import {
  LOCATIONS_REFRESH_INTERVAL_MS,
  reconcileSelectedLocation,
  startFocusedLocationRefresh,
  type LocationRefreshScheduler,
} from '../locationRefresh';

const openTap = {
  id: 'tap-open',
  name: 'Open tap',
  address: 'Open Road',
  lat: -1.2,
  lng: 36.8,
  type: 'city_tap',
} as MapLocation;

const closedTap = {
  ...openTap,
  id: 'tap-closed',
  name: 'Tap closed by staff',
} as MapLocation;

describe('focused customer-map location refresh', () => {
  it('refreshes immediately, again within one minute, and stops while off-screen', () => {
    let refreshes = 0;
    let intervalCallback: (() => void) | null = null;
    let scheduledDelay = 0;
    let clearedHandle: ReturnType<typeof setInterval> | null = null;
    const handle = 17 as unknown as ReturnType<typeof setInterval>;
    const scheduler: LocationRefreshScheduler = {
      setInterval(callback, delayMs) {
        intervalCallback = callback;
        scheduledDelay = delayMs;
        return handle;
      },
      clearInterval(value) {
        clearedHandle = value;
        intervalCallback = null;
      },
    };

    const stop = startFocusedLocationRefresh(() => { refreshes += 1; }, scheduler);
    assert.equal(refreshes, 1, 'returning to the map must refresh immediately');
    assert.equal(scheduledDelay, LOCATIONS_REFRESH_INTERVAL_MS);

    assert.ok(intervalCallback);
    (intervalCallback as () => void)();
    assert.equal(refreshes, 2, 'a focused map must refresh after one minute');

    stop();
    assert.equal(clearedHandle, handle);
    assert.equal(intervalCallback, null, 'leaving the map must remove its interval');

    const stopAfterReturn = startFocusedLocationRefresh(() => { refreshes += 1; }, scheduler);
    assert.equal(refreshes, 3, 'returning must not wait for the next interval');
    stopAfterReturn();
  });

  it('removes a deactivated tap from web results and native marker data', () => {
    const beforeRefresh = filterMapLocations([openTap, closedTap], 'Taps');
    assert.deepEqual(beforeRefresh.map(location => location.id), ['tap-open', 'tap-closed']);

    const afterRefresh = filterMapLocations([openTap], 'Taps');
    assert.deepEqual(afterRefresh.map(location => location.id), ['tap-open']);
    assert.equal(afterRefresh.some(location => location.id === closedTap.id), false);
  });

  it('closes an open detail when its tap disappears from refreshed locations', () => {
    assert.equal(reconcileSelectedLocation(closedTap, [openTap, closedTap]), closedTap);
    assert.equal(reconcileSelectedLocation(closedTap, [openTap]), null);
  });
});