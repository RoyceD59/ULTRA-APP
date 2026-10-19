/**
 * Boundaries required by isolated, extracted checkout handlers. Mounted-screen
 * tests exercise real recovery persistence; these handler tests control only
 * the provider, cancellation and retry outcomes, with a ready, stable account.
 * Use a new scope per harness so no mutable account state leaks between tests.
 */
export function checkoutHandlerScope() {
  const recoveryScope = 'customer:41';
  return {
    recoveryScope,
    checkoutAccountRef: { current: recoveryScope as string | undefined },
    checkoutRecoveryReady: true,
    reviewOrderId: null,
    checkingRecovery: false,
    sharingMode: false,
    user: null,
    recoveryRef: { current: null as unknown },
    orderIdentityRef: { current: { idempotencyKey: 'original-checkout', codReference: 'original-cod' } },
    async saveCheckoutRecovery(_value: unknown) {},
    async clearCheckoutRecovery(_scope: string) {},
    setCheckoutFeedback(_message: string) {},
    setSavedPayLink(_link: unknown) {},
    validateCustomerContact(_user: unknown) { return { ok: true }; },
  };
}
