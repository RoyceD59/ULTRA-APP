import { useCallback } from 'react';
import { PixelRatio } from 'react-native';
import { useAuth } from '@/context/AuthContext';

const getBase = () =>
  process.env.EXPO_PUBLIC_DOMAIN
    ? `https://${process.env.EXPO_PUBLIC_DOMAIN}`
    : 'http://localhost:8080';

// ApiError lives in its own dependency-free module so the rate-limit tests can
// exercise it under node:test; re-exported here so app imports keep working.
import { ApiError } from './apiError';
export { ApiError };

/**
 * Product/review media URLs from the API are relative paths
 * ("/api/uc/product-images/…", "/api/storage/objects/…").
 * Resolve them against the API base; absolute and local URIs pass through.
 */
export const resolveMediaUrl = (src?: string | null): string => {
  if (!src) return '';
  if (/^(https?:|file:|blob:|data:|content:)/.test(src)) return src;
  return `${getBase()}${src}`;
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
  stockStatus: 'instock' | 'outofstock';
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

export interface UCOrder {
  id: number;
  status: string;
  dateCreated: string;
  total: string;
  currency: string;
  lineItems: { productId: number; name: string; quantity: number; total: string }[];
  paymentMethod: string;
  shippingAddress: UCAddress;
}

export interface UCAddress {
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
}

export interface MapLocation {
  id: string;
  type: 'experience_centre' | 'refill_atm';
  name: string;
  address: string;
  lat: number;
  lng: number;
  hours: string;
  phone: string | null;
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
  referredCount: number;
  conversions: number;
  creditsEarnedKes: number;
  usedReferralCode: string | null;
  shareMessage: string;
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

export interface RegisterPurchaseItem {
  productId:    number;
  name:         string;
  quantity:     number;
  lifespanDays: number; // 0 = not trackable (no catalogue lifespan — never guessed)
}

export interface RegisterPurchaseResult {
  source:      'app' | 'store';
  orderId:     number;
  status:      string;
  dateCreated: string;
  items:       RegisterPurchaseItem[];
}

export interface CodeValidationResult {
  valid: boolean;
  type: 'referral' | 'promotion' | null;
  discountPercent: number;
  label: string;
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

  const get = useCallback(async <T>(path: string): Promise<T> => {
    const res = await fetch(`${getBase()}${path}`, { headers: authHeaders() });
    if (!res.ok) {
      const body = await res.json().catch(() => ({})) as Record<string, unknown>;
      throw new ApiError(String(body['error'] ?? res.status), res.status, body);
    }
    return res.json() as Promise<T>;
  }, [authHeaders]);

  const post = useCallback(async <T>(path: string, body?: unknown): Promise<T> => {
    const res = await fetch(`${getBase()}${path}`, {
      method: 'POST',
      headers: authHeaders(),
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      const errBody = await res.json().catch(() => ({})) as Record<string, unknown>;
      throw new ApiError(String(errBody['error'] ?? res.status), res.status, errBody);
    }
    return res.json() as Promise<T>;
  }, [authHeaders]);

  const patch = useCallback(async <T>(path: string, body?: unknown): Promise<T> => {
    const res = await fetch(`${getBase()}${path}`, {
      method: 'PATCH',
      headers: authHeaders(),
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      const errBody = await res.json().catch(() => ({})) as Record<string, unknown>;
      throw new ApiError(String(errBody['error'] ?? res.status), res.status, errBody);
    }
    return res.json() as Promise<T>;
  }, [authHeaders]);

  return {
    getProducts: (params?: { category?: string; search?: string }) => {
      const qs = new URLSearchParams();
      if (params?.category) qs.set('category', params.category);
      if (params?.search) qs.set('search', params.search);
      return get<UCProduct[]>(`/api/uc/products?${qs}`);
    },
    getProduct: (id: number) => get<UCProduct>(`/api/uc/products/${id}`),
    getCompatibilityProducts: (skus: string) =>
      get<UCProduct[]>(`/api/uc/products/compatibility?skus=${encodeURIComponent(skus)}`),
    getProfile: () => get<UCCustomer>('/api/uc/customer/profile'),
    getOrders: () => get<UCOrder[]>('/api/uc/orders'),
    getReturnRequest: (orderId: number) =>
      get<{ request: { id: number; reason: string; details: string; status: string; createdAt: string } | null }>(`/api/uc/orders/${orderId}/return-request`),
    requestReturn: (orderId: number, data: { reason: string; details?: string }) =>
      post<{ ok: boolean; requestId: number; message: string }>(`/api/uc/orders/${orderId}/return-request`, data),
    createOrder: (data: {
      lineItems: { productId: number; quantity: number }[];
      paymentMethod: string;
      paymentReference: string;
      shippingAddress: UCAddress;
      promoCode?: string;
      userEmail?: string;
    }) => post<UCOrder>('/api/uc/orders', data),
    /**
     * Look up a purchase by receipt/order number + the checkout phone number
     * so the buyer can register their filter from the purchase record.
     */
    registerFilterPurchase: (receipt: string, phone: string) =>
      post<RegisterPurchaseResult>('/api/uc/filters/register-purchase', { receipt, phone }),
    getLocations: () => get<MapLocation[]>('/api/uc/locations'),
    getTickets: () => get<MaintenanceTicket[]>('/api/uc/tickets'),
    createTicket: (data: {
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
    mpesaSTKPush: (phone: string, amount: number, orderId: string) =>
      post<MpesaResponse>('/api/payments/mpesa', { phone, amount, orderId }),
    mpesaStatus: (checkoutRequestId: string) =>
      get<MpesaStatusResult>(`/api/payments/mpesa/status/${checkoutRequestId}`),
    stripeSession: (amount: number, orderId: string) =>
      post<StripeSessionResponse>('/api/payments/stripe/session', { amount, currency: 'kes', orderId }),
    stripeSessionStatus: (sessionId: string) =>
      get<StripeSessionStatus>(`/api/payments/stripe/session/${sessionId}`),
    paystackVerify: (reference: string) =>
      get<{ success: boolean; status: string }>(`/api/payments/paystack/verify/${encodeURIComponent(reference)}`),
    paystackInit: (email: string, amount: number) =>
      post<PaystackInitResponse>('/api/payments/paystack/init', { email, amount }),
    verifyPayment: (reference: string, method: string) =>
      post<PaymentVerifyResult>('/api/payments/verify', { reference, method }),
    getMyReferral: () => get<UCReferralInfo>('/api/uc/referrals/my-code'),
    validateCode: (code: string, userEmail?: string) =>
      post<CodeValidationResult>('/api/uc/referrals/validate', { code, userEmail }),
    getPromotions: () => get<UCPromotion[]>('/api/uc/promotions'),
    /** Update the authenticated user's profile details (name / phone / address). */
    updateProfile: (data: { firstName?: string; lastName?: string; phone?: string; address?: string }) =>
      patch<UCCustomer>('/api/uc/customer/profile', data),

    /** Download a machine-readable JSON copy of the authenticated user's data
     *  (GDPR Art. 20 / PDPA data portability). Returns the raw JSON text. */
    exportData: async (): Promise<string> => {
      const res = await fetch(`${getBase()}/api/uc/customer/data-export`, {
        headers: authHeaders(),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as Record<string, unknown>;
        throw new ApiError(String(body['error'] ?? res.status), res.status, body);
      }
      return res.text();
    },

    /** Permanently anonymise the authenticated user's account and personal data. */
    deleteAccount: async (): Promise<{ ok: boolean }> => {
      const res = await fetch(`${getBase()}/api/uc/customer`, {
        method: 'DELETE',
        headers: authHeaders(),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(err.error || `${res.status}`);
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
    requestUploadUrl: (meta: { name: string; size: number; contentType: string }) =>
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
      const res = await fetch(`${getBase()}/api/uc/admin/media/${mediaId}`, {
        method: 'DELETE',
        headers: authHeaders(),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(err.error || `${res.status}`);
      }
      return res.json() as Promise<{ ok: boolean }>;
    },

    /** Send a message to the UC AI water quality assistant. */
    waterAiChat: (
      messages: Array<{ role: 'user' | 'assistant'; content: string }>,
      filterContext?: {
        productName?:   string;
        daysRemaining?: number;
        waterSource?:   string;
        lastCheckIn?:   string;
        cleanCount?:    number;
      },
      isRetry?: boolean,
    ) => post<{ reply: string; suggestions: string[] }>('/api/uc/ai/water-chat', { messages, filterContext, isRetry }),

    /** Fetch the live UC environmental impact stats. */
    getImpact: () =>
      get<{
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
    getRewards: () =>
      get<{
        balance: number;
        ledger: Array<{ id: number; points: number; reason: string; eventType: string; createdAt: string }>;
      }>('/api/uc/customer/rewards'),

    /** Submit a thumbs-up or thumbs-down rating for an Alison response. */
    chatFeedback: (
      rating:   'up' | 'down',
      question: string,
      answer:   string,
    ) => post<{ ok: boolean }>('/api/uc/ai/chat-feedback', { rating, question, answer }),

    // ── Admin: product detail edit ────────────────────────────────────────────
    /** Admin-only: update product fields in WooCommerce. All fields optional. */
    updateProductDetails: (
      productId: number,
      data: {
        name?:             string;
        description?:      string;
        shortDescription?: string;
        regularPrice?:     string;
        salePrice?:        string;
        stockStatus?:      'instock' | 'outofstock';
        stockQuantity?:    number;
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
      const res = await fetch(`${getBase()}/api/uc/wishlist/${productId}`, {
        method: 'DELETE',
        headers: authHeaders(),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(err.error || `${res.status}`);
      }
      return res.json() as Promise<{ ok: boolean }>;
    },
  };
}
