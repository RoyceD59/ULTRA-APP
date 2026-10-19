import { useEffect } from 'react';
import { AppState } from 'react-native';
import { reconcileHydrationReminder } from '@/lib/hydrationReminder';

export function useHydrationReminder(userId: number | null, authLoading: boolean) {
  useEffect(() => {
    if (authLoading) return;
    const sync = () => { void reconcileHydrationReminder(userId).catch(error => console.warn('Hydration reminder could not reconcile', error)); };
    sync();
    const subscription = AppState.addEventListener('change', state => { if (state === 'active') sync(); });
    const timer = setInterval(sync, 60000); // Detect timezone changes while open.
    return () => { subscription.remove(); clearInterval(timer); };
  }, [userId, authLoading]);
}