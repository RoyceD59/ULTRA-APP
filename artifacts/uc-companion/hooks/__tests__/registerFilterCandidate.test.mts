/**
 * Tests for the computeRegisterCandidate pure helper extracted from
 * RegisterFilterPrompt.tsx.
 *
 * The critical invariant this suite protects:
 *   When the only trackable order whose dateCreated is newer than activatedAt
 *   is the SAME order that originally registered the current filter cycle
 *   (activation.sourceOrderId === order.id), the helper must return null so
 *   the replacement nudge stays hidden.  Breaking this guard causes a customer
 *   who registers from the prompt to immediately see it again on next load.
 *
 * Covers:
 *   A. Same order as sourceOrderId → null (nudge stays hidden)
 *   B. Different order             → CandidateResult returned (nudge shows)
 *   C. sourceOrderId undefined (old activations pre-dating the field) →
 *      undefined never accidentally equals a real order id → nudge still
 *      shows for a genuinely new order, proving the guard is not broken
 *   D. sourceOrderId undefined, only one order exists and its time equals
 *      activatedAt → orderTime <= activationTime → break → null (no nudge)
 *   E. No orders at all            → null
 *   F. Order is older than activation → null (break path, not skip path)
 *   G. Register mode ignores sourceOrderId — any trackable order qualifies
 *
 * Run with: pnpm --filter @workspace/uc-companion test
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { computeRegisterCandidate } from '../filterCandidateUtils.js';
import type { FilterActivation } from '../useNotifications.js';

// ── Shared fixtures ───────────────────────────────────────────────────────────

const PRODUCT = { id: 42, name: 'Ultra Clear Standard Filter', lifespanDays: 90 };

/** Millisecond timestamp for a date string like "2026-01-01T00:00:00.000Z". */
function ms(iso: string): number { return new Date(iso).getTime(); }

const ACTIVATED_AT = '2026-01-01T00:00:00.000Z';
const NEWER_DATE   = '2026-06-01T00:00:00.000Z';  // after activation
const SAME_DATE    = '2025-12-31T00:00:00.000Z';  // before activation → triggers break

/** A minimal activation whose filter was registered via order 100. */
function makeActivation(override?: Partial<FilterActivation>): FilterActivation {
  return {
    activatedAt:  ACTIVATED_AT,
    productId:    PRODUCT.id,
    productName:  PRODUCT.name,
    lifespanDays: PRODUCT.lifespanDays,
    notifIds:     [],
    sourceOrderId: 100,
    ...override,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('computeRegisterCandidate — replace-mode sourceOrderId guard', () => {

  // A. The same order that registered the current cycle must be skipped.
  it('A: sourceOrderId === order.id → null (nudge stays hidden)', () => {
    const result = computeRegisterCandidate({
      eligibleForRegister: false,
      eligibleForReplace:  true,
      activation: makeActivation({ sourceOrderId: 100 }),
      orders: [
        {
          id:          100,                 // ← same as sourceOrderId
          dateCreated: NEWER_DATE,          // newer than activatedAt, so it passes the time check
          lineItems:   [{ productId: PRODUCT.id }],
        },
      ],
      filterProducts: [PRODUCT],
      now: ms(NEWER_DATE) + 86_400_000,   // "today" is one day after the order
    });

    assert.equal(result, null,
      'prompt must not show when the only newer trackable order is the one that registered the filter');
  });

  // B. A genuinely different order should produce a CandidateResult.
  it('B: different order id → CandidateResult returned (nudge shows)', () => {
    const result = computeRegisterCandidate({
      eligibleForRegister: false,
      eligibleForReplace:  true,
      activation: makeActivation({ sourceOrderId: 100 }),
      orders: [
        {
          id:          200,                 // ← different from sourceOrderId
          dateCreated: NEWER_DATE,
          lineItems:   [{ productId: PRODUCT.id }],
        },
      ],
      filterProducts: [PRODUCT],
      now: ms(NEWER_DATE) + 86_400_000,
    });

    assert.notEqual(result, null, 'a newer order from a different purchase must trigger the nudge');
    assert.equal(result!.mode,    'replace', 'mode must be replace');
    assert.equal(result!.orderId, 200,       'orderId must be the new order');
  });

  // C. sourceOrderId undefined (old activation) — must NOT accidentally match
  //    any real order id.  A genuine new order must still surface the nudge.
  it('C: sourceOrderId undefined → undefined !== number → new order still triggers nudge', () => {
    const result = computeRegisterCandidate({
      eligibleForRegister: false,
      eligibleForReplace:  true,
      activation: makeActivation({ sourceOrderId: undefined }),
      orders: [
        {
          id:          999,                 // any real id; undefined !== 999 → not skipped
          dateCreated: NEWER_DATE,
          lineItems:   [{ productId: PRODUCT.id }],
        },
      ],
      filterProducts: [PRODUCT],
      now: ms(NEWER_DATE) + 86_400_000,
    });

    assert.notEqual(result, null,
      'undefined sourceOrderId must not accidentally suppress a genuinely new order');
    assert.equal(result!.orderId, 999, 'the new order must be the candidate');
  });

  // D. sourceOrderId undefined, but the only order is not newer than activatedAt
  //    → the time-based break fires; result is null for the right reason.
  it('D: sourceOrderId undefined, only order pre-dates activation → null via time break', () => {
    const result = computeRegisterCandidate({
      eligibleForRegister: false,
      eligibleForReplace:  true,
      activation: makeActivation({ sourceOrderId: undefined }),
      orders: [
        {
          id:          50,
          dateCreated: SAME_DATE,           // not newer than ACTIVATED_AT → break
          lineItems:   [{ productId: PRODUCT.id }],
        },
      ],
      filterProducts: [PRODUCT],
      now: ms(ACTIVATED_AT) + 30 * 86_400_000,
    });

    assert.equal(result, null,
      'an order older than activatedAt must not trigger the nudge regardless of sourceOrderId');
  });

  // E. No orders — always null.
  it('E: no orders → null', () => {
    const result = computeRegisterCandidate({
      eligibleForRegister: false,
      eligibleForReplace:  true,
      activation: makeActivation(),
      orders:         [],
      filterProducts: [PRODUCT],
      now: ms(NEWER_DATE) + 86_400_000,
    });

    assert.equal(result, null, 'no orders → no candidate');
  });

  // F. Order exists but its date equals activatedAt — the loop uses strict
  //    <=, so this order is treated as "not newer" and breaks the loop.
  it('F: order dateCreated equals activatedAt → null (boundary: orderTime <= activationTime)', () => {
    const result = computeRegisterCandidate({
      eligibleForRegister: false,
      eligibleForReplace:  true,
      activation: makeActivation({ sourceOrderId: undefined }),
      orders: [
        {
          id:          77,
          dateCreated: ACTIVATED_AT,        // exactly equal — not strictly newer
          lineItems:   [{ productId: PRODUCT.id }],
        },
      ],
      filterProducts: [PRODUCT],
      now: ms(ACTIVATED_AT) + 86_400_000,
    });

    assert.equal(result, null,
      'an order whose date equals activatedAt is not newer and must not trigger the nudge');
  });

  // G. Register mode (no activation yet) — sourceOrderId is irrelevant;
  //    any trackable order qualifies regardless of its id.
  it('G: register mode ignores sourceOrderId — any trackable order qualifies', () => {
    const result = computeRegisterCandidate({
      eligibleForRegister: true,
      eligibleForReplace:  false,
      activation:          null,
      orders: [
        {
          id:          100,
          dateCreated: NEWER_DATE,
          lineItems:   [{ productId: PRODUCT.id }],
        },
      ],
      filterProducts: [PRODUCT],
      now: ms(NEWER_DATE) + 86_400_000,
    });

    assert.notEqual(result, null, 'register mode must find a candidate');
    assert.equal(result!.mode,    'register', 'mode must be register');
    assert.equal(result!.orderId, 100);
  });
});

describe('computeRegisterCandidate — replace mode, multiple orders', () => {

  // When the list contains both the triggering order and a new order, the new
  // one (newer date, different id) must be returned and the old one skipped.
  it('newer order wins; triggering order is skipped even when both are in the list', () => {
    const EVEN_NEWER = '2026-08-01T00:00:00.000Z';
    const result = computeRegisterCandidate({
      eligibleForRegister: false,
      eligibleForReplace:  true,
      activation: makeActivation({ sourceOrderId: 100 }),
      orders: [
        {
          id:          200,
          dateCreated: EVEN_NEWER,          // newest → checked first
          lineItems:   [{ productId: PRODUCT.id }],
        },
        {
          id:          100,                 // source order — must be skipped
          dateCreated: NEWER_DATE,
          lineItems:   [{ productId: PRODUCT.id }],
        },
      ],
      filterProducts: [PRODUCT],
      now: ms(EVEN_NEWER) + 86_400_000,
    });

    assert.notEqual(result, null, 'the new purchase must surface the nudge');
    assert.equal(result!.orderId, 200, 'order 200 (the newer, non-source order) must be the candidate');
  });

  // When the only newer order is the source order and an older order also has
  // a trackable item, the older one must NOT trigger the nudge (time break).
  it('source order is the only newer order; older order triggers break → null', () => {
    const result = computeRegisterCandidate({
      eligibleForRegister: false,
      eligibleForReplace:  true,
      activation: makeActivation({ sourceOrderId: 100, activatedAt: '2026-03-01T00:00:00.000Z' }),
      orders: [
        {
          id:          100,                 // skipped (sourceOrderId match)
          dateCreated: NEWER_DATE,          // newer than activation
          lineItems:   [{ productId: PRODUCT.id }],
        },
        {
          id:          50,
          dateCreated: '2026-02-01T00:00:00.000Z', // before activation → break
          lineItems:   [{ productId: PRODUCT.id }],
        },
      ],
      filterProducts: [PRODUCT],
      now: ms(NEWER_DATE) + 86_400_000,
    });

    assert.equal(result, null,
      'after skipping the source order the loop must break on the older order — no nudge');
  });
});
