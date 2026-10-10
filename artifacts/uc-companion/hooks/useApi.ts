import { reportRuntimeReadFailure } from '@workspace/api-client-react/config';
import { useCallback } from 'react';
import { PixelRatio } from 'react-native';
import { useAuth } from '@/context/AuthContext';
import { getApiBase } from '@/lib/apiBase';
import { getHydrateCustomerTree, quoteCompanionCheckout, quotePhysicalTestPromotion } from '@workspace/api-client-react/companion/customer';
import type { HydrateCustomerTree } from '@workspace/api-client-react/companion/models/hydrateCustomerTree';
import type { CustomerFilterAssignment } from '@workspace/api-client-react/companion/models/customerFilterAssignment';

import { ApiError } from './apiError';
import { handleRejectedSessionResponse } from './deletedAccountResponse';
export { ApiError };

/**
 * Product/review media URLs from the API are relative paths
 * ("/api/uc/product-images/…", "/api/storage/objects/…").
 * Resolve them against the API base; absolute and local URIs pass through.
 */
export const resolveMediaUrl = (src?: string | null): string => {
  if (!src) return '';
  if (/^(https?:|file:|blob:|data:|content:)/.test(src)) return src;
  return `${getApiBase()}${src}`;
};

/**
 * Optimized image URL: asks the API for a right-sized WebP derivative instead
 * of the full original (catalogue images are 533×800; review uploads can be
 * multi-megabyte). `displayWidth` is the layout width in points; the device
 * pixel ratio is applied here and the server snaps the result up to a fixed
 * bucket so devices share cached derivatives. Other URLs pass through
 * untouched, and the server falls back to the original bytes on any resize
 * failure (e.g. videos), so this is always safe to apply.
 */
export const resizedImageUrl = (src: string | null | undefined, displayWidth: number): string => {
  const url = resolveMediaUrl(src);
  const isCatalogue = url.includes('/api/uc/product-images/');
  const isUpload = url.includes('/api/storage/objects/uploads/');
  if (!isCatalogue && !isUpload) return url;
  const w = Math.min(768, Math.max(64, Math.round(PixelRatio.get() * displayWidth)));
  // Catalogue route needs the explicit fmt flag; upload thumbnails are always WebP.
  return `${url}?w=${w}${isCatalogue ? '&fmt=webp' : ''}`;
};

export interface UCProduct {
  id: number;
  name: string;
  price: string;
  regularPrice: string;
  salePrice: string;
  description: string;
  shortDescription: string;
  /** One-line marketing tagline from the catalogue. */
  tagline: string;
  categories: { id: number; name: string }[];
  images: { src: string; alt: string }[];
  sku: string;
  /** 'unknown' = awaiting staff stock review: not available, not zero. */
  stockStatus: 'instock' | 'outofstock' | 'onbackorder' | 'unknown';
  stockQuantity: number | null;
  tags: { name: string }[];
  enquiryOnly?: boolean;
  /** Rated filter lifespan in days; 0 or absent = not a trackable filter. */
  lifespanDays?: number;
  /** Team-uploaded product video (relative API path), shown in the gallery. */
  videoUrl?: string | null;
  /** WooCommerce lifetime sales count — used to rank recommendations. */
  totalSales?: number;
  /** Set by /products/compatibility: "Replacement Filter" | "Compatible Accessory". */
  compatibilityReason?: string;
}

export interface UCReviewMedia {
  url: string;
  type: 'photo' | 'video';
}

export interface UCReview {
  id: number;
  rating: number;
  title: string;
  body: string;
  authorName: string;
  media: UCReviewMedia[];
  createdAt: string;
  /** True when this review belongs to the requesting user. */
  mine?: boolean;
}

export interface UCReviewsResponse {
  average: number;
  count: number;
  reviews: UCReview[];
}

export interface UCProductMediaRow {
  id: number;
  productId: number;
  type: 'photo' | 'video';
  url: string;
  alt: string;
  position: number;
  createdAt: string;
}

export interface UploadUrlResponse {
  uploadURL: string;
  objectPath: string;
  kind: 'photo' | 'video';
}

export interface UCEnquiry {
  id: number;
  productId: string;
  productName: string;
  name: string;
  email: string;
  phone: string;
  message: string;
  createdAt: string;
}

export interface UCOrderStatusEvent {
  id?: number;
  stage: string;
  status: string | null;
  actor: string;
  eventKey: string;
  created_at: string;
}

export interface UCOrder {
  reconciliationRequired?: boolean;
  checkoutState?: string | null;
  synchronizationStatus?: string;
  discountAmount?: number;
  promoCode?: string;
  id: number;
  orderNumber?: number | string;
  status: string;
  /** Separate payment and fulfilment values stay current after order sync. */
  paymentStatus?: string;
  paymentConfirmedAt?: string | null;
  paymentReference?: string;
  receiptSerial?: string;
  codCollectionStatus?: string | null;
  fulfillmentStatus?: string;
  dateCreated: string;
  total: string;
  currency: string;
  lineItems: { productId?: number; name: string; quantity: number; total: string; variationId?: number | null; childSku?: string | null; variantLabel?: string | null }[];
  paymentMethod: string;
  shippingAddress: UCAddress;
  delivery?: { method: string; trackingNumber: string | null };
  customerStage?: 'accepted' | 'shipped' | 'delivered' | null;
  customerStageUpdatedAt?: string | null;
  statusEvents?: UCOrderStatusEvent[];
}

export interface UCAddress {
  fulfillment?: 'collection' | 'delivery';
  shippingAmount?: string;
  firstName: string;
  lastName: string;
  address1: string;
  address2: string;
  city: string;
  country: string;
  phone: string;
}

export interface UCCustomer {
  isAdmin?: boolean;
  id: number;
  email: string;
  firstName: string;
  lastName: string;
  billing: UCAddress;
  shipping: UCAddress;
  emailVerified?: boolean;
  phoneVerified?: boolean;
}

export interface MapLocation {
  id: string;
  /** Locations are published from the verified locations table. */
  type: 'experience_centre' | 'vendor' | 'water_atm' | 'refill_station' | 'city_tap';
  name: string;
  address: string;
  lat: number;
  lng: number;
  hours: string;
  phone: string | null;
  vendorName: string | null;
  countryIso: string;
  city: string | null;
  accessNotes: string | null;
  municipal: string | null;
  sourceAttribution: string | null;
  lastFieldVerifiedOn: string | null;
}

export interface LocationRatingAggregate {
  count: number;
  averages: {
    waterQuality?: number;
    cleanliness?: number;
    equipmentCondition?: number;
    serviceReliability?: number;
    safetyConfidence?: number;
  };
  ratings?: {
    id: string;
    waterQuality: number;
    cleanliness: number;
    equipmentCondition: number;
    serviceReliability: number;
    safetyConfidence: number;
    comment?: string | null;
    createdAt?: string;
  }[];
}

export interface LocationRating {
  id?: string;
  waterQuality: number;
  cleanliness: number;
  equipmentCondition: number;
  serviceReliability: number;
  safetyConfidence: number;
  comment?: string | null;
}

export interface MaintenanceTicket {
  id: string;
  productModel: string;
  issueDescription: string;
  preferredContactTime: string;
  photos: string[];
  status: 'submitted' | 'in_progress' | 'resolved';
  createdAt: string;
}

export interface WaterTestRequest {
  id: string;
  name: string;
  address: string;
  phone: string;
  waterSource: string;
  concerns: string;
  status: 'pending' | 'scheduled' | 'completed';
  createdAt: string;
}

export interface PaymentsConfig {
  /** Method visibility map — false = hide from the checkout picker. */
  methods: { paystack: boolean; mpesa: boolean; stripe: boolean; cod: boolean };
  /** "live" when real Daraja credentials are configured; "demo" otherwise. */
  mpesaMode: 'live' | 'demo';
}

export interface MpesaResponse {
  checkoutRequestId: string;
  merchantRequestId: string;
  responseCode: string;
  responseDescription: string;
  customerMessage: string;
}

export interface MpesaStatusResult {
  status: 'pending' | 'success' | 'failed';
  resultDesc?: string;
  /**
   * Only present when status === 'failed'.
   * true  → transient error (network timeout, unknown code) — offer "Try again / COD"
   * false → definitive decline (wrong PIN, user cancelled, insufficient funds) — show dismissal hint
   */
  retriable?: boolean;
}

export interface StripeSessionResponse {
  sessionId: string;
  sessionUrl: string;
  amount: number;
}

export interface StripeSessionStatus {
  status: string | null;
  paymentStatus: string;
}

export interface PaystackInitResponse {
  authorizationUrl: string;
  accessCode: string;
  reference: string;
}

export interface PaymentVerifyResult {
  success: boolean;
  orderId?: number;
  message: string;
}

export interface UCReferralInfo {
  code: string;
  successfulReferrals: number;
  referralLimit: number;
  pointsEarned: number;
  /** An attribution exists but has not yet qualified through an eligible purchase. */
  pendingAttribution: boolean;
  discounts: {
    /** Discount earned after a person referred by this account qualifies. */
    referrer: ReferralDiscountState;
    /** Discount earned when this account's own attribution qualifies. */
    referred: ReferralDiscountState;
  };
  shareMessage: string;
}

export interface ReferralDiscountState {
  status: 'not_earned' | 'available' | 'used';
  discountPercent: number;
  usedAt: string | null;
}
export interface UCPromotion {
  id: string;
  title: string;
  description: string;
  code: string;
  discountPercent: number;
  expiresAt: string;
  active: boolean;
  createdAt: string;
}

export interface UCBlogSource {
  title: string;
  url: string;
}

export interface UCBlogArticleSummary {
  id: string;
  slug: string;
  title: string;
  summary: string;
  category: string;
  publishedAt: string;
}

export interface UCBlogArticle extends UCBlogArticleSummary {
  body: string;
  sources: UCBlogSource[];
}

export interface UCBlogPage {
  articles: UCBlogArticleSummary[];
  nextCursor: string | null;
}

export interface RegisterPurchaseItem {
  /** App/store purchase item. Offline sale units use OfflinePurchaseItem. */
  productId:    number;
  name:         string;
  quantity:     number;
  lifespanDays: number; // 0 = not trackable (no catalogue lifespan — never guessed)
  capacityLitres?: number;
}
export interface OfflinePurchaseItem {
  lineId: string;
  productId: number | null;
  name: string;
  quantity: number;
  lifespanDays: number;
  capacityLitres: number;
  unavailableReason: string | null;
  availableUnitIds: string[];
  registeredUnits: { registeredFilterId?: number; unitId: string; installationDate: string; active: boolean }[];
}
export interface OfflinePurchase {
  source: 'offline';
  saleId: number;
  saleDate: string;
  label: string;
  items: OfflinePurchaseItem[];
}

export interface RegisterPurchaseResult {
  source:      'app' | 'store';
  orderId:     number;
  status:      string;
  dateCreated: string;
  items:       RegisterPurchaseItem[];
  registration?: RegisteredImpactFilter;
}

export interface RegisteredImpactFilter {
  id: number;
  userId?: number;
  verificationStatus?: string;
  capacityUsageValid?: boolean;
  productId: number;
  productName: string;
  ratedCapacityLitres: number;
  usedLitres: number;
  remainingCapacityLitres: number;
  activatedAt: string;
  sourceOrderId: number | null;
}

export interface PersonalImpact {
  totalLitres: number;
  starLevel: number;
  hasRefilled: boolean;
  remainingCapacityLitres: number;
  filters: RegisteredImpactFilter[];
  history: Array<{
    id: number;
    registeredFilterId: number;
    productName: string;
    litres: number;
    reason: string;
    actor: string;
    createdAt: string;
  }>;
}

export interface CustomerRewards {
  balance: number;
  lifetimeRedeemed?: number;
  /** Single server snapshot used by balance, tier/status labels, and QR badge. */
  snapshot?: { balance: number; tier: 'starter' | 'silver' | 'gold'; status: 'active' | 'ready'; qrBadge: 'ready' | 'refresh_required' };
  ledger: Array<{ id: number; points: number; reason: string; eventType: string; createdAt: string }>;
  /** Read-only current server token where recoverable; display still requires validation. */
  qrToken: string | null;
  impact: PersonalImpact;
}

export interface CodeValidationResult {
  valid: boolean;
  type: 'referral' | 'promotion' | null;
  discountPercent: number;
  label: string;
}

/** A checkout amount returned by the promotion service. Amounts are server-calculated. */
export interface CheckoutPromotionQuote {
  code?: string;
  referralBenefitId?: number | null;
  lines?: { productId: number; name: string; quantity: number; subtotal: number; variationId?: number; childSku?: string; variantLabel?: string }[];
  promotion: {
    code: string;
    type?: string;
    title?: string;
    label?: string;
  };
  subtotal: number;
  delivery: number;
  discountAmount: number;
  total: number;
  fulfillment?: 'collection' | 'delivery';
}

export interface CheckoutPaymentInput {
  quotedTotal?: number;
  lineItems: { productId: number; quantity: number; variationId?: number; childSku?: string }[];
  fulfillment: 'collection' | 'delivery';
  promoCode?: string;
  applyReferralDiscount?: boolean;
  shippingAddress: UCAddress;
  idempotencyKey: string;
}
export interface SavedPayLink {
  url: string;
  expiresAt: string;
  orderId: number;
  summary: {
    state: string; total: number; currency: string;
    items: { name: string; size?: string; variant: string; sku: string; quantity: number; total: number }[];
  };
}
/** Server-side notification preferences, including the opt-in flags for
 *  filter-reminder delivery via external channels (email / SMS / WhatsApp). */
export interface ServerNotifPrefs {
  optOutOrders: boolean;
  reminderEmail: boolean;
  reminderSms: boolean;
  reminderWhatsapp: boolean;
}

export function useApi() {
  const { token } = useAuth();

  const authHeaders = useCallback((): Record<string, string> => {
    const h: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) h['Authorization'] = `Bearer ${token}`;
    return h;
  }, [token]);

  const throwResponseError = useCallback(async (res: Response): Promise<never> => {
    const body = await res.json().catch(() => ({})) as Record<string, unknown>;
    await handleRejectedSessionResponse(res.status, token, body);
    throw new ApiError(String(body['error'] ?? res.status), res.status, body);
  }, [token]);

  const get = useCallback(async <T>(path: string, signal?: AbortSignal, deadlineMs?: number): Promise<T> => {
    const controller = deadlineMs ? new AbortController() : null;
    const abort = () => controller?.abort();
    if (controller && signal) {
      if (signal.aborted) controller.abort();
      else signal.addEventListener('abort', abort, { once: true });
    }
    const timer = controller ? setTimeout(abort, deadlineMs) : null;
    let correlationId: string | undefined;
    try {
      const res = await fetch(`${getApiBase()}${path}`, { headers: authHeaders(), signal: controller?.signal ?? signal });
      correlationId = res.headers.get('X-Correlation-ID') || undefined;
      if (res.status >= 500) reportRuntimeReadFailure('api_read_failed', correlationId);
      if (!res.ok) return await throwResponseError(res);
      // Keep the deadline armed while the response body is arriving too.
      return await res.json() as T;
    } catch (error) {
      // User cancellation and expected auth/validation are not operational failures.
      if (!signal?.aborted && !(error instanceof ApiError)) {
        reportRuntimeReadFailure(controller?.signal.aborted ? 'api_read_timeout' : 'api_read_failed', correlationId);
      }
      throw error;
    } finally {
      if (timer) clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
    }
  }, [authHeaders, throwResponseError]);

  const post = useCallback(async <T>(path: string, body?: unknown, signal?: AbortSignal): Promise<T> => {
    const res = await fetch(`${getApiBase()}${path}`, {
      method: 'POST',
      headers: authHeaders(),
      body: body ? JSON.stringify(body) : undefined,
      signal,
    });
    if (!res.ok) {
      return throwResponseError(res);
    }
    return res.json() as Promise<T>;
  }, [authHeaders, throwResponseError]);

  const put = useCallback(async <T>(path: string, body?: unknown): Promise<T> => {
    const res = await fetch(`${getApiBase()}${path}`, {
      method: 'PUT',
      headers: authHeaders(),
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      return throwResponseError(res);
    }
    return res.json() as Promise<T>;
  }, [authHeaders, throwResponseError]);

  const patch = useCallback(async <T>(path: string, body?: unknown): Promise<T> => {
    const res = await fetch(`${getApiBase()}${path}`, {
      method: 'PATCH',
      headers: authHeaders(),
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      return throwResponseError(res);
    }
    return res.json() as Promise<T>;
  }, [authHeaders, throwResponseError]);

  return {
    getProducts: (params?: { category?: string; search?: string }, signal?: AbortSignal) => {
      const qs = new URLSearchParams();
      if (params?.category) qs.set('category', params.category);
      if (params?.search) qs.set('search', params.search);
      return get<UCProduct[]>(`/api/uc/products?${qs}`, signal, 15_000);
    },
    getProduct: (id: number) => get<UCProduct>(`/api/uc/products/${id}`),
    getCompatibilityProducts: (skus: string) =>
      get<UCProduct[]>(`/api/uc/products/compatibility?skus=${encodeURIComponent(skus)}`),
    getProfile: () => get<UCCustomer>('/api/uc/customer/profile'),
    requestContactVerification: (channel: 'email' | 'whatsapp') =>
      post<{ ok: boolean }>('/api/uc/customer/contact-verification/request', { channel }),
    getOrders: () => get<UCOrder[]>('/api/uc/orders'),
    getCommerceStatus: () => get<{ authority: 'companion'; legacyHistory: 'pending_review' | 'reviewed' }>('/api/uc/commerce/status'),
    getAssignments: (signal?: AbortSignal) => get<CustomerFilterAssignment[]>('/api/uc/customer/assignments', signal, 30000),
    getCustomerTree: async () => {
      try { return await getHydrateCustomerTree({ headers: authHeaders() }); }
      catch (error) {
        const status = (error as { status?: number })?.status;
        if (status) await handleRejectedSessionResponse(status, token, (error as { data?: unknown })?.data);
        throw error;
      }
    },
    getOrder: (orderId: number) => get<UCOrder>(`/api/uc/orders/${orderId}`),
    getReturnRequest: (orderId: number) =>
      get<{ request: { id: number; reason: string; details: string; status: string; createdAt: string } | null }>(`/api/uc/orders/${orderId}/return-request`),
    requestReturn: (orderId: number, data: { reason: string; details?: string }) =>
      post<{ ok: boolean; requestId: number; message: string }>(`/api/uc/orders/${orderId}/return-request`, data),
    createOrder: (data: {
      lineItems: CheckoutPaymentInput['lineItems'];
      paymentMethod: string;
      paymentReference: string;
      shippingAddress: UCAddress;
      promoCode?: string;
      /** Applies the caller's own available referral reward; identity comes from auth. */
      applyReferralDiscount?: boolean;
      idempotencyKey: string;
      fulfillment?: 'collection' | 'delivery';
    }) => post<UCOrder & { reconciliationRequired?: boolean }>('/api/uc/orders', data),
    /** Validates a checkout code and returns its server-calculated quote. */
    quoteCheckout: (data: { code?: string; applyReferralDiscount?: boolean; fulfillment: 'collection' | 'delivery'; lineItems: CheckoutPaymentInput['lineItems'] }) =>
      quoteCompanionCheckout(data, { headers: authHeaders() }),
    quoteWaterTestPromotion: (code: string) => quotePhysicalTestPromotion({ code }, { headers: authHeaders() }),
    cancelCheckout: (idempotencyKey: string) => post<{cancelled: boolean}>('/api/uc/checkout/cancel',{idempotencyKey}),
    savePayLink: (checkout: CheckoutPaymentInput, method: 'paystack' | 'mpesa' | 'stripe') =>
      post<SavedPayLink>('/api/uc/orders/pay-link', { checkout, method }),
    revokePayLink: (idempotencyKey: string) => post<{revoked: boolean}>('/api/uc/orders/pay-link/revoke', { idempotencyKey }),
    getCheckoutRecovery: (idempotencyKey: string) => get<{resolution: 'editable' | 'completed' | 'unresolved'; orderId: number | null}>(`/api/uc/checkout/recovery?idempotencyKey=${encodeURIComponent(idempotencyKey)}`),
    quoteCheckoutPromotion: (data: { code: string; fulfillment: 'collection' | 'delivery'; lineItems: CheckoutPaymentInput['lineItems'] }) =>
      post<CheckoutPromotionQuote>('/api/uc/customer/promotions/checkout/quote', data),
    /** Quote the authenticated customer's available one-time referral reward. */
    quoteReferralDiscount: (data: { fulfillment: 'collection' | 'delivery'; lineItems: CheckoutPaymentInput['lineItems'] }) =>
      post<CheckoutPromotionQuote>('/api/uc/customer/referrals/discount/quote', data),
    /**
     * Look up a purchase by receipt/order number + the checkout phone number
     * so the buyer can register their filter from the purchase record.
     */
    getOfflinePurchases: (signal?: AbortSignal) => get<{ purchases: OfflinePurchase[] }>('/api/uc/purchases/offline', signal),
    registerOfflinePurchase: (saleId: number, unitId: string, installationDate: string) =>
      post<{ registration: RegisteredImpactFilter & { lifespanDays: number; offlineUnitId: string; maintenanceCount: number } }>(
        '/api/uc/filters/register-offline-purchase', { saleId, unitId, installationDate }),
    registerFilterPurchase: (receipt: string, phone: string, registration?: { productId: number; activatedAt: string; unitId?: string; source?: 'app' | 'store' }) =>
      post<RegisterPurchaseResult>('/api/uc/filters/register-purchase', { receipt, phone, ...registration }),
    getLocations: () => get<MapLocation[]>('/api/uc/locations'),
    getLocationRatingAggregate: (id: string) =>
      get<LocationRatingAggregate>(`/api/uc/locations/${id}/ratings`),
    getMyLocationRating: (id: string) =>
      get<{ rating: LocationRating | null }>(`/api/uc/me/locations/${id}/rating`),
    upsertLocationRating: (id: string, data: LocationRating) =>
      put<{ rating: LocationRating }>(`/api/uc/locations/${id}/rating`, data),
    reportLocationRating: (locationId: string, ratingId: string, data: { reason: 'spam' | 'unsafe' | 'inaccurate' | 'offensive' | 'other'; detail?: string }) =>
      post<{ report: any }>(`/api/uc/locations/${locationId}/ratings/${ratingId}/reports`, data),
    getTickets: () => get<MaintenanceTicket[]>('/api/uc/tickets'),
    createTicket: (data: {
      contactDetails?: { phone: string; address: string };
      productModel: string;
      issueDescription: string;
      preferredContactTime: string;
      photos: string[];
      videos?: string[];
    }) => post<MaintenanceTicket>('/api/uc/tickets', data),
    createWaterTest: (data: {
      name: string;
      address: string;
      phone: string;
      email?: string;
      waterSource: string;
      concerns: string;
      photos?: string[];
      videos?: string[];
    }) => post<WaterTestRequest>('/api/uc/water-tests', data),
    /** Server-driven payment method availability (e.g. Stripe deactivated). */
    getPaymentsConfig: () =>
      get<PaymentsConfig>('/api/payments/config'),
    mpesaSTKPush: (phone: string, amount: number, orderId: string, checkout?: CheckoutPaymentInput) =>
      post<MpesaResponse>('/api/payments/mpesa', { phone, amount, orderId, checkout }),
    mpesaStatus: (checkoutRequestId: string) =>
      get<MpesaStatusResult>(`/api/payments/mpesa/status/${checkoutRequestId}`),
    stripeSession: (amount: number, orderId: string, checkout?: CheckoutPaymentInput) =>
      post<StripeSessionResponse>('/api/payments/stripe/session', { amount, currency: 'kes', orderId, checkout }),
    stripeSessionStatus: (sessionId: string) =>
      get<StripeSessionStatus>(`/api/payments/stripe/session/${sessionId}`),
    paystackVerify: (reference: string) =>
      get<{ success: boolean; status: string }>(`/api/payments/paystack/verify/${encodeURIComponent(reference)}`),
    paystackInit: (email: string, amount: number, checkout?: CheckoutPaymentInput) =>
      post<PaystackInitResponse>('/api/payments/paystack/init', { email, amount, checkout }),
    verifyPayment: (reference: string, method: string) =>
      post<PaymentVerifyResult>('/api/payments/verify', { reference, method }),
    getMyReferral: () => get<UCReferralInfo>('/api/uc/referrals/my-code'),
    validateCode: (code: string) =>
      post<CodeValidationResult>('/api/uc/referrals/validate', { code }),
    getPromotions: (signal?: AbortSignal) => get<UCPromotion[]>('/api/uc/promotions', signal, 12_000),
    /** Published Companion Blog content is public and independently cancellable. */
    getBlogArticles: (params?: { search?: string; category?: string; cursor?: string; limit?: number }, signal?: AbortSignal) => {
      const qs = new URLSearchParams();
      if (params?.search) qs.set('search', params.search);
      if (params?.category) qs.set('category', params.category);
      if (params?.cursor) qs.set('cursor', params.cursor);
      qs.set('limit', String(params?.limit ?? 12));
      return get<UCBlogPage>(`/api/uc/blog?${qs}`, signal, 12_000);
    },
    getBlogArticle: (slug: string, signal?: AbortSignal) =>
      get<{ article: UCBlogArticle }>(`/api/uc/blog/${encodeURIComponent(slug)}`, signal, 12_000),
    /** Update the authenticated user's profile details (name / phone / address). */
    updateProfile: (data: { firstName?: string; lastName?: string; phone?: string; address?: string }) =>
      patch<UCCustomer>('/api/uc/customer/profile', data),

    /** Download a machine-readable JSON copy of the authenticated user's data
     *  (GDPR Art. 20 / PDPA data portability). Returns the raw JSON text. */
    exportData: async (): Promise<string> => {
      const res = await fetch(`${getApiBase()}/api/uc/customer/data-export`, {
        headers: authHeaders(),
      });
      if (!res.ok) {
        return throwResponseError(res);
      }
      return res.text();
    },

    /**
     * The customer data-export API is the existing authenticated source for
     * water-test records. Keep parsing here so the account screen receives a
     * typed, minimal history instead of duplicating a fetch layer.
     */
    getWaterTestHistory: async (): Promise<WaterTestRequest[]> => {
      const raw = await (async () => {
        const res = await fetch(`${getApiBase()}/api/uc/customer/data-export`, {
          headers: authHeaders(),
        });
        if (!res.ok) return throwResponseError(res);
        return res.text();
      })();
      let payload: unknown;
      try {
        payload = JSON.parse(raw);
      } catch {
        throw new ApiError('Water-test history is unavailable.', 502, {});
      }
      const records = (payload as { waterTests?: unknown } | null)?.waterTests;
      if (!Array.isArray(records)) {
        throw new ApiError('Water-test history is unavailable.', 502, {});
      }
      return records as WaterTestRequest[];
    },

    /** Permanently anonymise the authenticated user's account and personal data. */
    deleteAccount: async (): Promise<{ ok: boolean }> => {
      const res = await fetch(`${getApiBase()}/api/uc/customer`, {
        method: 'DELETE',
        headers: authHeaders(),
      });
      if (!res.ok) {
        return throwResponseError(res);
      }
      return res.json() as Promise<{ ok: boolean }>;
    },

    /** Register an Expo push token for the authenticated user. */
    registerPushToken: (pushToken: string) =>
      post<{ ok: boolean }>('/api/uc/notify/register', { pushToken }),
    /** Sync server-side push notification opt-out preferences. */
    updatePushPrefs: (prefs: {
      optOutOrders?: boolean;
      reminderEmail?: boolean;
      reminderSms?: boolean;
      reminderWhatsapp?: boolean;
    }) =>
      post<{ ok: boolean }>('/api/uc/notify/prefs', prefs),
    /** Load the caller's server-side notification prefs (incl. reminder channels). */
    getServerNotifPrefs: () =>
      get<ServerNotifPrefs>('/api/uc/notify/prefs'),
    /** Submit a product enquiry (works for guests and logged-in users). */
    createEnquiry: (data: {
      productId: number;
      productName: string;
      name: string;
      email: string;
      phone: string;
      message: string;
    }) => post<{ ok: boolean; message: string }>('/api/uc/enquiries', data),

    /** Fetch reviews + rating summary for a product (public). */
    getReviews: (productId: number) =>
      get<UCReviewsResponse>(`/api/uc/products/${productId}/reviews`),
    /** Create or update the signed-in user's review for a product. */
    submitReview: (productId: number, data: {
      rating: number;
      body: string;
      title?: string;
      media?: UCReviewMedia[];
    }) => post<UCReview>(`/api/uc/products/${productId}/reviews`, data),
    /** Step 1 of media upload: get a presigned PUT URL (requires sign-in). */
    requestUploadUrl: (meta: { name: string; size: number; contentType: string; assessmentId?: string; actionToken?: string }) =>
      post<UploadUrlResponse>('/api/uc/uploads/request-url', meta),

    /** Admin: list team-uploaded media for a product. */
    getProductMediaAdmin: (productId: number) =>
      get<UCProductMediaRow[]>(`/api/uc/admin/products/${productId}/media`),
    /** Admin: attach an uploaded photo/video to a product. */
    addProductMediaAdmin: (productId: number, data: {
      url: string; type: 'photo' | 'video'; alt?: string; position?: number;
    }) => post<UCProductMediaRow>(`/api/uc/admin/products/${productId}/media`, data),
    /** Admin: remove a team-uploaded media row. */
    deleteProductMediaAdmin: async (mediaId: number): Promise<{ ok: boolean }> => {
      const res = await fetch(`${getApiBase()}/api/uc/admin/media/${mediaId}`, {
        method: 'DELETE',
        headers: authHeaders(),
      });
      if (!res.ok) {
        return throwResponseError(res);
      }
      return res.json() as Promise<{ ok: boolean }>;
    },

    /** Send a message to the UC AI water quality assistant. */
    waterAiChat: (
      messages: Array<{ role: 'user' | 'assistant'; content: string }>,
      conversationId: string,
      turnId: string,
      filterContext?: {
        productName?:   string;
        daysRemaining?: number;
        waterSource?:   string;
        lastCheckIn?:   string;
        cleanCount?:    number;
      },
      isRetry?: boolean,
      signal?: AbortSignal,
    ) => post<{ reply: string; suggestions: string[]; feedbackToken: string }>('/api/uc/ai/water-chat', {
      messages, conversationId, turnId, filterContext, isRetry,
    }, signal),

    /** Fetch the live UC environmental impact stats. */
    getImpact: () =>
      get<{
        snapshotId: string;
        calculatedAt: string;
        adjustmentRevision: number;
        maxAgeSeconds: number;
        totalUsers:      number;
        litresFiltered:  number;
        plasticsAvoided: number;
        cleanWaterDays:  number;
        autoStats:       { totalUsers: number; litresFiltered: number; cleanWaterDays: number };
        override:        { litresOffset: number; usersOffset: number; lastUpdatedBy: string; lastUpdatedAt: string };
        lastUpdated:     string;
      }>('/api/uc/impact'),

    /** Admin: set additive offset adjustments for the impact figures. */
    updateImpactOverride: (
      litresOffset: number,
      usersOffset:  number,
      updatedBy?:   string,
    ) => post<{ ok: boolean }>('/api/uc/impact/override', { litresOffset, usersOffset, updatedBy }),

    /** Fetch the current user's loyalty-points balance and recent ledger. */
    getRewards: (signal?: AbortSignal) => get<CustomerRewards>('/api/uc/customer/rewards', signal, 12000),
    getRefillCapabilities: () => get<unknown>('/api/uc/refill/capabilities'),
    /** These read-only POSTs keep opaque candidates out of URLs and access logs. */
    validateRewardsQr: (qrToken: string | null, signal?: AbortSignal) =>
      post<import('@workspace/api-client-react/companion/models/rewardsQrInspection').RewardsQrInspection>(
        '/api/uc/customer/rewards/qr/validate', { qrToken }, signal),
    /** Deliberate recovery only; never scheduled by reconnect or foreground. */
    rotateRewardsQr: (expectedVersion: string | null) => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 12000);
      return post<import('@workspace/api-client-react/companion/models/rewardsQrInspection').RewardsQrInspection>(
        '/api/uc/customer/rewards/qr/rotate', { expectedVersion }, controller.signal)
        .finally(() => clearTimeout(timer));
    },
    /** Acknowledge the push lifecycle for this account; no device token is sent. */
    acknowledgeRewardsQrRequest: (requestId: number, event: 'delivered' | 'opened') =>
      post<{ ok: boolean }>('/api/uc/customer/rewards/qr/request-events', { requestId, event }),
    addPersonalImpact: (data: {
      registeredFilterId: number;
      litres: number;
      reason?: string;
      idempotencyKey: string;
    }) => post<{ repeated: boolean; entryId: number; impact: PersonalImpact }>('/api/uc/customer/impact', data),
    /** Redeem eligible whole point blocks; server validates conversion and promo atomically. */
    redeemRewards: (data: { points: number; promoCode?: string; idempotencyKey: string }) =>
      post<RewardsRedemptionResult>('/api/uc/customer/rewards/redeem', data),

    /** Submit a thumbs-up or thumbs-down rating for an Alison response. */
    chatFeedback: (
      rating:   'up' | 'down',
      question: string,
      answer:   string,
      feedbackToken: string,
    ) => post<{ ok: boolean }>('/api/uc/ai/chat-feedback', { rating, question, answer, feedbackToken }),

    // ── Admin: product detail edit ────────────────────────────────────────────
    /** Admin-only: update fields on the app-owned product record. All fields optional. */
    updateProductDetails: (
      productId: number,
      data: {
        name?:             string;
        description?:      string;
        shortDescription?: string;
        regularPrice?:     string;
        salePrice?:        string;
        stockStatus?:      'instock' | 'outofstock' | 'onbackorder';
        /** null = unmanaged quantity (not zero). */
        stockQuantity?:    number | null;
      },
    ) =>
      patch<{ ok: boolean; productId: number; updated: string[]; source: string }>(
        `/api/uc/admin/products/${productId}`,
        data,
      ),

    // ── Wishlist ──────────────────────────────────────────────────────────────
    /** Return the authenticated user's wishlist. */
    getWishlist: () =>
      get<Array<{
        id:                number;
        productId:         number;
        productName:       string;
        addedAt:           string;
        notifiedRestockAt: string | null;
      }>>('/api/uc/wishlist'),

    /** Add a product to the wishlist (idempotent). */
    addToWishlist: (productId: number, productName: string) =>
      post<{ id: number; productId: number; productName: string; addedAt: string }>(
        '/api/uc/wishlist',
        { productId, productName },
      ),

    /** Remove a product from the wishlist. */
    removeFromWishlist: async (productId: number): Promise<{ ok: boolean }> => {
      const res = await fetch(`${getApiBase()}/api/uc/wishlist/${productId}`, {
        method: 'DELETE',
        headers: authHeaders(),
      });
      if (!res.ok) {
        return throwResponseError(res);
      }
      return res.json() as Promise<{ ok: boolean }>;
    },
  };
}

export interface RewardsRedemptionResult {
  balance: number;
  message?: string;
  redemptionValue?: number;
  conversionMode?: 'fixed' | 'percentage';
}

export type CustomerTree = HydrateCustomerTree;
