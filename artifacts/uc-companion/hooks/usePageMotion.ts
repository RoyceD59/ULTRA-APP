import { useCallback, useEffect, useState } from 'react';
import { AccessibilityInfo, AppState, Platform } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { animatePageLoader } from '@/lib/pageLoading';

/** Conservative still frame until the platform's motion preference is known. */
export function usePageMotion() {
  const [reduced, setReduced] = useState(true);
  const [focused, setFocused] = useState(false);
  const [foreground, setForeground] = useState(
    Platform.OS === 'web' ? typeof document !== 'undefined' && !document.hidden : AppState.currentState === 'active',
  );
  useFocusEffect(useCallback(() => {
    setFocused(true);
    return () => setFocused(false);
  }, []));
  useEffect(() => {
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      const media = window.matchMedia('(prefers-reduced-motion: reduce)');
      const changed = () => setReduced(media.matches);
      const visible = () => setForeground(!document.hidden);
      changed();
      media.addEventListener('change', changed);
      document.addEventListener('visibilitychange', visible);
      return () => {
        media.removeEventListener('change', changed);
        document.removeEventListener('visibilitychange', visible);
      };
    }
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled().then(value => { if (alive) setReduced(value); }).catch(() => {});
    const motion = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduced);
    const state = AppState.addEventListener('change', value => setForeground(value === 'active'));
    return () => { alive = false; motion.remove(); state.remove(); };
  }, []);
  return animatePageLoader(reduced, focused, foreground);
}