import type { FilterActivation } from '@/hooks/useNotifications';

interface ReminderOptInFlowArgs {
  activation: FilterActivation;
  isReplacement: boolean;
  initiatingUserId: number | null;
  getCurrentUserId: () => number | null;
  wasSeen: (productId: number, activatedAt: string, userId: number) => Promise<boolean>;
}

/**
 * Resolves the activation that should open the post-registration opt-in sheet.
 * Re-checking the current account after the async storage read prevents a
 * signed-out or switched account from receiving the initiating user's sheet.
 */
export async function resolveReminderOptInActivation({
  activation,
  isReplacement,
  initiatingUserId,
  getCurrentUserId,
  wasSeen,
}: ReminderOptInFlowArgs): Promise<FilterActivation | null> {
  if (isReplacement || initiatingUserId === null) return null;

  const alreadySeen = await wasSeen(
    activation.productId,
    activation.activatedAt,
    initiatingUserId,
  );

  if (alreadySeen || getCurrentUserId() !== initiatingUserId) return null;
  return activation;
}