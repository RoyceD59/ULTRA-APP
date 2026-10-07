import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, Platform, Linking, Share, useWindowDimensions } from 'react-native';
import { Image } from 'expo-image';
import * as Clipboard from 'expo-clipboard';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { VideoView, useVideoPlayer } from 'expo-video';
import BrandLogo from '@/components/BrandLogo';
import StarRating from '@/components/StarRating';
import ReviewCard from '@/components/ReviewCard';
import MediaViewer from '@/components/MediaViewer';
import { useApi, resizedImageUrl, resolveMediaUrl, type UCReviewMedia } from '@/hooks/useApi';
import { useAuth } from '@/context/AuthContext';
import { useCart } from '@/context/CartContext';
import type { CartItem } from '@/context/CartContext';
import { customerQueryKeys } from '@/lib/customerQueryKeys';
import { headingProps } from '@/lib/accessibility';
import { trackProductEvent } from '@/lib/productAnalytics';
import { trackEvent } from '@/lib/analytics';
import {
  SLOT_LABELS, kes, productShareUrl, shareBase, purchaseState, shareText, whatsappUrl,
  type ProductRecord, type RecordVariant,
} from '@/lib/productRecord';
import ProductCompare from './ProductCompare';
import { P } from './theme';

function Section({ title, children, open: initial = false }: { title: string; children: React.ReactNode; open?: boolean }) {
  const [open, setOpen] = useState(initial);
  return (
    <View style={s.card}>
      <Text {...headingProps(3)} style={s.accTitle}>{title}</Text>
      <TouchableOpacity onPress={() => setOpen(o => !o)} accessibilityRole="button" accessibilityLabel={title}
        {...(Platform.OS === 'web' ? ({ 'aria-expanded': open } as object) : { accessibilityState: { expanded: open } })} style={s.accHead}>
        <Text style={s.note}>{open ? 'Hide' : 'Show'}</Text>
        <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={18} color={P.teal} />
      </TouchableOpacity>
      {open ? <View style={{ gap: 8, marginTop: 8 }}>{children}</View> : null}
    </View>
  );
}
const Bullets = ({ items }: { items?: unknown }) => Array.isArray(items) && items.length
  ? <View style={{ gap: 4 }}>{items.filter(i => typeof i === 'string').map((i, n) => <Text key={n} style={s.body}>{`\u2022 ${i}`}</Text>)}</View> : null;
const Txt = ({ v }: { v?: unknown }) => (typeof v === 'string' && v ? <Text style={s.body}>{v}</Text> : null);

type Gal = { src: string; alt: string; label: string; childSku?: string; picturedColour?: string };

export default function ProductRecordPage({ record, initialSku, topicsRow }: { record: ProductRecord; initialSku?: string; topicsRow?: boolean }) {
  const router = useRouter();
  const api = useApi();
  const qc = useQueryClient();
  const { token, user } = useAuth();
  const { addItem, totalItems, cartHydrated } = useCart();
  const { width } = useWindowDimensions();
  const op = record.operation;
  const variants = op.variants;
  const [variant, setVariant] = useState<RecordVariant | null>(() =>
    variants.find(v => v.childSku === initialSku) ?? (variants.length === 1 ? variants[0] : null));
  const [idx, setIdx] = useState(0);
  const [compare, setCompare] = useState(false);
  const [viewer, setViewer] = useState<UCReviewMedia | null>(null);
  const [suitWater, setSuitWater] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [wish, setWish] = useState<boolean | null>(null);
  const viewed = useRef(false);

  useEffect(() => {
    if (initialSku) setVariant(variants.find(v => v.childSku === initialSku) ?? null);
    else setVariant(previous => variants.find(v => v.childSku === previous?.childSku) ?? (variants.length === 1 ? variants[0] : null));
  }, [initialSku, variants]);
  useEffect(() => {
    if (viewed.current) return;
    viewed.current = true;
    trackProductEvent('view_item', { productId: op.commerceId ?? undefined, sku: record.parentSku });
    if (op.commerceId) trackEvent('product_viewed', { productId: op.commerceId });
  }, [op.commerceId, record.parentSku]);

  const photos: Gal[] = useMemo(() => op.images.slice().sort((a, b) => a.slot - b.slot).map(i => ({
    src: i.src, alt: i.alt, label: SLOT_LABELS[i.slot - 1] ?? `Photo ${i.slot}`, childSku: i.childSku, picturedColour: i.picturedColour })), [op.images]);
  // Selecting a colour jumps to its matching photo, when one exists.
  useEffect(() => {
    if (!variant) return;
    const n = photos.findIndex(p => p.childSku === variant.childSku);
    if (n >= 0) setIdx(n);
  }, [variant, photos]);
  const hasVideo = !!op.videoUrl;
  const total = photos.length + (hasVideo ? 1 : 0);
  const cur = photos[idx];
  const known = [...new Set(photos.map(p => p.picturedColour).filter((c): c is string => !!c))];
  const colourNote = variant && known.length && !photos.some(p => p.childSku === variant.childSku) && !known.some(c => c.toLowerCase() === variant.label.toLowerCase())
    ? `Photos show ${known.join(', ')}. Your selected colour, ${variant.label}, is not pictured.` : null;

  const player = useVideoPlayer(null as unknown as string, p => { p.loop = true; p.muted = true; });
  useEffect(() => { if (op.videoUrl && idx === photos.length) { player.replace({ uri: resolveMediaUrl(op.videoUrl) }); player.play(); } }, [idx, op.videoUrl, photos.length, player]);

  const state = purchaseState(record, variant);
  const pid = op.commerceId;
  const { data: profile } = useQuery({ queryKey: customerQueryKeys.profile(user?.id), queryFn: () => api.getProfile(), enabled: !!token && !!user, staleTime: 600000 });
  const { data: reviews } = useQuery({ queryKey: customerQueryKeys.reviews(user?.id, pid ?? 0), queryFn: () => api.getReviews(pid!), enabled: pid !== null });
  const { data: wishlist } = useQuery({ queryKey: customerQueryKeys.wishlist(user?.id), queryFn: () => api.getWishlist(), enabled: !!token && !!user, staleTime: 60000 });
  const saved = wish ?? (wishlist?.some(w => w.productId === pid) ?? false);
  const toggleWish = useCallback(async () => {
    if (!token || !user) { router.push('/auth/login'); return; }
    if (pid === null) return;
    const next = !saved; setWish(next);
    try {
      if (next) { await api.addToWishlist(pid, record.name); trackEvent('wishlist_item_added', { productId: pid }); trackProductEvent('add_to_wishlist', { productId: pid, sku: variant?.childSku ?? record.parentSku }); }
      else { await api.removeFromWishlist(pid); trackEvent('wishlist_item_removed', { productId: pid }); }
      await qc.invalidateQueries({ queryKey: customerQueryKeys.wishlist(user.id) });
    } catch { /* fall through to server truth */ } finally { setWish(null); }
  }, [token, user, pid, saved, api, qc, record, variant, router]);

  const buyNow = (askToPay = false) => {
    if (state.kind !== 'buy' || pid === null) return;
    const item = { id: pid, name: record.name, price: state.price, quantity: 1,
      image: resolveMediaUrl(photos[0]?.src ?? ''), sku: variant?.childSku ?? record.parentSku,
      variationId: variant?.variationId ?? undefined, childSku: variant?.childSku, variantLabel: variant?.label };
    addItem(item as CartItem);
    router.push(askToPay ? '/checkout?askToPay=1' : '/checkout');
  };

  const waUrl = productShareUrl(record.slug, variant?.childSku, 'whatsapp');
  const copyUrl = productShareUrl(record.slug, variant?.childSku, 'copy');
  const canShare = state.kind === 'buy' && !!waUrl && !!copyUrl;
  const shareWa = () => { if (!waUrl) return; const text = shareText(record.name, waUrl); trackProductEvent('share', { productId: pid ?? undefined, sku: variant?.childSku ?? record.parentSku, method: 'whatsapp' }); Linking.openURL(whatsappUrl(text)); };
  const shareCopy = async () => {
    if (!copyUrl) return;
    const text = shareText(record.name, copyUrl);
    await Clipboard.setStringAsync(text); setCopied(true); setTimeout(() => setCopied(false), 2000);
    trackProductEvent('share', { productId: pid ?? undefined, sku: variant?.childSku ?? record.parentSku, method: 'copy' });
  };
  const shareNative = () => waUrl && Share.share({ message: shareText(record.name, waUrl) }).catch(() => undefined);

  const op_ = record.opening ?? {};
  const wide = width >= 900;
  const reviewParams = { productId: String(pid ?? ''), productName: record.name };
  const sp = record.specs ?? {};
  const suit = record.suitability ?? {};
  const own = record.ownership ?? {};
  const svc = record.service ?? {};
  const pk = record.package ?? {};
  const price = state.kind === 'buy' ? state.price : record.price;

  const gallery = (
    <View style={{ flex: wide ? 1 : undefined, gap: 8 }}>
      <View style={s.stage}>
        {idx === photos.length && hasVideo
          ? <VideoView player={player} style={{ width: '100%', height: '100%' }} contentFit="contain" nativeControls />
          : cur ? <Image source={{ uri: resizedImageUrl(cur.src, 520) }} accessibilityLabel={cur.alt} contentFit="contain" style={{ width: '100%', height: '100%' }} />
            : <Ionicons name="water-outline" size={64} color={P.teal} />}
      </View>
      {colourNote ? <Text style={s.note}>{colourNote}</Text> : null}
      {total > 1 ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
          {photos.map((p, i) => (
            <TouchableOpacity key={p.src + i} onPress={() => setIdx(i)} accessibilityRole="button" accessibilityLabel={`${p.label}: ${p.alt}`} style={[s.thumb, i === idx && s.thumbOn]}>
              <Image source={{ uri: resizedImageUrl(p.src, 64) }} contentFit="contain" style={{ width: 52, height: 52 }} />
              <Text style={s.thumbL} numberOfLines={1}>{p.label}</Text>
            </TouchableOpacity>))}
          {hasVideo ? <TouchableOpacity onPress={() => setIdx(photos.length)} accessibilityRole="button" accessibilityLabel="Product video" style={[s.thumb, idx === photos.length && s.thumbOn]}>
            <Ionicons name="play-circle-outline" size={30} color={P.teal} /><Text style={s.thumbL}>Video</Text></TouchableOpacity> : null}
        </ScrollView>) : null}
    </View>
  );

  const buyBox = (
    <View style={[{ gap: 10 }, wide && { flex: 1 }]}>
      <Text {...headingProps(1)} style={s.h1}>{record.seo?.h1 ?? record.name}</Text>
      {record.seo?.subline ? <Text style={s.sub}>{record.seo.subline}</Text> : null}
      {record.opening?.outcome ? <Text style={s.body}>{record.opening.outcome}</Text> : null}
      {reviews && reviews.count > 0 ? <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center' }}><StarRating rating={reviews.average} size={13} />
        <Text style={s.note}>{reviews.average.toFixed(1)} ({reviews.count})</Text></View> : null}
      {price !== null ? <Text style={s.price}>{kes(price)}</Text> : <Text style={s.price}>Price on enquiry</Text>}
      {variants.length > 0 ? (
        <View style={{ gap: 6 }}>
          <Text style={s.label}>Choose an option</Text>
          <View style={s.chips}>
            {variants.map(v => {
              const on = variant?.childSku === v.childSku;
              return <TouchableOpacity key={v.childSku} onPress={() => setVariant(v)} accessibilityRole="radio" accessibilityState={{ selected: on }}
                style={[s.chip, on && s.chipOn]}><Text style={[s.chipT, on && { color: '#fff' }]}>{v.label}{v.stockStatus === 'outofstock' ? ' (out of stock)' : ''}</Text></TouchableOpacity>;
            })}
          </View>
        </View>) : null}
      {state.kind === 'blocked' ? <View style={s.warn}><Text style={s.warnT}>{state.reason}</Text></View> : null}
      {state.kind === 'buy' ? (
        <><TouchableOpacity onPress={() => buyNow()} style={s.primary} accessibilityRole="button"><Text style={s.primaryT}>Buy now</Text></TouchableOpacity>
        <TouchableOpacity onPress={() => buyNow(true)} style={s.chip} accessibilityRole="button"><Text style={s.chipT}>Ask someone to pay</Text></TouchableOpacity>
        </>
      ) : state.kind === 'out_of_stock' ? (
        <TouchableOpacity onPress={toggleWish} style={s.ghost} accessibilityRole="button">
          <Ionicons name={saved ? 'heart' : 'heart-outline'} size={18} color={P.tealDark} />
          <Text style={s.ghostT}>{saved ? 'Remove from wishlist' : 'Notify me when back in stock'}</Text>
        </TouchableOpacity>
      ) : (
        <TouchableOpacity onPress={() => router.push(`/enquiry?productId=${pid ?? ''}&productName=${encodeURIComponent(record.name)}` as never)} style={s.primary}>
          <Text style={s.primaryT}>Enquire about this product</Text>
        </TouchableOpacity>)}
      {state.kind === 'buy' ? <TouchableOpacity onPress={() => setCompare(c => !c)} style={s.ghost}><Text style={s.ghostT}>{compare ? 'Hide comparison' : 'Compare bottles'}</Text></TouchableOpacity> : null}
      {record.category && /bottle/i.test(record.category) && state.kind !== 'buy'
        ? <TouchableOpacity onPress={() => setCompare(c => !c)} style={s.ghost}><Text style={s.ghostT}>{compare ? 'Hide comparison' : 'Compare bottles'}</Text></TouchableOpacity> : null}
      <View style={s.share}>
        <Text style={s.label}>Share this product link</Text>
        {!shareBase() ? <Text style={s.note}>Sharing is unavailable: no public share address is configured.</Text> : null}
        <Text style={s.note}>This is a product link for the selected option. It is not a payment link and cannot pay for anyone's order.</Text>
        <View style={s.chips}>
          <TouchableOpacity disabled={!canShare} onPress={shareWa} style={[s.chip, !canShare && { opacity: 0.4 }]}><Text style={s.chipT}>WhatsApp</Text></TouchableOpacity>
          <TouchableOpacity disabled={!canShare} onPress={shareCopy} style={[s.chip, !canShare && { opacity: 0.4 }]}><Text style={s.chipT}>{copied ? 'Copied' : 'Copy link'}</Text></TouchableOpacity>
          {Platform.OS !== 'web' ? <TouchableOpacity disabled={!canShare} onPress={shareNative} style={[s.chip, !canShare && { opacity: 0.4 }]}><Text style={s.chipT}>More</Text></TouchableOpacity> : null}
        </View>
      </View>
    </View>
  );

  const fullSuit = suit.water as string[] | undefined;
  return (
    <View style={s.page}>
      <View style={s.wrap}>
        <View style={s.top}>
          <TouchableOpacity onPress={() => (router.canGoBack() ? router.back() : router.replace('/(tabs)/products'))} accessibilityRole="button" accessibilityLabel="Back to products" style={s.iconBtn}>
            <Ionicons name="chevron-back" size={20} color={P.navy} />
          </TouchableOpacity>
          <BrandLogo width={72} variant="deep" />
          <TouchableOpacity onPress={() => router.push('/cart')} accessibilityRole="button" accessibilityLabel="Cart" style={s.iconBtn}>
            <Ionicons name="cart-outline" size={22} color={P.navy} />
            {cartHydrated && totalItems > 0 ? <View style={s.badge}><Text style={s.badgeT}>{totalItems}</Text></View> : null}
          </TouchableOpacity>
        </View>

        <Text style={s.step}>1  Choose</Text>
        <View style={{ flexDirection: wide ? 'row' : 'column', gap: 20 }}>{gallery}{buyBox}</View>
        {compare ? <ProductCompare current={record} initialVariant={variant} /> : null}

        <Text style={s.step}>2  Understand</Text>
        {record.benefits?.items?.length ? (
          <Section title={record.benefits.heading || 'What changes in your routine'} open>
            {(record.benefits.items as { feature: string; consequence: string }[]).map((b, i) => (
              <View key={i} style={s.benefit}><Text style={s.bF}>{b.feature}</Text><Text style={s.body}>{b.consequence}</Text></View>))}
          </Section>) : null}
        {Object.keys(sp).length ? (
          <Section title="Specifications">
            {Object.entries(sp).map(([k, v]) => <View key={k} style={s.spec}><Text style={s.specK}>{k}</Text><Text style={s.specV}>{String(v)}</Text></View>)}
          </Section>) : null}
        {fullSuit?.length || suit.exclusions?.length ? (
          <Section title={suit.heading || 'Will it work with your water?'}>
            <Txt v={suit.intended_use} />
            {fullSuit?.length ? <><Text style={s.label}>Your water source</Text>
              <View style={s.chips}>{fullSuit.map(w => <TouchableOpacity key={w} onPress={() => setSuitWater(x => (x === w ? null : w))} accessibilityRole="button"
                style={[s.chip, suitWater === w && s.chipOn]}><Text style={[s.chipT, suitWater === w && { color: '#fff' }]}>{w}</Text></TouchableOpacity>)}</View></> : null}
            {suitWater ? <View style={s.benefit}><Text style={s.bF}>{suitWater}</Text><Text style={s.body}>Listed as a suitable water source for this product.</Text><Bullets items={suit.setup} /></View> : null}
            {suit.exclusions?.length ? <><Text style={s.label}>Not suitable</Text><Bullets items={suit.exclusions} /></> : null}
            <View style={s.chips}>
              <TouchableOpacity onPress={() => router.push('/water-test')} style={s.chip}><Text style={s.chipT}>Water assessment</Text></TouchableOpacity>
              <TouchableOpacity onPress={() => router.push('/care')} style={s.chip}><Text style={s.chipT}>Setup help</Text></TouchableOpacity>
            </View>
          </Section>) : null}
        {record.opening?.critical_limit || op_.warning ? <View style={s.warn}><Text style={s.warnT}>{op_.warning ?? op_.critical_limit}</Text></View> : null}
        {record.claims?.length ? (
          <Section title="Evidence">
            {record.claims.map((c, i) => (
              <View key={i} style={s.benefit}>
                <Text style={s.bF}>{c.text}</Text>
                <Text style={s.note}>{c.status.replace('_', ' ')}{c.conditions ? ` - ${c.conditions}` : ''}</Text>
                {c.reports.map((r, n) => <Text key={n} style={s.note}>{`Tested by ${r.lab} (${r.report})`}</Text>)}
              </View>))}
            <Bullets items={record.evidenceLimits} />
          </Section>) : null}
        {pk.included?.length ? (
          <Section title={pk.heading || 'What is included'}>
            <Bullets items={pk.included} />
            {pk.sold_separately?.length ? <><Text style={s.label}>Sold separately</Text><Bullets items={pk.sold_separately} /></> : null}
            {pk.dimensions ? <Text style={s.note}>{`Dimensions: ${pk.dimensions}`}</Text> : null}
            <Bullets items={pk.setup_steps} />
          </Section>) : null}
        {record.faq?.length ? (
          <Section title="Questions">
            {record.faq.map((f, i) => <View key={i} style={s.benefit}><Text style={s.bF}>{f.q}</Text><Text style={s.body}>{f.a}</Text></View>)}
          </Section>) : null}

        <Text style={s.step}>3  Decide</Text>
        <Section title={own.heading || 'Replacement and care'} open>
          {own.replacement ? <View style={s.benefit}><Text style={s.bF}>{own.replacement.name}</Text>
            {typeof own.replacement.price_kes === 'number' ? <Text style={s.body}>{kes(own.replacement.price_kes)}</Text> : null}
            <Txt v={own.replacement.guidance} /></View> : null}
          <Txt v={own.delivery} />
        </Section>
        <Section title={svc.heading || 'Delivery, service and returns'}>
          <Txt v={op_.delivery || svc.delivery} />
          {svc.warranty?.text ? <Txt v={svc.warranty.text} /> : null}
          <Txt v={svc.returns} /><Txt v={svc.support} />
          <Bullets items={svc.exclusions} />
        </Section>
        <View style={[s.card, { backgroundColor: P.aqua }]}>
          <Text {...headingProps(2)} style={s.accTitle}>{record.summary?.heading || 'Review your selection'}</Text>
          <Text style={s.body}>{record.name}{variant ? ` - ${variant.label}` : ''}</Text>
          <Text style={s.price}>{price !== null ? kes(price) : 'Price on enquiry'}</Text>
          {state.kind === 'buy' ? <TouchableOpacity onPress={() => buyNow()} style={s.primary}><Text style={s.primaryT}>Buy now</Text></TouchableOpacity>
            : state.kind === 'blocked' ? <Text style={s.warnT}>{state.reason}</Text> : null}
        </View>

        {op.diagnostics?.length && profile?.isAdmin ? <View style={s.warn}>{op.diagnostics.map((d, i) => <Text key={i} style={s.warnT}>{d}</Text>)}</View> : null}

        <Text style={s.step}>Reviews</Text>
        <View style={{ gap: 10 }}>
          {reviews?.count === 0 ? <Text style={s.body}>No reviews yet.</Text> : null}
          {reviews?.reviews.slice(0, 2).map(r => <ReviewCard key={r.id} review={r} onOpenMedia={setViewer} />)}
          <View style={s.chips}>
            <TouchableOpacity onPress={() => (token ? router.push({ pathname: '/review/new', params: reviewParams }) : router.push('/auth/login'))} style={s.chip}>
              <Text style={s.chipT}>{reviews?.reviews.some(r => r.mine) ? 'Edit your review' : 'Write a review'}</Text></TouchableOpacity>
            {reviews && reviews.count > 2 ? <TouchableOpacity onPress={() => router.push({ pathname: '/review/list', params: reviewParams })} style={s.chip}><Text style={s.chipT}>{`See all ${reviews.count}`}</Text></TouchableOpacity> : null}
          </View>
        </View>
        {profile?.isAdmin && pid !== null ? (
          <View style={s.chips}>
            <TouchableOpacity onPress={() => router.push({ pathname: '/admin/product-media', params: reviewParams })} style={s.chip}><Text style={s.chipT}>Manage product media</Text></TouchableOpacity>
            <TouchableOpacity onPress={() => router.push({ pathname: '/admin/product-edit', params: reviewParams })} style={s.chip}><Text style={s.chipT}>Edit product details</Text></TouchableOpacity>
          </View>) : null}
        {topicsRow && record.topics?.length ? (
          <View style={s.chips}>{record.topics.map(t => <TouchableOpacity key={t.slug} onPress={() => router.push(`/topic/${t.slug}` as never)} style={s.chip}><Text style={s.chipT}>{t.name}</Text></TouchableOpacity>)}</View>) : null}
      </View>
      <MediaViewer item={viewer} onClose={() => setViewer(null)} />
    </View>
  );
}

const s = StyleSheet.create({
  page: { backgroundColor: P.ground, minHeight: '100%' as never, alignItems: 'center' },
  wrap: { width: '100%', maxWidth: 1040, padding: 16, gap: 14 },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  iconBtn: { width: 44, height: 44, borderRadius: 22, borderWidth: 1, borderColor: P.line, alignItems: 'center', justifyContent: 'center' },
  badge: { position: 'absolute', top: -2, right: -2, backgroundColor: P.teal, borderRadius: 9, minWidth: 18, height: 18, alignItems: 'center', justifyContent: 'center' },
  badgeT: { color: '#fff', fontSize: 10, fontWeight: '700' },
  step: { color: P.tealDark, fontSize: 13, fontWeight: '700', letterSpacing: 1.2, textTransform: 'uppercase', marginTop: 8 },
  stage: { aspectRatio: 1, width: '100%', maxHeight: 460, backgroundColor: P.aqua, borderRadius: 16, borderWidth: 1, borderColor: P.line, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  thumb: { width: 64, alignItems: 'center', borderWidth: 1, borderColor: P.line, borderRadius: 10, padding: 4, backgroundColor: P.ground },
  thumbOn: { borderColor: P.teal, borderWidth: 2 },
  thumbL: { fontSize: 10, color: P.muted },
  h1: { color: P.navy, fontSize: 28, fontWeight: '800', lineHeight: 34 },
  sub: { color: P.tealDark, fontSize: 16, fontWeight: '600' },
  body: { color: P.navy, fontSize: 15, lineHeight: 22 },
  note: { color: P.muted, fontSize: 13, lineHeight: 18 },
  price: { color: P.navy, fontSize: 24, fontWeight: '800' },
  label: { color: P.muted, fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.8 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { borderWidth: 1, borderColor: P.teal, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8, minHeight: 40, justifyContent: 'center', backgroundColor: P.ground },
  chipOn: { backgroundColor: P.teal },
  chipT: { color: P.tealDark, fontWeight: '600', fontSize: 14 },
  primary: { backgroundColor: P.teal, borderRadius: 12, minHeight: 50, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16 },
  primaryT: { color: '#fff', fontSize: 16, fontWeight: '700' },
  ghost: { borderWidth: 1.5, borderColor: P.teal, borderRadius: 12, minHeight: 46, flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center' },
  ghostT: { color: P.tealDark, fontWeight: '700', fontSize: 15 },
  warn: { backgroundColor: P.warnBg, borderRadius: 12, padding: 12, borderWidth: 1, borderColor: '#F0D9A8', gap: 4 },
  warnT: { color: P.warn, fontSize: 14, lineHeight: 20 },
  share: { backgroundColor: P.aqua, borderRadius: 12, borderWidth: 1, borderColor: P.line, padding: 12, gap: 8 },
  card: { backgroundColor: P.ground, borderRadius: 16, borderWidth: 1, borderColor: P.line, padding: 14 },
  accHead: { flexDirection: 'row', justifyContent: 'flex-end', gap: 6, alignItems: 'center', minHeight: 32 },
  accTitle: { color: P.navy, fontSize: 18, fontWeight: '700', flex: 1 },
  benefit: { backgroundColor: P.aqua, borderRadius: 12, padding: 12, gap: 4 },
  bF: { color: P.navy, fontWeight: '700', fontSize: 15 },
  spec: { flexDirection: 'row', justifyContent: 'space-between', gap: 12, borderBottomWidth: 1, borderColor: P.line, paddingVertical: 6 },
  specK: { color: P.muted, fontSize: 14, flexShrink: 0 },
  specV: { color: P.navy, fontSize: 14, fontWeight: '600', flex: 1, textAlign: 'right' },
});
