/** UI/storage boundaries for tests that execute extracted production handlers.
 * Account switching and durable recovery are exercised by CheckoutRecoveryRendered
 * and checkoutRecovery; these provider-race fixtures start in a ready account.
 */
export function checkoutBoundaries() {
  const scope = 'checkout-provider-fixture';
  const persisted: unknown[] = [];
  const cleared: string[] = [];
  const feedback: string[] = [];
  return {
    recoveryScope: scope, checkoutAccountRef: { current: scope },
    checkoutRecoveryReady: true, reviewOrderId: null, checkingRecovery: false,
    sharingMode: false, user: null, recoveryRef: { current: null },
    orderIdentityRef: { current: { idempotencyKey: 'original-checkout' } },
    saveCheckoutRecovery: async (value: unknown) => { persisted.push(value); },
    clearCheckoutRecovery: async (value: string) => { cleared.push(value); },
    setCheckoutFeedback: (value: string) => { feedback.push(value); },
    setSavedPayLink: (_value: unknown) => {},
    validateCustomerContact: (_value: unknown) => ({ ok: true }),
    persisted, cleared, feedback,
  };
}
