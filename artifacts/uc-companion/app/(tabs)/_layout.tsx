import React, { useRef, useEffect } from 'react';
import { StyleSheet, View, Text, TouchableOpacity, Animated } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Tabs, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { useColors } from '@/hooks/useColors';
import { useCart } from '@/context/CartContext';
import { useCompanionLayout } from '@/hooks/useCompanionLayout';
import { COMPANION_TABS } from '@/lib/companionLayout';
import CompanionNavigation from '@/components/CompanionNavigation';

function formatKES(price: number) {
  return `KES ${price.toLocaleString('en-KE')}`;
}

function GlobalCartBar() {
  const colors = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const layout = useCompanionLayout();
  const { totalItems, totalPrice, cartHydrated } = useCart();

  // Hydration guard: before the AsyncStorage read completes, `totalItems` is
  // the pre-hydration default (0).  Without the cartHydrated gate, a JS-context
  // restart (e.g. Android low-memory purge) would animate the bar OUT against
  // that stale 0 and then back IN once the real cart loads — a visible flash.
  const hasItems = cartHydrated && totalItems > 0;

  const anim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(anim, {
      toValue: hasItems ? 1 : 0,
      duration: 260,
      useNativeDriver: true,
    }).start();
  }, [hasItems, anim]);

  const bottomOffset = layout.size === 'compact'
    ? layout.bottomNavigationHeight + insets.bottom + 8 : insets.bottom + 16;

  if (!hasItems) return null;

  return (
    <Animated.View
      pointerEvents={hasItems ? 'auto' : 'none'}
      style={[
        styles.globalBar,
        {
          backgroundColor: colors.primary,
          bottom: bottomOffset,
          left: layout.navigationWidth + 12,
          maxWidth: 680,
          opacity: anim,
          transform: [
            {
              translateY: anim.interpolate({
                inputRange: [0, 1],
                outputRange: [56, 0],
              }),
            },
          ],
        },
      ]}
    >
      {/* Left: item count + total */}
      <View style={[styles.barLeft, { flexShrink: 1 }]}>
        <View style={[styles.badgeCircle, { backgroundColor: 'rgba(255,255,255,0.25)' }]}>
          <Text style={styles.badgeText}>{totalItems}</Text>
        </View>
        <Text style={styles.barTotal}>Subtotal {formatKES(totalPrice)}</Text>
      </View>

      {/* Right: Quick Checkout button */}
      <TouchableOpacity
        activeOpacity={0.8}
        onPress={() => {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
          router.push('/checkout');
        }}
        style={[styles.checkoutBtn, { backgroundColor: '#fff' }]}
        accessibilityRole="button"
        accessibilityLabel={`Checkout ${totalItems} items, subtotal ${formatKES(totalPrice)}`}
      >
        <Ionicons name="bag-check-outline" size={15} color={colors.primary} />
        <Text style={[styles.checkoutBtnText, { color: colors.primary }]}>Checkout</Text>
      </TouchableOpacity>
    </Animated.View>
  );
}


export default function TabLayout() {
  const layout = useCompanionLayout();
  const insets = useSafeAreaInsets();
  const colors = useColors();
  const bottom = layout.size === 'compact' ? layout.bottomNavigationHeight + insets.bottom : 0;
  // Keep one navigator mounted across breakpoints: rotation must preserve the
  // selected tab, filters, scroll position, and in-progress form state.
  return (
    <View style={{ flex: 1, minWidth: 0, backgroundColor: colors.background }}>
      <Tabs tabBar={props => <CompanionNavigation {...props} />}
        screenOptions={{ headerShown: false, animation: 'none', lazy: true,
          sceneStyle: { marginLeft: layout.navigationWidth, marginBottom: bottom, paddingTop: insets.top, minWidth: 0 },
        }}>
        {COMPANION_TABS.map(tab => <Tabs.Screen key={tab.name} name={tab.name} options={{ title: tab.label }} />)}
      </Tabs>
      <GlobalCartBar />
    </View>
  );
}

const styles = StyleSheet.create({
  globalBar: {
    position: 'absolute',
    left: 12,
    right: 12,
    zIndex: 50,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 12,
    minHeight: 56,
    flexWrap: 'wrap',
    gap: 8,
    // Shadow
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 8,
  },
  barLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  badgeCircle: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { color: '#fff', fontSize: 13, fontWeight: '700' },
  barTotal: { color: '#fff', fontSize: 13, fontWeight: '700', flexShrink: 1 },
  checkoutBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    minHeight: 44,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 10,
  },
  checkoutBtnText: { fontSize: 12, fontWeight: '700' },
});
