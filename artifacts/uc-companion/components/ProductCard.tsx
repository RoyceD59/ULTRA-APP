import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Platform } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useColors } from '@/hooks/useColors';
import { UCProduct, resolveMediaUrl, resizedImageUrl } from '@/hooks/useApi';
import { useCart } from '@/context/CartContext';
import * as Haptics from 'expo-haptics';

interface Props {
  product: UCProduct;
  onPress: () => void;
  layout?: 'grid' | 'list';
}

function formatKES(price: string) {
  const n = parseFloat(price);
  if (isNaN(n)) return 'KES —';
  return `KES ${n.toLocaleString('en-KE')}`;
}

export default function ProductCard({ product, onPress, layout = 'grid' }: Props) {
  const colors = useColors();
  const router = useRouter();
  const { addItem } = useCart();
  const isEnquiryOnly = product.enquiryOnly === true;
  // NB: must be a real boolean — an empty-string salePrice would otherwise make
  // this '' and render a stray text node inside the card View on web.
  const isOnSale = !isEnquiryOnly && !!product.salePrice && parseFloat(product.salePrice) < parseFloat(product.regularPrice);
  const displayPrice = product.salePrice || product.price || product.regularPrice;

  const handleAddToCart = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    addItem({
      id: product.id,
      name: product.name,
      price: parseFloat(displayPrice),
      quantity: 1,
      image: resolveMediaUrl(product.images[0]?.src ?? ''),
      sku: product.sku,
    });
  };

  const handleEnquire = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.push(`/enquiry?productId=${product.id}&productName=${encodeURIComponent(product.name)}`);
  };

  if (layout === 'list') {
    return (
      <TouchableOpacity onPress={onPress} activeOpacity={0.8}
        style={[styles.listCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <View style={[styles.listImageWrap, { backgroundColor: colors.surface }]}>
          {product.images[0] ? (
            <Image source={{ uri: resizedImageUrl(product.images[0].src, 56) }} style={styles.listImage} contentFit="contain" transition={120} recyclingKey={product.images[0].src} />
          ) : (
            <Ionicons name="water-outline" size={28} color={colors.primary} />
          )}
        </View>
        <View style={styles.listInfo}>
          <Text style={[styles.listName, { color: colors.text }]} numberOfLines={2}>{product.name}</Text>
          {!!product.tagline && (
            <Text style={[styles.listTagline, { color: colors.mutedForeground }]} numberOfLines={1}>
              {product.tagline}
            </Text>
          )}
          <Text style={[styles.listCategory, { color: colors.mutedForeground }]}>
            {[product.sku, product.categories[0]?.name].filter(Boolean).join(' · ')}
          </Text>
          <View style={styles.listPriceRow}>
            {isEnquiryOnly
              ? <View style={[styles.enquirePill, { backgroundColor: colors.primaryLight }]}>
                  <Text style={[styles.enquirePillText, { color: colors.primary }]}>Enquire for pricing</Text>
                </View>
              : <>
                  <Text style={[styles.price, { color: colors.primary }]}>{formatKES(displayPrice)}</Text>
                  {isOnSale && (
                    <Text style={[styles.oldPrice, { color: colors.mutedForeground }]}>{formatKES(product.regularPrice)}</Text>
                  )}
                </>
            }
          </View>
        </View>
        {isEnquiryOnly
          ? <TouchableOpacity onPress={handleEnquire} activeOpacity={0.7}
              style={[styles.addBtn, { backgroundColor: colors.accent }]}>
              <Ionicons name="chatbubble-ellipses-outline" size={18} color="#fff" />
            </TouchableOpacity>
          : <TouchableOpacity onPress={handleAddToCart} activeOpacity={0.7}
              style={[styles.addBtn, { backgroundColor: colors.primary }]}>
              <Ionicons name="add" size={20} color="#fff" />
            </TouchableOpacity>
        }
      </TouchableOpacity>
    );
  }

  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.85}
      style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
      {!isEnquiryOnly && isOnSale && (
        <View style={[styles.saleBadge, { backgroundColor: colors.destructive }]}>
          <Text style={styles.saleBadgeText}>SALE</Text>
        </View>
      )}
      {isEnquiryOnly && (
        <View style={[styles.saleBadge, { backgroundColor: colors.accent }]}>
          <Text style={styles.saleBadgeText}>ENQUIRE</Text>
        </View>
      )}
      {!isEnquiryOnly && product.tags.some(t => t.name === 'bestseller') && (
        <View style={[styles.saleBadge, { backgroundColor: colors.accent, left: 'auto' as never, right: 8 }]}>
          <Text style={styles.saleBadgeText}>TOP</Text>
        </View>
      )}
      <View style={[styles.imageWrap, { backgroundColor: colors.surface }]}>
        {product.images[0] ? (
          <Image source={{ uri: resizedImageUrl(product.images[0].src, 200) }} style={styles.image} contentFit="contain" transition={120} recyclingKey={product.images[0].src} />
        ) : (
          <Ionicons name="water-outline" size={40} color={colors.primary} />
        )}
      </View>
      <View style={styles.info}>
        <Text style={[styles.category, { color: colors.accent }]} numberOfLines={1}>
          {product.categories[0]?.name ?? ''}
        </Text>
        <Text style={[styles.name, { color: colors.text }]} numberOfLines={2}>{product.name}</Text>
        {!!product.tagline && (
          <Text style={[styles.tagline, { color: colors.mutedForeground }]} numberOfLines={1}>
            {product.tagline}
          </Text>
        )}
        {!!product.sku && (
          <Text style={[styles.sku, { color: colors.mutedForeground }]}>{product.sku}</Text>
        )}

        {isEnquiryOnly
          ? <>
              <Text style={[styles.enquireLabel, { color: colors.mutedForeground }]}>Pricing on request</Text>
              <TouchableOpacity onPress={handleEnquire} activeOpacity={0.8}
                style={[styles.cartBtn, { backgroundColor: colors.primaryLight, borderColor: colors.primary }]}>
                <Ionicons name="mail-outline" size={14} color={colors.primary} />
                <Text style={[styles.cartBtnText, { color: colors.primary }]}>Contact Us</Text>
              </TouchableOpacity>
            </>
          : <>
              <View style={styles.priceRow}>
                <Text style={[styles.price, { color: colors.primary }]}>{formatKES(displayPrice)}</Text>
                {isOnSale && (
                  <Text style={[styles.oldPrice, { color: colors.mutedForeground }]}>{formatKES(product.regularPrice)}</Text>
                )}
              </View>
              <TouchableOpacity onPress={handleAddToCart} activeOpacity={0.8}
                style={[styles.cartBtn, { backgroundColor: colors.primaryLight, borderColor: colors.primary }]}>
                <Ionicons name="cart-outline" size={14} color={colors.primary} />
                <Text style={[styles.cartBtnText, { color: colors.primary }]}>Add to Cart</Text>
              </TouchableOpacity>
            </>
        }
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  // Grid card — increased border-radius and soft shadow
  card: {
    borderRadius: 16,
    borderWidth: 1,
    overflow: 'hidden',
    width: '100%',
    // Soft shadow
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
  saleBadge: { position: 'absolute', top: 8, left: 8, zIndex: 1, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
  saleBadgeText: { color: '#fff', fontSize: 9, fontWeight: '700' as const, letterSpacing: 0.5 },
  imageWrap: { height: 140, alignItems: 'center', justifyContent: 'center' },
  image: { width: '100%', height: '100%' },
  info: { padding: 12, gap: 4 },
  category: { fontSize: 11, fontWeight: '600' as const, textTransform: 'uppercase', letterSpacing: 0.5 },
  // Bolder product name with tighter line height
  name: { fontSize: 13, fontWeight: '700' as const, lineHeight: 17 },
  tagline: { fontSize: 11, lineHeight: 15 },
  sku: { fontSize: 10, letterSpacing: 0.3 },
  listTagline: { fontSize: 12, lineHeight: 16, marginTop: 1 },
  priceRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  price: { fontSize: 15, fontWeight: '700' as const },
  oldPrice: { fontSize: 12, textDecorationLine: 'line-through' },
  enquireLabel: { fontSize: 12, fontStyle: 'italic' },
  enquirePill: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  enquirePillText: { fontSize: 11, fontWeight: '600' as const },
  cartBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4,
    borderWidth: 1, borderRadius: 8, paddingVertical: 6, marginTop: 4 },
  cartBtnText: { fontSize: 12, fontWeight: '600' as const },
  // List layout
  listCard: { flexDirection: 'row', alignItems: 'center', borderRadius: 12, borderWidth: 1,
    padding: 12, gap: 12 },
  listImageWrap: { width: 64, height: 64, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  listImage: { width: 56, height: 56 },
  listInfo: { flex: 1 },
  listName: { fontSize: 14, fontWeight: '600' as const, lineHeight: 18 },
  listCategory: { fontSize: 12, marginTop: 2 },
  listPriceRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 },
  addBtn: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
});
