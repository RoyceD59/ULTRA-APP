/**
 * Tests for the reminder opt-in seen-flag persistence layer
 * (hooks/reminderOptInStorage.ts).
 *
 * ReminderOptInSheet shows a one-time prompt after a filter is registered.
 * The sheet is suppressed for future app launches (or account swaps) through
 * three exported helpers:
 *
 *   reminderOptInSeenKey(productId, activatedAt, userId)
 *     → AsyncStorage key scoped to one registration AND one user account.
 *
 *   wasReminderOptInSeen(productId, activatedAt, userId)
 *     → true only when the key holds '1'.
 *
 *   markReminderOptInSeen(productId, activatedAt, userId)
 *     → writes '1' to that key.
 *
 * Covers:
 *   A. Key builder is user-scoped and embeds all three dimensions
 *   B. wasReminderOptInSeen returns false when no flag is stored
 *   C. markReminderOptInSeen writes '1'; wasReminderOptInSeen reads it back
 *      (simulates surviving an app restart)
 *   D. A different userId yields false for the same productId + activatedAt
 *      (account isolation — User B must not be affected by User A's dismissal)
 *   E. markReminderOptInSeen is idempotent — a second call keeps the flag
 *   F. A different productId yields false even for the same userId + activatedAt
 *   G. A different activatedAt yields false even for the same userId + productId
 *
 * Run with: pnpm --filter @workspace/uc-companion test
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// ── AsyncStorage stub ─────────────────────────────────────────────────────────
// @ts-ignore — stub exposes private helpers not in real package types
import AsyncStorageStub from '@react-native-async-storage/async-storage';

const _resetStorage: () => void = (AsyncStorageStub as any)._reset;

// ── Units under test ──────────────────────────────────────────────────────────
import {
  reminderOptInSeenKey,
  wasReminderOptInSeen,
  markReminderOptInSeen,
} from '../reminderOptInStorage.js';

// ── Shared fixtures ───────────────────────────────────────────────────────────
const PRODUCT_ID   = 42;
const ACTIVATED_AT = '2026-01-15T08:00:00.000Z';
const USER_A       = 1;
const USER_B       = 2;

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('reminderOptInStorage — key builder', () => {
  // A. Key must embed all three dimensions so every combination is unique.
  it('A: key is unique per userId, productId, and activatedAt', () => {
    const k1 = reminderOptInSeenKey(PRODUCT_ID, ACTIVATED_AT, USER_A);
    const k2 = reminderOptInSeenKey(PRODUCT_ID, ACTIVATED_AT, USER_B);
    const k3 = reminderOptInSeenKey(PRODUCT_ID + 1, ACTIVATED_AT, USER_A);
    const k4 = reminderOptInSeenKey(PRODUCT_ID, '2026-02-01T00:00:00.000Z', USER_A);

    // Different users → different keys
    assert.notEqual(k1, k2, 'user A and user B must get different keys');

    // Different product → different keys
    assert.notEqual(k1, k3, 'different productId must produce a different key');

    // Different activatedAt → different keys
    assert.notEqual(k1, k4, 'different activatedAt must produce a different key');

    // Key must embed the userId so it is visibly user-scoped
    assert.ok(k1.includes(String(USER_A)), 'key must embed the userId');
    assert.ok(k2.includes(String(USER_B)), 'key must embed the userId');

    // All keys must share the common namespace prefix
    const prefix = 'uc_msg_reminder_optin_seen_';
    assert.ok(k1.startsWith(prefix), `key must start with "${prefix}"`);
    assert.ok(k2.startsWith(prefix), `key must start with "${prefix}"`);
  });
});

describe('reminderOptInStorage — read / write round-trip', () => {
  beforeEach(() => { _resetStorage(); });

  // B. No flag → returns false (fresh device / new registration).
  it('B: wasReminderOptInSeen returns false when no flag has been stored', async () => {
    const seen = await wasReminderOptInSeen(PRODUCT_ID, ACTIVATED_AT, USER_A);
    assert.equal(seen, false, 'must return false when the key is absent');
  });

  // C. After markReminderOptInSeen, wasReminderOptInSeen must return true.
  //    The storage map survives between the two calls, simulating what happens
  //    across an app restart (AsyncStorage is persistent on a real device).
  it('C: markReminderOptInSeen writes the flag; wasReminderOptInSeen returns true on the next check', async () => {
    // Before dismissal
    const before = await wasReminderOptInSeen(PRODUCT_ID, ACTIVATED_AT, USER_A);
    assert.equal(before, false, 'precondition: flag must be absent before marking');

    // User dismisses the sheet (taps ✕ or "Skip for now")
    await markReminderOptInSeen(PRODUCT_ID, ACTIVATED_AT, USER_A);

    // App restarts — wasReminderOptInSeen is called again with the same args
    const after = await wasReminderOptInSeen(PRODUCT_ID, ACTIVATED_AT, USER_A);
    assert.equal(after, true, 'flag must persist and be detected after marking');
  });

  // D. User A's dismissal must not suppress the prompt for User B.
  //    This is the core account-isolation requirement: two accounts on the
  //    same physical device must each manage their own seen-flag.
  it('D: dismissal by user A does not affect user B — same productId + activatedAt', async () => {
    // User A dismisses
    await markReminderOptInSeen(PRODUCT_ID, ACTIVATED_AT, USER_A);

    // User B signs in on the same device — their state is checked independently
    const seenByB = await wasReminderOptInSeen(PRODUCT_ID, ACTIVATED_AT, USER_B);
    assert.equal(seenByB, false,
      'user B must still see the prompt even though user A dismissed it');
  });

  // E. Calling markReminderOptInSeen twice must not throw or corrupt the flag.
  it('E: markReminderOptInSeen is idempotent — repeated calls keep the flag true', async () => {
    await markReminderOptInSeen(PRODUCT_ID, ACTIVATED_AT, USER_A);
    await markReminderOptInSeen(PRODUCT_ID, ACTIVATED_AT, USER_A); // second call

    const seen = await wasReminderOptInSeen(PRODUCT_ID, ACTIVATED_AT, USER_A);
    assert.equal(seen, true, 'flag must still be true after a second markSeen call');
  });

  // F. A different productId for the same user must have its own independent flag.
  it('F: flag for productId A does not affect productId B for the same user', async () => {
    const OTHER_PRODUCT = PRODUCT_ID + 1;

    await markReminderOptInSeen(PRODUCT_ID, ACTIVATED_AT, USER_A);

    const seenForOtherProduct = await wasReminderOptInSeen(OTHER_PRODUCT, ACTIVATED_AT, USER_A);
    assert.equal(seenForOtherProduct, false,
      'each productId must have its own independent seen-flag');
  });

  // G. A different activatedAt for the same user + product must have its own flag.
  it('G: flag for one activatedAt does not affect a different activatedAt for the same user + product', async () => {
    const OTHER_ACTIVATED_AT = '2026-03-01T00:00:00.000Z';

    await markReminderOptInSeen(PRODUCT_ID, ACTIVATED_AT, USER_A);

    const seenForOtherDate = await wasReminderOptInSeen(PRODUCT_ID, OTHER_ACTIVATED_AT, USER_A);
    assert.equal(seenForOtherDate, false,
      'each activatedAt must have its own independent seen-flag');
  });
});
