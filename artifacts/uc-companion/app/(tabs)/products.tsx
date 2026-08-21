import React, { useState, useRef, useCallback, useEffect } from 'react';
import {
  View, Text, StyleSheet, FlatList, TextInput, Platform,
  ActivityIndicator, RefreshControl, ScrollView, TouchableOpacity, Animated,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';
import { useRouter, useFocusEffect } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { useApi, UCProduct, resolveMediaUrl, resizedImageUrl } from '@/hooks/useApi';
import { useCart } from '@/context/CartContext';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useCartBarInset } from '@/hooks/useCartBarInset';
import ProductCard from '@/components/ProductCard';
import FilterChip from '@/components/FilterChip';
import SwipeTabs from '@/components/SwipeTabs';
import HorizontalCarousel from '@/components/HorizontalCarousel';
import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';

const CATEGORIES = ['All', 'Bottles & Portable', 'Home Filters', 'Shower & Skin', 'Accessories', 'Solutions'];
const topPad = Platform.OS === 'web' ? 67 : 0;

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
  const api = useApi();
  const insets = useSafeAreaInsets();
  const { items, addItem, refreshCart, cartHydrated, totalItems } = useCart();
  const cartBarInset = useCartBarInset();

  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('All');

  // Basket-derived state
  const hasItems = items.length > 0;
  const basketSkus = items.map(i => i.sku).filter(Boolean).join(',');

  // Re-sync cart from AsyncStorage on every tab focus so the bar always shows
  // the live item count/total even when items were added from another screen.
  useFocusEffect(useCallback(() => { refreshCart(); }, [refreshCart]));

  // Animated transition for the empty-basket view: 1 = visible, 0 = hidden.
  // Always start at 0 — we don't know the saved cart state until AsyncStorage
  // resolves, so we suppress it until cartHydrated is true.
  const emptyAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    // Don't animate until we know what the cart actually contains.
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
  const { data: products, isLoading, refetch, isRefetching } = useQuery({
    queryKey: ['products', category, search],
    queryFn: () => api.getProducts({
      category: category === 'All' ? undefined : category,
      search: search || undefined,
    }),
    staleTime: 2 * 60 * 1000,
  });

  // Compatibility add-ons — only fetched when basket has items
  const { data: addons, isFetching: addonsLoading } = useQuery({
    queryKey: ['compatibility', basketSkus],
    queryFn: () => api.getCompatibilityProducts(basketSkus),
    enabled: hasItems && basketSkus.length > 0,
    staleTime: 60 * 1000,
  });

  const numColumns = 2;

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
      {addonsLoading ? (
        <View style={styles.addonsSkeletonRow}>
          {[0, 1, 2].map(k => (
            <View key={k} style={[styles.addonSkeletonCard, { backgroundColor: colors.surface, borderColor: colors.border }]} />
          ))}
        </View>
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

      {/* Inline chatbot welcome card */}
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
    </Animated.View>
  );

  // ── Floating chatbot bubble ───────────────────────────────────────────────────

  const bubbleBottom = Platform.OS === 'web' ? 96 : (72 + insets.bottom);

  const chatBubble = hasItems ? (
    <TouchableOpacity
      onPress={() => router.push('/ai-chat' as never)}
      activeOpacity={0.85}
      style={[styles.chatBubble, { backgroundColor: colors.primary, bottom: bubbleBottom }]}>
      <Ionicons name="chatbubble-ellipses" size={18} color="#fff" />
      <Text style={styles.chatBubbleText}>Need help?</Text>
    </TouchableOpacity>
  ) : null;

  // ── Layout ────────────────────────────────────────────────────────────────────

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <Animated.ScrollView
        ref={scrollRef}
        showsVerticalScrollIndicator={false}
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingBottom: cartBarInset || (Platform.OS === 'web' ? 34 : 80) }}
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={colors.primary} />}>

        {/* Search */}
        <View style={[styles.searchBar, { backgroundColor: colors.surface, borderColor: colors.border, marginTop: topPad }]}>
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

        {/* Category chips */}
        <HorizontalCarousel
          data={CATEGORIES}
          keyExtractor={i => i}
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chips}
          renderItem={({ item }) => (
            <FilterChip label={item} active={category === item} onPress={() => setCategory(item)} />
          )}
        />

        {/* Empty state (basket empty) or Add-Ons section (basket has items).
            Suppressed until cartHydrated to prevent a flash of the empty card
            on first load when AsyncStorage hasn't resolved yet. */}
        {cartHydrated && (!hasItems ? emptyState : addOnsSection)}

        {/* Products catalog */}
        <View onLayout={e => { catalogOffsetY.current = e.nativeEvent.layout.y; }}>
          {isLoading ? (
            <ActivityIndicator color={colors.primary} style={{ marginTop: 40 }} />
          ) : (
            <FlatList
              data={products ?? []}
              key={`grid-${numColumns}`}
              numColumns={numColumns}
              keyExtractor={i => String(i.id)}
              contentContainerStyle={styles.grid}
              columnWrapperStyle={styles.row}
              showsVerticalScrollIndicator={false}
              scrollEnabled={false}
              ListHeaderComponent={
                <View style={styles.catalogHeader}>
                  <Text style={[styles.catalogLabel, { color: colors.mutedForeground }]}>
                    {category === 'All' ? 'All products' : category}
                  </Text>
                  <Text style={[styles.catalogCount, { color: colors.mutedForeground }]}>
                    {(products ?? []).length} product{(products ?? []).length === 1 ? '' : 's'}
                  </Text>
                </View>
              }
              ListEmptyComponent={
                <View style={styles.empty}>
                  <Ionicons name="search-outline" size={40} color={colors.border} />
                  <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>No products found</Text>
                </View>
              }
              renderItem={({ item }) => (
                <View style={styles.cardWrap}>
                  <ProductCard product={item} onPress={() => router.push(`/product/${item.id}` as never)} />
                </View>
              )}
            />
          )}
        </View>
      </Animated.ScrollView>

      {/* Floating chatbot bubble (basket non-empty) */}
      {chatBubble}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },

  // Search
  searchBar: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    margin: 16, marginBottom: 8,
    paddingHorizontal: 14, paddingVertical: 10,
    borderRadius: 12, borderWidth: 1,
  },
  searchInput: { flex: 1, fontSize: 15 },

  // Category chips
  chips: { paddingHorizontal: 16, paddingBottom: 12, gap: 8 },

  // Add-Ons
  addonsSection: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 6 },
  addonsHeading: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 9 },
  sectionTitle: { fontSize: 15, fontWeight: '700' as const },
  sectionSub: { fontSize: 12, marginTop: 1 },
  basketLink: { flexDirection: 'row', alignItems: 'center', gap: 5, borderWidth: 1, borderRadius: 16, paddingHorizontal: 9, paddingVertical: 6 },
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

  // Empty state
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

  // Chatbot welcome card
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

  // Floating chatbot bubble
  chatBubble: {
    position: 'absolute', right: 16,
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 14, paddingVertical: 10,
    borderRadius: 24,
    shadowColor: '#000', shadowOpacity: 0.18, shadowRadius: 8, shadowOffset: { width: 0, height: 3 },
    elevation: 5,
    zIndex: 10,
  },
  chatBubbleText: { color: '#fff', fontSize: 13, fontWeight: '600' as const },

  // Products catalog
  catalogHeader: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 8 },
  catalogLabel: { fontSize: 13, fontWeight: '700' as const, letterSpacing: 0.3, textTransform: 'uppercase' },
  catalogCount: { fontSize: 12 },
  grid: { padding: 12, paddingBottom: 0 },
  row: { gap: 12, marginBottom: 12 },
  cardWrap: { flex: 1 },
  empty: { alignItems: 'center', marginTop: 60, gap: 12 },
  emptyText: { fontSize: 15 },
});
