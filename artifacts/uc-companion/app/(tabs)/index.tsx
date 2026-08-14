import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, FlatList, ActivityIndicator, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';
import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/context/AuthContext';
import { useCart } from '@/context/CartContext';
import { useApi, type UCPromotion } from '@/hooks/useApi';
import ProductCard from '@/components/ProductCard';
import TrustBadges from '@/components/TrustBadges';
import ImpactBubble from '@/components/ImpactBubble';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getFilterActivation, effectiveLifespanDays } from '@/hooks/useNotifications';
import { useCartBarInset } from '@/hooks/useCartBarInset';

const UC_SKY  = '#52b6dc';
const UC_DEEP = '#005d8f';

function PromoBanner({ promo, onPress }: { promo: UCPromotion; onPress: () => void }) {
  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.85}
      style={styles.promoBannerCard}>
      <View style={styles.promoBannerDiscount}>
        <Text style={styles.promoBannerPct}>{promo.discountPercent}%</Text>
        <Text style={styles.promoBannerOff}>OFF</Text>
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={styles.promoBannerTitle} numberOfLines={1}>{promo.title}</Text>
        <Text style={styles.promoBannerDesc} numberOfLines={2}>{promo.description}</Text>
        <View style={styles.promoBannerCodeWrap}>
          <Text style={styles.promoBannerCode}>{promo.code}</Text>
        </View>
      </View>
      <Ionicons name="chevron-forward" size={16} color="rgba(255,255,255,0.7)" />
    </TouchableOpacity>
  );
}

const QUICK_ACTIONS = [
  { id: 'filter', label: 'Filter Status', icon: 'water-outline' as const, color: '#0054A6', route: '/account' },
  { id: 'map', label: 'Nearest ATM', icon: 'map-outline' as const, color: '#00B4D8', route: '/(tabs)/map' },
  { id: 'ticket', label: 'Book Service', icon: 'construct-outline' as const, color: '#F59E0B', route: '/ticket/new' },
  { id: 'test', label: 'Water Test', icon: 'flask-outline' as const, color: '#22C55E', route: '/water-test' },
];

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

export default function HomeScreen() {
  const colors = useColors();
  const router = useRouter();
  const { user } = useAuth();
  const { totalItems, cartHydrated } = useCart();
  const api = useApi();
  const [filterDays, setFilterDays] = useState<number | null>(null);
  const [filterAdjusted, setFilterAdjusted] = useState(false);
  const topPad = Platform.OS === 'web' ? 67 : 0;

  const { data: products, isLoading } = useQuery({
    queryKey: ['products', 'featured'],
    queryFn: () => api.getProducts(),
    staleTime: 5 * 60 * 1000,
  });

  const { data: promotions } = useQuery({
    queryKey: ['promotions'],
    queryFn: () => api.getPromotions(),
    staleTime: 2 * 60 * 1000,
  });

  useEffect(() => {
    // Primary: use the structured FilterActivation record (product-specific lifespan)
    getFilterActivation().then(activation => {
      if (activation) {
        const elapsed   = Math.floor((Date.now() - new Date(activation.activatedAt).getTime()) / 86_400_000);
        const effDays   = effectiveLifespanDays(activation);
        const ratedDays = activation.lifespanDays;
        setFilterDays(effDays - elapsed);
        // Show "adjusted" note if a check-in has reduced the effective lifespan
        setFilterAdjusted(activation.lastCheckIn != null && effDays < ratedDays);
        return;
      }
      // Fallback: legacy uc_filter_last_changed key (180-day assumption)
      AsyncStorage.getItem('uc_filter_last_changed').then(v => {
        if (v) {
          const elapsed = Math.floor((Date.now() - parseInt(v)) / 86_400_000);
          setFilterDays(180 - elapsed);
        }
      });
    });
  }, []);

  const cartBarInset = useCartBarInset();
  const featured = products?.slice(0, 6) ?? [];

  return (
    <ScrollView style={[styles.screen, { backgroundColor: colors.background }]}
      contentContainerStyle={{ paddingBottom: cartBarInset || (Platform.OS === 'web' ? 34 : 80) }}
      showsVerticalScrollIndicator={false}>

      {/* Header */}
      <View style={[styles.header, { backgroundColor: colors.primary, paddingTop: topPad + 16 }]}>
        <View>
          <Text style={styles.greeting}>{greeting()}{user ? `, ${user.firstName}` : ''}</Text>
          <Text style={styles.headerSub}>Your water, your health</Text>
        </View>
        <TouchableOpacity onPress={() => router.push('/cart')} style={styles.cartBtn}>
          <Ionicons name="cart-outline" size={24} color="#fff" />
          {/* Hydration-gated: never render a badge state derived from the pre-hydration default */}
          {cartHydrated && totalItems > 0 && (
            <View style={styles.cartBadge}><Text style={styles.cartBadgeText}>{totalItems}</Text></View>
          )}
        </TouchableOpacity>
      </View>

      <View style={styles.body}>
        {/* Filter Health */}
        <View style={[styles.filterCard, { backgroundColor: filterDays !== null && filterDays < 30 ? colors.warningLight : colors.primaryLight, borderColor: filterDays !== null && filterDays < 30 ? colors.warning : colors.primary }]}>
          <View style={[styles.filterIcon, { backgroundColor: filterDays !== null && filterDays < 30 ? colors.warning : colors.primary }]}>
            <Ionicons name="water" size={20} color="#fff" />
          </View>
          <View style={{ flex: 1 }}>
            {filterDays !== null ? (
              <>
                <Text style={[styles.filterTitle, { color: colors.text }]}>
                  {filterDays > 0 ? `${filterDays} days until next filter change` : 'Filter replacement overdue!'}
                </Text>
                <Text style={[styles.filterSub, { color: colors.mutedForeground }]}>
                  {filterAdjusted ? 'Adjusted for your water quality · Tap to order' : 'Tap to order replacement parts'}
                </Text>
              </>
            ) : (
              <>
                <Text style={[styles.filterTitle, { color: colors.text }]}>Register your filter</Text>
                <Text style={[styles.filterSub, { color: colors.mutedForeground }]}>Track replacement reminders</Text>
              </>
            )}
          </View>
          <Ionicons name="chevron-forward" size={18} color={colors.mutedForeground} />
        </View>

        {/* Promotions banner — scrollable horizontal strip */}
        {promotions && promotions.length > 0 && (
          <View style={styles.promosSection}>
            <View style={styles.sectionHeader}>
              <Text style={[styles.sectionTitle, { color: colors.text }]}>Promotions</Text>
              <TouchableOpacity onPress={() => router.push('/referral' as never)}>
                <Text style={[styles.seeAll, { color: colors.primary }]}>Refer & Earn</Text>
              </TouchableOpacity>
            </View>
            <FlatList
              horizontal data={promotions}
              keyExtractor={p => p.id}
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ gap: 10, paddingVertical: 4 }}
              renderItem={({ item }) => (
                <PromoBanner promo={item} onPress={() => router.push('/referral' as never)} />
              )}
            />
          </View>
        )}

        {/* Quick Actions */}
        <View style={styles.section}>
          <View style={styles.grid2}>
            {QUICK_ACTIONS.map(a => (
              <TouchableOpacity key={a.id} activeOpacity={0.8}
                onPress={() => router.push(a.route as never)}
                style={[styles.actionCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <View style={[styles.actionIcon, { backgroundColor: a.color + '18' }]}>
                  <Ionicons name={a.icon} size={24} color={a.color} />
                </View>
                <Text style={[styles.actionLabel, { color: colors.text }]}>{a.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* Featured Products */}
        <View style={styles.sectionHeader}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>Shop Products</Text>
          <TouchableOpacity onPress={() => router.push('/(tabs)/products')}>
            <Text style={[styles.seeAll, { color: colors.primary }]}>See all</Text>
          </TouchableOpacity>
        </View>

        {isLoading ? (
          <ActivityIndicator color={colors.primary} style={{ marginVertical: 20 }} />
        ) : (
          <FlatList
            horizontal data={featured}
            keyExtractor={i => String(i.id)}
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ gap: 12, paddingHorizontal: 2, paddingVertical: 4 }}
            renderItem={({ item }) => (
              <View style={{ width: 180 }}>
                <ProductCard product={item} onPress={() => router.push(`/product/${item.id}` as never)} />
              </View>
            )}
          />
        )}

        {/* UC Impact */}
        <ImpactBubble />

        {/* Trust Badges */}
        <View style={[styles.trustSection, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Text style={[styles.trustTitle, { color: colors.mutedForeground }]}>CERTIFIED & TRUSTED</Text>
          <TrustBadges />
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: { paddingHorizontal: 20, paddingBottom: 24, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  greeting: { fontSize: 22, fontWeight: '700' as const, color: '#fff' },
  headerSub: { fontSize: 13, color: 'rgba(255,255,255,0.75)', marginTop: 2 },
  cartBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  cartBadge: { position: 'absolute', top: 0, right: 0, backgroundColor: '#EF4444', borderRadius: 8, minWidth: 16, height: 16, alignItems: 'center', justifyContent: 'center' },
  cartBadgeText: { color: '#fff', fontSize: 10, fontWeight: '700' as const, paddingHorizontal: 2 },
  body: { padding: 16, gap: 20 },
  filterCard: { flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1, borderRadius: 14, padding: 14 },
  filterIcon: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  filterTitle: { fontSize: 14, fontWeight: '600' as const },
  filterSub: { fontSize: 12, marginTop: 2 },
  section: {},
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  sectionTitle: { fontSize: 18, fontWeight: '700' as const },
  seeAll: { fontSize: 14, fontWeight: '500' as const },
  grid2: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  actionCard: { flex: 1, minWidth: '45%', borderRadius: 14, borderWidth: 1, padding: 16, alignItems: 'center', gap: 10 },
  actionIcon: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  actionLabel: { fontSize: 13, fontWeight: '600' as const, textAlign: 'center' },
  trustSection: { borderWidth: 1, borderRadius: 14, padding: 14, gap: 10 },
  trustTitle: { fontSize: 11, fontWeight: '700' as const, letterSpacing: 1 },
  promosSection: { gap: 10 },
  promoBannerCard: {
    width: 240, backgroundColor: UC_DEEP, borderRadius: 14,
    padding: 14, flexDirection: 'row', alignItems: 'center', gap: 10,
  },
  promoBannerDiscount: { alignItems: 'center', minWidth: 42 },
  promoBannerPct: { color: UC_SKY, fontSize: 22, fontWeight: '900' as const, lineHeight: 24 },
  promoBannerOff: { color: 'rgba(255,255,255,0.75)', fontSize: 10, fontWeight: '700' as const, letterSpacing: 1 },
  promoBannerTitle: { color: '#fff', fontSize: 14, fontWeight: '700' as const },
  promoBannerDesc: { color: 'rgba(255,255,255,0.75)', fontSize: 12, lineHeight: 16 },
  promoBannerCodeWrap: {
    alignSelf: 'flex-start', marginTop: 4,
    backgroundColor: UC_SKY + '30', borderRadius: 4, paddingHorizontal: 7, paddingVertical: 2,
  },
  promoBannerCode: { color: UC_SKY, fontSize: 11, fontWeight: '800' as const, letterSpacing: 1 },
});
