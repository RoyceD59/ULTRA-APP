import type { MapLocation } from '@/hooks/useApi';

export const LOCATIONS_REFRESH_INTERVAL_MS = 60 * 1000;

type IntervalHandle = ReturnType<typeof setInterval>;

export interface LocationRefreshScheduler {
  setInterval(callback: () => void, delayMs: number): IntervalHandle;
  clearInterval(handle: IntervalHandle): void;
}

const defaultScheduler: LocationRefreshScheduler = {
  setInterval: (callback, delayMs) => globalThis.setInterval(callback, delayMs),
  clearInterval: handle => globalThis.clearInterval(handle),
};

export function startFocusedLocationRefresh(
  refetch: () => unknown,
  scheduler: LocationRefreshScheduler = defaultScheduler,
): () => void {
  void refetch();
  const interval = scheduler.setInterval(() => void refetch(), LOCATIONS_REFRESH_INTERVAL_MS);
  return () => scheduler.clearInterval(interval);
}

export function reconcileSelectedLocation(
  selected: MapLocation | null,
  locations: readonly MapLocation[],
): MapLocation | null {
  if (!selected) return null;
  return locations.some(location => location.id === selected.id) ? selected : null;
}