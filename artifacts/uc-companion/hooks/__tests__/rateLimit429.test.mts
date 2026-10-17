import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { checkoutHandlerScope } from './fixtures/checkoutHandlerScope.mts';
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

// ── Checkout classification (payment init and Paystack verification) ─────────

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

describe('classifyPaymentInitError — Paystack verify path', () => {
  it('429 keeps verification in the OK-only rate-limit branch instead of decline or retry', () => {
    const originalReference = 'paystack_verify_ref_123';
    const action = classifyPaymentInitError(
      new ApiError(`Verification rate-limited for ${originalReference}`, 429, {}),
    );

    assert.deepEqual(action, {
      kind: 'rate_limited',
      title: RATE_LIMIT_TITLE,
      message: RATE_LIMIT_MESSAGE,
    });
    assert.equal(originalReference, 'paystack_verify_ref_123');
  });
});

// Execute the production screen handlers, not a copy of their retry logic.
// Only API, browser and UI boundaries are stubbed; no payment is issued.
const checkoutSource = readFileSync(new URL('../../app/checkout.tsx', import.meta.url), 'utf8');
const checkoutAst = ts.createSourceFile('checkout.tsx', checkoutSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const handlerNames = new Set(['handleConfirm', 'handlePaystack', 'handlePaystackVerify']);
const handlerSource: string[] = [];
function collectHandlers(node: ts.Node) {
  if (ts.isFunctionDeclaration(node) && node.name && handlerNames.has(node.name.text)) {
    handlerSource.push(node.getText(checkoutAst));
  }
  ts.forEachChild(node, collectHandlers);
}
collectHandlers(checkoutAst);
assert.equal(handlerSource.length, handlerNames.size, 'All checkout handlers must be present');
const checkoutHandlers = ts.transpileModule(handlerSource.join('\n'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022 },
}).outputText;

describe('checkout handlers — Paystack verification 429 recovery', () => {
  for (const body of [{}, { retryable: true }]) {
    it(`dismisses 429 with default OK and manually verifies the original reference (${JSON.stringify(body)})`, async () => {
      const originalReference = 'paystack_original_payment_123';
      const alerts: unknown[][] = [];
      const verifications: string[] = [];
      const orders: { method: string; reference: string }[] = [];
      let initializations = 0;
      let browserOpens = 0;
      const state = {
        ...checkoutHandlerScope(),
        processing: false, paymentMethod: 'paystack', total: 100,
        fulfillment: 'collection', baseQuote: { total: 100 }, quoteCurrent: true,
        quoteLoading: false, quoteError: '', user: { email: 'customer@example.test' },
        paystackVerifyAttemptRef: { current: 0 },
        paystackVerifyingRef: { current: false },
        pendingPaystackReferenceRef: { current: null as string | null },
        paymentMethodChangingRef: { current: false },
        validateAddress: () => true,
        checkoutPaymentInput: () => ({ idempotencyKey: 'original-checkout' }),
        setProcessing(value: boolean) { state.processing = value; },
        Haptics: { ImpactFeedbackStyle: { Medium: 'medium' }, impactAsync() {} },
        Alert: { alert(...args: unknown[]) { alerts.push(args); } },
        ApiError, classifyPaymentInitError,
        changePaymentMethod: () => assert.fail('429 must not offer a payment-method switch'),
        createOrder: async (method: string, reference: string) => {
          orders.push({ method, reference });
          return true;
        },
        WebBrowser: { openBrowserAsync: async () => { browserOpens++; } },
        api: {
          paystackInit: async () => {
            initializations++;
            return { authorizationUrl: 'https://paystack.example.test/checkout', reference: originalReference };
          },
          paystackVerify: async (reference: string) => {
            verifications.push(reference);
            // Two rate limits ensure the ref also survives repeated manual retries.
            if (verifications.length <= 2) throw new ApiError('Too many requests', 429, body);
            return { success: true, status: 'success' };
          },
        },
      };
      // Mutable scope models checkout re-renders while refs persist.
      const { handleConfirm } = new Function('scope', `with (scope) {
        ${checkoutHandlers}
        return { handleConfirm };
      }`)(state);

      for (let attempt = 1; attempt <= 2; attempt++) {
        await handleConfirm(); // The real checkout button path, not the verify helper.
        assert.deepEqual(alerts[attempt - 1], [RATE_LIMIT_TITLE, RATE_LIMIT_MESSAGE],
          'Exactly two alert arguments: default OK, no Try again or COD buttons');
        assert.equal(state.processing, false, 'Manual retry must be available after dismissal');
        assert.equal(state.paystackVerifyingRef.current, false);
        assert.equal(state.pendingPaystackReferenceRef.current, originalReference);
        assert.deepEqual(orders, [], 'A rate limit cannot create an order');
        assert.equal(initializations, 1, 'Manual retry must not initialize another payment');
        assert.equal(browserOpens, 1, 'Manual retry must not reopen hosted checkout');
        assert.deepEqual(verifications, Array(attempt).fill(originalReference));
      }

      await handleConfirm(); // A later manual retry after the wait succeeds.
      assert.deepEqual(verifications, [originalReference, originalReference, originalReference]);
      assert.equal(initializations, 1);
      assert.equal(browserOpens, 1);
      assert.equal(alerts.length, 2);
      assert.deepEqual(orders, [{ method: 'paystack', reference: originalReference }]);
      assert.equal(state.pendingPaystackReferenceRef.current, null);
      assert.equal(state.processing, false);
    });
  }
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
