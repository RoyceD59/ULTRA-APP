import { useQuery } from '@tanstack/react-query';
import { useApi } from '@/hooks/useApi';
import { careOverviewAvailable } from '@/lib/careOverview';

export function useCareOverview() {
  const api = useApi();
  const clientFlag = process.env.EXPO_PUBLIC_UC_CARE_OVERVIEW_PREVIEW;
  const query = useQuery({
    queryKey: ['refill-capabilities'],
    queryFn: () => api.getRefillCapabilities(),
    enabled: clientFlag?.trim().toLowerCase() === 'true',
    staleTime: 0,
  });
  return { ...query, available: !query.isError && careOverviewAvailable(query.data, clientFlag) };
}
