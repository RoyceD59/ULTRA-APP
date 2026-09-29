import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useCart } from '@/context/CartContext';
import { useWindowDimensions } from 'react-native';
import { cartContentInset } from '@/lib/companionLayout';

/** Navigation takes up scene space; only the floating cart overlaps content. */
export function useCartBarInset(): number {
  const insets = useSafeAreaInsets();
  const { totalItems, cartHydrated } = useCart();
  const { fontScale } = useWindowDimensions();
  return cartContentInset(cartHydrated, totalItems, insets.bottom, fontScale);
}
