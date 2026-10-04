import { trackEvent } from '@/lib/analytics';
import React, { useState, useRef, useCallback, useEffect } from 'react';
import {
  View, Text, StyleSheet, FlatList, TextInput, Platform,
   RefreshControl, ScrollView, TouchableOpacity, Animated,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { useColors } from '@/hooks/useColors';
import { useRouter, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useApi, UCProduct, resolveMediaUrl, resizedImageUrl } from '@/hooks/useApi';
import { useAuth } from '@/context/AuthContext';
import { useCart } from '@/context/CartContext';
import { customerQueryKeys } from '@/lib/customerQueryKeys';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useCompanionLayout } from '@/hooks/useCompanionLayout';
import { useCartBarInset } from '@/hooks/useCartBarInset';
import PhotoHeader from '@/components/PhotoHeader';
import ProductCard from '@/components/ProductCard';
import PageDataLoader from '@/components/PageDataLoader';
import PageDataError from '@/components/PageDataError';
import { pageDataState } from '@/lib/pageLoading';
import FilterChip from '@/components/FilterChip';
import SwipeTabs from '@/components/SwipeTabs';
import HorizontalCarousel from '@/components/HorizontalCarousel';
import * as Haptics from 'expo-haptics';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { STORE_CATEGORIES, visibleStoreCategory, type StoreCategory } from '@/lib/storeCategories';
import {
  catalogueQueryKey,
  normalizeCatalogueParams,
  scheduleCatalogueSearch,
} from '@/lib/catalogueQuery';

const CATEGORIES = STORE_CATEGORIES;

const ALISON_SEEN_KEY = 'hasSeenAlisonWelcome';
function formatKES(price: number) {
  return `KES ${price.toLocaleString('en-KE')}`;
}

// ── Compact add-on card ───────────────────────────────────────────────────────

interface AddonCardProps {
  product: UCProduct;
  onAdd: () => void;
  onPress: () => void;
  colors: ReturnType<typeof useColors>;
}

function AddonCard({ product, onAdd, onPress, colors }: AddonCardProps) {
  const price = parseFloat(product.salePrice || product.price || product.regularPrice);
  return (
    <View
      style={[styles.addonCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <TouchableOpacity onPress={onPress} activeOpacity={0.8} style={styles.addonInfoTap}>
        <View style={[styles.addonImageWrap, { backgroundColor: colors.surface }]}>
          {product.images[0] ? (
            <Image
              source={{ uri: resizedImageUrl(product.images[0].src, 64) }}
              style={styles.addonImage}
              contentFit="contain"
              transition={120}
              recyclingKey={product.images[0].src}
            />
          ) : (
            <Ionicons name="water-outline" size={20} color={colors.primary} />
          )}
        </View>
        <View style={styles.addonText}>
          <Text style={[styles.addonName, { color: colors.text }]} numberOfLines={1}>{product.name}</Text>
          <Text style={[styles.addonPrice, { color: colors.primary }]}>
            {isNaN(price) ? '—' : formatKES(price)}
          </Text>
        </View>
      </TouchableOpacity>
      <TouchableOpacity
        onPress={onAdd}
        activeOpacity={0.8}
        style={[styles.addonAddBtn, { backgroundColor: colors.primaryLight, borderColor: colors.primary }]}>
        <Ionicons name="add" size={13} color={colors.primary} />
        <Text style={[styles.addonAddText, { color: colors.primary }]}>Add</Text>
      </TouchableOpacity>
    </View>
  );
}

// ── Main screen ───────────────────────────────────────────────────────────────

export default function ProductsScreen() {
  return (
    <SwipeTabs tab="products">
      <ProductsScreenContent />
    </SwipeTabs>
  );
}

function ProductsScreenContent() {
  const colors = useColors();
  const router = useRouter();
  const layout = useCompanionLayout();
  const contentBound = { width: '100%' as const, maxWidth: 1200, alignSelf: 'center' as const };
  const numColumns = layout.columns;

  const { category: categoryParam } = useLocalSearchParams<{ category?: string }>();
  const api = useApi();
  const queryClient = useQueryClient();
  const { token, user } = useAuth();
  const insets = useSafeAreaInsets();
  const { items, addItem, refreshCart, cartHydrated, totalItems } = useCart();
  const cartBarInset = useCartBarInset();

  const [search, setSearch] = useState('');
  const [settledSearch, setSettledSearch] = useState('');
  const [category, setCategory] = useState<StoreCategory>('All');

  useEffect(
    () => scheduleCatalogueSearch(search, setSettledSearch),
    [search],
  );

  // Products can be reached from a product-category chip or a deep link. Keep
  // the UI state derived from the route so a back navigation never loses the
  // shopper's selected segment.
  useEffect(() => {
    if (typeof categoryParam === 'string') {
      setCategory(visibleStoreCategory(categoryParam) ?? 'All');
    }
  }, [categoryParam]);

  const selectCategory = useCallback((next: StoreCategory) => {
    setCategory(next);
    router.setParams({ category: next });
  }, [router]);

  // Alison collapsed state — persisted across visits
  const [alisonCollapsed, setAlisonCollapsed] = useState(true); // default collapsed until AsyncStorage resolves
  const [alisonReady, setAlisonReady] = useState(false); // true once AsyncStorage check is done

  // In-grid Alison nudge — session-only dismissal
  const nudgeDismissedRef = useRef(false);
  const [nudgeReady, setNudgeReady] = useState(false);

  // True when the user has an active filter — suppress Alison surfaces
  const isFiltering = search.length > 0 || category !== 'All';

  // Basket-derived state
  const hasItems = items.length > 0;
  const basketSkus = items.map(i => i.sku).filter(Boolean).join(',');

  // Re-sync cart from AsyncStorage on every tab focus so the bar always shows
  // the live item count/total even when items were added from another screen.
  useFocusEffect(useCallback(() => { refreshCart(); }, [refreshCart]));

  // Load/set Alison seen flag from AsyncStorage once on mount
  useEffect(() => {
    AsyncStorage.getItem(ALISON_SEEN_KEY).then(val => {
      if (val === 'true') {
        setAlisonCollapsed(true);
      } else {
        // First visit — show full card and mark as seen for future visits
        setAlisonCollapsed(false);
        AsyncStorage.setItem(ALISON_SEEN_KEY, 'true').catch(() => {});
      }
      setAlisonReady(true);
    }).catch(() => {
      setAlisonCollapsed(false);
      setAlisonReady(true);
    });
  }, []);

  // Make the inline nudge eligible after 8 seconds of browsing. Filtering only
  // suppresses its display; clearing the filter can reveal it unless dismissed.
  useEffect(() => {
    const timer = setTimeout(() => {
      if (!nudgeDismissedRef.current) setNudgeReady(true);
    }, 8000);
    return () => clearTimeout(timer);
  }, []);

  const dismissNudge = useCallback(() => {
    nudgeDismissedRef.current = true;
    setNudgeReady(false);
  }, []);

  // Animated transition for the empty-basket view: 1 = visible, 0 = hidden.
  const emptyAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!cartHydrated) return;
    Animated.timing(emptyAnim, { toValue: hasItems ? 0 : 1, duration: 280, useNativeDriver: true }).start();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasItems, cartHydrated]);

  // ScrollView ref + catalog layout position for scroll-to-products
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const scrollRef      = useRef<any>(null);
  const catalogOffsetY = useRef(0);
  const scrollToProducts = useCallback(() => {
    scrollRef.current?.scrollTo({ y: catalogOffsetY.current, animated: true });
  }, []);

  // Main products query
  const { data: products, isLoading, isError, error, refetch, isRefetching } = useQuery({
    queryKey: catalogueQueryKey({
      category: category === 'All' ? undefined : category,
      search: settledSearch,
    }),
    queryFn: ({ signal }) => api.getProducts(normalizeCatalogueParams({
      category: category === 'All' ? undefined : category,
      search: settledSearch,
    }), signal),
    staleTime: 30_000,
  });

  // Compatibility add-ons — only fetched when basket has items
  const { data: addons, isLoading: addonsLoading, isError: addonsError, refetch: retryAddons } = useQuery({
    queryKey: ['compatibility', basketSkus],
    queryFn: () => api.getCompatibilityProducts(basketSkus),
    enabled: hasItems && basketSkus.length > 0,
    staleTime: 60 * 1000,
  });

  // Wishlist
  const { data: wishlist } = useQuery({
    queryKey: customerQueryKeys.wishlist(user?.id),
    queryFn: () => api.getWishlist(),
    enabled: !!token && !!user,
    staleTime: 60 * 1000,
  });

  // Track pending wishlist toggles per product ID
  const [wishlistPendingMap, setWishlistPendingMap] = useState<Record<number, boolean>>({});

  // Track current customer to avoid state leaks on sign-out/switch
  const currentCustomerId = useRef<number | null>(user?.id ?? null);
  useEffect(() => {
    currentCustomerId.current = user?.id ?? null;
    setWishlistPendingMap({});
  }, [user?.id]);

  const toggleWishlist = useCallback(async (product: UCProduct) => {
    if (!token || !user) {
      router.push('/auth/login');
      return;
    }
    const pid = product.id;
    const initiatingCustomerId = user.id;
    const serverWishlisted = wishlist?.some((w) => w.productId === pid) ?? false;
    const isCurrentlyWishlisted = wishlistPendingMap[pid] !== undefined ? wishlistPendingMap[pid] : serverWishlisted;
    const nextState = !isCurrentlyWishlisted;

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    setWishlistPendingMap(prev => ({ ...prev, [pid]: nextState }));

    try {
      if (nextState) {
        await api.addToWishlist(pid, product.name);
      } else {
        await api.removeFromWishlist(pid);
      }
      trackEvent(nextState ? 'wishlist_item_added' : 'wishlist_item_removed', { productId: pid });
      await queryClient.invalidateQueries({ queryKey: customerQueryKeys.wishlist(initiatingCustomerId) });
    } catch {
      if (currentCustomerId.current === initiatingCustomerId) {
        setWishlistPendingMap(prev => {
          const newState = { ...prev };
          delete newState[pid];
          return newState;
        });
      }
    } finally {
      if (currentCustomerId.current === initiatingCustomerId) {
        setWishlistPendingMap(prev => {
          const newState = { ...prev };
          delete newState[pid];
          return newState;
        });
      }
    }
  }, [token, user, router, wishlist, wishlistPendingMap, api, queryClient]);

  // ── Add-Ons section ──────────────────────────────────────────────────────────

  const addOnsSection = (
    <View style={styles.addonsSection}>
      <View style={styles.addonsHeading}>
        <View style={{ flex: 1 }}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>Compatible add-ons</Text>
          <Text style={[styles.sectionSub, { color: colors.mutedForeground }]}>Recommended for your basket</Text>
        </View>
        <TouchableOpacity
          testID="products-view-basket"
          onPress={() => router.push('/cart' as never)}
          activeOpacity={0.8}
          style={[styles.basketLink, { backgroundColor: colors.primaryLight, borderColor: colors.primary }]}
        >
          <Ionicons name="cart-outline" size={14} color={colors.primary} />
          <Text style={[styles.basketLinkText, { color: colors.primary }]}>
            {totalItems} item{totalItems === 1 ? '' : 's'}
          </Text>
        </TouchableOpacity>
      </View>
      {addonsError ? <PageDataError title="Compatible add-ons unavailable" onRetry={retryAddons} /> : null}
      {addonsLoading && addons === undefined ? (
        <PageDataLoader label="Loading compatible add-ons…" />
      ) : (addons ?? []).length > 0 ? (
        <HorizontalCarousel
          data={addons}
          keyExtractor={i => String(i.id)}
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.addonsRow}
          renderItem={({ item }) => (
                <AddonCard
              product={item}
              colors={colors}
              onPress={() => router.push(`/product/${item.id}` as never)}
              onAdd={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
                const price = parseFloat(item.salePrice || item.price || item.regularPrice);
                addItem({
                  id: item.id,
                  name: item.name,
                  price: isNaN(price) ? 0 : price,
                  quantity: 1,
                  image: resolveMediaUrl(item.images[0]?.src ?? ''),
                  sku: item.sku,
                });
              }}
            />
          )}
        />
      ) : null}
    </View>
  );

  // ── Empty state ──────────────────────────────────────────────────────────────

  // Alison inline card — collapsed to a slim row after the first visit,
  // or hidden entirely when the user is actively filtering.
  const alisonInlineCard = !isFiltering && alisonReady ? (
    alisonCollapsed ? (
      // Slim link row shown on subsequent visits
      <TouchableOpacity
        onPress={() => router.push('/ai-chat' as never)}
        activeOpacity={0.8}
        style={[styles.alisonSlimRow, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <View style={[styles.chatAvatar, styles.chatAvatarSm, { backgroundColor: colors.primary }]}>
          <Text style={styles.chatAvatarText}>A</Text>
        </View>
        <Text style={[styles.alisonSlimText, { color: colors.text }]}>Chat with Alison — water filtration guide</Text>
        <Ionicons name="chevron-forward" size={16} color={colors.mutedForeground} />
      </TouchableOpacity>
    ) : (
      // Full welcome card — first visit only
      <View style={[styles.chatPromptCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <View style={styles.chatPromptHeader}>
          <View style={[styles.chatAvatar, { backgroundColor: colors.primary }]}>
            <Text style={styles.chatAvatarText}>A</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.chatName, { color: colors.text }]}>Alison</Text>
            <View style={styles.chatStatusRow}>
              <View style={styles.onlineDot} />
              <Text style={[styles.chatStatusText, { color: colors.mutedForeground }]}>Ultra-Clear Water Guide</Text>
            </View>
          </View>
        </View>
        <Text style={[styles.chatMessage, { color: colors.text }]}>
          Welcome! I can help you find the perfect water filtration solution for your home or business.
          What kind of water issue are you facing?
        </Text>
        <View style={styles.quickReplyRow}>
          <TouchableOpacity
            onPress={() => router.push('/ai-chat' as never)}
            activeOpacity={0.8}
            style={[styles.quickReply, { borderColor: colors.primary + '66', backgroundColor: colors.primaryLight + '55' }]}>
            <Text style={[styles.quickReplyText, { color: colors.primary }]}>Show me filters</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => router.push('/ai-chat' as never)}
            activeOpacity={0.8}
            style={[styles.quickReply, { borderColor: colors.primary + '66', backgroundColor: colors.primaryLight + '55' }]}>
            <Text style={[styles.quickReplyText, { color: colors.primary }]}>Help me choose</Text>
          </TouchableOpacity>
        </View>
      </View>
    )
  ) : null;

  const emptyState = (
    <Animated.View
      style={[
        styles.emptyStateWrap,
        {
          opacity: emptyAnim,
          transform: [{
            translateY: emptyAnim.interpolate({ inputRange: [0, 1], outputRange: [20, 0] }),
          }],
        },
      ]}>
      {/* Empty basket card */}
      <View style={[styles.emptyCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <Ionicons name="cart-outline" size={52} color={colors.border} />
        <Text style={[styles.emptyCardTitle, { color: colors.text }]}>Your basket is empty</Text>
        <Text style={[styles.emptyCardSub, { color: colors.mutedForeground }]}>
          Discover water filtration solutions for your home or business
        </Text>
        <TouchableOpacity
          onPress={scrollToProducts}
          activeOpacity={0.8}
          style={[styles.emptyBrowseBtn, { backgroundColor: colors.primary }]}>
          <Text style={styles.emptyBrowseBtnText}>Browse Products</Text>
        </TouchableOpacity>
      </View>

      {alisonInlineCard}
    </Animated.View>
  );

  // ── In-grid Alison nudge (session-timed) ──────────────────────────────────────

  const showNudge = nudgeReady && !isFiltering && (products?.length ?? 0) > numColumns;
  const alisonNudge = showNudge ? (
    <View
      testID="products-alison-nudge"
      style={[styles.alisonNudge, { backgroundColor: colors.surface, borderColor: colors.primary + '55' }]}>
      <View style={[styles.chatAvatar, { backgroundColor: colors.primary }]}>
        <Text style={styles.chatAvatarText}>A</Text>
      </View>
      <TouchableOpacity
        testID="products-alison-nudge-open"
        onPress={() => router.push('/ai-chat' as never)}
        activeOpacity={0.85}
        style={styles.alisonNudgeContent}>
        <Text style={[styles.alisonNudgeTitle, { color: colors.text }]}>Not sure which filter fits?</Text>
        <Text style={[styles.alisonNudgeText, { color: colors.mutedForeground }]}>
          Ask Alison for a quick recommendation
        </Text>
      </TouchableOpacity>
      <TouchableOpacity
        testID="products-alison-nudge-dismiss"
        accessibilityRole="button"
        accessibilityLabel="Dismiss filter help"
        hitSlop={10}
        onPress={dismissNudge}
        style={styles.alisonNudgeDismiss}>
        <Ionicons name="close" size={18} color={colors.mutedForeground} />
      </TouchableOpacity>
    </View>
  ) : null;

  // ── Layout ────────────────────────────────────────────────────────────────────

  const headerTop = 0;

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>

      {/* ── Branded header bar ── */}
      <PhotoHeader initialView source={require('@/assets/headers/shop-filter.jpg')} photoHeight={104} position="center">
      <View style={[styles.brandHeader, { paddingTop: headerTop + 10 }]}>
        <View style={[styles.brandHeaderInner, contentBound]}>
          <Image
            source={require('@/assets/images/logo-lockup-white.png')}
            style={styles.brandLogo}
            contentFit="contain"
          />
          <TouchableOpacity
            onPress={() => router.push('/cart' as never)}
            activeOpacity={0.8}
            style={styles.cartIconBtn}
            accessibilityLabel={`Cart, ${items.length} items`}>
            <Ionicons name="cart-outline" size={24} color="#fff" />
            {cartHydrated && totalItems > 0 && (
              <View style={styles.cartBadge}>
                <Text style={styles.cartBadgeText}>{totalItems > 9 ? '9+' : totalItems}</Text>
              </View>
            )}
          </TouchableOpacity>
        </View>
      </View>
      </PhotoHeader>

      {/* ── Sticky search + category chips ── */}
      <View style={[styles.stickyControls, { backgroundColor: colors.background, borderBottomColor: colors.border }]}>
        <View style={contentBound}>
          {/* Search */}
          <View style={[styles.searchBar, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Ionicons name="search-outline" size={18} color={colors.mutedForeground} />
            <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder="Search filters, systems…"
            placeholderTextColor={colors.mutedForeground}
            style={[styles.searchInput, { color: colors.text }]}
          />
          {search.length > 0 && (
            <Ionicons name="close-circle" size={18} color={colors.mutedForeground} onPress={() => setSearch('')} />
          )}
        </View>

        {/* Category chips — plain ScrollView to avoid gesture conflict with SwipeTabs */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chips}
          keyboardShouldPersistTaps="handled">
          {CATEGORIES.map(cat => (
            <FilterChip key={cat} label={cat} active={category === cat} onPress={() => selectCategory(cat)} />
          ))}
        </ScrollView>
        </View>
      </View>

      {/* ── Scrollable content ── */}
      <Animated.ScrollView
        ref={scrollRef}
        showsVerticalScrollIndicator={false}
        style={{ flex: 1 }}
        contentContainerStyle={[{ paddingBottom: cartBarInset || (Platform.OS === 'web' ? 34 : 80) }, contentBound]}
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={colors.primary} />}>

        {/* Empty state (basket empty) or Add-Ons section (basket has items).
            Suppressed until cartHydrated to prevent a flash of the empty card
            on first load when AsyncStorage hasn't resolved yet. */}
        {cartHydrated && (!hasItems ? emptyState : addOnsSection)}

        {/* Products catalog */}
        <View onLayout={e => { catalogOffsetY.current = e.nativeEvent.layout.y; }}>
          {products !== undefined && isError && (
            <PageDataError title="Products could not refresh" message="Your saved products are shown below." onRetry={refetch} />
          )}
          {pageDataState(products !== undefined, isLoading, isError) === 'loading' ? (
            <PageDataLoader label="Loading products…" />
          ) : !products && isError ? (
            <PageDataError title="Products unavailable" error={error} onRetry={refetch} />
          ) : (
            <FlatList
              key={`grid-${numColumns}`}
              numColumns={numColumns}
              keyExtractor={i => String(i.id)}
              contentContainerStyle={[styles.grid, { paddingHorizontal: layout.gutter }]}
              columnWrapperStyle={numColumns > 1 ? [styles.row, { gap: layout.gap }] : undefined}
              showsVerticalScrollIndicator={false}
              scrollEnabled={false}
              ListHeaderComponent={
                <View>
                  <View style={styles.catalogHeader}>
                    <Text style={[styles.catalogLabel, { color: colors.mutedForeground }]}>
                      {category === 'All' ? 'All products' : category}
                    </Text>
                    <Text style={[styles.catalogCount, { color: colors.mutedForeground }]}>
                      {(products ?? []).length} product{(products ?? []).length === 1 ? '' : 's'}
                    </Text>
                  </View>
                  {showNudge && (
                    <>
                      <View style={[styles.row, { flexDirection: 'row', gap: layout.gap }]}>
                        {(products ?? []).slice(0, numColumns).map(product => {
                          const isServerWishlisted = wishlist?.some(w => w.productId === product.id) ?? false;
                          const pendingState = wishlistPendingMap[product.id];
                          const isWishlisted = pendingState !== undefined ? pendingState : isServerWishlisted;
                          return (
                            <View key={product.id} style={[styles.cardWrap, { width: layout.cardWidth, marginBottom: 8 }]}>
                              <ProductCard
                                product={product}
                                isWishlisted={isWishlisted}
                                wishlistPending={pendingState !== undefined}
                                onToggleWishlist={() => toggleWishlist(product)}
                                onPress={() => router.push({
                                  pathname: '/product/[id]',
                                  params: { id: String(product.id), category },
                                } as never)}
                              />
                            </View>
                          );
                        })}
                      </View>
                      {alisonNudge}
                    </>
                  )}
                </View>
              }
              ListEmptyComponent={
                <View style={styles.empty}>
                  <Ionicons name="search-outline" size={40} color={colors.border} />
                  <Text style={[styles.emptyText, { color: colors.text }]}>
                    {search || category !== 'All' ? 'No products in this selection' : 'No products found'}
                  </Text>
                  <Text style={[styles.emptySub, { color: colors.mutedForeground }]}>
                    {search || category !== 'All'
                      ? 'Try another category or clear your search.'
                      : 'Please check back shortly.'}
                  </Text>
                </View>
              }
              renderItem={({ item }) => {
                const isServerWishlisted = wishlist?.some(w => w.productId === item.id) ?? false;
                const pendingState = wishlistPendingMap[item.id];
                const isWishlisted = pendingState !== undefined ? pendingState : isServerWishlisted;
                return (
                  <View style={[styles.cardWrap, { width: layout.cardWidth, marginBottom: 8 }]}>
                    <ProductCard
                      product={item}
                      isWishlisted={isWishlisted}
                      wishlistPending={pendingState !== undefined}
                      onToggleWishlist={() => toggleWishlist(item)}
                      onPress={() => router.push({
                        pathname: '/product/[id]',
                        params: { id: String(item.id), category },
                      } as never)}
                    />
                  </View>
                );
              }}
              data={showNudge ? (products ?? []).slice(numColumns) : (products ?? [])}
            />
          )}
        </View>
      </Animated.ScrollView>

    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },

  // ── Branded header ────────────────────────────────────────────────────────────
  brandHeader: {
    backgroundColor: '#005d8f',
    paddingBottom: 10,
  },
  brandHeaderInner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
  },
  brandLogo: {
    width: 120,
    height: 36,
  },
  cartIconBtn: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cartBadge: {
    position: 'absolute',
    top: 2,
    right: 2,
    backgroundColor: '#f59e0b',
    width: 16,
    height: 16,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cartBadgeText: { color: '#fff', fontSize: 9, fontWeight: '700' as const },

  // ── Sticky search + chips ─────────────────────────────────────────────────────
  stickyControls: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingBottom: 6,
  },

  // Search
  searchBar: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    marginHorizontal: 16, marginTop: 12, marginBottom: 8,
    paddingHorizontal: 14, paddingVertical: 10,
    borderRadius: 12, borderWidth: 1,
  },
  searchInput: { flex: 1, fontSize: 15 },

  // Category chips
  chips: { paddingHorizontal: 16, paddingBottom: 6, gap: 8, flexDirection: 'row' },

  // ── Add-Ons ───────────────────────────────────────────────────────────────────
  addonsSection: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 6 },
  addonsHeading: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 9 },
  sectionTitle: { fontSize: 15, fontWeight: '700' as const },
  sectionSub: { fontSize: 12, marginTop: 1 },
  basketLink: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    borderWidth: 1, borderRadius: 16, paddingHorizontal: 9, paddingVertical: 6,
  },
  basketLinkText: { fontSize: 12, fontWeight: '700' as const },
  addonsRow: { gap: 8, paddingRight: 16 },
  addonsSkeletonRow: { flexDirection: 'row', gap: 10 },
  addonSkeletonCard: {
    width: 230, height: 72,
    borderRadius: 12, borderWidth: 1,
    opacity: 0.5,
  },
  addonCard: {
    width: 250, minHeight: 72, borderRadius: 12, borderWidth: 1,
    padding: 8, flexDirection: 'row', alignItems: 'center', gap: 8,
  },
  addonInfoTap: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8 },
  addonText: { flex: 1, gap: 3 },
  addonImageWrap: {
    width: 52, height: 52, borderRadius: 8,
    alignItems: 'center', justifyContent: 'center',
  },
  addonImage: { width: '100%', height: '100%', borderRadius: 6 },
  addonName: { fontSize: 12, fontWeight: '600' as const, lineHeight: 16 },
  addonPrice: { fontSize: 13, fontWeight: '700' as const },
  addonAddBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 3, borderWidth: 1, borderRadius: 7,
    paddingHorizontal: 7, paddingVertical: 7,
  },
  addonAddText: { fontSize: 12, fontWeight: '600' as const },

  // ── Empty state ───────────────────────────────────────────────────────────────
  emptyStateWrap: { paddingHorizontal: 16, paddingTop: 8, gap: 14 },
  emptyCard: {
    borderRadius: 16, borderWidth: 1,
    padding: 24, alignItems: 'center', gap: 10,
  },
  emptyCardTitle: { fontSize: 18, fontWeight: '700' as const },
  emptyCardSub: { fontSize: 13, textAlign: 'center', lineHeight: 20 },
  emptyBrowseBtn: {
    paddingVertical: 11, paddingHorizontal: 28,
    borderRadius: 10, marginTop: 4,
  },
  emptyBrowseBtnText: { color: '#fff', fontSize: 14, fontWeight: '700' as const },

  // ── Alison slim row (collapsed) ───────────────────────────────────────────────
  alisonSlimRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    borderRadius: 12, borderWidth: 1,
    paddingHorizontal: 14, paddingVertical: 10,
  },
  chatAvatarSm: { width: 28, height: 28, borderRadius: 14 },
  alisonSlimText: { flex: 1, fontSize: 13 },

  // ── Alison full welcome card ──────────────────────────────────────────────────
  chatPromptCard: { borderRadius: 14, borderWidth: 1, padding: 16, gap: 12 },
  chatPromptHeader: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  chatAvatar: {
    width: 36, height: 36, borderRadius: 18,
    alignItems: 'center', justifyContent: 'center',
  },
  chatAvatarText: { color: '#fff', fontSize: 15, fontWeight: '700' as const },
  chatName: { fontSize: 14, fontWeight: '700' as const },
  chatStatusRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 2 },
  onlineDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: '#22c55e' },
  chatStatusText: { fontSize: 12 },
  chatMessage: { fontSize: 14, lineHeight: 21 },
  quickReplyRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  quickReply: {
    paddingHorizontal: 14, paddingVertical: 7,
    borderRadius: 20, borderWidth: 1,
  },
  quickReplyText: { fontSize: 13, fontWeight: '500' as const },

  // ── In-grid Alison nudge ───────────────────────────────────────────────────────
  alisonNudge: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    borderWidth: 1, borderRadius: 12,
    paddingHorizontal: 12, paddingVertical: 10,
    marginBottom: 8,
  },
  alisonNudgeContent: { flex: 1 },
  alisonNudgeTitle: { fontSize: 14, fontWeight: '700' as const },
  alisonNudgeText: { fontSize: 12, marginTop: 2 },
  alisonNudgeDismiss: {
    width: 32, height: 32,
    alignItems: 'center', justifyContent: 'center',
  },

  // ── Products catalog ──────────────────────────────────────────────────────────
  catalogHeader: {
    flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between',
    marginTop: 16, marginBottom: 8,
  },
  catalogLabel: {
    fontSize: 12, fontWeight: '600' as const,
    letterSpacing: 0.8, textTransform: 'uppercase',
  },
  catalogCount: { fontSize: 12 },
  grid: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 0 },
  row: { gap: 4, marginBottom: 8 },
  cardWrap: { flexGrow: 0, flexShrink: 0 },
  empty: { alignItems: 'center', marginTop: 60, gap: 12, paddingHorizontal: 28 },
  emptyText: { fontSize: 15 },
  emptySub: { fontSize: 13, textAlign: 'center', lineHeight: 19 },
  retryBtn: { borderRadius: 10, paddingHorizontal: 18, paddingVertical: 10 },
  retryBtnText: { color: '#fff', fontSize: 14, fontWeight: '700' as const },
});
