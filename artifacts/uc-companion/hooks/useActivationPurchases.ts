import { useGetUcActivationPurchases } from '@workspace/api-client-react/companion/customer';
import { useAuth } from '@/context/AuthContext';

export function useActivationPurchases() {
  const { user, token } = useAuth();
  return useGetUcActivationPurchases({
    query: { queryKey: ['activation-purchases', user?.id], enabled: !!user && !!token,
      staleTime: 15_000, refetchInterval: 30_000 },
    request: { headers: { Authorization: `Bearer ${token}` } },
  });
}