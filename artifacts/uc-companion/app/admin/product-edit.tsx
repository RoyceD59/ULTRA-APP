import React, { useEffect, useState } from 'react';
import {
  View, Text, ScrollView, TextInput, TouchableOpacity,
  StyleSheet, ActivityIndicator, Alert, Platform,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useLocalSearchParams } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import { useColors } from '@/hooks/useColors';
import PageDataLoader from '@/components/PageDataLoader';
import PageDataError from '@/components/PageDataError';
import { useApi } from '@/hooks/useApi';

/**
 * Team-only screen: edit product name, description, pricing, and stock status
 * on the app-owned product record shared with ProjectHub.
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
  type Status = 'instock' | 'outofstock' | 'onbackorder' | 'unknown';
  const [stockStatus,      setStockStatus]      = useState<Status>('unknown');
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
      setStockStatus(product.stockStatus ?? 'unknown');
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
      const t = stockQuantity.trim();
      if (t !== '' && !/^\d+$/.test(t)) {
        Alert.alert('Invalid', 'Managed quantity must be a whole number of 0 or more, or blank for unmanaged.');
        return;
      }
      const qty: number | null = t === '' ? null : parseInt(t, 10);

      await api.updateProductDetails(pid, {
        name:             name.trim(),
        description:      description.trim(),
        shortDescription: shortDescription.trim(),
        regularPrice:     regularPrice.trim() || undefined,
        ...(stockStatus !== 'unknown' ? { stockStatus } : {}),
        stockQuantity:    qty,
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

  if (isLoading && !product) {
    return (
      <View style={[s.center, { backgroundColor: colors.background }]}>
        <PageDataLoader label="Loading product details…" />
      </View>
    );
  }

  if (isError && !product) {
    return (
      <View style={[s.center, { backgroundColor: colors.background, gap: 12 }]}>
        <PageDataError title="Product details unavailable" message="Product details couldn’t load. This area is for the Ultra Clear team only." onRetry={refetch} />
      </View>
    );
  }

  const displayName = paramName ?? product?.name ?? `Product #${pid}`;

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={{
        padding: 16, gap: 20, paddingBottom: Platform.OS === 'web' ? 40 : 60,
        width: '100%', maxWidth: 800, alignSelf: 'center'
      }}
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
            <Text style={[s.subLabel, { color: colors.mutedForeground }]}>Price (KES)</Text>
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
        </View>
        <Text style={[s.hint, { color: colors.mutedForeground }]}>
          This is the record price used at checkout. There is no separate sale price: discounts come from promotions.
        </Text>
      </View>

      {/* ── Stock ─────────────────────────────────────────────────────────── */}
      <View style={s.field}>
        <Text style={[s.label, { color: colors.text }]}>Stock</Text>

        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {([['instock', 'In stock'], ['outofstock', 'Out of stock'], ['onbackorder', 'Backorder']] as const).map(([v, l]) => {
            const on = stockStatus === v;
            return (
              <TouchableOpacity key={v} onPress={() => setStockStatus(v)} accessibilityRole="button" accessibilityState={{ selected: on }}
                style={[s.chip, { borderColor: on ? colors.primary : colors.border, backgroundColor: on ? colors.primary : colors.card }]}>
                <Text style={{ color: on ? '#fff' : colors.text, fontWeight: '600', fontSize: 13 }}>{l}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
        {stockStatus === 'unknown' && (
          <View style={[s.stockRow, { backgroundColor: '#FFFBEB', borderColor: '#FCD34D' }]}>
            <Ionicons name="help-circle-outline" size={18} color="#92400E" />
            <Text style={[s.hint, { color: '#92400E', flex: 1 }]}>
              Stock has not been reviewed. Customers cannot buy this until you choose a reviewed status.
            </Text>
          </View>
        )}

        <View style={{ marginTop: 10 }}>
          <Text style={[s.subLabel, { color: colors.mutedForeground }]}>
            Managed quantity (blank = unmanaged, not zero)
          </Text>
          <TextInput
            style={[s.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.card }]}
            value={stockQuantity}
            onChangeText={setStockQuantity}
            placeholder="Unmanaged"
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
            Saved to the product record
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
        Saves to the shared product record. Customers see changes only when the product is published.
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
  chip:          { borderWidth: 1, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8 },
  saveBtn:       { borderRadius: 14, paddingVertical: 15, alignItems: 'center' },
  saveInner:     { flexDirection: 'row', alignItems: 'center', gap: 10 },
  saveTxt:       { color: '#fff', fontSize: 15, fontWeight: '700' },
});
