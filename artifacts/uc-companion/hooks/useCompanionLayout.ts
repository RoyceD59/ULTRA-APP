import { useWindowDimensions } from 'react-native';
import { companionLayout } from '@/lib/companionLayout';

export function useCompanionLayout() {
  const { width, fontScale } = useWindowDimensions();
  return companionLayout(width, fontScale);
}
