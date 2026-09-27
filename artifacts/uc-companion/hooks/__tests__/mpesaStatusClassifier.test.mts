/**
 * Unit tests for the M-Pesa status response classifier.
 *
 * Covers:
 *   (a) status="success"               → create_order (no dialog)
 *   (b) status="pending"               → continue_polling (no dialog)
 *   (c) status="failed", retriable=false → hint_dialog (wrong PIN / cancelled / funds)
 *   (d) status="failed", retriable=true  → retry_dialog (DS timeout / unknown transient)
 *   (e) status="failed", no retriable    → retry_dialog (missing flag defaults to retriable)
 *   (f) resultDesc surfaced in dialog messages
 *   (g) fallback messages when resultDesc is absent
 *
 * Tests import the REAL classifyMpesaStatus from hooks/mpesaStatusClassifier.ts
 * so any change to the decision tree in that module will immediately break
 * these tests — including changes that propagate into checkout.tsx, which
 * calls classifyMpesaStatus directly.
 *
 * Run with: pnpm --filter @workspace/uc-companion test
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { classifyMpesaStatus, type MpesaStatusResponse } from '../mpesaStatusClassifier.js';

// ── (a) success → create_order ────────────────────────────────────────────────

describe('classifyMpesaStatus — success', () => {
  it('returns create_order for status="success"', () => {
    const action = classifyMpesaStatus({ status: 'success' });
    assert.equal(action.kind, 'create_order', 'success must produce create_order — happy path');
  });

  it('ignores resultDesc when status is success', () => {
    const action = classifyMpesaStatus({ status: 'success', resultDesc: 'The service request is processed successfully.' });
    assert.equal(action.kind, 'create_order');
  });
});

// ── (b) pending → continue_polling ───────────────────────────────────────────

describe('classifyMpesaStatus — pending', () => {
  it('returns continue_polling for status="pending"', () => {
    const action = classifyMpesaStatus({ status: 'pending' });
    assert.equal(action.kind, 'continue_polling', 'pending must produce continue_polling — interval keeps running');
  });
});

// ── (c) failed + retriable=false → hint_dialog ───────────────────────────────
// Covers the NON_RETRIABLE_CODES behaviours: wrong PIN (2001), user cancelled
// (1032), and insufficient funds (1) — all map to retriable=false on the server.

describe('classifyMpesaStatus — failed, retriable=false (definitive decline)', () => {
  it('returns hint_dialog with "Payment Not Completed" title', () => {
    const action = classifyMpesaStatus({ status: 'failed', retriable: false });
    assert.equal(
      action.kind,
      'hint_dialog',
      'retriable=false must produce hint_dialog — no retry buttons',
    );
    if (action.kind !== 'hint_dialog') return; // narrow type
    assert.equal(action.title, 'Payment Not Completed');
  });

  it('hint_dialog message includes the Safaricom-app PIN hint', () => {
    const action = classifyMpesaStatus({
      status: 'failed',
      retriable: false,
      resultDesc: 'The initiator information is invalid.',
    });
    if (action.kind !== 'hint_dialog') {
      assert.fail(`Expected hint_dialog, got ${action.kind}`);
    }
    assert.ok(
      action.message.includes('Safaricom app'),
      'hint_dialog must tell the user to verify their PIN in the Safaricom app',
    );
  });

  it('hint_dialog message includes the server resultDesc', () => {
    const desc = 'Request cancelled by user';
    const action = classifyMpesaStatus({ status: 'failed', retriable: false, resultDesc: desc });
    if (action.kind !== 'hint_dialog') {
      assert.fail(`Expected hint_dialog, got ${action.kind}`);
    }
    assert.ok(
      action.message.includes(desc),
      'hint_dialog must surface the server resultDesc so the user sees the specific reason',
    );
  });

  it('hint_dialog message uses a fallback when resultDesc is absent', () => {
    const action = classifyMpesaStatus({ status: 'failed', retriable: false });
    if (action.kind !== 'hint_dialog') {
      assert.fail(`Expected hint_dialog, got ${action.kind}`);
    }
    assert.ok(
      action.message.length > 0,
      'hint_dialog must have a non-empty fallback message',
    );
  });

  it('all three non-retriable result codes produce hint_dialog', () => {
    // resultDesc matches what the server sends for each code
    const cases: MpesaStatusResponse[] = [
      { status: 'failed', retriable: false, resultDesc: 'The balance is insufficient for the transaction' },         // code 1
      { status: 'failed', retriable: false, resultDesc: 'Request cancelled by user' },                               // code 1032
      { status: 'failed', retriable: false, resultDesc: 'The initiator information is invalid.' },                   // code 2001
    ];
    for (const resp of cases) {
      const action = classifyMpesaStatus(resp);
      assert.equal(
        action.kind,
        'hint_dialog',
        `retriable=false with resultDesc "${resp.resultDesc}" must produce hint_dialog`,
      );
    }
  });
});

// ── (d) failed + retriable=true → retry_dialog ───────────────────────────────
// Covers the transient code 1037 (DS timeout) and any unknown future codes.

describe('classifyMpesaStatus — failed, retriable=true (transient error)', () => {
  it('returns retry_dialog with "M-Pesa Failed" title', () => {
    const action = classifyMpesaStatus({ status: 'failed', retriable: true });
    assert.equal(
      action.kind,
      'retry_dialog',
      'retriable=true must produce retry_dialog — offer Try again / COD',
    );
    if (action.kind !== 'retry_dialog') return;
    assert.equal(action.title, 'M-Pesa Failed');
  });

  it('retry_dialog message includes the server resultDesc when present', () => {
    const desc = 'DS timeout user cannot be reached';
    const action = classifyMpesaStatus({ status: 'failed', retriable: true, resultDesc: desc });
    if (action.kind !== 'retry_dialog') {
      assert.fail(`Expected retry_dialog, got ${action.kind}`);
    }
    assert.ok(
      action.message.includes(desc),
      'retry_dialog must surface the server resultDesc verbatim',
    );
  });

  it('retry_dialog message falls back to COD hint when resultDesc is absent', () => {
    const action = classifyMpesaStatus({ status: 'failed', retriable: true });
    if (action.kind !== 'retry_dialog') {
      assert.fail(`Expected retry_dialog, got ${action.kind}`);
    }
    assert.ok(
      action.message.includes('Cash on Delivery') || action.message.includes('COD'),
      'retry_dialog fallback must mention COD as an alternative',
    );
  });
});

// ── (e) failed + no retriable field → retry_dialog (safe default) ─────────────
// The server always sets retriable, but a missing field should default to
// retriable behaviour to avoid a silent dead end.

describe('classifyMpesaStatus — failed, retriable field absent (safe default)', () => {
  it('returns retry_dialog when retriable is not present in the response', () => {
    const resp: MpesaStatusResponse = { status: 'failed' };
    const action = classifyMpesaStatus(resp);
    assert.equal(
      action.kind,
      'retry_dialog',
      'absent retriable must default to retry_dialog — never leave the user with a silent dead end',
    );
  });
});

// ── (f) resultDesc is propagated faithfully ───────────────────────────────────

describe('classifyMpesaStatus — resultDesc propagation', () => {
  it('propagates resultDesc into hint_dialog message for non-retriable failures', () => {
    const desc = 'Custom server message for wrong PIN';
    const action = classifyMpesaStatus({ status: 'failed', retriable: false, resultDesc: desc });
    if (action.kind !== 'hint_dialog') assert.fail(`Expected hint_dialog`);
    assert.ok(action.message.includes(desc));
  });

  it('propagates resultDesc into retry_dialog message for retriable failures', () => {
    const desc = 'Custom server message for DS timeout';
    const action = classifyMpesaStatus({ status: 'failed', retriable: true, resultDesc: desc });
    if (action.kind !== 'retry_dialog') assert.fail(`Expected retry_dialog`);
    assert.ok(action.message.includes(desc));
  });
});
