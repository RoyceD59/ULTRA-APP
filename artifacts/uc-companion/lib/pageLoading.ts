/** Initial loading only: cached content (including an empty response) wins. */
export function pageDataState(hasData: boolean, loading: boolean, error: boolean) {
  if (hasData) return 'ready' as const;
  if (error) return 'error' as const;
  return loading ? 'loading' as const : 'empty' as const;
}

export function animatePageLoader(reducedMotion: boolean, focused: boolean, foreground: boolean) {
  return !reducedMotion && focused && foreground;
}

/** Classify known network failures without displaying provider diagnostics. */
export function pageFailureCopy(error: unknown) {
  const value = error as { name?: string; message?: string; status?: number } | null;
  if (value?.status === 401) return 'Please sign in again to load this information.';
  if (value?.status === 403) return 'Your account does not have access to this information. Return Home or use an account with access.';
  if (value?.status === 404) return 'This item is no longer available. Go back to browse other items.';
  if (value?.name === 'TypeError' && /fetch|network|offline/i.test(value.message ?? '')) {
    return 'You may be offline. Check your connection and retry. Your other Companion features are still available.';
  }
  return 'This information couldn’t be loaded. Please try again. Your other Companion features are still available.';
}
