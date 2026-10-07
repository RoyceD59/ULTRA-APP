import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { Image } from 'expo-image';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { resizedImageUrl } from '@/hooks/useApi';
import { useCart } from '@/context/CartContext';
import type { CartItem } from '@/context/CartContext';
import { trackProductEvent } from '@/lib/productAnalytics';
import { fetchCollection, fetchRecord, kes, purchaseState, specValue, type ProductRecord, type RecordVariant } from '@/lib/productRecord';
import { P } from './theme';

type Row = { label: string; get: (r: ProductRecord, v: RecordVariant | null) => string | null };
const ROWS: Row[] = [
  { label: 'Price', get: r => (r.price === null ? null : kes(r.price)) },
  { label: 'Capacity', get: r => specValue(r, 'capacity') },
  { label: 'Material', get: r => specValue(r, 'body', 'material') },
  { label: 'Insulation', get: r => specValue(r, 'insulat') },
  { label: 'Filter life', get: r => specValue(r, 'filter life') },
  { label: 'Replacement', get: r => { const p = r.ownership?.replacement?.price_kes; return typeof p === 'number' ? kes(p) : null; } },
  { label: 'Evidence', get: r => {
    const reports = [...new Set((r.claims || []).flatMap(c => c.reports.map(e => `${e.lab} (${e.report})`)))];
    return reports.length ? reports.join('; ') : 'None on record';
  } },
  { label: 'Colours', get: r => (r.operation.variants.length ? r.operation.variants.map(v => v.label).join(', ') : null) },
  { label: 'Live stock', get: (r, v) => {
    const s = r.operation.variants.length ? v?.stockStatus : r.operation.availability;
    return s === 'instock' ? 'In stock' : s === 'outofstock' ? 'Out of stock' : s === 'onbackorder' ? 'On backorder' : null; } },
];

function Column({ rec, variant, onVariant }: { rec: ProductRecord; variant: RecordVariant | null; onVariant: (v: RecordVariant) => void }) {
  const router = useRouter();
  const { addItem } = useCart();
  const state = purchaseState(rec, variant);
  const img = rec.operation.images.slice().sort((a, b) => a.slot - b.slot)[0];
  const buy = () => {
    if (state.kind !== 'buy' || rec.operation.commerceId === null) return;
    const item = { id: rec.operation.commerceId, name: rec.name, price: state.price, quantity: 1,
      image: img?.src ?? '', sku: variant?.childSku ?? rec.parentSku,
      variationId: variant?.variationId ?? undefined, childSku: variant?.childSku, variantLabel: variant?.label };
    addItem(item as CartItem);
    router.push('/checkout');
  };
  return (
    <View style={s.col}>
      {img ? <Image source={{ uri: resizedImageUrl(img.src, 160) }} contentFit="contain" style={s.img} accessibilityLabel={img.alt} /> : null}
      <Text style={s.name}>{rec.name}</Text>
      <View style={s.chips}>
        {rec.operation.variants.map(v => (
          <TouchableOpacity key={v.childSku} onPress={() => onVariant(v)} accessibilityRole="button"
            style={[s.chip, variant?.childSku === v.childSku && s.chipOn]}>
            <Text style={[s.chipT, variant?.childSku === v.childSku && { color: '#fff' }]}>{v.label}</Text>
          </TouchableOpacity>))}
      </View>
      <TouchableOpacity onPress={() => router.push(`/product/${rec.slug}${variant ? `?sku=${variant.childSku}` : ''}` as never)} style={s.view}>
        <Text style={s.viewT}>View</Text>
      </TouchableOpacity>
      <TouchableOpacity disabled={state.kind !== 'buy'} onPress={buy} style={[s.buy, state.kind !== 'buy' && { opacity: 0.45 }]}>
        <Text style={s.buyT}>{state.kind === 'out_of_stock' ? 'Out of stock' : state.kind === 'enquiry' ? 'Enquire on page' : 'Buy now'}</Text>
      </TouchableOpacity>
    </View>
  );
}

export default function ProductCompare({ current, initialVariant }: { current: ProductRecord; initialVariant: RecordVariant | null }) {
  const collection = useQuery({ queryKey: ['record-collection'], queryFn: ({ signal }) => fetchCollection(signal) });
  const bottles = useMemo(() => (collection.data?.products ?? []).filter(p =>
    /bottle/i.test(p.category ?? '') && !!p.specs?.Capacity && p.slug !== current.slug), [collection.data, current.slug]);
  const [otherSlug, setOtherSlug] = useState<string | null>(null);
  useEffect(() => {
    if (otherSlug || !bottles.length) return;
    const ordered = (collection.data?.products || []).filter(p => /bottle/i.test(p.category ?? '') && !!p.specs?.Capacity);
    const index = ordered.findIndex(p => p.slug === current.slug);
    setOtherSlug((ordered[(index + 1) % ordered.length] ?? bottles[0]).slug);
  }, [bottles, otherSlug, current.slug, collection.data]);
  useEffect(() => { trackProductEvent('compare_opened', { productId: current.operation.commerceId ?? undefined, sku: current.parentSku }); }, [current.slug]);
  const other = useQuery({ queryKey: ['product-record', otherSlug], queryFn: ({ signal }) => fetchRecord(otherSlug!, signal), enabled: !!otherSlug });
  const [va, setVa] = useState<RecordVariant | null>(initialVariant);
  const [vb, setVb] = useState<RecordVariant | null>(null);
  useEffect(() => { setVb(other.data?.operation.variants[0] ?? null); }, [other.data]);

  if (collection.isError) return <Text style={s.note}>Comparison is unavailable right now.</Text>;
  const b = other.data;
  const rows = b ? ROWS.map(r => ({ label: r.label, a: r.get(current, va), b: r.get(b, vb) })).filter(r => r.a && r.b) : [];
  return (
    <View style={s.wrap}>
      <Text style={s.h}>Compare bottles</Text>
      <View style={s.chips}>
        {bottles.map(p => (
          <TouchableOpacity key={p.slug} onPress={() => setOtherSlug(p.slug)} style={[s.chip, otherSlug === p.slug && s.chipOn]}>
            <Text style={[s.chipT, otherSlug === p.slug && { color: '#fff' }]}>{p.name}</Text>
          </TouchableOpacity>))}
      </View>
      {collection.isLoading || other.isLoading ? <ActivityIndicator color={P.teal} />
        : other.isError ? <TouchableOpacity onPress={() => other.refetch()}><Text style={s.note}>Could not load that bottle. Tap to retry.</Text></TouchableOpacity>
        : !b ? <Text style={s.note}>No other bottle is available to compare.</Text> : (
        <>
          <View style={s.cols}>
            <Column rec={current} variant={va} onVariant={setVa} />
            <Column rec={b} variant={vb} onVariant={setVb} />
          </View>
          {rows.map(r => (
            <View key={r.label} style={s.row}>
              <Text style={s.rl}>{r.label}</Text>
              <View style={s.cols}><Text style={s.cell}>{r.a}</Text><Text style={s.cell}>{r.b}</Text></View>
            </View>))}
        </>)}
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { backgroundColor: P.aqua, borderRadius: 16, borderWidth: 1, borderColor: P.line, padding: 14, gap: 10 },
  h: { color: P.navy, fontSize: 18, fontWeight: '700' },
  cols: { flexDirection: 'row', gap: 10 },
  col: { flex: 1, minWidth: 0, backgroundColor: P.ground, borderRadius: 12, borderWidth: 1, borderColor: P.line, padding: 8, gap: 6 },
  img: { width: '100%', height: 110 },
  name: { color: P.navy, fontWeight: '700', fontSize: 14 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { borderWidth: 1, borderColor: P.teal, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6, minHeight: 32, justifyContent: 'center' },
  chipOn: { backgroundColor: P.teal },
  chipT: { color: P.tealDark, fontSize: 12, fontWeight: '600' },
  view: { borderWidth: 1, borderColor: P.teal, borderRadius: 10, paddingVertical: 9, alignItems: 'center' },
  viewT: { color: P.tealDark, fontWeight: '700' },
  buy: { backgroundColor: P.teal, borderRadius: 10, paddingVertical: 10, alignItems: 'center' },
  buyT: { color: '#fff', fontWeight: '700', fontSize: 13 },
  row: { borderTopWidth: 1, borderColor: P.line, paddingTop: 6, gap: 2 },
  rl: { color: P.muted, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.6 },
  cell: { flex: 1, minWidth: 0, color: P.navy, fontSize: 13 },
  note: { color: P.muted },
});
