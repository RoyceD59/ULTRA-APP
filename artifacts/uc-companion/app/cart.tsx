import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, Platform, ActivityIndicator } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';
import { useRouter } from 'expo-router';
import { useCart } from '@/context/CartContext';
import { useApi, UCProduct, resolveMediaUrl, resizedImageUrl } from '@/hooks/useApi';
import * as Haptics from 'expo-haptics';

const DELIVERY_FEE = 500;

/** Sale-aware display price for a recommendation row. */
function recPrice(p: UCProduct): number {
  const n = parseFloat(p.salePrice || p.price || p.regularPrice);
  return isNaN(n) ? 0 : n;
}

export default function CartScreen() {
  const colors = useColors();
  const router = useRouter();
  const api = useApi();
  const { items, removeItem, updateQty, totalPrice, addItem, cartHydrated, cartLoadError, refreshCart } = useCart();

  const total = totalPrice + (items.length > 0 ? DELIVERY_FEE : 0);

  // ── Recommendations (below the price-match badge) ──────────────────────────
  // Replacement filters compatible with the cart items come first, then other
  // recommended products ranked by lifetime sales (toggle high↔low).
  const [recs, setRecs] = useState<UCProduct[]>([]);
  const [salesDesc, setSalesDesc] = useState(true);
  const skusKey = items.map(i => i.sku).filter(Boolean).join(',');
  const idsInCart = items.map(i => i.id).join(',');

  useEffect(() => {
    if (!skusKey) { setRecs([]); return; }
    let cancelled = false;
    api.getCompatibilityProducts(skusKey)
      .then(list => {
        if (cancelled) return;
        const cartIds = new Set(idsInCart.split(',').map(Number));
        setRecs(list.filter(p => !cartIds.has(p.id) && p.stockStatus !== 'outofstock'));
      })
      .catch(() => { if (!cancelled) setRecs([]); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [skusKey, idsInCart]);

  const replacements = recs.filter(p => p.compatibilityReason === 'Replacement Filter');
  const others = [...recs.filter(p => p.compatibilityReason !== 'Replacement Filter')]
    .sort((a, b) => salesDesc
      ? (b.totalSales ?? 0) - (a.totalSales ?? 0)
      : (a.totalSales ?? 0) - (b.totalSales ?? 0));

  function handleAddRec(p: UCProduct) {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    addItem({
      id: p.id,
      name: p.name,
      price: recPrice(p),
      quantity: 1,
      image: resolveMediaUrl(p.images?.[0]?.src ?? ''),
      sku: p.sku,
    });
  }

  // NB: the row is a plain View with two SIBLING touchables (info → product
  // page, button → add/enquire). Nesting a TouchableOpacity inside another
  // makes taps on the inner button also fire the outer navigation on web.
  function RecRow({ product }: { product: UCProduct }) {
    return (
      <View style={[styles.recRow, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <TouchableOpacity
          activeOpacity={0.8}
          onPress={() => router.push(`/product/${product.id}` as never)}
          style={styles.recInfoTap}
        >
          <View style={[styles.recImageWrap, { backgroundColor: colors.surface }]}>
            {product.images?.[0] ? (
              <Image
                source={{ uri: resizedImageUrl(product.images[0].src, 48) }}
                style={styles.recImage}
                contentFit="contain"
                transition={120}
              />
            ) : (
              <Ionicons name="water-outline" size={20} color={colors.primary} />
            )}
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.recName, { color: colors.text }]} numberOfLines={2}>{product.name}</Text>
            <Text style={[styles.recPrice, { color: colors.primary }]}>
              KES {recPrice(product).toLocaleString('en-KE')}
            </Text>
          </View>
        </TouchableOpacity>
        {product.enquiryOnly ? (
          <TouchableOpacity
            onPress={() => router.push(`/enquiry?productId=${product.id}&productName=${encodeURIComponent(product.name)}` as never)}
            style={[styles.recAddBtn, { backgroundColor: colors.surface, borderColor: colors.primary, borderWidth: 1 }]}
          >
            <Ionicons name="mail-outline" size={16} color={colors.primary} />
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            onPress={() => handleAddRec(product)}
            hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
            style={[styles.recAddBtn, { backgroundColor: colors.primary }]}
          >
            <Ionicons name="add" size={18} color="#fff" />
          </TouchableOpacity>
        )}
      </View>
    );
  }

  // Hydration guard: on a slow device the AsyncStorage read can still be in
  // flight when this screen mounts.  Rendering against the not-yet-hydrated
  // `items: []` default would flash "Your cart is empty" for a frame or two,
  // so show a spinner until the cart has been read at least once.
  // If the read has failed (or timed out), show a Retry button instead of
  // leaving the shopper on an endless spinner.
  if (!cartHydrated) {
    if (cartLoadError) {
      return (
        <View style={[styles.screen, { backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center', gap: 16 }]}>
          <Ionicons name="cloud-offline-outline" size={48} color={colors.border} />
          <Text style={[styles.emptyTitle, { color: colors.text }]}>Couldn't load your basket</Text>
          <Text style={[styles.emptySub, { color: colors.mutedForeground }]}>There was a problem reading your saved cart.</Text>
          <TouchableOpacity onPress={refreshCart} style={[styles.shopBtn, { backgroundColor: colors.primary }]}>
            <Text style={styles.shopBtnText}>Retry</Text>
          </TouchableOpacity>
        </View>
      );
    }
    return (
      <View style={[styles.screen, { backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center' }]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  if (items.length === 0) {
    return (
      <View style={[styles.screen, { backgroundColor: colors.background }]}>
        <View style={styles.empty}>
          <Ionicons name="cart-outline" size={64} color={colors.border} />
          <Text style={[styles.emptyTitle, { color: colors.text }]}>Your cart is empty</Text>
          <Text style={[styles.emptySub, { color: colors.mutedForeground }]}>Add products to get started</Text>
          <TouchableOpacity onPress={() => router.push('/(tabs)/products')}
            style={[styles.shopBtn, { backgroundColor: colors.primary }]}>
            <Text style={styles.shopBtnText}>Browse Products</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <FlatList
        data={items}
        keyExtractor={i => String(i.id)}
        contentContainerStyle={styles.list}
        showsVerticalScrollIndicator={false}
        ListFooterComponent={
          <View style={{ gap: 16 }}>
            {/* Summary */}
            <View style={[styles.summary, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <View style={styles.sumRow}>
                <Text style={[styles.sumLabel, { color: colors.mutedForeground }]}>Subtotal</Text>
                <Text style={[styles.sumValue, { color: colors.text }]}>KES {totalPrice.toLocaleString('en-KE')}</Text>
              </View>
              <View style={styles.sumRow}>
                <Text style={[styles.sumLabel, { color: colors.mutedForeground }]}>Delivery (Nairobi)</Text>
                <Text style={[styles.sumValue, { color: colors.text }]}>KES {DELIVERY_FEE.toLocaleString()}</Text>
              </View>
              <View style={[styles.sumDivider, { backgroundColor: colors.border }]} />
              <View style={styles.sumRow}>
                <Text style={[styles.totalLabel, { color: colors.text }]}>Total</Text>
                <Text style={[styles.totalValue, { color: colors.primary }]}>KES {total.toLocaleString('en-KE')}</Text>
              </View>
            </View>

            {/* Prices match badge */}
            <View style={[styles.matchBadge, { backgroundColor: colors.primaryLight, borderColor: colors.primary }]}>
              <Ionicons name="shield-checkmark-outline" size={14} color={colors.primary} />
              <Text style={[styles.matchText, { color: colors.primary }]}>Prices match our website — guaranteed</Text>
            </View>

            {/* Recommended replacement filter(s) for the items in the cart */}
            {replacements.length > 0 && (
              <View style={{ gap: 8 }}>
                <View style={styles.recHeader}>
                  <Ionicons name="sync-outline" size={16} color={colors.primary} />
                  <Text style={[styles.recTitle, { color: colors.text }]}>Recommended replacement filter</Text>
                </View>
                {replacements.map(p => <RecRow key={p.id} product={p} />)}
              </View>
            )}

            {/* Other recommended products — ranked by sales, toggleable */}
            {others.length > 0 && (
              <View style={{ gap: 8 }}>
                <View style={styles.recHeader}>
                  <Ionicons name="sparkles-outline" size={16} color={colors.primary} />
                  <Text style={[styles.recTitle, { color: colors.text }]}>Recommended for you</Text>
                  <TouchableOpacity
                    onPress={() => { Haptics.selectionAsync(); setSalesDesc(v => !v); }}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    style={[styles.sortBtn, { borderColor: colors.border }]}
                  >
                    <Ionicons
                      name={salesDesc ? 'trending-down-outline' : 'trending-up-outline'}
                      size={14}
                      color={colors.mutedForeground}
                    />
                    <Text style={[styles.sortText, { color: colors.mutedForeground }]}>
                      Sales {salesDesc ? 'high → low' : 'low → high'}
                    </Text>
                  </TouchableOpacity>
                </View>
                {others.map(p => <RecRow key={p.id} product={p} />)}
              </View>
            )}
          </View>
        }
        renderItem={({ item }) => (
          <View style={[styles.item, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={[styles.itemImage, { backgroundColor: colors.surface }]}>
              {item.image ? (
                <Image
                  source={{ uri: item.image }}
                  style={styles.itemImageAsset}
                  contentFit="contain"
                  transition={120}
                  recyclingKey={item.image}
                />
              ) : (
                <Ionicons name="water-outline" size={24} color={colors.primary} />
              )}
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.itemName, { color: colors.text }]} numberOfLines={2}>{item.name}</Text>
              <Text style={[styles.itemPrice, { color: colors.primary }]}>KES {item.price.toLocaleString('en-KE')}</Text>
            </View>
            <View style={styles.qtyRow}>
              <TouchableOpacity onPress={() => { Haptics.selectionAsync(); updateQty(item.id, item.quantity - 1); }}
                style={[styles.qtyBtn, { borderColor: colors.border }]}>
                <Ionicons name="remove" size={16} color={colors.text} />
              </TouchableOpacity>
              <Text style={[styles.qty, { color: colors.text }]}>{item.quantity}</Text>
              <TouchableOpacity onPress={() => { Haptics.selectionAsync(); updateQty(item.id, item.quantity + 1); }}
                style={[styles.qtyBtn, { borderColor: colors.border }]}>
                <Ionicons name="add" size={16} color={colors.text} />
              </TouchableOpacity>
              <TouchableOpacity onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); removeItem(item.id); }}
                style={styles.removeBtn}>
                <Ionicons name="trash-outline" size={18} color={colors.destructive} />
              </TouchableOpacity>
            </View>
          </View>
        )}
      />

      {/* Checkout button */}
      <View style={[styles.footer, { backgroundColor: colors.background, borderColor: colors.border }]}>
        <View style={{ flex: 1 }}>
          <Text style={[styles.footerTotal, { color: colors.mutedForeground }]}>Total</Text>
          <Text style={[styles.footerAmount, { color: colors.primary }]}>KES {total.toLocaleString('en-KE')}</Text>
        </View>
        <TouchableOpacity onPress={() => router.push('/checkout')}
          style={[styles.checkoutBtn, { backgroundColor: colors.primary }]}>
          <Text style={styles.checkoutBtnText}>Checkout</Text>
          <Ionicons name="arrow-forward" size={18} color="#fff" />
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  emptyTitle: { fontSize: 20, fontWeight: '700' as const },
  emptySub: { fontSize: 14 },
  shopBtn: { paddingVertical: 12, paddingHorizontal: 32, borderRadius: 12, marginTop: 8 },
  shopBtnText: { color: '#fff', fontSize: 15, fontWeight: '700' as const },
  list: { padding: 16, gap: 12, paddingBottom: 120 },
  recHeader: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  recTitle: { fontSize: 15, fontWeight: '700' as const, flex: 1 },
  sortBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, borderWidth: 1, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  sortText: { fontSize: 11, fontWeight: '500' as const },
  recRow: { flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 12, borderWidth: 1, padding: 10 },
  recInfoTap: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 },
  recImageWrap: { width: 44, height: 44, borderRadius: 8, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  recImage: { width: 44, height: 44 },
  recName: { fontSize: 12.5, fontWeight: '600' as const, lineHeight: 17 },
  recPrice: { fontSize: 13.5, fontWeight: '700' as const, marginTop: 2 },
  recAddBtn: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  item: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, borderRadius: 12, borderWidth: 1, padding: 12 },
  itemImage: { width: 60, height: 60, borderRadius: 8, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  itemImageAsset: { width: 54, height: 54 },
  itemName: { fontSize: 13, fontWeight: '600' as const, lineHeight: 18 },
  itemPrice: { fontSize: 15, fontWeight: '700' as const, marginTop: 4 },
  qtyRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  qtyBtn: { width: 28, height: 28, borderRadius: 8, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  qty: { fontSize: 15, fontWeight: '600' as const, minWidth: 24, textAlign: 'center' },
  removeBtn: { padding: 4 },
  summary: { borderRadius: 14, borderWidth: 1, padding: 16, gap: 10 },
  sumRow: { flexDirection: 'row', justifyContent: 'space-between' },
  sumLabel: { fontSize: 14 },
  sumValue: { fontSize: 14, fontWeight: '500' as const },
  sumDivider: { height: 1 },
  totalLabel: { fontSize: 16, fontWeight: '700' as const },
  totalValue: { fontSize: 18, fontWeight: '800' as const },
  matchBadge: { flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1, borderRadius: 10, padding: 10 },
  matchText: { fontSize: 13, fontWeight: '500' as const },
  footer: { position: 'absolute', bottom: 0, left: 0, right: 0, flexDirection: 'row', alignItems: 'center', gap: 16, padding: 16, paddingBottom: Platform.OS === 'web' ? 34 : 16, borderTopWidth: 1 },
  footerTotal: { fontSize: 12 },
  footerAmount: { fontSize: 20, fontWeight: '800' as const },
  checkoutBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 14, paddingHorizontal: 24, borderRadius: 12 },
  checkoutBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' as const },
});
