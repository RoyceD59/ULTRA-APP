import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Platform } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
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
import { getFilterActivation, filterLastChangedKey, effectiveLifespanDays } from '@/hooks/useNotifications';
import { useCartBarInset } from '@/hooks/useCartBarInset';
import RegisterFilterPrompt from '@/components/RegisterFilterPrompt';
import SwipeTabs from '@/components/SwipeTabs';
import HorizontalCarousel from '@/components/HorizontalCarousel';
import { catalogueQueryKey } from '@/lib/catalogueQuery';
import { useCompanionLayout } from '@/hooks/useCompanionLayout';
import { pageDataState } from '@/lib/pageLoading';
import PageDataLoader from '@/components/PageDataLoader';
import { fetchBlogPage } from '@/lib/blogContent';
import PhotoHeader from '@/components/PhotoHeader';
import { Image } from 'expo-image';
import PageDataError from '@/components/PageDataError';

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
  return (
    <SwipeTabs tab="index">
      <HomeScreenContent />
    </SwipeTabs>
  );
}

function HomeScreenContent() {
  const layout = useCompanionLayout();
  const colors = useColors();
  const router = useRouter();
  const { user } = useAuth();
  const { totalItems, cartHydrated } = useCart();
  const api = useApi();
  const [filterDays, setFilterDays] = useState<number | null>(null);
  const [filterAdjusted, setFilterAdjusted] = useState(false);
  const topPad = 0;

  const { data: products, isLoading, isError, error: productError, refetch: retryProducts } = useQuery({
    queryKey: catalogueQueryKey(),
    queryFn: ({ signal }) => api.getProducts(undefined, signal),
    staleTime: 30_000,
  });

  const { data: promotions, isLoading: promotionsLoading, isError: promotionsError, error: promotionFailure, refetch: retryPromotions } = useQuery({
    queryKey: ['promotions'],
    queryFn: ({ signal }) => api.getPromotions(signal),
    staleTime: 2 * 60 * 1000,
  });

  // The editorial feed is an independent query: blog network delays or errors
  // never hold up the Home screen or any of its existing data.
  const { data: latestBlog, isLoading: latestBlogLoading, isError: latestBlogError, error: blogFailure, refetch: retryBlog } = useQuery({
    queryKey: ['companion', 'blog', { homeLatest: true, limit: 3 }],
    queryFn: ({ signal }) => fetchBlogPage(
      (requestSignal) => api.getBlogArticles({ limit: 3 }, requestSignal),
      { limit: 3 },
      signal,
    ),
    staleTime: 30_000,
    refetchInterval: 30_000,
    retry: false,
  });

  const refreshFilterStatus = useCallback(() => {
    setFilterDays(null);
    setFilterAdjusted(false);
    if (!user) return;
    // Primary: use the structured FilterActivation record (product-specific lifespan)
    getFilterActivation(user.id).then(activation => {
      if (activation) {
        const elapsed   = Math.floor((Date.now() - new Date(activation.activatedAt).getTime()) / 86_400_000);
        const effDays   = effectiveLifespanDays(activation);
        const ratedDays = activation.lifespanDays;
        setFilterDays(effDays - elapsed);
        // Show "adjusted" note if a check-in has reduced the effective lifespan
        setFilterAdjusted(activation.lastCheckIn != null && effDays < ratedDays);
        return;
      }
      // Fallback: user-scoped last_changed timestamp, then legacy unscoped key
      AsyncStorage.getItem(filterLastChangedKey(user.id)).then(v => {
        if (v) {
          const elapsed = Math.floor((Date.now() - parseInt(v)) / 86_400_000);
          setFilterDays(180 - elapsed);
          return;
        }
        // Legacy pre-migration key — only present on devices not yet migrated
        AsyncStorage.getItem('uc_filter_last_changed').then(lv => {
          if (lv) {
            const elapsed = Math.floor((Date.now() - parseInt(lv)) / 86_400_000);
            setFilterDays(180 - elapsed);
          }
        }).catch(() => {});
      }).catch(() => {});
    }).catch(() => {});
  }, [user]);

  useEffect(() => { refreshFilterStatus(); }, [refreshFilterStatus]);

  const cartBarInset = useCartBarInset();
  const featured = products?.slice(0, 6) ?? [];
  const productState = pageDataState(products !== undefined, isLoading, isError);

  return (
    <ScrollView style={[styles.screen, { backgroundColor: colors.background }]}
      contentContainerStyle={{ paddingBottom: cartBarInset || (Platform.OS === 'web' ? 34 : 80) }}
      showsVerticalScrollIndicator={false}>

      {/* Header */}
      <PhotoHeader initialView source={require('@/assets/headers/home-water.jpg')} photoHeight={128} position="center">
      <View style={[styles.header, { backgroundColor: UC_DEEP, paddingTop: topPad + 16 }]}>
        <View style={{ flex: 1, minWidth: 0 }}>
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
      </PhotoHeader>

       <View style={[styles.body, { padding: layout.gutter }]}>
        {/* Filter Health */}
        <TouchableOpacity accessibilityRole="button" accessibilityLabel={filterDays !== null ? 'View filter status' : 'Register your filter'}
          onPress={() => router.push('/(tabs)/account' as never)} activeOpacity={0.8}
          style={[styles.filterCard, { backgroundColor: filterDays !== null && filterDays < 30 ? colors.warningLight : colors.primaryLight, borderColor: filterDays !== null && filterDays < 30 ? colors.warning : colors.primary }]}>
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
        </TouchableOpacity>

        {/* Nudge: bought a trackable filter but never registered it */}
        <RegisterFilterPrompt onRegistered={refreshFilterStatus} />

        {/* Promotions banner — scrollable horizontal strip */}
        {promotions && promotions.length > 0 && (
          <View style={styles.promosSection}>
            <View style={styles.sectionHeader}>
              <Text style={[styles.sectionTitle, { color: colors.text }]}>Promotions</Text>
              <TouchableOpacity onPress={() => router.push('/referral' as never)}>
                <Text style={[styles.seeAll, { color: colors.primary }]}>Refer & Earn</Text>
              </TouchableOpacity>
            </View>
            <HorizontalCarousel
              data={promotions}
              keyExtractor={p => p.id}
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ gap: 10, paddingVertical: 4 }}
              renderItem={({ item }) => (
                <PromoBanner promo={item} onPress={() => router.push('/referral' as never)} />
              )}
            />
          </View>
        )}
        {promotionsLoading && promotions === undefined ? <PageDataLoader label="Loading promotions…" /> : null}
        {promotionsError && <PageDataError title="Promotions unavailable" error={promotionFailure} onRetry={retryPromotions} />}

        {/* Latest Blog reads — this request is intentionally separate from
            Home's primary catalogue and account content. */}
        <View style={styles.blogSection}>
          <View style={styles.sectionHeader}>
            <View>
              <Text style={[styles.sectionTitle, { color: colors.text }]}>Latest from the blog</Text>
              {latestBlog?.fromCache ? (
                <Text style={[styles.blogOffline, { color: colors.mutedForeground }]}>Saved articles · reconnect to refresh</Text>
              ) : null}
            </View>
            <TouchableOpacity onPress={() => router.push('/(tabs)/blog' as never)} accessibilityRole="button">
              <Text style={[styles.seeAll, { color: colors.primary }]}>See all</Text>
            </TouchableOpacity>
          </View>
          {latestBlog?.articles.length ? (
            latestBlog.articles.slice(0, 3).map((article) => (
              <TouchableOpacity key={article.id} accessibilityRole="button"
                accessibilityLabel={`Read ${article.title}`}
                onPress={() => router.push(`/blog/${encodeURIComponent(article.slug)}` as never)}
                style={[styles.blogCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <View style={styles.blogCardText}>
                  <Text style={[styles.blogCategory, { color: colors.primary }]} numberOfLines={1}>{article.category}</Text>
                  <Text style={[styles.blogTitle, { color: colors.text }]} numberOfLines={2}>{article.title}</Text>
                  <Text style={[styles.blogSummary, { color: colors.mutedForeground }]} numberOfLines={2}>{article.summary}</Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={colors.mutedForeground} />
              </TouchableOpacity>
            ))
          ) : latestBlog === undefined && latestBlogLoading ? (
            <PageDataLoader label="Loading articles…" />
          ) : latestBlog === undefined && latestBlogError ? (
            <PageDataError title="Blog articles unavailable" error={blogFailure} onRetry={retryBlog} />
          ) : latestBlog ? (
            <TouchableOpacity accessibilityRole="button" onPress={() => router.push('/(tabs)/blog' as never)} style={styles.statusAction}>
              <Text style={{ color: colors.mutedForeground }}>No articles yet. Explore the blog.</Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity accessibilityRole="button" onPress={() => router.push('/(tabs)/blog' as never)} style={styles.statusAction}>
              <Text style={{ color: colors.mutedForeground }}>Explore practical water and filtration advice.</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Quick Actions */}
        <View style={styles.section}>
          <View style={styles.grid2}>
            {QUICK_ACTIONS.map(a => (
              <TouchableOpacity key={a.id} activeOpacity={0.8}
                onPress={() => router.push(a.route as never)}
                style={[styles.actionCard, { minWidth: layout.size === 'compact' ? '45%' : '20%', backgroundColor: colors.card, borderColor: colors.border }]}>
                <View style={[styles.actionIcon, { backgroundColor: a.color + '18' }]}>
                  {a.id === 'test' ? <Image source={require('@/assets/images/water-test.png')} contentFit="contain" style={{ width: 48, height: 48 }} /> : <Ionicons name={a.icon} size={24} color={a.color} />}
                </View>
                <Text style={[styles.actionLabel, { color: colors.text }]}>{a.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* Featured Products */}
        <View style={styles.sectionHeader}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>Shop Products</Text>
          <TouchableOpacity onPress={() => router.push('/(tabs)/products')} style={styles.statusAction}>
            <Text style={[styles.seeAll, { color: colors.primary }]}>See all</Text>
          </TouchableOpacity>
        </View>
        {products !== undefined && isError && (
          <PageDataError title="Products could not refresh" message="Your saved products are shown below." onRetry={retryProducts} />
        )}

        {productState === 'loading' ? (
          <PageDataLoader label="Loading products…" />
        ) : productState === 'error' ? (
          <PageDataError title="Products couldn’t load" error={productError} onRetry={retryProducts} />
        ) : featured.length === 0 ? (
          <TouchableOpacity onPress={() => router.push('/(tabs)/products')} accessibilityRole="button" style={styles.statusAction}>
            <Text style={{ color: colors.mutedForeground }}>No featured products yet. Browse the shop.</Text>
          </TouchableOpacity>
        ) : (
          <HorizontalCarousel
            data={featured}
            keyExtractor={i => String(i.id)}
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ gap: 12, paddingHorizontal: 2, paddingVertical: 4 }}
            renderItem={({ item }) => (
              <View style={{ width: Math.max(156, Math.min(240, layout.cardWidth)) }}>
                <ProductCard product={item} onPress={() => router.push(`/product/${item.id}` as never)} />
              </View>
            )}
          />
        )}

        {/* UC Impact */}
        <ImpactBubble />
        <TouchableOpacity accessibilityRole="link" testID="home-about-us"
          onPress={() => router.push('/about' as never)} style={styles.statusAction}>
          <Text style={{ color: colors.primary, fontSize: 13, textDecorationLine: 'underline' }}>About Ultra Clear</Text>
        </TouchableOpacity>

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
  body: { padding: 16, gap: 20, width: '100%', maxWidth: 1200, alignSelf: 'center' },
  filterCard: { flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1, borderRadius: 14, padding: 14 },
  filterIcon: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  filterTitle: { fontSize: 14, fontWeight: '600' as const },
  filterSub: { fontSize: 12, marginTop: 2 },
  section: {},
  sectionHeader: { flexWrap: 'wrap', gap: 8, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  sectionTitle: { fontSize: 18, fontWeight: '700' as const },
  seeAll: { fontSize: 14, fontWeight: '500' as const },
  statusAction: { minHeight: 44, justifyContent: 'center', alignItems: 'center', gap: 8 },
  grid2: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  actionCard: { flex: 1, minWidth: '45%', borderRadius: 14, borderWidth: 1, padding: 16, alignItems: 'center', gap: 10 },
  actionIcon: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  actionLabel: { fontSize: 13, fontWeight: '600' as const, textAlign: 'center' },
  trustSection: { borderWidth: 1, borderRadius: 14, padding: 14, gap: 10 },
  trustTitle: { fontSize: 11, fontWeight: '700' as const, letterSpacing: 1 },
  promosSection: { gap: 10 },
  blogSection: { gap: 9 },
  blogCard: { flexDirection: 'row', alignItems: 'center', gap: 9, borderWidth: 1, borderRadius: 13, padding: 12 },
  blogCardText: { flex: 1, gap: 3 },
  blogCategory: { fontSize: 10, fontWeight: '700' as const, letterSpacing: 0.4, textTransform: 'uppercase' },
  blogTitle: { fontSize: 14, lineHeight: 19, fontWeight: '700' as const },
  blogSummary: { fontSize: 11, lineHeight: 16 },
  blogOffline: { fontSize: 10, marginTop: 2 },
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
