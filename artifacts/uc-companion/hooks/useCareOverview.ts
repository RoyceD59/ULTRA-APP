import { useCallback } from 'react';
import { useFocusEffect } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { useApi } from '@/hooks/useApi';
import { careOverviewAvailable } from '@/lib/careOverview';

export function useCareOverview() {
  const api = useApi();
  const query = useQuery({
    queryKey: ['refill-capabilities'],
    queryFn: () => api.getRefillCapabilities(),
    staleTime: 0,
    refetchOnMount: 'always',
    refetchOnWindowFocus: 'always',
    refetchOnReconnect: 'always',
  });

  useFocusEffect(useCallback(() => {
    void query.refetch();
  }, [query.refetch]));

  // Hide stale enabled state as soon as a focus refresh begins and on errors.
  const available = query.isSuccess && !query.isFetching && !query.isError && careOverviewAvailable(query.data);
  return { ...query, available };
}