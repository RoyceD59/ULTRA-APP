import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { Image } from 'expo-image';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { resizedImageUrl } from '@/hooks/useApi';
import { useCart } from '@/context/CartContext';
import type { CartItem } from '@/context/CartContext';
import { trackProductEvent } from '@/lib/productAnalytics';
import { COMPARE_ROWS, fetchCollection, fetchRecord, kes, purchaseState, type ProductRecord, type RecordVariant } from '@/lib/productRecord';
import { P } from './theme';

type Row = { label: string; get: (r: ProductRecord, v: RecordVariant | null) => string | null };
const ROWS: Row[] = [
  { label: 'Price', get: r => (r.price === null ? null : kes(r.price)) },
  ...COMPARE_ROWS.map(([key, label]): Row => ({ label, get: r => r.compare?.[key]?.trim() || null })),
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
  const router = useRouter();
  const collection = useQuery({ queryKey: ['record-collection'], queryFn: ({ signal }) => fetchCollection(signal) });
  const group = useMemo(() => (collection.data?.groups ?? []).find(g => g.id === current.compareGroup) ?? null, [collection.data, current.compareGroup]);
  // Peers are published products in the same comparison group, in group order.
  const peers = useMemo(() => {
    const byCode = new Map((collection.data?.products ?? []).map(p => [p.code, p]));
    return (group?.products ?? []).map(code => byCode.get(code)).filter((p): p is NonNullable<typeof p> => !!p && p.slug !== current.slug);
  }, [collection.data, group, current.slug]);
  const replacements = useMemo(() => {
    const byCode = new Map((collection.data?.products ?? []).map(p => [p.code, p]));
    return (group?.replacements ?? []).map(code => byCode.get(code)).filter((p): p is NonNullable<typeof p> => !!p);
  }, [collection.data, group]);
  const [otherSlug, setOtherSlug] = useState<string | null>(null);
  useEffect(() => {
    if (otherSlug || !group || !peers.length) return;
    const order = group.products;
    const index = order.indexOf(current.code);
    const next = peers.find(p => order.indexOf(p.code) > index) ?? peers[0];
    setOtherSlug(next.slug);
  }, [peers, otherSlug, group, current.code]);
  useEffect(() => { trackProductEvent('compare_opened', { productId: current.operation.commerceId ?? undefined, sku: current.parentSku }); }, [current.slug]);
  const other = useQuery({ queryKey: ['product-record', otherSlug], queryFn: ({ signal }) => fetchRecord(otherSlug!, signal), enabled: !!otherSlug });
  const [va, setVa] = useState<RecordVariant | null>(initialVariant);
  const [vb, setVb] = useState<RecordVariant | null>(null);
  useEffect(() => { setVb(other.data?.operation.variants[0] ?? null); }, [other.data]);

  if (collection.isError) return <Text style={s.note}>Comparison is unavailable right now.</Text>;
  const b = other.data;
  const rows = b ? ROWS.map(r => ({ label: r.label, a: r.get(current, va), b: r.get(b, vb) })).filter(r => r.a || r.b) : [];
  const title = group ? `Compare ${group.label.toLowerCase()}` : 'Compare';
  return (
    <View style={s.wrap}>
      <Text style={s.h}>{title}</Text>
      <View style={s.chips}>
        {peers.map(p => (
          <TouchableOpacity key={p.slug} onPress={() => setOtherSlug(p.slug)} accessibilityRole="button" style={[s.chip, otherSlug === p.slug && s.chipOn]}>
            <Text style={[s.chipT, otherSlug === p.slug && { color: '#fff' }]}>{p.name}</Text>
          </TouchableOpacity>))}
      </View>
      {collection.isLoading || other.isLoading ? <ActivityIndicator color={P.teal} />
        : other.isError ? <TouchableOpacity onPress={() => other.refetch()}><Text style={s.note}>Could not load that product. Tap to retry.</Text></TouchableOpacity>
        : !b ? <Text style={s.note}>No other product is available to compare.</Text> : (
        <>
          <View style={s.cols}>
            <Column rec={current} variant={va} onVariant={setVa} />
            <Column rec={b} variant={vb} onVariant={setVb} />
          </View>
          {rows.map(r => (
            <View key={r.label} style={s.row}>
              <Text style={s.rl}>{r.label}</Text>
              <View style={s.cols}><Text style={s.cell}>{r.a ?? 'Not stated'}</Text><Text style={s.cell}>{r.b ?? 'Not stated'}</Text></View>
            </View>))}
        </>)}
      {replacements.length ? (
        <View style={{ gap: 6 }}>
          <Text style={s.h}>Replacement filters</Text>
          {replacements.map(r => (
            <TouchableOpacity key={r.slug} onPress={() => router.push(`/product/${r.slug}` as never)} accessibilityRole="link" style={s.view}>
              <Text style={s.viewT}>{r.name}{r.fits?.length ? ` - fits ${r.fits.join(', ')}` : ''}</Text>
            </TouchableOpacity>))}
        </View>) : null}
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
