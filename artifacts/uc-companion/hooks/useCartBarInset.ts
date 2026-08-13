import { Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useCart } from '@/context/CartContext';

/** Height of the GlobalCartBar pill. Must match the `height` in _layout.tsx styles. */
const CART_BAR_HEIGHT = 52;

/** Breathing room above the top edge of the cart bar. */
const GAP = 8;

/**
 * Height of the tab bar on each platform (matches ClassicTabLayout tabBarStyle).
 * On web the tab bar has an explicit height of 84 pt.
 */
const TAB_BAR_HEIGHT = Platform.OS === 'web' ? 84 : Platform.OS === 'ios' ? 49 : 56;

/**
 * Returns the full bottom `paddingBottom` needed by a tab-screen scroll
 * container so its last item is never hidden behind either the tab bar or the
 * GlobalCartBar.
 *
 * - Cart **empty**  → 0  (callers fall back to their own baseline, e.g. `34` / `80`)
 * - Cart **non-empty** → tab-bar height + safe-area bottom + cart-bar height + gap
 *   (this exceeds the baseline on every platform, so use it as the sole value)
 *
 * Usage in a screen:
 * ```tsx
 * const cartBarInset = useCartBarInset();
 * // …
 * contentContainerStyle={{
 *   paddingBottom: cartBarInset || (Platform.OS === 'web' ? 34 : 80),
 * }}
 * ```
 */
export function useCartBarInset(): number {
  const insets = useSafeAreaInsets();
  const { totalItems } = useCart();
  if (!totalItems) return 0;
  const safeBottom = Platform.OS === 'web' ? 0 : insets.bottom;
  return TAB_BAR_HEIGHT + safeBottom + CART_BAR_HEIGHT + GAP;
}
