/**
 * filterNudge.ts — pure persistence helpers for the register-filter nudge.
 *
 * Extracted from RegisterFilterPrompt so the logic can be unit-tested without
 * importing React Native UI modules.  The component delegates all AsyncStorage
 * reads and writes to these functions.
 *
 * Also owns DAY_OFFSETS and closestDayOffset (shared with FilterTrackerSection)
 * because both are pure and have no platform dependencies.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getFilterActivation, type FilterActivation } from './useNotifications';

// ── Dismissal flag (initial registration nudge) ───────────────────────────────

/**
 * Per-user AsyncStorage key for the dismissal flag.
 * Scoped so one account dismissing the prompt on a shared device never
 * suppresses it for a different account that signs in later.
 */
export const dismissedKeyFor = (userId: number): string =>
  `uc_register_filter_prompt_dismissed_${userId}`;

// ── Dismissal flag (replacement nudge, per order) ────────────────────────────

/**
 * Per-user, per-order key so dismissing the replacement nudge for order N
 * never suppresses it for a later, different order.
 */
export const replacementDismissedKeyFor = (userId: number, orderId: number): string =>
  `uc_replace_filter_prompt_dismissed_${userId}_${orderId}`;

export async function readReplacementNudgeDismissed(
  userId: number,
  orderId: number,
): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(replacementDismissedKeyFor(userId, orderId))) === '1';
  } catch { return false; }
}

export async function markReplacementNudgeDismissed(
  userId: number,
  orderId: number,
): Promise<void> {
  try {
    await AsyncStorage.setItem(replacementDismissedKeyFor(userId, orderId), '1');
  } catch {
    // best-effort — UI already hides the prompt via local state
  }
}

// ── Compound nudge state ──────────────────────────────────────────────────────

export interface NudgeState {
  /** True when the user tapped ✕ and the initial-registration flag was stored. */
  dismissed: boolean;
  /** True when a FilterActivation record exists (reminders already running). */
  hasActivation: boolean;
  /** The stored activation record, or null when none exists. */
  activation: FilterActivation | null;
}

/**
 * Read all suppression signals in parallel.
 * The initial prompt must stay hidden whenever `dismissed` or `hasActivation`
 * is true; the replacement prompt uses `activation` to check order freshness.
 */
export async function readNudgeState(userId: number): Promise<NudgeState> {
  const [flag, activation] = await Promise.all([
    AsyncStorage.getItem(dismissedKeyFor(userId)),
    getFilterActivation(userId),
  ]);
  return {
    dismissed:     flag === '1',
    hasActivation: activation != null,
    activation,
  };
}

/**
 * Persist the dismissal flag for the given user.
 * Best-effort: errors are swallowed so a storage failure never crashes the UI.
 */
export async function markNudgeDismissed(userId: number): Promise<void> {
  try {
    await AsyncStorage.setItem(dismissedKeyFor(userId), '1');
  } catch {
    // best-effort — UI already hides the prompt via local state
  }
}

// ── Day-offset picker ─────────────────────────────────────────────────────────

/** Selectable "days since installation" options shown in the registration modal. */
export const DAY_OFFSETS = [
  { label: 'Today',        days: 0  },
  { label: '1 week ago',   days: 7  },
  { label: '2 weeks ago',  days: 14 },
  { label: '1 month ago',  days: 30 },
  { label: '2 months ago', days: 60 },
] as const;

/**
 * Snap an arbitrary number of days (e.g. days since a purchase) to the
 * closest selectable day-offset option.  Ties go to the earlier entry.
 */
export function closestDayOffset(days: number): number {
  return DAY_OFFSETS.reduce<number>(
    (best, o) => (Math.abs(o.days - days) < Math.abs(best - days) ? o.days : best),
    DAY_OFFSETS[0].days,
  );
}
