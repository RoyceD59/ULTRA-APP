import React, { useRef, useEffect } from 'react';
import { Platform, StyleSheet, useColorScheme, View, Text, TouchableOpacity, Animated } from 'react-native';
import { useColors } from '@/hooks/useColors';
import { Feather, Ionicons } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import { isLiquidGlassAvailable } from 'expo-glass-effect';
import { Tabs, useRouter } from 'expo-router';
import { NativeTabs } from 'expo-router/unstable-native-tabs';
import { SymbolView } from 'expo-symbols';
import { useCart } from '@/context/CartContext';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';

// ── Global Cart Bar ───────────────────────────────────────────────────────────
// Floats above the tab bar from every tab when the cart is non-empty.

function formatKES(price: number) {
  return `KES ${price.toLocaleString('en-KE')}`;
}

function GlobalCartBar() {
  const colors = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
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

  // Position the compact bar just above the tab bar.
  // Tab bar is ~49 pt tall on iOS (+ safe-area bottom), ~56 on Android, ~84 on web.
  const tabBarHeight = Platform.OS === 'web' ? 84 : Platform.OS === 'ios' ? 49 : 56;
  const bottomOffset = tabBarHeight + (Platform.OS === 'web' ? 0 : insets.bottom);

  return (
    <Animated.View
      pointerEvents={hasItems ? 'auto' : 'none'}
      style={[
        styles.globalBar,
        {
          backgroundColor: colors.primary,
          bottom: bottomOffset,
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
      <View style={styles.barLeft}>
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

// ── Native-tab layout (iOS Liquid Glass) ─────────────────────────────────────

function NativeTabLayout() {
  return (
    <NativeTabs>
      <NativeTabs.Trigger name="index">
        <NativeTabs.Trigger.Icon sf={{ default: 'house', selected: 'house.fill' }} />
        <NativeTabs.Trigger.Label>Home</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="products">
        <NativeTabs.Trigger.Icon sf={{ default: 'cart', selected: 'cart.fill' }} />
        <NativeTabs.Trigger.Label>Products</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="support">
        <NativeTabs.Trigger.Icon sf={{ default: 'questionmark.circle', selected: 'questionmark.circle.fill' }} />
        <NativeTabs.Trigger.Label>Support</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="map">
        <NativeTabs.Trigger.Icon sf={{ default: 'map', selected: 'map.fill' }} />
        <NativeTabs.Trigger.Label>Map</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="account">
        <NativeTabs.Trigger.Icon sf={{ default: 'person', selected: 'person.fill' }} />
        <NativeTabs.Trigger.Label>Account</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}

// ── Classic tab layout (Android / web / older iOS) ───────────────────────────

function ClassicTabLayout() {
  const colors = useColors();
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';
  const isIOS = Platform.OS === 'ios';
  const isWeb = Platform.OS === 'web';
  const { totalItems, cartHydrated } = useCart();

  const tabBarStyle = {
    position: 'absolute' as const,
    backgroundColor: isIOS ? 'transparent' : colors.background,
    borderTopWidth: isWeb ? 1 : 0,
    borderTopColor: colors.border,
    elevation: 0,
    ...(isWeb ? { height: 84 } : {}),
  };

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.mutedForeground,
        headerShown: false,
        // Slide/shift transition between tabs — pairs with the swipe-to-switch
        // gesture (SwipeTabs) so page selection feels like sliding.
        animation: 'shift',
        tabBarStyle,
        tabBarBackground: () =>
          isIOS ? (
            <BlurView intensity={100} tint={isDark ? 'dark' : 'light'} style={StyleSheet.absoluteFill} />
          ) : isWeb ? (
            <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.background }]} />
          ) : null,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Home',
          tabBarIcon: ({ color }) =>
            isIOS ? <SymbolView name="house" tintColor={color} size={24} /> : <Feather name="home" size={22} color={color} />,
        }}
      />
      <Tabs.Screen
        name="products"
        options={{
          title: 'Products',
          tabBarIcon: ({ color }) =>
            isIOS ? <SymbolView name="cart" tintColor={color} size={24} /> : <Ionicons name="cart-outline" size={22} color={color} />,
          // Hydration-gated: never show a (stale-zero-derived) badge state pre-hydration
          tabBarBadge: cartHydrated && totalItems > 0 ? totalItems : undefined,
        }}
      />
      <Tabs.Screen
        name="support"
        options={{
          title: 'Support',
          tabBarIcon: ({ color }) =>
            isIOS ? <SymbolView name="questionmark.circle" tintColor={color} size={24} /> : <Ionicons name="help-circle-outline" size={22} color={color} />,
        }}
      />
      <Tabs.Screen
        name="map"
        options={{
          title: 'Map',
          tabBarIcon: ({ color }) =>
            isIOS ? <SymbolView name="map" tintColor={color} size={24} /> : <Feather name="map-pin" size={22} color={color} />,
        }}
      />
      <Tabs.Screen
        name="account"
        options={{
          title: 'Account',
          tabBarIcon: ({ color }) =>
            isIOS ? <SymbolView name="person" tintColor={color} size={24} /> : <Feather name="user" size={22} color={color} />,
        }}
      />
    </Tabs>
  );
}

// ── Root export ───────────────────────────────────────────────────────────────

export default function TabLayout() {
  return (
    <View style={{ flex: 1 }}>
      {isLiquidGlassAvailable() ? <NativeTabLayout /> : <ClassicTabLayout />}
      {/* Persistent cart bar — visible from every tab when cart is non-empty */}
      <GlobalCartBar />
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

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
    height: 46,
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
  barTotal: { color: '#fff', fontSize: 13, fontWeight: '700' },
  checkoutBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    minHeight: 34,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 10,
  },
  checkoutBtnText: { fontSize: 12, fontWeight: '700' },
});
