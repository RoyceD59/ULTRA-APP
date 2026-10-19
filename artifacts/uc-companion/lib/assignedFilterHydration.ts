import type { CustomerFilterAssignment } from '@workspace/api-client-react/companion/models/customerFilterAssignment';
import type { FilterActivation } from '@/hooks/useNotifications';

/** The primary tracker stays local; additional server assignments are listed separately. */
export function assignedPrimaryActivation(
  existing: FilterActivation | null,
  assignments: CustomerFilterAssignment[],
  savedCleanCount = 0,
): FilterActivation | null {
  // Never overwrite even an older activation: it may contain newer maintenance,
  // check-ins, notification identities or a customer's replacement cycle.
  if (existing) return existing;
  const first = assignments.filter(a => a.status === 'linked' && a.active === true && a.activatedAt && a.lifespanDays > 0)
    .sort((a, b) => String(b.activatedAt).localeCompare(String(a.activatedAt)))[0];
  if (!first) return null;
  return {
    productId: first.productId, productName: first.productName,
    activatedAt: first.activatedAt!, lifespanDays: first.lifespanDays,
    registeredFilterId: first.filterId ?? undefined,
    sourceOrderId: Number(first.orderReference),
    cleanCount: Math.max(savedCleanCount, first.maintenanceCount ?? 0),
    // Hydration is not registration or reminder scheduling.
    notifIds: [],
  };
}