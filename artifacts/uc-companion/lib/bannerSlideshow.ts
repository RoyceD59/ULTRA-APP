/** Shared, framework-free timing policy for the Products banner slideshow. */
export const BANNER_INTERVAL_MS = 3000;
export const BANNER_FADE_MS = 450;

export function nextSlideIndex(current: number, count: number): number {
  if (count <= 1) return 0;
  return (current + 1) % count;
}

/** Cycling requires motion allowed (not reduced, focused, foregrounded) and more than one slide. */
export function shouldCycleBanner(animate: boolean, count: number): boolean {
  return animate && count > 1;
}

/**
 * Starts the interval only when cycling is allowed; returns a cleanup.
 * Timer functions are injectable so tests can drive time deterministically.
 */
export function startBannerCycle(
  animate: boolean,
  count: number,
  advance: () => void,
  timers: { set: (fn: () => void, ms: number) => unknown; clear: (id: unknown) => void } = {
    set: (fn, ms) => setInterval(fn, ms),
    clear: id => clearInterval(id as ReturnType<typeof setInterval>),
  },
): () => void {
  if (!shouldCycleBanner(animate, count)) return () => {};
  const id = timers.set(advance, BANNER_INTERVAL_MS);
  return () => timers.clear(id);
}
