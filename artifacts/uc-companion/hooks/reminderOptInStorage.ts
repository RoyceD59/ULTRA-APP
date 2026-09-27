/**
 * reminderOptInStorage.ts — pure persistence helpers for the reminder opt-in sheet.
 *
 * Extracted from ReminderOptInSheet so the logic can be unit-tested without
 * importing React Native UI modules.  The component delegates all AsyncStorage
 * reads and writes to these functions.
 *
 * The storage key is scoped to (productId × activatedAt × userId) so that:
 *   • Two different registrations on the same account each get their own flag.
 *   • Two different accounts on the same device do NOT share the flag.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

// ── Key builder ───────────────────────────────────────────────────────────────

/**
 * AsyncStorage key scoped to one registration AND one user account.
 * Including userId prevents a dismissal by User A from hiding the prompt
 * for User B when two accounts are used on the same device.
 */
export function reminderOptInSeenKey(
  productId: number,
  activatedAt: string,
  userId: number,
): string {
  return `uc_msg_reminder_optin_seen_${userId}_${productId}_${activatedAt}`;
}

// ── Read / write helpers ──────────────────────────────────────────────────────

/** Returns true if the prompt has already been shown for this registration. */
export async function wasReminderOptInSeen(
  productId: number,
  activatedAt: string,
  userId: number,
): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(reminderOptInSeenKey(productId, activatedAt, userId))) === '1';
  } catch {
    return false;
  }
}

/** Mark the prompt as shown so it is never re-displayed for this registration. */
export async function markReminderOptInSeen(
  productId: number,
  activatedAt: string,
  userId: number,
): Promise<void> {
  try {
    await AsyncStorage.setItem(reminderOptInSeenKey(productId, activatedAt, userId), '1');
  } catch { /* non-critical */ }
}
