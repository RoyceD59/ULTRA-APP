/** All preference reads are scoped to the current account, including device
 * preferences, so a pending read cannot populate a different account's UI. */
export const notificationPreferenceKeys = {
  device: (owner: number | undefined) => ['customer', owner, 'notification-preferences', 'device'] as const,
  hydration: (owner: number | undefined) => ['customer', owner, 'notification-preferences', 'hydration'] as const,
  channels: (owner: number | undefined) => ['customer', owner, 'notification-preferences', 'channels'] as const,
};

export function preferenceReadBlocked(data: unknown, failed: boolean, fetching: boolean) {
  return data === undefined || failed || fetching;
}