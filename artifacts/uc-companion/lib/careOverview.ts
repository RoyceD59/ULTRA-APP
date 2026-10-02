import { refillCapabilitiesSchema } from '@workspace/api-zod/refill-readiness';

/** Capability responses must be valid and explicitly opt in; all paid phases stay unavailable. */
export function careOverviewAvailable(value: unknown): boolean {
  const parsed = refillCapabilitiesSchema.safeParse(value);
  if (!parsed.success) return false;
  const capabilities = parsed.data;
  return capabilities.careOverview
    && !capabilities.promoRefill
    && !capabilities.paidRefill
    && !capabilities.moneyWallet
    && !capabilities.paidCare
    && !capabilities.automaticCollection;
}
