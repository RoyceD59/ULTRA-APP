import { onlineManager } from '@tanstack/react-query';

export interface ConnectionState {
  isConnected: boolean | null;
  isInternetReachable: boolean | null;
}

/** Unknown reachability is not an offline/online transition. */
export function connectionOnline(state: ConnectionState): boolean | undefined {
  if (state.isConnected === false || state.isInternetReachable === false) return false;
  if (state.isConnected === true && state.isInternetReachable === true) return true;
  return undefined;
}

export function installNativeQueryRecovery(
  subscribe: (listener: (state: ConnectionState) => void) => () => void,
) {
  onlineManager.setEventListener(setOnline => subscribe(state => {
    const online = connectionOnline(state);
    if (online !== undefined) setOnline(online);
  }));
  return () => {
    onlineManager.setEventListener(() => undefined);
    onlineManager.setOnline(true);
  };
}

/** Preserve explicit offline failures and local-storage reads, rather than
 * pausing loaders. Connectivity only triggers the existing query refetch path.
 * Writes must fail once, never be queued or replayed by onlineManager. */
export function nativeRecoveryDefaults(platform: string) {
  return platform === 'web' ? {} : {
    queries: { networkMode: 'always' as const },
    mutations: { networkMode: 'always' as const, retry: false as const },
  };
}