/** Pure ownership checks shared by purchase-registration paths. */
export function appPurchaseOwnedBy(accountId: number, orderUserId: string, storedPhone: unknown, suppliedPhone: unknown, phonesMatch: (a: unknown, b: unknown) => boolean): boolean {
  return orderUserId === String(accountId) && phonesMatch(storedPhone, suppliedPhone);
}

export function storePurchaseOwnedBy(accountEmail: string, billingEmail: unknown, billingPhone: unknown, shippingPhone: unknown, suppliedPhone: unknown, normalizeEmail: (value: string) => string, phonesMatch: (a: unknown, b: unknown) => boolean): boolean {
  return normalizeEmail(String(billingEmail ?? "")) === normalizeEmail(accountEmail) &&
    (phonesMatch(billingPhone, suppliedPhone) || phonesMatch(shippingPhone, suppliedPhone));
}