/**
 * The only client-side registration sequence.  A reminder/visible activation
 * is intentionally impossible until the purchase-backed API commit resolves.
 */
export async function commitPurchaseBackedRegistration<T>(
  commitPurchase: () => Promise<unknown>,
  scheduleReminders: () => Promise<T>,
  showRegisteredActivation: (activation: T) => void,
): Promise<T> {
  await commitPurchase();
  const activation = await scheduleReminders();
  showRegisteredActivation(activation);
  return activation;
}