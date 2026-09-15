import { useEffect, useState } from 'react';
import { Platform } from 'react-native';
import * as Linking from 'expo-linking';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAuth } from '@/context/AuthContext';
import { useConsumeInstantWaterAssessmentHandoff } from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { ApiError } from '@/hooks/apiError';
import type { InstantWaterAssessment } from '@workspace/api-client-react';

export const HANDOFF_STORAGE_KEY = 'water_check_pending_handoff';

export function captureHandoffUrl(url: string | null) {
  if (!url) return;
  let token = null;

  if (url.includes('water-check-handoff=')) {
    try {
      const match = url.match(/water-check-handoff=([^&]+)/);
      if (match) {
        token = decodeURIComponent(match[1]);
      }
    } catch (e) {}
  }

  if (token) {
    AsyncStorage.setItem(HANDOFF_STORAGE_KEY, token);
    // Remove from visible URL if on web
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      const hashParams = new URLSearchParams(window.location.hash.replace(/^#\/?/, ''));
      hashParams.delete('water-check-handoff');
      const newHash = hashParams.toString();
      const newUrl = window.location.pathname + window.location.search + (newHash ? '#' + newHash : '');
      window.history.replaceState(null, '', newUrl);
    }
  }
}

export function useWaterTestHandoffCapture() {
  useEffect(() => {
    Linking.getInitialURL().then(captureHandoffUrl);
    const sub = Linking.addEventListener('url', ({ url }) => captureHandoffUrl(url));
    return () => sub.remove();
  }, []);
}

export async function processHandoffState(
  token: string | null,
  consumeFn: (handoffToken: string) => Promise<InstantWaterAssessment>,
  onSuccess: (assessment: InstantWaterAssessment) => void,
  setHandoffPending: (val: boolean) => void,
  setHandoffSuccess: (val: boolean) => void,
  setHandoffError: (err: string | null) => void
) {
  const handoffToken = await AsyncStorage.getItem(HANDOFF_STORAGE_KEY);
  if (!handoffToken) {
    setHandoffPending(false);
    return;
  }

  if (!token) {
    setHandoffPending(true);
    return;
  }

  try {
    const res = await consumeFn(handoffToken);
    await AsyncStorage.removeItem(HANDOFF_STORAGE_KEY);
    setHandoffPending(false);
    setHandoffSuccess(true);
    setHandoffError(null);
    onSuccess(res);
  } catch (err: any) {
    const isTerminal = err instanceof ApiError && err.status && (err.status === 400 || err.status === 403 || err.status === 404 || err.status === 410);
    if (isTerminal) {
      await AsyncStorage.removeItem(HANDOFF_STORAGE_KEY);
      setHandoffPending(false);
      setHandoffError('This water check link has expired or belongs to another account.');
    } else {
      setHandoffPending(true);
    }
  }
}

export function useConsumeHandoff(
  onSuccess: (assessment: InstantWaterAssessment) => void,
) {
  const { token } = useAuth();
  const consumeMut = useConsumeInstantWaterAssessmentHandoff();
  const queryClient = useQueryClient();

  const [handoffPending, setHandoffPending] = useState(false);
  const [handoffSuccess, setHandoffSuccess] = useState(false);
  const [handoffError, setHandoffError] = useState<string | null>(null);

  useEffect(() => {
    processHandoffState(
      token,
      async (handoffToken) => {
        const res = await consumeMut.mutateAsync({ data: { handoffToken } });
        queryClient.invalidateQueries({ queryKey: ['authenticatedInstantWaterAssessments'] });
        return res;
      },
      onSuccess,
      setHandoffPending,
      setHandoffSuccess,
      setHandoffError
    );
  }, [token]);

  return { handoffPending, handoffSuccess, handoffError, clearHandoffError: () => setHandoffError(null) };
}
