import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Platform,
  ActivityIndicator, useWindowDimensions,
} from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { VideoView, useVideoPlayer } from 'expo-video';
import { useColors } from '@/hooks/useColors';
import { useApi, resolveMediaUrl, resizedImageUrl, type UCReviewMedia } from '@/hooks/useApi';
import { useAuth } from '@/context/AuthContext';
import { useCart } from '@/context/CartContext';
import { visibleStoreCategory } from '@/lib/storeCategories';
import TrustBadges from '@/components/TrustBadges';
import StarRating from '@/components/StarRating';
import ReviewCard from '@/components/ReviewCard';
import MediaViewer from '@/components/MediaViewer';
import * as Haptics from 'expo-haptics';
import { customerQueryKeys } from '@/lib/customerQueryKeys';

const GALLERY_H = 310;
const THUMB_SIZE = 54;
const MAX_PHOTOS = 6;

function formatKES(price: string) {
  const n = parseFloat(price);
  return isNaN(n) ? '—' : `KES ${n.toLocaleString('en-KE')}`;
}

type Slide =
  | { kind: 'photo'; src: string; alt: string }
  | { kind: 'video'; src: string };

export default function ProductDetailScreen() {
  const { id, category: returnCategory } = useLocalSearchParams<{ id: string; category?: string }>();
  const colors = useColors();
  const router = useRouter();
  const api = useApi();
  const { addItem, totalItems, cartHydrated } = useCart();
  const { token, user } = useAuth();
  const { width } = useWindowDimensions();

  const pid = parseInt(id ?? '');
  const queryClient = useQueryClient();
  const [slideIndex, setSlideIndex] = useState(0);
  const [viewerItem, setViewerItem] = useState<UCReviewMedia | null>(null);
  // Optimistic wishlist toggle state: null = use server data
  const [wishlistPending, setWishlistPending] = useState<boolean | null>(null);
  const currentCustomerId = useRef<number | null>(user?.id ?? null);
  currentCustomerId.current = user?.id ?? null;
  const galleryRef = useRef<ScrollView>(null);
  const thumbStripRef = useRef<ScrollView>(null);

  // Keep the active thumbnail in view as the customer pages through slides.
  useEffect(() => {
    const cell = THUMB_SIZE + 8; // thumb width + strip gap
    thumbStripRef.current?.scrollTo({
      x: Math.max(0, slideIndex * cell - width / 2 + cell / 2),
      animated: true,
    });
  }, [slideIndex, width]);

  const { data: product, isLoading } = useQuery({
    queryKey: ['product', id],
    queryFn: () => api.getProduct(pid),
    enabled: !!id,
  });

  const { data: reviewData } = useQuery({
    queryKey: customerQueryKeys.reviews(user?.id, pid),
    queryFn: () => api.getReviews(pid),
    enabled: !isNaN(pid),
  });

  // Admin flag (drives the "Manage media" row).
  const { data: profile } = useQuery({
    queryKey: customerQueryKeys.profile(user?.id),
    queryFn: () => api.getProfile(),
    enabled: !!token && !!user,
  });
  const isAdmin = profile?.isAdmin === true;

  // Wishlist — only fetched when logged in; used to detect if this product is already saved.
  const { data: wishlist } = useQuery({
    queryKey: customerQueryKeys.wishlist(user?.id),
    queryFn: () => api.getWishlist(),
    enabled: !!token && !!user,
    staleTime: 60_000,
  });
  const serverWishlisted = wishlist?.some((w) => w.productId === pid) ?? false;
  // Optimistic override: null = fall back to server data.
  const isWishlisted = wishlistPending ?? serverWishlisted;

  useEffect(() => {
    setWishlistPending(null);
  }, [user?.id]);

  const toggleWishlist = useCallback(async () => {
    if (!token || !user || !product) return;
    const initiatingCustomerId = user.id;
    const next = !isWishlisted;
    setWishlistPending(next);
    try {
      if (next) {
        await api.addToWishlist(pid, product.name);
      } else {
        await api.removeFromWishlist(pid);
      }
      await queryClient.invalidateQueries({ queryKey: customerQueryKeys.wishlist(initiatingCustomerId) });
    } catch {
      if (currentCustomerId.current === initiatingCustomerId) setWishlistPending(null);
    } finally {
      if (currentCustomerId.current === initiatingCustomerId) setWishlistPending(null);
    }
  }, [token, user, product, isWishlisted, pid, api, queryClient]);

  // Strike video player — muted, looping, auto-plays.
  const player = useVideoPlayer(null as unknown as string, (p) => {
    p.loop = true;
    p.muted = true;
  });
  useEffect(() => {
    if (product?.videoUrl) {
      player.replace({ uri: resolveMediaUrl(product.videoUrl) });
      player.play();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [product?.videoUrl]);

  if (isLoading) return (
    <View style={[styles.loading, { backgroundColor: colors.background }]}>
      <ActivityIndicator color={colors.primary} />
    </View>
  );

  if (!product) return (
    <View style={[styles.loading, { backgroundColor: colors.background }]}>
      <Text style={{ color: colors.mutedForeground }}>Product not found</Text>
    </View>
  );

  const isEnquiryOnly = product.enquiryOnly === true;
  const displayPrice = product.salePrice || product.price || product.regularPrice;
  // NB: must be a real boolean — an empty-string salePrice would otherwise make
  // this '' and render a stray text node inside the surrounding View on web.
  const isOnSale = !isEnquiryOnly && !!product.salePrice && parseFloat(product.salePrice) < parseFloat(product.regularPrice);
  const inStock = product.stockStatus === 'instock';

  // Up to 6 photos, then exactly one strike-video slot.
  const slides: Slide[] = [
    ...product.images.slice(0, MAX_PHOTOS).map((img) => ({
      kind: 'photo' as const,
      src: resolveMediaUrl(img.src),
      alt: img.alt,
    })),
    ...(product.videoUrl ? [{ kind: 'video' as const, src: resolveMediaUrl(product.videoUrl) }] : []),
  ];

  function goToSlide(i: number) {
    galleryRef.current?.scrollTo({ x: i * width, animated: true });
    setSlideIndex(i);
  }

  const myReview = reviewData?.reviews.find((r) => r.mine);
  const reviewParams = { productId: String(product.id), productName: product.name };

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <ScrollView contentContainerStyle={{ paddingBottom: 120 }} showsVerticalScrollIndicator={false}>

        {/* ── Gallery ─────────────────────────────────────────────────── */}
        <View style={{ backgroundColor: '#0d0d0d' }}>
          <TouchableOpacity
            onPress={() => {
              if (returnCategory) {
                router.replace({
                  pathname: '/(tabs)/products',
                  params: { category: returnCategory },
                } as never);
              } else {
                router.back();
              }
            }}
            style={styles.backBtn}
            accessibilityRole="button"
            accessibilityLabel="Back to products"
          >
            <Ionicons name="chevron-back" size={22} color="#fff" />
            <Text style={styles.backBtnText}>Products</Text>
          </TouchableOpacity>

          {/* Main slide area */}
          <View style={{ height: GALLERY_H, alignItems: 'center', justifyContent: 'center' }}>
            {slides.length === 0 ? (
              <Ionicons name="water-outline" size={80} color={colors.primary} />
            ) : (
              <ScrollView
                ref={galleryRef}
                horizontal
                pagingEnabled
                nestedScrollEnabled
                decelerationRate="fast"
                disableIntervalMomentum
                showsHorizontalScrollIndicator={false}
                // Track the index continuously via onScroll (not just
                // onMomentumScrollEnd, which never fires on web) so the
                // counter and thumbnails always stay in sync with the swipe.
                scrollEventThrottle={16}
                onScroll={(e) => {
                  const w = e.nativeEvent.layoutMeasurement.width || width;
                  const i = Math.max(0, Math.min(slides.length - 1, Math.round(e.nativeEvent.contentOffset.x / w)));
                  setSlideIndex(prev => (prev === i ? prev : i));
                }}
                style={{ height: GALLERY_H }}
              >
                {slides.map((slide, i) => (
                  <View key={i} style={{ width, height: GALLERY_H, alignItems: 'center', justifyContent: 'center' }}>
                    {slide.kind === 'photo' ? (
                      <Image
                        source={{ uri: resizedImageUrl(slide.src, width) }}
                        style={{ width, height: GALLERY_H }}
                        contentFit="contain"
                        transition={150}
                      />
                    ) : (
                      <View style={{ width, height: GALLERY_H }}>
                        <VideoView
                          player={player}
                          style={{ width: '100%', height: '100%' }}
                          contentFit="contain"
                          nativeControls={false}
                        />
                        {/* Strike badge */}
                        <View style={styles.strikeBadge}>
                          <Ionicons name="flash" size={12} color="#fff" />
                          <Text style={styles.strikeBadgeTxt}>Quick Look</Text>
                        </View>
                        {/* Duration hint */}
                        <View style={styles.durationHint}>
                          <Text style={styles.durationHintTxt}>3 – 5 s</Text>
                        </View>
                      </View>
                    )}
                  </View>
                ))}
              </ScrollView>
            )}

            {/* Sale badge */}
            {isOnSale && (
              <View style={[styles.saleBadge, { backgroundColor: colors.destructive }]}>
                <Text style={styles.saleBadgeText}>SALE</Text>
              </View>
            )}

            {/* Slide counter */}
            {slides.length > 1 && (
              <View style={styles.slideCounter}>
                <Text style={styles.slideCounterTxt}>{slideIndex + 1} / {slides.length}</Text>
              </View>
            )}

            {/* Prev / next arrows — tap navigation that works everywhere,
                including web where mouse-dragging a pager is awkward. */}
            {slides.length > 1 && slideIndex > 0 && (
              <TouchableOpacity
                onPress={() => goToSlide(slideIndex - 1)}
                activeOpacity={0.8}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                style={[styles.navArrow, { left: 10 }]}
              >
                <Ionicons name="chevron-back" size={22} color="#fff" />
              </TouchableOpacity>
            )}
            {slides.length > 1 && slideIndex < slides.length - 1 && (
              <TouchableOpacity
                onPress={() => goToSlide(slideIndex + 1)}
                activeOpacity={0.8}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                style={[styles.navArrow, { right: 10 }]}
              >
                <Ionicons name="chevron-forward" size={22} color="#fff" />
              </TouchableOpacity>
            )}
          </View>

          {/* Thumbnail strip */}
          {slides.length > 1 && (
            <ScrollView
              ref={thumbStripRef}
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.thumbStrip}
              style={{ height: THUMB_SIZE + 20 }}
            >
              {slides.map((slide, i) => {
                const active = i === slideIndex;
                return (
                  <TouchableOpacity
                    key={i}
                    onPress={() => goToSlide(i)}
                    activeOpacity={0.75}
                    style={[
                      styles.thumbCell,
                      { borderColor: active ? colors.primary : 'rgba(255,255,255,0.2)' },
                      active && styles.thumbCellActive,
                    ]}
                  >
                    {slide.kind === 'photo' ? (
                      <Image source={{ uri: resizedImageUrl(slide.src, 56) }} style={styles.thumbImg} contentFit="cover" transition={100} />
                    ) : (
                      <View style={styles.thumbVideo}>
                        <Ionicons
                          name="flash"
                          size={16}
                          color={active ? '#fff' : 'rgba(255,255,255,0.55)'}
                        />
                        <Text style={[styles.thumbVideoTxt, { opacity: active ? 1 : 0.55 }]}>
                          Quick{'\n'}Look
                        </Text>
                      </View>
                    )}
                    {active && (
                      <View style={[styles.thumbActiveBar, { backgroundColor: colors.primary }]} />
                    )}
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          )}
        </View>
        {/* ── /Gallery ─────────────────────────────────────────────────── */}

        <View style={styles.body}>
          {/* Categories are navigation controls, not passive metadata. */}
          {product.categories.length > 0 && (
            <View style={styles.categoryChips}>
              {product.categories.map(category => {
                const storeCategory = visibleStoreCategory(category.name);
                return (
                  <TouchableOpacity
                    key={`${category.id}-${category.name}`}
                    disabled={!storeCategory}
                    onPress={() => {
                      if (!storeCategory) return;
                      router.replace({
                        pathname: '/(tabs)/products',
                        params: { category: storeCategory },
                      } as never);
                    }}
                    style={[styles.categoryChip, {
                      backgroundColor: colors.primaryLight,
                      borderColor: colors.primary,
                      opacity: storeCategory ? 1 : 0.7,
                    }]}
                    accessibilityRole={storeCategory ? 'button' : undefined}
                    accessibilityLabel={storeCategory ? `Browse ${storeCategory}` : category.name}
                  >
                    <Text style={[styles.categoryChipText, { color: colors.primary }]}>{category.name}</Text>
                    {storeCategory && <Ionicons name="arrow-forward" size={12} color={colors.primary} />}
                  </TouchableOpacity>
                );
              })}
            </View>
          )}

          {/* Name & Price */}
          <Text style={[styles.name, { color: colors.text }]}>{product.name}</Text>
          <View style={styles.skuRow}>
            <Text style={[styles.sku, { color: colors.mutedForeground }]}>SKU: {product.sku}</Text>
            {reviewData && reviewData.count > 0 && (
              <TouchableOpacity
                style={styles.ratingInline}
                onPress={() => router.push({ pathname: '/review/list', params: reviewParams })}
              >
                <StarRating rating={reviewData.average} size={12} />
                <Text style={[styles.ratingInlineTxt, { color: colors.mutedForeground }]}>
                  {reviewData.average.toFixed(1)} ({reviewData.count})
                </Text>
              </TouchableOpacity>
            )}
          </View>

          {isEnquiryOnly
            ? <View style={[styles.enquiryBanner, { backgroundColor: colors.primaryLight, borderColor: colors.primary }]}>
                <Ionicons name="chatbubble-ellipses-outline" size={18} color={colors.primary} />
                <View style={{ flex: 1 }}>
                  <Text style={[styles.enquiryBannerTitle, { color: colors.primary }]}>Pricing on request</Text>
                  <Text style={[styles.enquiryBannerSub, { color: colors.mutedForeground }]}>
                    Contact us for a personalised quote — usually within 24 hours.
                  </Text>
                </View>
              </View>
            : <>
                <View style={styles.priceRow}>
                  <Text style={[styles.price, { color: colors.primary }]}>{formatKES(displayPrice)}</Text>
                  {isOnSale && (
                    <Text style={[styles.oldPrice, { color: colors.mutedForeground }]}>{formatKES(product.regularPrice)}</Text>
                  )}
                  <View style={[styles.stockBadge, { backgroundColor: inStock ? colors.successLight : '#FFF0F0' }]}>
                    <Ionicons name={inStock ? 'checkmark-circle-outline' : 'close-circle-outline'} size={13}
                      color={inStock ? colors.success : colors.destructive} />
                    <Text style={[styles.stockText, { color: inStock ? colors.success : colors.destructive }]}>
                      {inStock ? 'In Stock' : 'Out of Stock'}
                    </Text>
                  </View>
                </View>
                <View style={[styles.matchBadge, { backgroundColor: colors.primaryLight, borderColor: colors.primary }]}>
                  <Ionicons name="shield-checkmark-outline" size={14} color={colors.primary} />
                  <Text style={[styles.matchText, { color: colors.primary }]}>Prices match our website — guaranteed</Text>
                </View>
              </>
          }

          {/* Description */}
          <Text style={[styles.sectionLabel, { color: colors.text }]}>Product Details</Text>
          <Text style={[styles.description, { color: colors.mutedForeground }]}>
            {product.description.replace(/<[^>]*>/g, '')}
          </Text>

          {product.shortDescription ? (
            <Text style={[styles.shortDesc, { color: colors.mutedForeground }]}>
              {product.shortDescription.replace(/<[^>]*>/g, '')}
            </Text>
          ) : null}

          {/* Trust Badges */}
          <Text style={[styles.sectionLabel, { color: colors.text }]}>Certifications & Trust</Text>
          <TrustBadges />

          {/* Reviews */}
          <View style={styles.reviewsHeader}>
            <Text style={[styles.sectionLabel, { color: colors.text }]}>Reviews</Text>
            {reviewData && reviewData.count > 0 && (
              <View style={styles.ratingInline}>
                <StarRating rating={reviewData.average} size={13} />
                <Text style={[styles.ratingInlineTxt, { color: colors.mutedForeground }]}>
                  {reviewData.average.toFixed(1)} · {reviewData.count} review{reviewData.count === 1 ? '' : 's'}
                </Text>
              </View>
            )}
          </View>

          {reviewData && reviewData.count === 0 && (
            <Text style={[styles.noReviews, { color: colors.mutedForeground }]}>
              No reviews yet — be the first to share your experience.
            </Text>
          )}

          <View style={{ gap: 10 }}>
            {reviewData?.reviews.slice(0, 2).map((r) => (
              <ReviewCard key={r.id} review={r} onOpenMedia={setViewerItem} />
            ))}
          </View>

          <View style={styles.reviewBtnRow}>
            <TouchableOpacity
              activeOpacity={0.85}
              onPress={() =>
                token
                  ? router.push({ pathname: '/review/new', params: reviewParams })
                  : router.push('/auth/login')
              }
              style={[styles.reviewBtn, { borderColor: colors.primary }]}
            >
              <Ionicons name="create-outline" size={15} color={colors.primary} />
              <Text style={[styles.reviewBtnTxt, { color: colors.primary }]}>
                {myReview ? 'Edit your review' : 'Write a review'}
              </Text>
            </TouchableOpacity>
            {reviewData && reviewData.count > 2 && (
              <TouchableOpacity
                activeOpacity={0.85}
                onPress={() => router.push({ pathname: '/review/list', params: reviewParams })}
                style={[styles.reviewBtn, { borderColor: colors.border }]}
              >
                <Text style={[styles.reviewBtnTxt, { color: colors.text }]}>
                  See all {reviewData.count}
                </Text>
              </TouchableOpacity>
            )}
          </View>

          {/* Team-only: manage extra product photos & video */}
          {isAdmin && (
            <TouchableOpacity
              activeOpacity={0.8}
              onPress={() => router.push({ pathname: '/admin/product-media', params: reviewParams })}
              style={[styles.adminRow, { backgroundColor: colors.card, borderColor: colors.border }]}
            >
              <Ionicons name="images-outline" size={18} color={colors.primary} />
              <View style={{ flex: 1 }}>
                <Text style={[styles.adminTitle, { color: colors.text }]}>Manage product media</Text>
                <Text style={[styles.adminSub, { color: colors.mutedForeground }]}>
                  Team only — add photos or a quick-look strike video (3–5 s)
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.mutedForeground} />
            </TouchableOpacity>
          )}

          {/* Team-only: edit product name, description, pricing, stock */}
          {isAdmin && (
            <TouchableOpacity
              activeOpacity={0.8}
              onPress={() => router.push({ pathname: '/admin/product-edit', params: reviewParams })}
              style={[styles.adminRow, { backgroundColor: colors.card, borderColor: colors.border }]}
            >
              <Ionicons name="create-outline" size={18} color={colors.primary} />
              <View style={{ flex: 1 }}>
                <Text style={[styles.adminTitle, { color: colors.text }]}>Edit product details</Text>
                <Text style={[styles.adminSub, { color: colors.mutedForeground }]}>
                  Team only — update name, description, pricing and stock status
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.mutedForeground} />
            </TouchableOpacity>
          )}
        </View>
      </ScrollView>

      {/* Bottom CTA */}
      <View style={[styles.footer, { backgroundColor: colors.background, borderColor: colors.border }]}>
        {isEnquiryOnly ? (
          <TouchableOpacity
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
              router.push(`/enquiry?productId=${product.id}&productName=${encodeURIComponent(product.name)}`);
            }}
            style={[styles.addBtn, { backgroundColor: colors.primary }]}
            activeOpacity={0.85}>
            <Ionicons name="chatbubble-ellipses-outline" size={20} color="#fff" />
            <Text style={[styles.addBtnText, { color: '#fff' }]}>Enquire About This Product</Text>
          </TouchableOpacity>
        ) : (
          <>
            <TouchableOpacity onPress={() => router.push('/cart')} activeOpacity={0.8}
              style={[styles.cartIcon, { borderColor: colors.border }]}>
              <Ionicons name="cart-outline" size={22} color={colors.primary} />
              {/* Hydration-gated: never render a badge state derived from the pre-hydration default */}
              {cartHydrated && totalItems > 0 && (
                <View style={styles.badge}><Text style={styles.badgeText}>{totalItems}</Text></View>
              )}
            </TouchableOpacity>
            {inStock ? (
              <TouchableOpacity
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                  addItem({
                    id: product.id,
                    name: product.name,
                    price: parseFloat(displayPrice),
                    quantity: 1,
                    image: resolveMediaUrl(product.images[0]?.src ?? ''),
                    sku: product.sku,
                  });
                  router.push('/cart');
                }}
                style={[styles.addBtn, { backgroundColor: colors.primary }]}
                activeOpacity={0.85}>
                <Ionicons name="cart-outline" size={20} color="#fff" />
                <Text style={[styles.addBtnText, { color: '#fff' }]}>Add to Cart</Text>
              </TouchableOpacity>
            ) : (
              /* Out of stock — show wishlist toggle so the user can be notified on restock */
              <TouchableOpacity
                onPress={() => {
                  if (!token) { router.push('/auth/login'); return; }
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  toggleWishlist();
                }}
                activeOpacity={0.85}
                style={[
                  styles.addBtn,
                  isWishlisted
                    ? { backgroundColor: '#FFF0F0', borderWidth: 1.5, borderColor: colors.destructive }
                    : { backgroundColor: colors.primaryLight, borderWidth: 1.5, borderColor: colors.primary },
                ]}>
                <Ionicons
                  name={isWishlisted ? 'heart' : 'heart-outline'}
                  size={20}
                  color={isWishlisted ? colors.destructive : colors.primary}
                />
                <Text style={[styles.addBtnText, { color: isWishlisted ? colors.destructive : colors.primary }]}>
                  {isWishlisted ? 'Remove from Wishlist' : 'Notify When Back in Stock'}
                </Text>
              </TouchableOpacity>
            )}
          </>
        )}
      </View>

      <MediaViewer item={viewerItem} onClose={() => setViewerItem(null)} />
    </View>
  );
}

const styles = StyleSheet.create({
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  // Gallery
  backBtn: {
    position: 'absolute', top: 12, left: 12, zIndex: 3,
    flexDirection: 'row', alignItems: 'center', gap: 2,
    backgroundColor: 'rgba(0,0,0,0.58)', borderRadius: 18,
    paddingHorizontal: 8, paddingVertical: 7,
  },
  backBtnText: { color: '#fff', fontSize: 12, fontWeight: '700' as const },
  strikeBadge: {
    position: 'absolute', top: 12, right: 12,
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: 'rgba(0,0,0,0.72)',
    paddingHorizontal: 9, paddingVertical: 4, borderRadius: 20,
  },
  strikeBadgeTxt: { color: '#fff', fontSize: 11, fontWeight: '700' as const },
  durationHint: {
    position: 'absolute', bottom: 12, right: 12,
    backgroundColor: 'rgba(0,0,0,0.65)',
    paddingHorizontal: 7, paddingVertical: 3, borderRadius: 8,
  },
  durationHintTxt: { color: 'rgba(255,255,255,0.75)', fontSize: 10, fontWeight: '600' as const },
  slideCounter: {
    position: 'absolute', top: 12, left: 98,
    backgroundColor: 'rgba(0,0,0,0.55)',
    paddingHorizontal: 9, paddingVertical: 4, borderRadius: 20,
  },
  slideCounterTxt: { color: '#fff', fontSize: 11, fontWeight: '700' as const },
  saleBadge: { position: 'absolute', top: 52, left: 12, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 6 },
  saleBadgeText: { color: '#fff', fontSize: 12, fontWeight: '700' as const },

  // Thumbnail strip
  navArrow: {
    position: 'absolute', top: '50%', marginTop: -18,
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center', justifyContent: 'center',
  },
  thumbStrip: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, paddingVertical: 8 },
  thumbCell: {
    width: THUMB_SIZE, height: THUMB_SIZE, borderRadius: 9,
    overflow: 'hidden', borderWidth: 1.5,
  },
  thumbCellActive: { borderWidth: 2 },
  thumbImg: { width: '100%', height: '100%' },
  thumbVideo: {
    width: '100%', height: '100%',
    backgroundColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center', justifyContent: 'center', gap: 2,
  },
  thumbVideoTxt: { color: '#fff', fontSize: 8, fontWeight: '700' as const, textAlign: 'center' },
  thumbActiveBar: { position: 'absolute', bottom: 0, left: 0, right: 0, height: 3 },

  // Body
  body: { padding: 20, gap: 14 },
  categoryChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  categoryChip: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    borderWidth: 1, borderRadius: 20, paddingHorizontal: 10, paddingVertical: 6,
  },
  categoryChipText: { fontSize: 12, fontWeight: '700' as const },
  name: { fontSize: 22, fontWeight: '700' as const, lineHeight: 28 },
  skuRow: { flexDirection: 'row', alignItems: 'center', gap: 12, flexWrap: 'wrap' },
  sku: { fontSize: 12 },
  ratingInline: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  ratingInlineTxt: { fontSize: 12 },
  priceRow: { flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
  price: { fontSize: 26, fontWeight: '800' as const },
  oldPrice: { fontSize: 16, textDecorationLine: 'line-through' },
  stockBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8 },
  stockText: { fontSize: 12, fontWeight: '600' as const },
  matchBadge: { flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1, borderRadius: 10, padding: 10 },
  matchText: { fontSize: 13, fontWeight: '500' as const },
  sectionLabel: { fontSize: 16, fontWeight: '700' as const, marginTop: 4 },
  description: { fontSize: 14, lineHeight: 22 },
  shortDesc: { fontSize: 14, lineHeight: 22, fontStyle: 'italic' },
  reviewsHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 6 },
  noReviews: { fontSize: 13, lineHeight: 18 },
  reviewBtnRow: { flexDirection: 'row', gap: 10, flexWrap: 'wrap' },
  reviewBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1.5, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 9 },
  reviewBtnTxt: { fontSize: 13, fontWeight: '700' as const },
  adminRow: { flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1, borderRadius: 12, padding: 12 },
  adminTitle: { fontSize: 14, fontWeight: '600' as const },
  adminSub: { fontSize: 12, marginTop: 1 },
  enquiryBanner: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, borderWidth: 1, borderRadius: 12, padding: 14 },
  enquiryBannerTitle: { fontSize: 15, fontWeight: '700' as const },
  enquiryBannerSub: { fontSize: 13, marginTop: 2, lineHeight: 18 },

  // Footer
  footer: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    flexDirection: 'row', gap: 12, padding: 16,
    paddingBottom: Platform.OS === 'web' ? 34 : 16,
    borderTopWidth: 1,
  },
  cartIcon: { width: 50, height: 50, borderRadius: 12, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  badge: { position: 'absolute', top: -4, right: -4, backgroundColor: '#EF4444', borderRadius: 8, minWidth: 16, height: 16, alignItems: 'center', justifyContent: 'center' },
  badgeText: { color: '#fff', fontSize: 10, fontWeight: '700' as const },
  addBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: 12, paddingVertical: 14 },
  addBtnText: { fontSize: 16, fontWeight: '700' as const },
});
