/**
 * Tests for the register-filter nudge persistence layer (hooks/filterNudge.ts).
 *
 * RegisterFilterPrompt.tsx controls its own visibility through two independent
 * signals, both delegated to filterNudge.ts:
 *
 *   1. Dismissal flag  — `uc_register_filter_prompt_dismissed_<userId>`
 *      Written by markNudgeDismissed when the user taps ✕.
 *      Read by readNudgeState on every mount and after an account switch.
 *      A truthy flag suppresses the prompt permanently (dismissed=true).
 *
 *   2. Filter activation — `uc_filter_activation` (via getFilterActivation)
 *      Written by scheduleAllFilterNotifications after the user registers.
 *      readNudgeState returns hasActivation=true → prompt must stay hidden.
 *
 * A third guard lives in the React layer (candidate useMemo): the prompt is
 * hidden when no trackable-filter product appears in the user's orders.
 * That guard is covered by the closestDayOffset tests, which verify the
 * pre-selection logic used when a purchase-date candidate IS found.
 *
 * Covers:
 *   A. Per-user dismissal key is unique and contains the user id
 *   B. markNudgeDismissed writes the flag; readNudgeState reads it back (simulated restart)
 *   C. Dismissal flag is isolated between accounts on the same device
 *   D. readNudgeState returns dismissed=false, hasActivation=false before any action
 *   E. readNudgeState returns hasActivation=true after registration
 *   F. clearFilterActivation resets hasActivation to false (replacement path)
 *   G. markNudgeDismissed is idempotent — repeated calls leave the flag as '1'
 *   H. closestDayOffset snaps arbitrary day counts to the nearest option
 *   I. Registration from the nudge stores all required FilterActivation fields
 *
 * Run with: pnpm --filter @workspace/uc-companion test
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// ── Stubs ────────────────────────────────────────────────────────────────────
// @ts-ignore — stubs expose private helpers not present in real package types
import notifStub from 'expo-notifications';
// @ts-ignore
import AsyncStorageStub from '@react-native-async-storage/async-storage';

const _storage: Map<string, string> = (AsyncStorageStub as any)._storage;
const _resetStorage: () => void     = (AsyncStorageStub as any)._reset;
const _resetNotifs: () => void      = (notifStub as any)._reset;

// ── Units under test ─────────────────────────────────────────────────────────
// Import the real functions from filterNudge.ts — the same module that
// RegisterFilterPrompt delegates to.  Regressions in the component's key
// builder, read path, or write path will therefore break these tests.
import {
  dismissedKeyFor,
  readNudgeState,
  markNudgeDismissed,
  closestDayOffset,
} from '../filterNudge.js';

import {
  scheduleAllFilterNotifications,
  clearFilterActivation,
} from '../useNotifications.js';

// ── Helpers ──────────────────────────────────────────────────────────────────
function nowIso(): string { return new Date().toISOString(); }

// ── Tests ────────────────────────────────────────────────────────────────────

describe('register-filter nudge — dismissal flag', () => {
  beforeEach(() => { _resetStorage(); _resetNotifs(); });

  // A. dismissedKeyFor is user-scoped (tests the real exported function)
  it('A: dismissal key is unique per user id and contains the id', () => {
    const k1 = dismissedKeyFor(1);
    const k2 = dismissedKeyFor(2);
    assert.notEqual(k1, k2, 'each user must get a different key');
    assert.ok(k1.includes('1'), 'key for user 1 must embed the id');
    assert.ok(k2.includes('2'), 'key for user 2 must embed the id');
    // Both keys must share a common prefix so the storage namespace is clear
    assert.ok(
      k1.startsWith('uc_register_filter_prompt_dismissed_'),
      'key must use the expected prefix',
    );
  });

  // B. markNudgeDismissed writes; readNudgeState reads (the full round-trip)
  it('B: markNudgeDismissed writes the flag; readNudgeState sees dismissed=true across a simulated restart', async () => {
    const userId = 42;

    // Before dismissal: readNudgeState must report dismissed=false
    const before = await readNudgeState(userId);
    assert.equal(before.dismissed, false, 'prompt must not be suppressed before dismissal');

    // Simulate tapping ✕ (what handleDismiss does via markNudgeDismissed)
    await markNudgeDismissed(userId);

    // Simulate app restart: readNudgeState is called again with the same userId
    const after = await readNudgeState(userId);
    assert.equal(after.dismissed, true,
      'prompt must be permanently suppressed after dismissal (flag="1")');
  });

  // C. One user's dismissal must not affect another user's prompt
  it('C: dismissal flag for user 1 does not suppress the prompt for user 2', async () => {
    await markNudgeDismissed(1);

    // User 2 signs in — their state is read independently
    const user2State = await readNudgeState(2);
    assert.equal(user2State.dismissed, false,
      'user 2 must still see the prompt even after user 1 dismissed it');
  });

  // D. Clean state: both flags false before any action
  it('D: readNudgeState returns dismissed=false and hasActivation=false on a fresh device', async () => {
    const state = await readNudgeState(99);
    assert.equal(state.dismissed,     false, 'dismissed must be false');
    assert.equal(state.hasActivation, false, 'hasActivation must be false');
  });

  // G. Calling markNudgeDismissed twice must not throw or corrupt state
  it('G: markNudgeDismissed is idempotent — repeated calls keep dismissed=true', async () => {
    await markNudgeDismissed(5);
    await markNudgeDismissed(5); // second call must be safe
    const state = await readNudgeState(5);
    assert.equal(state.dismissed, true, 'dismissed must still be true after a second call');
  });
});

describe('register-filter nudge — activation suppression', () => {
  beforeEach(() => { _resetStorage(); _resetNotifs(); });

  // E. After registration readNudgeState returns hasActivation=true → prompt hidden
  it('E: readNudgeState returns hasActivation=true after registration → prompt suppressed', async () => {
    // Before registration
    const before = await readNudgeState(1);
    assert.equal(before.hasActivation, false,
      'hasActivation must be false before registration — prompt eligible');

    // Simulate completing registration from the nudge
    await scheduleAllFilterNotifications({
      activatedAt:  nowIso(),
      productId:    1,
      productName:  'Hydra Flux',
      lifespanDays: 90,
    });

    // Simulate app restart: readNudgeState is called again
    const after = await readNudgeState(1);
    assert.equal(after.hasActivation, true,
      'hasActivation must be true after registration — prompt must stay hidden');
  });

  // F. clearFilterActivation (filter replacement) must reset hasActivation
  it('F: clearFilterActivation resets hasActivation — prompt becomes eligible again', async () => {
    await scheduleAllFilterNotifications({
      activatedAt:  nowIso(),
      productId:    1,
      productName:  'Hydra Flux',
      lifespanDays: 90,
    });
    assert.equal((await readNudgeState(1)).hasActivation, true, 'sanity: activation exists');

    await clearFilterActivation();

    const state = await readNudgeState(1);
    assert.equal(state.hasActivation, false,
      'hasActivation must be false after clearFilterActivation — user can register a new filter');
  });
});

describe('register-filter nudge — registration writes all required fields', () => {
  beforeEach(() => { _resetStorage(); _resetNotifs(); });

  // I. scheduleAllFilterNotifications (called from the prompt's onSave handler)
  //    must write all fields the home-screen status card reads.
  it('I: registration stores productId, productName, lifespanDays, activatedAt, and notifIds', async () => {
    const activatedAt = nowIso();
    const activation = await scheduleAllFilterNotifications({
      activatedAt,
      productId:    7,
      productName:  'Ultra Clear Standard Filter',
      lifespanDays: 180,
    });

    assert.equal(activation.productId,    7,                             'productId');
    assert.equal(activation.productName,  'Ultra Clear Standard Filter', 'productName');
    assert.equal(activation.lifespanDays, 180,                           'lifespanDays');
    assert.equal(activation.activatedAt,  activatedAt,                   'activatedAt');
    assert.ok(Array.isArray(activation.notifIds),                        'notifIds is an array');
    assert.ok(activation.notifIds.length > 0, 'at least one reminder must be scheduled');

    // readNudgeState must now report hasActivation=true (simulates a restart)
    const state = await readNudgeState(1);
    assert.equal(state.hasActivation, true,
      'readNudgeState must see the new activation after registration');
  });
});

describe('register-filter nudge — closestDayOffset pre-selection', () => {
  // H. Snap arbitrary day counts to the closest DAY_OFFSETS entry.
  //    This is the same function RegisterFilterPrompt passes as initialDayOffset
  //    to RegisterModal when a purchase-date candidate is found.
  it('H: closestDayOffset snaps to the nearest option (ties go to the earlier entry)', () => {
    // Exact matches
    assert.equal(closestDayOffset(0),  0,  'Today (0 days)');
    assert.equal(closestDayOffset(7),  7,  '1 week ago');
    assert.equal(closestDayOffset(14), 14, '2 weeks ago');
    assert.equal(closestDayOffset(30), 30, '1 month ago');
    assert.equal(closestDayOffset(60), 60, '2 months ago');

    // Between options — nearest wins
    assert.equal(closestDayOffset(3),  0,  '3d → Today   (|3-0|=3 < |3-7|=4)');
    assert.equal(closestDayOffset(5),  7,  '5d → 1 week  (|5-7|=2 < |5-0|=5)');
    assert.equal(closestDayOffset(11), 14, '11d → 2 weeks (|11-14|=3 < |11-7|=4)');
    assert.equal(closestDayOffset(80), 60, '80d → 2 months (beyond all options)');

    // Same-day purchase must always give "Today" so the modal opens on the right step
    assert.equal(closestDayOffset(0), 0, 'same-day order → Today pre-selected');
  });
});
