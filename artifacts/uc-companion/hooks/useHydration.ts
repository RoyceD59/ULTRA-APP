import { useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { getUcDailyHydration } from '@workspace/api-client-react/companion/hydration';
import { useAuth } from '@/context/AuthContext';
import { localCalendarDate } from '@/lib/hydration';

export const hydrationKey = (userId: number | undefined, date: string) => ['customer', userId, 'hydration', date] as const;
export function useHydration() {
  const { user, token } = useAuth();
  const [date, setDate] = useState(localCalendarDate);
  useEffect(() => {
    const refresh = () => setDate(localCalendarDate());
    const timer = setInterval(refresh, 30000);
    const sub = AppState.addEventListener('change', state => { if (state === 'active') refresh(); });
    return () => { clearInterval(timer); sub.remove(); };
  }, []);
  const query = useQuery({
    queryKey: hydrationKey(user?.id, date),
    queryFn: ({ signal }) => getUcDailyHydration(date, { signal, headers: { Authorization: `Bearer ${token}` } }),
    enabled: !!user && !!token,
    staleTime: 0,
  });
  return { ...query, date };
}