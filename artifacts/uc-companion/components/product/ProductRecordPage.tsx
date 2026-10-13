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
import { visibleStoreCategory } from '@/lib/storeCategories';
import ProductCompare from './ProductCompare';
import { P } from './theme';
import { Accordion, GroupNav, H2, ProductLayers, SearchListing, serviceSummary } from './ProductLayers';

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
  const videos = useMemo(() => op.videos?.length ? op.videos : op.videoUrl ? [{ slot: 1, url: op.videoUrl }] : [], [op.videos, op.videoUrl]);
  const activeVideo = videos[idx - photos.length];
  const total = photos.length + videos.length;
  const cur = photos[idx];
  const known = [...new Set(photos.map(p => p.picturedColour).filter((c): c is string => !!c))];
  const colourNote = variant && known.length && !photos.some(p => p.childSku === variant.childSku) && !known.some(c => c.toLowerCase() === variant.label.toLowerCase())
    ? `Photos show ${known.join(', ')}. Your selected colour, ${variant.label}, is not pictured.` : null;

  const player = useVideoPlayer(null as unknown as string, p => { p.loop = true; p.muted = true; });
  useEffect(() => { if (activeVideo?.url) { player.replace({ uri: resolveMediaUrl(activeVideo.url) }); player.play(); } else { player.pause(); } }, [activeVideo?.url, player]);

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
      if (next) { await api.addToWishlist(pid, record.name); trackProductEvent('add_to_wishlist', { productId: pid, sku: variant?.childSku ?? record.parentSku }); }
      else { await api.removeFromWishlist(pid); }
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
  const life = photos.find(p => p.label === SLOT_LABELS[1]) ;
  const price = state.kind === 'buy' ? state.price : record.price;

  const gallery = (
    <View style={{ flex: wide ? 1 : undefined, gap: 8 }}>
      <View style={s.stage}>
        {activeVideo
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
          {videos.map((video, i) => <TouchableOpacity key={video.slot} onPress={() => setIdx(photos.length + i)} accessibilityRole="button" accessibilityLabel={`Product video ${video.slot}`} style={[s.thumb, idx === photos.length + i && s.thumbOn]}>
            <Ionicons name="play-circle-outline" size={30} color={P.teal} /><Text style={s.thumbL}>Video {video.slot}</Text></TouchableOpacity>)}
        </ScrollView>) : null}
    </View>
  );

  const buyBox = (
    <View style={[{ gap: 10 }, wide && { flex: 1 }]}>
      <Text {...headingProps(1)} style={s.h1}>{record.seo?.h1 ?? record.name}</Text>
      {record.seo?.subline ? <Text style={s.sub}>{record.seo.subline}</Text> : null}
      {op_.outcome || op_.intro ? <Text style={s.body}>{[op_.outcome, op_.intro].filter(Boolean).join(' ')}</Text> : null}
      {record.category ? <View style={s.chips}>
        <TouchableOpacity onPress={() => router.push({ pathname: '/(tabs)/products', params: { category: visibleStoreCategory(record.category!) ?? 'All' } } as never)}
          accessibilityRole="link" accessibilityLabel={`Category: ${record.category}`} style={s.chip}><Text style={s.chipT}>{record.category}</Text></TouchableOpacity>
      </View> : null}
      <Text style={s.note}>{`SKU: ${variant?.childSku ?? record.parentSku}`}</Text>
      {record.fits?.length ? <View style={{ gap: 6 }}><Text style={s.label}>Fits</Text>
        <View style={s.chips}>{record.fits.map(f => <View key={f} style={s.chip}><Text style={s.chipT}>{f}</Text></View>)}</View></View> : null}
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
      {op_.delivery ? <Text style={s.note}>{op_.delivery}</Text> : null}
      {op_.suits || op_.warning ? <View style={s.limit}><Text style={s.body}><Text style={{ fontWeight: '700' }}>Before you buy: </Text>{[op_.suits, op_.warning].filter(Boolean).join(' ')}</Text></View> : null}
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
      {record.compareGroup ? <TouchableOpacity onPress={() => setCompare(c => !c)} accessibilityRole="button" style={s.ghost}><Text style={s.ghostT}>{compare ? 'Hide comparison' : 'Compare with similar products'}</Text></TouchableOpacity> : null}
      {serviceSummary(record) ? <Text style={[s.note, { textAlign: 'center' }]}>{serviceSummary(record)}</Text> : null}
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

        <GroupNav record={record} />
        <View style={{ flexDirection: wide ? 'row' : 'column', gap: 20 }}>{gallery}{buyBox}</View>

        <ProductLayers record={record} price={price} lifeSrc={life?.src} lifeAlt={life?.alt} />

        <H2>{record.summary?.heading || 'Review your selection'}</H2>
        <View style={[s.card, { backgroundColor: P.aqua, gap: 8 }]}>
          <View style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}>
            {photos[0] ? <Image source={{ uri: resizedImageUrl(photos[0].src, 160) }} accessibilityLabel={photos[0].alt} contentFit="cover" style={s.sumPic} /> : null}
            <View style={{ flex: 1 }}><Text style={s.bF}>{record.name}</Text>
              <Text style={s.note}>{`${variant ? `${variant.label} - ` : ''}${variant?.childSku ?? record.parentSku}`}</Text></View>
          </View>
          <View style={s.spec}><Text style={s.specK}>Price</Text><Text style={s.specV}>{price !== null ? kes(price) : 'On request'}</Text></View>
          <View style={s.spec}><Text style={s.specK}>Delivery</Text><Text style={s.specV}>Our delivery or self-paid, chosen at checkout</Text></View>
          {record.service?.warranty?.text ? <View style={s.spec}><Text style={s.specK}>Warranty</Text><Text style={s.specV}>{record.service.warranty.text}</Text></View> : null}
          {state.kind === 'buy' ? <><TouchableOpacity onPress={() => buyNow()} style={s.primary} accessibilityRole="button"><Text style={s.primaryT}>Buy now</Text></TouchableOpacity>
            <TouchableOpacity onPress={() => buyNow(true)} style={s.ghost} accessibilityRole="button"><Text style={s.ghostT}>Ask someone to pay</Text></TouchableOpacity></>
            : state.kind === 'blocked' ? <Text style={s.warnT}>{state.reason}</Text>
            : state.kind === 'enquiry' ? <TouchableOpacity onPress={() => router.push(`/enquiry?productId=${pid ?? ''}&productName=${encodeURIComponent(record.name)}` as never)} style={s.primary}><Text style={s.primaryT}>Enquire about this product</Text></TouchableOpacity> : null}
        </View>

        {compare ? <ProductCompare current={record} initialVariant={variant} /> : null}

        {record.faq?.length ? <Accordion title="Questions" icon="help-circle-outline">
          {record.faq.map((f, i) => <View key={i} style={{ gap: 2 }}><Text style={s.bF}>{f.q}</Text><Text style={s.body}>{f.a}</Text></View>)}
        </Accordion> : null}
        <Accordion title="Full specifications" icon="list-outline">
          {Object.entries(sp).map(([k, v]) => <View key={k} style={s.spec}><Text style={s.specK}>{k}</Text><Text style={s.specV}>{String(v)}</Text></View>)}
          <View style={s.spec}><Text style={s.specK}>SKU</Text><Text style={s.specV}>{record.parentSku}</Text></View>
        </Accordion>
        <SearchListing record={record} />

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
  limit: { backgroundColor: P.aqua, borderLeftWidth: 4, borderColor: P.teal, borderRadius: 10, padding: 12 },
  sumPic: { width: 64, height: 64, borderRadius: 12, backgroundColor: P.ground },
  bF: { color: P.navy, fontWeight: '700', fontSize: 15 },
  spec: { flexDirection: 'row', justifyContent: 'space-between', gap: 12, borderBottomWidth: 1, borderColor: P.line, paddingVertical: 6 },
  specK: { color: P.muted, fontSize: 14, flexShrink: 0 },
  specV: { color: P.navy, fontSize: 14, fontWeight: '600', flex: 1, textAlign: 'right' },
});
