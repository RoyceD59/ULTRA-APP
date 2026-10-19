import { useCallback, useEffect, useState } from 'react';
import { useQuery, onlineManager } from '@tanstack/react-query';
import { useFocusEffect } from 'expo-router';
import { getApiBase } from '@/lib/apiBase';
import { fetchGlobalImpact, impactFreshness } from '@/lib/globalImpact';
import { GLOBAL_IMPACT_QUERY_KEY } from '@/lib/queryFreshness';

/** Account-independent totals: the same endpoint and cache for Home and About. */
export { GLOBAL_IMPACT_QUERY_KEY };

export function useGlobalImpact() {
  const [now, setNow] = useState(Date.now());
  const [online, setOnline] = useState(onlineManager.isOnline());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 5_000);
    const unsubscribe = onlineManager.subscribe(setOnline);
    return () => { clearInterval(timer); unsubscribe(); };
  }, []);
  const query = useQuery({
    queryKey: GLOBAL_IMPACT_QUERY_KEY,
    // This request deliberately carries no account/session headers.
    queryFn: ({ signal }) => fetchGlobalImpact(getApiBase(), signal),
    retry: 1,
    staleTime: 15_000,
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
    refetchOnMount: 'always',
    refetchOnWindowFocus: 'always',
    refetchOnReconnect: 'always',
  });
  const { refetch } = query;
  useFocusEffect(useCallback(() => { void refetch(); }, [refetch]));
  return { ...query, freshness: impactFreshness(query.data, query.dataUpdatedAt, now, query.isError, online) };
}