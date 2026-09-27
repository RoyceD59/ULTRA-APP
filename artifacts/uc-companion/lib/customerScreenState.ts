export function cartBackDestination(canGoBack: boolean): 'back' | '/(tabs)/products' {
  return canGoBack ? 'back' : '/(tabs)/products';
}

export function featuredState(isLoading: boolean, isError: boolean, count: number):
  'loading' | 'error' | 'empty' | 'ready' {
  if (isLoading) return 'loading';
  if (isError) return 'error';
  return count > 0 ? 'ready' : 'empty';
}