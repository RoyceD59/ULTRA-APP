/** Web keeps React Query's existing browser connectivity handling untouched.
 * Metro resolves queryConnectivity.native.ts on iOS and Android only. */
export function installQueryConnectivity(): (() => void) | undefined {
  return undefined;
}