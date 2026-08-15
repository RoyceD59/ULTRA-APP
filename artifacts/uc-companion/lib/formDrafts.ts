/**
 * Lightweight per-form draft persistence (AsyncStorage).
 *
 * Used by the account-gated request screens (service request, water test) so
 * a guest who is sent through sign-in / registration mid-flow returns to the
 * form with everything they typed — fields, selections, and
 * attachments-in-progress — intact.
 *
 * Drafts are device-local, never sent to the server, and cleared on
 * successful submission.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

export type DraftKey = 'ticket' | 'water-test';

const storageKey = (key: DraftKey) => `uc_form_draft:${key}`;

/** Persist the current form state. Fire-and-forget safe — never throws. */
export async function saveDraft<T extends object>(key: DraftKey, data: T): Promise<void> {
  try {
    await AsyncStorage.setItem(storageKey(key), JSON.stringify(data));
  } catch {
    // Non-critical: worst case the user retypes the form.
  }
}

/** Load a previously saved draft, or null when none exists. */
export async function loadDraft<T extends object>(key: DraftKey): Promise<T | null> {
  try {
    const raw = await AsyncStorage.getItem(storageKey(key));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === 'object' ? (parsed as T) : null;
  } catch {
    return null;
  }
}

/** Remove the draft (after successful submission). */
export async function clearDraft(key: DraftKey): Promise<void> {
  try {
    await AsyncStorage.removeItem(storageKey(key));
  } catch {
    // ignore
  }
}
