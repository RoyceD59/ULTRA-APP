import AsyncStorage from '@react-native-async-storage/async-storage';
import type { CheckoutPaymentInput, CheckoutPromotionQuote } from './useApi';
import type { CheckoutOrderIdentity } from './checkoutOrderIdentity';

export interface CheckoutRecovery {
  accountId: string;
  identity: CheckoutOrderIdentity;
  input: CheckoutPaymentInput;
  quote: CheckoutPromotionQuote;
  method: 'cod' | 'mpesa' | 'paystack' | 'stripe';
  reviewOrderId?: number;
}

const key = (accountId: string | number) => `uc-checkout-recovery-v1:${accountId}`;

// Anonymous checkout has a device-local namespace, never a customer account key.
export function checkoutRecoveryScope(userId?: string | number): string {
  return userId == null ? 'anonymous-device' : String(userId);
}

export async function loadCheckoutRecovery(userId?: string | number) {
  const scope = checkoutRecoveryScope(userId);
  return { scope, saved: await readCheckoutRecovery(scope), ready: true };
}

export async function readCheckoutRecovery(accountId: string | number): Promise<CheckoutRecovery | null> {
  const raw = await AsyncStorage.getItem(key(accountId));
  if (raw === null) return null;
  const value = JSON.parse(raw) as CheckoutRecovery;
  if (value.accountId !== String(accountId) ||
      !value.identity?.idempotencyKey ||
      value.identity.codReference !== `cod_${value.identity.idempotencyKey}` ||
      value.input?.idempotencyKey !== value.identity.idempotencyKey ||
      !['cod', 'mpesa', 'paystack', 'stripe'].includes(value.method) ||
      !['collection', 'delivery'].includes(value.input.fulfillment ?? '') ||
      !value.input.shippingAddress ||
      !Array.isArray(value.input.lineItems) || !value.input.lineItems.length ||
      !Array.isArray(value.quote?.lines) ||
      !Number.isFinite(value.quote.total) || value.quote.total < 0) {
    throw new Error('Saved checkout could not be read safely. Contact the team before starting another payment.');
  }
  return value;
}

export async function saveCheckoutRecovery(value: CheckoutRecovery): Promise<void> {
  await AsyncStorage.setItem(key(value.accountId), JSON.stringify(value));
}

export async function clearCheckoutRecovery(accountId: string | number): Promise<void> {
  await AsyncStorage.removeItem(key(accountId));
}