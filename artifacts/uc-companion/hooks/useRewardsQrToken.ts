import { useMemo, useRef, useSyncExternalStore } from 'react';
import { useMutation, useQuery, useQueryClient, onlineManager } from '@tanstack/react-query';
import { useApi } from './useApi';
import { readStoredRewardsQrToken, storeRewardsQrToken } from '@/lib/rewardsQrStorage';
import { RewardsQrController } from '@/lib/RewardsQrController';
import { resolveRewardsQrToken, storageDeadline, type ResolvedRewardsQr } from '@/lib/rewardsQrResolution';
import { customerQueryKeys } from '@/lib/customerQueryKeys';
import { useAuth } from '@/context/AuthContext';

export function useRewardsQrToken(userId: number | undefined | null, focused = true) {
  const api = useApi();
  const { token: sessionToken } = useAuth();
  const client = useQueryClient();
  const owner = useRef({ userId, sessionToken });
  owner.current = { userId, sessionToken };
  const worker = useMemo(() => new RewardsQrController(), []);
  const online = useSyncExternalStore(
    listener => onlineManager.subscribe(listener), () => onlineManager.isOnline(), () => true);
  const query = useQuery({
    queryKey: customerQueryKeys.rewardsQr(userId),
    queryFn: ({ signal }) => worker.load(userId!, innerSignal => resolveRewardsQrToken(
      userId!, null, api.validateRewardsQr, readStoredRewardsQrToken, storeRewardsQrToken, innerSignal,
    ), signal),
    enabled: !!userId && !!sessionToken && focused,
    staleTime: 0,
    gcTime: 0,
    networkMode: 'always',
    retry: false,
    refetchOnMount: 'always',
    refetchOnWindowFocus: 'always',
    refetchOnReconnect: 'always',
    refetchInterval: focused ? 60_000 : false,
  });
  const recovery = useMutation({
    networkMode: 'always',
    retry: false,
    mutationFn: async (attempt: { userId: number; sessionToken: string; version: string | null }) => {
      await client.cancelQueries({ queryKey: customerQueryKeys.rewardsQr(attempt.userId) });
      const result = await api.rotateRewardsQr(attempt.version);
      if (owner.current.userId !== attempt.userId || owner.current.sessionToken !== attempt.sessionToken) {
        throw new Error('Account changed. Refresh your rewards QR.');
      }
      if (result.userId !== attempt.userId || !result.qrToken || result.status !== 'active') {
        throw new Error('QR recovery did not return a valid account code');
      }
      let persistenceWarning = false;
      try { await storageDeadline(storeRewardsQrToken(attempt.userId, result.qrToken)); }
      catch { persistenceWarning = true; }
      if (owner.current.userId !== attempt.userId || owner.current.sessionToken !== attempt.sessionToken) {
        throw new Error('Account changed. Refresh your rewards QR.');
      }
      const resolved: ResolvedRewardsQr = {
        userId: attempt.userId, token: result.qrToken, version: result.version,
        recoveryRequired: false, persistenceWarning,
      };
      client.setQueryData(customerQueryKeys.rewardsQr(attempt.userId), resolved);
      await client.invalidateQueries({ queryKey: customerQueryKeys.rewards(attempt.userId) });
      return resolved;
    },
  });
  const busy = query.isFetching || recovery.isPending;
  // Never display a previously Ready code while offline, validating, or failed.
  const current = query.data?.userId === userId ? query.data : undefined;
  const error = online ? recovery.error ?? query.error : new Error('Connect to verify your rewards QR.');
  return {
    token: online && !busy && !error ? current?.token ?? null : null,
    loading: !!userId && busy,
    error,
    recoveryRequired: online && !query.isError && !!current?.recoveryRequired,
    persistenceWarning: current?.persistenceWarning ?? false,
    retry: async () => { recovery.reset(); await query.refetch(); },
    recover: async () => {
      if (!userId || !sessionToken || !online || busy || !current?.recoveryRequired) return;
      await recovery.mutateAsync({ userId, sessionToken, version: current.version });
    },
  };
}