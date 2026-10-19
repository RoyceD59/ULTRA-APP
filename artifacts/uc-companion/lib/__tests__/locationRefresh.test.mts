import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { QueryClient, QueryObserver } from '@tanstack/react-query';
import type { MapLocation } from '@/hooks/useApi';
import { filterMapLocations } from '../locationMap';
import {
  LOCATIONS_REFRESH_INTERVAL_MS,
  reconcileSelectedLocation,
  startFocusedLocationRefresh,
  type LocationRefreshScheduler,
} from '../locationRefresh';

function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function fakeScheduler() {
  const callbacks = new Map<ReturnType<typeof setInterval>, () => void>();
  let nextHandle = 0;
  const scheduler: LocationRefreshScheduler = {
    setInterval(callback, delay) {
      assert.equal(delay, LOCATIONS_REFRESH_INTERVAL_MS);
      const handle = ++nextHandle as unknown as ReturnType<typeof setInterval>;
      callbacks.set(handle, callback);
      return handle;
    },
    clearInterval(handle) { callbacks.delete(handle); },
  };
  return {
    scheduler,
    tick: () => { for (const callback of callbacks.values()) callback(); },
    callbacks,
  };
}

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
  for (const platform of ['web', 'native'] as const) {
    it(`${platform}: skips stalled refreshes across ticks and tab switches, then refreshes on return`, async () => {
      // Assert both screens keep the guard outside the focus callback and
      // reuse the same non-cancelling query refetch path tested below.
      const screen = readFileSync(new URL(
        platform === 'web' ? '../../app/(tabs)/map.tsx' : '../../app/(tabs)/map.native.tsx',
        import.meta.url,
      ), 'utf8');
      assert.match(screen, /const locationRefreshState = useRef\(\{ pending: false \}\)/);
      assert.match(screen, /startFocusedLocationRefresh\(\s*\(\) => refetch\(\{ cancelRefetch: false \}\),\s*undefined,\s*locationRefreshState.current/);

      const clock = fakeScheduler();
      const state = { pending: false };
      let request = deferred();
      let calls = 0;
      const refetch = () => { calls++; return request.promise; };
      const stop = startFocusedLocationRefresh(refetch, clock.scheduler, state);
      const queuedTick = [...clock.callbacks.values()][0];
      assert.equal(calls, 1);
      clock.tick();
      clock.tick();
      assert.equal(calls, 1, 'even a multi-minute stall must not overlap requests');
      stop();
      queuedTick();
      assert.equal(calls, 1, 'already queued callbacks must not refresh after blur');
      const stopAfterReturn = startFocusedLocationRefresh(refetch, clock.scheduler, state);
      clock.tick();
      assert.equal(calls, 1, 'returning during a pending request must not replace it');
      request.resolve();
      await request.promise;
      request = deferred();
      clock.tick();
      assert.equal(calls, 2, 'the next tick is allowed once the request settles');
      stopAfterReturn();
      request.resolve();
      await request.promise;
      const stopAfterSettling = startFocusedLocationRefresh(refetch, clock.scheduler, state);
      assert.equal(calls, 3, 'safe return must refresh immediately');
      await request.promise;
      stopAfterSettling();
      assert.equal(clock.callbacks.size, 0);
    });

    it(`${platform}: reuses an existing query request without cancelling it`, async () => {
      const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
      client.setQueryData(['locations'], [openTap, closedTap]);
      const request = deferred();
      let calls = 0;
      let signal: AbortSignal | undefined;
      const observer = new QueryObserver(client, {
        queryKey: ['locations'],
        queryFn: async (context) => {
          calls++;
          signal = context.signal;
          await request.promise;
          return [openTap];
        },
      });
      const existing = observer.refetch();
      const clock = fakeScheduler();
      const state = { pending: false };
      const refresh = () => observer.refetch({ cancelRefetch: false });
      const stop = startFocusedLocationRefresh(refresh, clock.scheduler, state);
      clock.tick();
      stop();
      const stopAfterReturn = startFocusedLocationRefresh(refresh, clock.scheduler, state);
      assert.equal(calls, 1, 'initial or manual in-flight reads are reused');
      assert.equal(signal?.aborted, false);
      request.resolve();
      await existing;
      assert.deepEqual(client.getQueryData(['locations']), [openTap]);
      stopAfterReturn();
      observer.destroy();
      client.clear();
    });
  }

  it('unlocks after a rejected promise and retries only on the next scheduled tick', async () => {
    const clock = fakeScheduler();
    const request = deferred();
    let calls = 0;
    const stop = startFocusedLocationRefresh(() => {
      calls++;
      return calls === 1 ? request.promise : Promise.resolve();
    }, clock.scheduler);
    request.reject(new Error('offline'));
    await request.promise.catch(() => {});
    assert.equal(calls, 1);
    clock.tick();
    assert.equal(calls, 2);
    stop();
  });

  it('unlocks after a synchronous exception so later ticks can retry', () => {
    const clock = fakeScheduler();
    let calls = 0;
    const stop = startFocusedLocationRefresh(() => {
      calls++;
      throw new Error('failed');
    }, clock.scheduler);
    clock.tick();
    assert.equal(calls, 2);
    stop();
  });

  it('calls browser timers with the global receiver, including cleanup', () => {
    const originalSet = globalThis.setInterval;
    const originalClear = globalThis.clearInterval;
    const handle = 29 as unknown as ReturnType<typeof setInterval>;
    let cleared = false;
    globalThis.setInterval = function (this: unknown) {
      assert.equal(this, globalThis, 'wrong timer receiver causes Illegal invocation');
      return handle;
    } as typeof setInterval;
    globalThis.clearInterval = function (this: unknown, value) {
      assert.equal(this, globalThis);
      assert.equal(value, handle);
      cleared = true;
    } as typeof clearInterval;
    try {
      const stop = startFocusedLocationRefresh(() => {});
      stop();
      assert.equal(cleared, true);
    } finally {
      globalThis.setInterval = originalSet;
      globalThis.clearInterval = originalClear;
    }
  });

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