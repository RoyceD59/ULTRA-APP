import React, { useEffect, useState } from 'react';
import {
  View, Text, ScrollView, TextInput, TouchableOpacity,
  StyleSheet, ActivityIndicator, Alert, Platform, Switch,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import { useColors } from '@/hooks/useColors';
import { useApi } from '@/hooks/useApi';

/**
 * Team-only screen: edit product name, description, pricing, and stock status
 * for any catalogue product. Updates are sent directly to WooCommerce.
 */
export default function ProductEditAdminScreen() {
  const { productId, productName: paramName } = useLocalSearchParams<{
    productId: string;
    productName?: string;
  }>();

  const colors = useColors();
  const api = useApi();
  const queryClient = useQueryClient();

  const pid = parseInt(productId ?? '');

  // ── Server data ─────────────────────────────────────────────────────────────
  const { data: product, isLoading, isError, refetch } = useQuery({
    queryKey: ['product', productId],
    queryFn: () => api.getProduct(pid),
    enabled: !isNaN(pid),
  });

  // ── Local form state (seeded from product once loaded) ───────────────────────
  const [name,             setName]             = useState('');
  const [description,      setDescription]      = useState('');
  const [shortDescription, setShortDescription] = useState('');
  const [regularPrice,     setRegularPrice]     = useState('');
  const [salePrice,        setSalePrice]        = useState('');
  const [inStock,          setInStock]          = useState(true);
  const [stockQuantity,    setStockQuantity]    = useState('');

  const [seeded,  setSeeded]  = useState(false);
  const [saving,  setSaving]  = useState(false);
  const [success, setSuccess] = useState(false);

  // Seed form once the product arrives
  useEffect(() => {
    if (product && !seeded) {
      setName(product.name);
      setDescription(product.description.replace(/<[^>]*>/g, ''));
      setShortDescription(product.shortDescription.replace(/<[^>]*>/g, ''));
      setRegularPrice(product.regularPrice ?? '');
      setSalePrice(product.salePrice ?? '');
      setInStock(product.stockStatus === 'instock');
      setStockQuantity(
        product.stockQuantity != null ? String(product.stockQuantity) : '',
      );
      setSeeded(true);
    }
  }, [product, seeded]);

  // ── Save handler ─────────────────────────────────────────────────────────────
  async function handleSave() {
    if (!name.trim()) {
      Alert.alert('Required', 'Product name cannot be empty.');
      return;
    }

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setSaving(true);
    setSuccess(false);

    try {
      const qty = stockQuantity.trim() !== '' ? parseInt(stockQuantity.trim(), 10) : undefined;
      if (qty !== undefined && (isNaN(qty) || qty < 0)) {
        Alert.alert('Invalid', 'Stock quantity must be a whole number ≥ 0.');
        return;
      }

      await api.updateProductDetails(pid, {
        name:             name.trim(),
        description:      description.trim(),
        shortDescription: shortDescription.trim(),
        regularPrice:     regularPrice.trim() || undefined,
        salePrice:        salePrice.trim(),
        stockStatus:      inStock ? 'instock' : 'outofstock',
        ...(qty !== undefined ? { stockQuantity: qty } : {}),
      });

      // Bust all product caches so the catalogue and detail screen reflect edits.
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['product', productId] }),
        queryClient.invalidateQueries({ queryKey: ['products'] }),
      ]);

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setSuccess(true);
    } catch (e) {
      Alert.alert(
        'Could not save',
        e instanceof Error ? e.message : 'Please try again.',
      );
    } finally {
      setSaving(false);
    }
  }

  // ── States ───────────────────────────────────────────────────────────────────
  if (isNaN(pid)) {
    return (
      <View style={[s.center, { backgroundColor: colors.background }]}>
        <Text style={{ color: colors.mutedForeground }}>Product not found</Text>
      </View>
    );
  }

  if (isLoading) {
    return (
      <View style={[s.center, { backgroundColor: colors.background }]}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  if (isError) {
    return (
      <View style={[s.center, { backgroundColor: colors.background, gap: 12 }]}>
        <Ionicons name="lock-closed-outline" size={40} color={colors.mutedForeground} />
        <Text style={{ color: colors.mutedForeground, textAlign: 'center', paddingHorizontal: 30 }}>
          Couldn't load product — this area is for the Ultra Clear team only.
        </Text>
        <TouchableOpacity onPress={() => refetch()} style={[s.retryBtn, { borderColor: colors.primary }]}>
          <Text style={{ color: colors.primary, fontWeight: '600' }}>Try again</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const displayName = paramName ?? product?.name ?? `Product #${pid}`;

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={{ padding: 16, gap: 20, paddingBottom: Platform.OS === 'web' ? 40 : 60 }}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={[s.subhead, { color: colors.mutedForeground }]}>
        Editing{' '}
        <Text style={{ color: colors.text, fontWeight: '700' }}>{displayName}</Text>
      </Text>

      {/* ── Name ──────────────────────────────────────────────────────────── */}
      <View style={s.field}>
        <Text style={[s.label, { color: colors.text }]}>Product name</Text>
        <TextInput
          style={[s.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.card }]}
          value={name}
          onChangeText={setName}
          placeholder="e.g. Ultra Clear 7-Stage Filter"
          placeholderTextColor={colors.mutedForeground}
          returnKeyType="next"
        />
      </View>

      {/* ── Description ───────────────────────────────────────────────────── */}
      <View style={s.field}>
        <Text style={[s.label, { color: colors.text }]}>Description</Text>
        <Text style={[s.hint, { color: colors.mutedForeground }]}>
          Full product description (plain text — HTML tags are stripped on display).
        </Text>
        <TextInput
          style={[s.textarea, { color: colors.text, borderColor: colors.border, backgroundColor: colors.card }]}
          value={description}
          onChangeText={setDescription}
          placeholder="Describe the product…"
          placeholderTextColor={colors.mutedForeground}
          multiline
          numberOfLines={5}
          textAlignVertical="top"
        />
      </View>

      {/* ── Short description ─────────────────────────────────────────────── */}
      <View style={s.field}>
        <Text style={[s.label, { color: colors.text }]}>Short description</Text>
        <Text style={[s.hint, { color: colors.mutedForeground }]}>
          One or two sentences shown below the product name.
        </Text>
        <TextInput
          style={[s.textarea, { color: colors.text, borderColor: colors.border, backgroundColor: colors.card }]}
          value={shortDescription}
          onChangeText={setShortDescription}
          placeholder="Brief product summary…"
          placeholderTextColor={colors.mutedForeground}
          multiline
          numberOfLines={3}
          textAlignVertical="top"
        />
      </View>

      {/* ── Pricing ───────────────────────────────────────────────────────── */}
      <View style={s.field}>
        <Text style={[s.label, { color: colors.text }]}>Pricing</Text>
        <View style={s.row}>
          <View style={{ flex: 1 }}>
            <Text style={[s.subLabel, { color: colors.mutedForeground }]}>Regular price (KES)</Text>
            <TextInput
              style={[s.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.card }]}
              value={regularPrice}
              onChangeText={setRegularPrice}
              placeholder="e.g. 4500"
              placeholderTextColor={colors.mutedForeground}
              keyboardType="decimal-pad"
              returnKeyType="next"
            />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[s.subLabel, { color: colors.mutedForeground }]}>Sale price (KES)</Text>
            <TextInput
              style={[s.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.card }]}
              value={salePrice}
              onChangeText={setSalePrice}
              placeholder="Leave blank to remove"
              placeholderTextColor={colors.mutedForeground}
              keyboardType="decimal-pad"
              returnKeyType="next"
            />
          </View>
        </View>
      </View>

      {/* ── Stock ─────────────────────────────────────────────────────────── */}
      <View style={s.field}>
        <Text style={[s.label, { color: colors.text }]}>Stock</Text>

        <View style={[s.stockRow, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View>
            <Text style={[s.subLabel, { color: colors.text, marginBottom: 0 }]}>
              {inStock ? 'In Stock' : 'Out of Stock'}
            </Text>
            <Text style={[s.hint, { color: colors.mutedForeground }]}>
              Customers {inStock ? 'can' : 'cannot'} add this to their cart.
            </Text>
          </View>
          <Switch
            value={inStock}
            onValueChange={setInStock}
            trackColor={{ false: '#ccc', true: colors.primary + '66' }}
            thumbColor={inStock ? colors.primary : '#aaa'}
          />
        </View>

        <View style={{ marginTop: 10 }}>
          <Text style={[s.subLabel, { color: colors.mutedForeground }]}>
            Stock quantity (leave blank if unmanaged)
          </Text>
          <TextInput
            style={[s.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.card }]}
            value={stockQuantity}
            onChangeText={setStockQuantity}
            placeholder="e.g. 25"
            placeholderTextColor={colors.mutedForeground}
            keyboardType="number-pad"
          />
        </View>
      </View>

      {/* ── Success banner ────────────────────────────────────────────────── */}
      {success && (
        <View style={[s.successBanner, { backgroundColor: '#ECFDF5', borderColor: '#6EE7B7' }]}>
          <Ionicons name="checkmark-circle" size={18} color="#059669" />
          <Text style={{ color: '#059669', fontWeight: '600', fontSize: 14 }}>
            Product updated successfully
          </Text>
        </View>
      )}

      {/* ── Save button ───────────────────────────────────────────────────── */}
      <TouchableOpacity
        onPress={handleSave}
        disabled={saving}
        activeOpacity={0.85}
        style={[s.saveBtn, { backgroundColor: colors.primary, opacity: saving ? 0.7 : 1 }]}
      >
        {saving ? (
          <View style={s.saveInner}>
            <ActivityIndicator color="#fff" size="small" />
            <Text style={s.saveTxt}>Saving…</Text>
          </View>
        ) : (
          <Text style={s.saveTxt}>Save changes</Text>
        )}
      </TouchableOpacity>

      <Text style={[s.hint, { color: colors.mutedForeground, textAlign: 'center' }]}>
        Changes are applied to the live WooCommerce store immediately.
      </Text>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  center:        { flex: 1, alignItems: 'center', justifyContent: 'center' },
  retryBtn:      { borderWidth: 1.5, borderRadius: 10, paddingHorizontal: 18, paddingVertical: 8 },
  subhead:       { fontSize: 14 },
  field:         { gap: 8 },
  label:         { fontSize: 15, fontWeight: '700' },
  subLabel:      { fontSize: 12, fontWeight: '600', marginBottom: 4 },
  hint:          { fontSize: 12, lineHeight: 17 },
  input: {
    borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10,
    fontSize: 15,
  },
  textarea: {
    borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10,
    fontSize: 14, minHeight: 90,
  },
  row:           { flexDirection: 'row', gap: 12 },
  stockRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    borderWidth: 1, borderRadius: 12, padding: 14, gap: 12,
  },
  successBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    borderWidth: 1, borderRadius: 10, padding: 12,
  },
  saveBtn:       { borderRadius: 14, paddingVertical: 15, alignItems: 'center' },
  saveInner:     { flexDirection: 'row', alignItems: 'center', gap: 10 },
  saveTxt:       { color: '#fff', fontSize: 15, fontWeight: '700' },
});
