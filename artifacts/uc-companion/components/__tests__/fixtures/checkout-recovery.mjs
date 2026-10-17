// Plain ESM is intentional: tsx's synchronous CJS loader treats data: mocks
// as filesystem names. Explicit exports also avoid star-export inference.
export let user = { id: 41, firstName: 'Amina', lastName: 'Otieno', phone: '+254712345678', address: 'Test building, Nairobi' };
export let items = [];
export let mode = 'review', calls = [], clears = 0, cancellations = 0;
export function newCart() { items = [{ id: 1, name: 'Hydra Flux', price: 3499, quantity: 1 }]; }
export function setup(next) { mode = next; calls = []; clears = 0; cancellations = 0; newCart(); }
export function setMode(next) { mode = next; }
export function useAuth() { return { user }; }
export function useCart() {
  return { items, totalPrice: 3499, cartHydrated: true, clearCart() { clears++; items = []; } };
}
export class ApiError extends Error {
  constructor(message, status, body = {}) { super(message); this.status = status; this.body = body; }
}
export function useApi() {
  return {
    async getPaymentsConfig() { return { methods: { cod: true, paystack: false, mpesa: false, stripe: false } }; },
    async quoteCheckout(input) { return { ...input, total: 3499, lines: [{ productId: 1, quantity: 1, name: 'Hydra Flux', subtotal: 3499 }] }; },
    async createOrder(input) {
      calls.push(input);
      if (mode === 'invalid') throw new ApiError('Prices changed', 422, { fields: { quotedTotal: 'Refresh total' } });
      return { id: 71, reconciliationRequired: mode === 'review' };
    },
    async getCheckoutRecovery() { return { resolution: mode === 'resolved' ? 'completed' : mode === 'invalid' ? 'editable' : 'unresolved', orderId: 71 }; },
    async cancelCheckout() {
      if (mode === 'review') throw new ApiError('Still needs review', 409);
      cancellations++;
      return { cancelled: true };
    },
  };
}
export function useColors() { return { primary: '#0054A6', text: '#000', mutedForeground: '#666' }; }
export function useRouter() { return { replace() {}, push() {}, back() {} }; }
export function useLocalSearchParams() { return {}; }
export function useSafeAreaInsets() { return { top: 0, bottom: 0 }; }
export function useQueryClient() { return { async invalidateQueries() {} }; }
export const ImpactFeedbackStyle = {};
export function impactAsync() {}
export function openAuthSessionAsync() {}
export function openBrowserAsync() {}
export function trackEvent() {}
export function trackProductEvent() {}
export function trackVerifiedPurchase() {}
export function useCheckoutReceipt() { return { retainOrder() {} }; }
export function CountryPicker() { return null; }
export default function Component() { return null; }
