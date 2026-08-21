/**
 * The account QR code is deliberately a small, stable string rather than a URL.
 * Field staff can scan it in ProjectHub without requiring the customer's phone
 * to have network access at scan time.
 */
export function buildRewardsQrPayload(userId: number | string, phone?: string | null): string {
  const numericId = Number(userId);
  if (!Number.isSafeInteger(numericId) || numericId <= 0) {
    throw new Error("A valid account ID is required for the rewards QR code");
  }

  return `uc-rewards:${numericId}:${phone?.trim() ?? ""}`;
}