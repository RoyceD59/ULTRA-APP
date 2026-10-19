import type { MapLocation } from '@/hooks/useApi';

export const LOCATIONS_REFRESH_INTERVAL_MS = 60 * 1000;

type IntervalHandle = ReturnType<typeof setInterval>;

export interface LocationRefreshScheduler {
  setInterval(callback: () => void, delayMs: number): IntervalHandle;
  clearInterval(handle: IntervalHandle): void;
}

export interface LocationRefreshState {
  pending: boolean;
}

const defaultScheduler: LocationRefreshScheduler = {
  // Browser timers must not receive the scheduler object as their `this`.
  setInterval: (callback, delayMs) => globalThis.setInterval(callback, delayMs),
  clearInterval: (handle) => globalThis.clearInterval(handle),
};

export function startFocusedLocationRefresh(
  refetch: () => unknown,
  scheduler: LocationRefreshScheduler = defaultScheduler,
  state: LocationRefreshState = { pending: false },
): () => void {
  let focused = true;
  const refresh = () => {
    if (!focused || state.pending) return;
    state.pending = true;
    try {
      const result = refetch();
      if (result && typeof (result as PromiseLike<unknown>).then === 'function') {
        // Handle both outcomes: query errors belong to the map's error UI,
        // and a rejected refresh must not leave the scheduler locked.
        void Promise.resolve(result).then(
          () => { state.pending = false; },
          () => { state.pending = false; },
        );
      } else {
        state.pending = false;
      }
    } catch {
      state.pending = false;
    }
  };
  refresh();
  const interval = scheduler.setInterval(refresh, LOCATIONS_REFRESH_INTERVAL_MS);
  return () => {
    focused = false;
    scheduler.clearInterval(interval);
    // Do not clear pending: the request can still be running after blur.
  };
}

export function reconcileSelectedLocation(
  selected: MapLocation | null,
  locations: readonly MapLocation[],
): MapLocation | null {
  if (!selected) return null;
  return locations.some(location => location.id === selected.id) ? selected : null;
}
