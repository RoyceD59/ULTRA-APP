/** Initial loading only: cached content (including an empty response) wins. */
export function pageDataState(hasData: boolean, loading: boolean, error: boolean) {
  if (hasData) return 'ready' as const;
  if (error) return 'error' as const;
  return loading ? 'loading' as const : 'empty' as const;
}

export function animatePageLoader(reducedMotion: boolean, focused: boolean, foreground: boolean) {
  return !reducedMotion && focused && foreground;
}

export const FONT_STARTUP_BUDGET_MS = 600;
export function startupReady(loaded: boolean, error: unknown, budgetExpired: boolean) {
  return loaded || !!error || budgetExpired;
}