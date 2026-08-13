import React from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';
import { useRouter } from 'expo-router';
import { useCart } from '@/context/CartContext';
import * as Haptics from 'expo-haptics';

const DELIVERY_FEE = 500;

export default function CartScreen() {
  const colors = useColors();
  const router = useRouter();
  const { items, removeItem, updateQty, totalPrice, clearCart } = useCart();

  const total = totalPrice + (items.length > 0 ? DELIVERY_FEE : 0);

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
        ListHeaderComponent={
          <TouchableOpacity
            onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); clearCart(); }}
            style={styles.clearRow}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Ionicons name="trash-outline" size={14} color={colors.destructive} />
            <Text style={[styles.clearText, { color: colors.destructive }]}>Clear all</Text>
          </TouchableOpacity>
        }
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
          </View>
        }
        renderItem={({ item }) => (
          <View style={[styles.item, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={[styles.itemImage, { backgroundColor: colors.surface }]}>
              <Ionicons name="water-outline" size={24} color={colors.primary} />
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
  clearRow: { flexDirection: 'row', alignItems: 'center', gap: 5, alignSelf: 'flex-end' as const, marginBottom: 4 },
  clearText: { fontSize: 13, fontWeight: '500' as const },
  list: { padding: 16, gap: 12, paddingBottom: 120 },
  item: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, borderRadius: 12, borderWidth: 1, padding: 12 },
  itemImage: { width: 60, height: 60, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
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
