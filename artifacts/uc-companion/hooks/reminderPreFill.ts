/**
 * reminderPreFill
 *
 * Pure async helper extracted from ReminderOptInSheet's useEffect so the
 * pre-fill behaviour can be unit-tested without a React rendering harness.
 *
 * Behaviour:
 *   1. Immediately sets loading=true (spinner visible before the network call).
 *   2. Fetches server prefs via `getServerNotifPrefs`.
 *   3. On success  → applies the returned channels to `setChannels`.
 *   4. On failure  → resets all three channels to OFF (safe fallback).
 *   5. Always clears loading when done, unless the caller cancelled.
 */

import type { ServerNotifPrefs } from './useApi';

export interface ChannelState {
  reminderEmail: boolean;
  reminderSms: boolean;
  reminderWhatsapp: boolean;
}

export const ALL_OFF: ChannelState = {
  reminderEmail: false,
  reminderSms: false,
  reminderWhatsapp: false,
};

/**
 * Fetches server notification prefs and applies them to the provided state
 * setters. Falls back to ALL_OFF when the network call fails.
 *
 * @param getServerNotifPrefs  API call (from useApi)
 * @param setLoading           React setter for the loading flag
 * @param setChannels          React setter for the channel toggles
 * @param isCancelled          Returns true when the effect has been torn down
 *                             (component unmounted or visibility toggled off)
 */
export async function applyReminderPreFill(
  getServerNotifPrefs: () => Promise<ServerNotifPrefs>,
  setLoading: (v: boolean) => void,
  setChannels: (c: ChannelState) => void,
  isCancelled: () => boolean,
): Promise<void> {
  // Synchronous: spinner appears before the first await.
  setLoading(true);
  try {
    const prefs = await getServerNotifPrefs();
    if (isCancelled()) return;
    setChannels({
      reminderEmail:    prefs.reminderEmail,
      reminderSms:      prefs.reminderSms,
      reminderWhatsapp: prefs.reminderWhatsapp,
    });
  } catch {
    if (isCancelled()) return;
    // Graceful fallback — all channels OFF; user can still opt in manually.
    setChannels(ALL_OFF);
  } finally {
    // eslint-disable-next-line no-unsafe-finally
    if (!isCancelled()) setLoading(false);
  }
}
