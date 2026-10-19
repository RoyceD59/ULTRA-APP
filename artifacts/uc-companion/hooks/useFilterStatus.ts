import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useFocusEffect } from 'expo-router';
import React from 'react';
import { useAuth } from '@/context/AuthContext';
import { useApi } from '@/hooks/useApi';
import { getFilterActivation, effectiveLifespanDays, hydrateAssignedFilter } from '@/hooks/useNotifications';
import { customerQueryKeys } from '@/lib/customerQueryKeys';
import { calculateRemainingLife, resolveCapacityCycle } from '@/lib/filterRemainingLife';

/** Same account-scoped cycle and recorded-usage calculation on Home and Account. */
export function useFilterStatus() {
  const { user } = useAuth(), api = useApi();
  const id = user?.id;
  const activeId = React.useRef(id); activeId.current = id;
  const cycle = useQuery({
    queryKey: ['filter-cycle', id], enabled: !!id, staleTime: 0, refetchInterval: 30_000,
    queryFn: async ({ signal }) => {
      if (!id) return null;
      const activation = await getFilterActivation(id);
      const assignments = await api.getAssignments(signal).catch(error => {
        if (!activation || signal.aborted) throw error;
        // A persisted cycle is still known when a read fails; usage independently
        // becomes unknown/time-only. Never invent an installation or replay it.
        return [];
      });
      const hydrated = await hydrateAssignedFilter(id, assignments, () => !signal.aborted && activeId.current === id);
      return hydrated ?? activation;
    },
  });
  const usage = useQuery({
    queryKey: customerQueryKeys.rewards(id), enabled: !!id, staleTime: 15_000,
    queryFn: ({ signal }) => api.getRewards(signal),
  });
  useFocusEffect(React.useCallback(() => {
    if (id) { void cycle.refetch(); void usage.refetch(); }
  }, [id]));
  const [now, setNow] = React.useState(Date.now());
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(timer); }, []);
  const activation = id ? cycle.data ?? null : null;
  const capacity = !activation || usage.isError || usage.isFetching ? null : resolveCapacityCycle(activation, usage.data?.impact.filters, id);
  return { activation, life: activation ? calculateRemainingLife(activation, effectiveLifespanDays(activation), capacity, now) : null,
    cycleError: cycle.isError, usage, refetch: cycle.refetch };
}