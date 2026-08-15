import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ApiError } from '../apiError.js';
import {
  RATE_LIMIT_MESSAGE,
  RATE_LIMIT_TITLE,
  isRateLimitError,
  classifyPaymentInitError,
  authErrorMessage,
} from '../rateLimitAlert.js';

// ── Task 250: 'Too many attempts' after rapid login / checkout taps ──────────
//
// The screens show these classifications verbatim:
//   - login.tsx / register.tsx: Alert.alert(title, error) with NO buttons array
//     → React Native renders a single default OK button, so success here means
//     "OK-only alert" on the screen.
//   - checkout.tsx (Paystack init / Stripe session / M-Pesa STK push): a
//     'rate_limited' classification maps to Alert.alert(title, message) with
//     NO buttons array (no "Try again" / "Pay with COD"); only 'retry_dialog'
//     ever renders retry buttons. The M-Pesa handler returns before the code
//     that closes the modal, so the phone number is preserved.

// ── ApiError flags ────────────────────────────────────────────────────────────

describe('ApiError — 429 flags', () => {
  it('sets rateLimited=true and retryable=false for a 429', () => {
    const e = new ApiError('Too many requests', 429, {});
    assert.equal(e.rateLimited, true, '429 must be flagged rateLimited');
    assert.equal(e.retryable, false, 'a rate-limited request must never be retryable');
  });

  it('429 stays non-retryable even if the server sets retryable:true', () => {
    const e = new ApiError('Too many requests', 429, { retryable: true });
    assert.equal(e.retryable, false, 'rate limit wins over the server retryable flag');
  });

  it('5xx is retryable and not rateLimited', () => {
    const e = new ApiError('boom', 500, {});
    assert.equal(e.rateLimited, false);
    assert.equal(e.retryable, true);
  });

  it('402 (declined) is neither retryable nor rateLimited', () => {
    const e = new ApiError('declined', 402, {});
    assert.equal(e.rateLimited, false);
    assert.equal(e.retryable, false);
  });
});

// ── isRateLimitError ──────────────────────────────────────────────────────────

describe('isRateLimitError', () => {
  it('detects an ApiError 429', () => {
    assert.equal(isRateLimitError(new ApiError('x', 429, {})), true);
  });
  it('rejects non-429 ApiErrors, plain Errors, and junk', () => {
    assert.equal(isRateLimitError(new ApiError('x', 500, {})), false);
    assert.equal(isRateLimitError(new Error('network')), false);
    assert.equal(isRateLimitError(null), false);
    assert.equal(isRateLimitError('429'), false);
  });
});

// ── Checkout classification (Paystack init / Stripe session / M-Pesa push) ───

describe('classifyPaymentInitError — checkout handlers', () => {
  it('429 → rate_limited with the exact required wording (OK-only alert, no retry buttons)', () => {
    const action = classifyPaymentInitError(new ApiError('Too many requests', 429, {}));
    assert.equal(action.kind, 'rate_limited');
    if (action.kind !== 'rate_limited') return;
    assert.equal(action.title, RATE_LIMIT_TITLE);
    assert.equal(
      action.message,
      'Too many attempts. Please wait a minute before trying again.',
      'wording must match the task-188 contract exactly',
    );
    assert.equal(action.message, RATE_LIMIT_MESSAGE, 'constant must carry the same wording');
  });

  it('5xx → retry_dialog (the only kind that shows Try again / COD buttons)', () => {
    assert.equal(classifyPaymentInitError(new ApiError('boom', 500, {})).kind, 'retry_dialog');
  });

  it('network error (plain Error) → retry_dialog (preserves existing behaviour)', () => {
    assert.equal(classifyPaymentInitError(new Error('fetch failed')).kind, 'retry_dialog');
  });

  it('402 decline → declined (no retry, but not the rate-limit message)', () => {
    assert.equal(classifyPaymentInitError(new ApiError('declined', 402, {})).kind, 'declined');
  });

  it('rate_limited never classifies as retry_dialog, so no retry button can render', () => {
    // Guard against a regression that reorders the branches: for every 429
    // variant the classification must be rate_limited, never retry_dialog.
    for (const body of [{}, { retryable: true }, { error: 'slow down' }]) {
      const action = classifyPaymentInitError(new ApiError('x', 429, body));
      assert.equal(action.kind, 'rate_limited', `429 with body ${JSON.stringify(body)}`);
    }
  });
});

// ── Login / register screens (AuthContext → Alert with default OK button) ────

describe('authErrorMessage — login & register 429', () => {
  it('login: 429 with no server message → exact required wording', () => {
    assert.equal(
      authErrorMessage(429, false, undefined, 'Login failed'),
      'Too many attempts. Please wait a minute before trying again.',
    );
  });

  it('register: 429 with no server message → same wording', () => {
    assert.equal(authErrorMessage(429, false, undefined, 'Registration failed'), RATE_LIMIT_MESSAGE);
  });

  it('429 prefers the server-provided message when present', () => {
    assert.equal(authErrorMessage(429, false, 'Please wait 60s', 'Login failed'), 'Please wait 60s');
  });

  it('non-429 failures fall back to the screen-specific message', () => {
    assert.equal(authErrorMessage(401, false, undefined, 'Login failed'), 'Login failed');
    assert.equal(authErrorMessage(400, false, 'Email taken', 'Registration failed'), 'Email taken');
  });

  it('success → null (no alert)', () => {
    assert.equal(authErrorMessage(200, true, undefined, 'Login failed'), null);
  });
});
