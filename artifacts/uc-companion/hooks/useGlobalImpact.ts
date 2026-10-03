import { useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useFocusEffect } from 'expo-router';
import { useApi } from '@/hooks/useApi';
import { GLOBAL_IMPACT_QUERY_KEY } from '@/lib/queryFreshness';

/** Account-independent totals: the same endpoint and cache for Home and About. */
export { GLOBAL_IMPACT_QUERY_KEY };

export function useGlobalImpact() {
  const api = useApi();
  const query = useQuery({
    queryKey: GLOBAL_IMPACT_QUERY_KEY,
    queryFn: () => api.getImpact(),
    staleTime: 15_000,
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
    refetchOnMount: 'always',
    refetchOnWindowFocus: 'always',
    refetchOnReconnect: 'always',
  });
  const { refetch } = query;
  useFocusEffect(useCallback(() => { void refetch(); }, [refetch]));
  return query;
}