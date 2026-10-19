/**
 * The only client-side registration sequence.  A reminder/visible activation
 * is intentionally impossible until the purchase-backed API commit resolves.
 */
export async function commitPurchaseBackedRegistration<T, C>(
  commitPurchase: () => Promise<C>,
  scheduleReminders: (committed: C) => Promise<T>,
  showRegisteredActivation: (activation: T) => void,
): Promise<T> {
  const committed = await commitPurchase();
  const activation = await scheduleReminders(committed);
  showRegisteredActivation(activation);
  return activation;
}