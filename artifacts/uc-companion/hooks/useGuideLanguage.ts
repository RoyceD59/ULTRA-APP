import { useEffect, useSyncExternalStore } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createGuideLanguageStore } from '@/lib/guideLanguage';

const store = createGuideLanguageStore(AsyncStorage);

export function useGuideLanguage() {
  const language = useSyncExternalStore(store.subscribe, store.getSnapshot, () => 'en' as const);
  useEffect(() => { void store.hydrate(); }, []);
  return { language, setLanguage: store.setLanguage };
}