import { useState, useEffect, useMemo } from 'react';
import { useApi, CustomerRewards } from './useApi';
import { readStoredRewardsQrToken, storeRewardsQrToken } from '@/lib/rewardsQrStorage';
import { RewardsQrController, RewardsQrState } from '@/lib/RewardsQrController';
import { resolveRewardsQrToken } from '@/lib/rewardsQrResolution';

export function useRewardsQrToken(userId: number | undefined | null, rewards: CustomerRewards | undefined) {
  const api = useApi();
  const [state, setState] = useState<RewardsQrState>({ token: null, loading: !!userId, error: null });
  
  const controller = useMemo(() => {
    return new RewardsQrController((newState) => setState(newState), resolveRewardsQrToken);
  }, []);

  useEffect(() => {
    controller.setProps(
      userId, 
      rewards, 
      api.rotateRewardsQr, 
      readStoredRewardsQrToken, 
      storeRewardsQrToken
    );
  }, [userId, rewards, api.rotateRewardsQr, controller]);

  return {
    ...state,
    retry: () => controller.retry()
  };
}
