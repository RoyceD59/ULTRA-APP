import React from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Tabs } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '@/hooks/useColors';
import { useCompanionLayout } from '@/hooks/useCompanionLayout';
import { COMPANION_TABS } from '@/lib/companionLayout';
import { useCart } from '@/context/CartContext';
import BrandLogo from './BrandLogo';

type BottomTabBarProps = Parameters<NonNullable<React.ComponentProps<typeof Tabs>['tabBar']>>[0];

export default function CompanionNavigation({ state, navigation }: BottomTabBarProps) {
  const colors = useColors();
  const layout = useCompanionLayout();
  const insets = useSafeAreaInsets();
  const { totalItems, cartHydrated } = useCart();
  const compact = layout.size === 'compact';
  const expanded = layout.size === 'expanded';

  return (
    <View accessibilityRole="tablist" accessibilityLabel="Companion navigation" testID={`companion-navigation-${layout.size}`} style={[
      styles.navigation, { backgroundColor: colors.background, borderColor: colors.border },
      compact
        ? { bottom: 0, left: 0, right: 0, borderTopWidth: 1, paddingBottom: insets.bottom }
        : { top: 0, bottom: 0, left: 0, width: layout.navigationWidth, borderRightWidth: 1, paddingTop: insets.top },
    ]}>
      {!compact && <View style={styles.brand}><BrandLogo width={expanded ? 52 : 36} />
        {expanded && <Text style={[styles.brandText, { color: colors.primary }]}>Companion</Text>}
      </View>}
      <ScrollView horizontal={compact} showsHorizontalScrollIndicator={false}
        contentContainerStyle={[styles.items, compact ? { flexDirection: 'row', flexGrow: 1 } : { padding: 8, gap: 8 }]}>
        {COMPANION_TABS.map(tab => {
          const route = state.routes.find(item => item.name === tab.name);
          if (!route) return null;
          const selected = state.routes[state.index].key === route.key;
          return (
            <TouchableOpacity key={tab.name} accessibilityRole="tab"
              accessibilityLabel={tab.label} accessibilityState={{ selected }}
              testID={`companion-tab-${tab.name}`} activeOpacity={0.75}
              onPress={() => {
                const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
                if (!selected && !event.defaultPrevented) navigation.navigate(route.name, route.params);
              }}
              onLongPress={() => navigation.emit({ type: 'tabLongPress', target: route.key })}
              style={[styles.item, compact ? { flex: 1, minWidth: 48, minHeight: layout.bottomNavigationHeight }
                : { minHeight: 60, flexDirection: expanded ? 'row' : 'column', justifyContent: expanded ? 'flex-start' : 'center', paddingHorizontal: expanded ? 16 : 4 },
              selected && { backgroundColor: colors.primaryLight }]}>
              <View>
                <Ionicons name={tab.icon} size={23} color={selected ? colors.primary : colors.mutedForeground} />
                {tab.name === 'products' && cartHydrated && totalItems > 0 &&
                  <View style={[styles.badge, { backgroundColor: colors.primary }]}><Text style={styles.badgeText}>{totalItems > 99 ? '99+' : totalItems}</Text></View>}
              </View>
              <Text style={{ fontSize: expanded ? 15 : 11, fontWeight: selected ? '700' : '500', color: selected ? colors.primary : colors.mutedForeground, textAlign: 'center' }}>{tab.label}</Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  navigation: { position: 'absolute', zIndex: 20 },
  brand: { alignItems: 'center', paddingVertical: 20, gap: 8 },
  brandText: { fontSize: 16, fontWeight: '700' },
  items: { alignItems: 'stretch' },
  item: { alignItems: 'center', justifyContent: 'center', gap: 5, borderRadius: 12, paddingVertical: 8, paddingHorizontal: 2 },
  badge: { position: 'absolute', top: -7, right: -12, borderRadius: 9, minWidth: 18, paddingHorizontal: 3 },
  badgeText: { color: '#fff', fontSize: 10, textAlign: 'center' },
});
