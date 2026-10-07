import React from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useFocusEffect } from 'expo-router';
import { useAuth } from '@/context/AuthContext';
import { useApi } from '@/hooks/useApi';
import { useActivationPurchases } from '@/hooks/useActivationPurchases';
import { myFiltersPresentation } from '@/lib/myFiltersPresentation';
import type { FilterActivation } from '@/hooks/useNotifications';
import { customerQueryKeys } from '@/lib/customerQueryKeys';

export function useMyFilters(activation: FilterActivation | null) {
  const { user } = useAuth();
  const id = user?.id;
  const api = useApi(), client = useQueryClient();
  const online = useActivationPurchases();
  const offline = useQuery({
    queryKey: ['offline-purchases', id], enabled: !!id,
    queryFn: ({ signal }) => api.getOfflinePurchases(signal),
    staleTime: 15_000, refetchInterval: 30_000,
  });
  const assignments = useQuery({
    queryKey: ['customer-filter-assignments', id], enabled: !!id,
    queryFn: ({ signal }) => api.getAssignments(signal),
    staleTime: 15_000, refetchInterval: 30_000,
  });
  const registrations = useQuery({
    queryKey: customerQueryKeys.rewards(id), enabled: !!id,
    queryFn: ({ signal }) => api.getRewards(signal), staleTime: 15_000,
  });
  const refresh = React.useCallback(() => {
    if (!id) return;
    void online.refetch(); void offline.refetch(); void assignments.refetch(); void registrations.refetch();
    void client.invalidateQueries({ queryKey: ['filter-cycle', id] });
  }, [id, online.refetch, offline.refetch, assignments.refetch, registrations.refetch, client]);
  useFocusEffect(React.useCallback(() => { refresh(); }, [refresh]));
  React.useEffect(() => () => {
    // Query functions consume the abort signal; late reads cannot populate a new account.
    if (!id) return;
    for (const source of ['activation-purchases', 'offline-purchases', 'customer-filter-assignments']) {
      void client.cancelQueries({ queryKey: [source, id], exact: true });
    }
  }, [id, client]);
  const invalidate = React.useCallback(() => {
    if (!id) return;
    for (const key of [
      ['activation-purchases', id], ['offline-purchases', id],
      ['customer-filter-assignments', id], ['filter-cycle', id], customerQueryKeys.rewards(id),
    ]) void client.invalidateQueries({ queryKey: key });
  }, [id, client]);
  return {
    ...myFiltersPresentation(activation, online.data?.purchases, offline.data?.purchases, assignments.data, registrations.data?.impact.filters),
    online, offline, assignments, registrations, refresh, invalidate,
    storeError: online.data?.sourceErrors?.store,
  };
}
