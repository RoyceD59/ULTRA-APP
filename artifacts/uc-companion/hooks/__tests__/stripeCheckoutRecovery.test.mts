import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import ts from 'typescript';
import { ApiError } from '../apiError.ts';
import { classifyPaymentInitError } from '../rateLimitAlert.ts';

// Execute the screen's actual handler with boundary stubs, without rendering
// the entire checkout or opening a real payment page.
const screen = readFileSync(new URL('../../app/checkout.tsx', import.meta.url), 'utf8');
const start = screen.indexOf('  async function handleStripeCheckout()');
const end = screen.indexOf('\n  /**', start);
assert.ok(start >= 0 && end > start);
const handler = ts.transpileModule(screen.slice(start, end), {
  compilerOptions: { target: ts.ScriptTarget.ES2022 },
}).outputText;

// Exercise the real POST/error deserialization and Stripe endpoint wrapper,
// replacing only fetch and hook dependencies. No Stripe account is contacted.
const apiSource = readFileSync(new URL('../useApi.ts', import.meta.url), 'utf8');
function apiSection(from: string, to: string) {
  const start = apiSource.indexOf(from);
  const end = apiSource.indexOf(to, start);
  assert.ok(start >= 0 && end > start, `Missing API section: ${from}`);
  return apiSource.slice(start, end);
}
const transport = ts.transpileModule([
  apiSection('  const throwResponseError =', '  const get ='),
  apiSection('  const post =', '  const put ='),
  `return { ${apiSection('    stripeSession:', '    stripeSessionStatus:')} };`,
].join('\n'), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;

function failingSessionEndpoint(status: number, body: Record<string, unknown>) {
  return new Function(
    'fetch', 'getApiBase', 'authHeaders', 'useCallback', 'ApiError',
    'token', 'handleRejectedSessionResponse', transport,
  )(
    async (url: string, options: RequestInit) => {
      assert.equal(url, 'https://api.example.test/api/payments/stripe/session');
      assert.equal(options.method, 'POST');
      const request = JSON.parse(String(options.body));
      assert.equal(request.amount, 100);
      assert.match(request.orderId, /^cart_\d+$/);
      assert.equal(request.checkout.idempotencyKey, 'stable-checkout');
      return new Response(JSON.stringify(body), {
        status, headers: { 'Content-Type': 'application/json' },
      });
    },
    () => 'https://api.example.test',
    () => ({ 'Content-Type': 'application/json' }),
    (callback: unknown) => callback,
    ApiError, null, async () => {},
  ).stripeSession as (...args: unknown[]) => Promise<never>;
}

function harness(error: Error, initFails = false, sessionEndpoint?: (...args: unknown[]) => Promise<never>) {
  const alerts: { title: string; message: string; buttons: { text: string; onPress: () => unknown; style?: string }[] }[] = [];
  const processing: boolean[] = [];
  const methods: string[] = [];
  const initiationErrors: unknown[] = [];
  let sessions = 0;
  let browserOpens = 0;
  const references: string[] = [];
  const run = new Function(
    'api', 'WebBrowser', 'createOrder', 'setProcessing', 'checkoutPaymentInput',
    'total', 'Alert', 'changePaymentMethod', 'classifyPaymentInitError', 'ApiError',
    `${handler}\nreturn handleStripeCheckout;`,
  )(
    { stripeSession: async (...args: unknown[]) => {
      sessions++;
      if (sessionEndpoint) {
        try { return await sessionEndpoint(...args); }
        catch (error) { initiationErrors.push(error); throw error; }
      }
      if (initFails) throw error;
      return { sessionUrl: 'https://checkout.stripe.com/test', sessionId: 'cs_test' };
    } },
    { openBrowserAsync: async () => { browserOpens++; } },
    async (method: string, reference: string) => {
      assert.equal(method, 'stripe');
      references.push(reference);
      throw error;
    },
    (value: boolean) => processing.push(value),
    () => ({ idempotencyKey: 'stable-checkout' }),
    100,
    { alert: (title: string, message: string, buttons: typeof alerts[number]['buttons']) => alerts.push({ title, message, buttons }) },
    async (method: string) => { methods.push(method); },
    classifyPaymentInitError,
    ApiError,
  ) as () => Promise<void>;
  return { run, alerts, processing, methods, references, initiationErrors,
    get sessions() { return sessions; }, get browserOpens() { return browserOpens; } };
}

test('unpaid Stripe checkout offers a working retry and guarded COD switch', async () => {
  for (const reason of ['Stripe session status: unpaid', 'Stripe payment was not completed. No order was created.']) {
    const h = harness(new ApiError(reason, 402, {}));
    await h.run();
    const alert = h.alerts[0];
    assert.equal(alert.title, 'Payment not confirmed');
    assert.match(alert.message, /closed Stripe checkout before completing payment/);
    assert.match(alert.message, /No order was created/);
    assert.deepEqual(alert.buttons.map(b => b.text), ['Try again', 'Pay with COD instead']);
    assert.equal(h.processing.at(-1), false);
    assert.deepEqual(h.references, ['cs_test']);
    await alert.buttons[0].onPress();
    assert.equal(h.sessions, 2);
    assert.equal(h.browserOpens, 2);
    alert.buttons[1].onPress();
    assert.deepEqual(h.methods, ['cod']);
    assert.equal(alert.buttons[1].style, 'cancel');
  }
});

test('other verification errors do not claim the customer closed without paying', async () => {
  const h = harness(new ApiError('Verified payment does not match this checkout total or currency', 402, {}));
  await h.run();
  assert.equal(h.alerts[0].message, 'Verified payment does not match this checkout total or currency');
  assert.doesNotMatch(h.alerts[0].message, /closed|No order/);
  assert.equal(h.processing.at(-1), false);
});

test('Stripe initiation connection failure retains distinct unavailable copy', async () => {
  const h = harness(new Error('Network request failed'), true);
  await h.run();
  assert.equal(h.alerts[0].title, 'Stripe Unavailable');
  assert.match(h.alerts[0].message, /could not be opened/);
  assert.doesNotMatch(h.alerts[0].message, /closed|No order/);
  assert.equal(h.browserOpens, 0);
  assert.equal(h.processing.at(-1), false);
});

test('Stripe session 503 with retryable true offers Try again and COD', async () => {
  const h = harness(new Error('Order creation must not run'), false,
    failingSessionEndpoint(503, { error: 'Stripe is temporarily down', retryable: true }));
  await h.run();
  assert.ok(h.initiationErrors[0] instanceof ApiError);
  assert.equal(h.initiationErrors[0].status, 503);
  assert.equal(h.initiationErrors[0].retryable, true);
  assert.equal(h.alerts.length, 1);
  const alert = h.alerts[0];
  assert.equal(alert.title, 'Stripe Unavailable');
  assert.equal(alert.message,
    'Stripe checkout could not be opened. You can try again or place your order with Cash on Delivery.');
  assert.deepEqual(alert.buttons.map(button => button.text), ['Try again', 'Pay with COD instead']);
  assert.deepEqual(h.processing, [true, false]);
  assert.equal(h.browserOpens, 0);
  assert.deepEqual(h.references, []);
  await alert.buttons[0].onPress();
  assert.equal(h.sessions, 2);
  assert.equal(h.alerts[1].title, 'Stripe Unavailable');
  await alert.buttons[1].onPress();
  assert.deepEqual(h.methods, ['cod']);
});

test('Stripe session 402 with retryable false shows card guidance without retry buttons', async () => {
  const message = 'Your payment could not be completed. Please check your card details and try a different payment method.';
  const h = harness(new Error('Order creation must not run'), false,
    failingSessionEndpoint(402, { error: message, retryable: false }));
  await h.run();
  assert.ok(h.initiationErrors[0] instanceof ApiError);
  assert.equal(h.initiationErrors[0].status, 402);
  assert.equal(h.initiationErrors[0].retryable, false);
  assert.equal(h.alerts.length, 1);
  assert.equal(h.alerts[0].title, 'Payment Declined');
  assert.equal(h.alerts[0].message, message);
  // Omitting the button argument leaves only React Native's default dismissal.
  assert.equal(h.alerts[0].buttons, undefined);
  assert.deepEqual(h.processing, [true, false]);
  assert.equal(h.sessions, 1);
  assert.equal(h.browserOpens, 0);
  assert.deepEqual(h.references, []);
  assert.deepEqual(h.methods, []);
});

test('actual COD method-change guard retains an open unpaid Stripe checkout', async () => {
  // Execute both production guards. An unpaid but still-open hosted session
  // is not terminal failure and must never release the checkout reservation.
  const cancellationSource = readFileSync(
    new URL('../../../api-server/src/lib/checkout-cancellation.ts', import.meta.url), 'utf8',
  ).replace(/^import .*;\r?\n/gm, '').replace(/export /g, '');
  const cancellation = ts.transpileModule(cancellationSource, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const release = new Function('pool', 'verifyPaymentOnServer',
    `${cancellation}\nreturn releaseUnsuccessfulCheckout;`)(
    { connect() { assert.fail('An open Stripe session must not reach the release transaction'); } },
    async (method: string, reference: string) => {
      assert.equal(method, 'stripe');
      assert.equal(reference, 'cs_open');
      return { ok: false, failureFinal: false, reason: 'Stripe session status: unpaid' };
    },
  );
  const order = {
    status: 'pending', checkout_state: 'payment_pending',
    checkout_snapshot: { provider: { reference: 'cs_open' } },
    payment_method: 'stripe', payment_reference: 'cs_open',
  };
  const methodStart = screen.indexOf('  async function changePaymentMethod(');
  const methodEnd = screen.indexOf('\n  function validateAddress', methodStart);
  assert.ok(methodStart >= 0 && methodEnd > methodStart);
  const methodHandler = ts.transpileModule(screen.slice(methodStart, methodEnd), {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const input = { current: { idempotencyKey: 'stable-checkout' } };
  const identity = { current: { idempotencyKey: 'stable-checkout' } };
  const alerts: string[] = [];
  const busy: boolean[] = [];
  let cancellations = 0;
  const unexpectedMutation = () => assert.fail('Must not clear payment state or switch to COD');
  const change = new Function(
    'paymentMethod', 'processing', 'paymentFrozen', 'paymentInputRef',
    'orderIdentityRef', 'lastCheckoutRequestIdRef', 'api', 'Alert',
    'setPaymentFrozen', 'cancelMpesaPoll', 'attemptRef', 'pollRef',
    'setMpesaWaiting', 'setProcessing', 'setPaymentMethod',
    'paystackVerifyAttemptRef', 'paystackVerifyingRef', 'paymentMethodChangingRef',
    `${methodHandler}\nreturn changePaymentMethod;`,
  )(
    'stripe', false, true, input, identity, { current: null },
    { cancelCheckout: async (key: string) => {
      assert.equal(key, 'stable-checkout');
      cancellations++;
      const result = await release(order, 'customer');
      assert.equal(result, 'retained');
      throw new ApiError('Resume the original payment before changing method.', 409, {});
    } },
    { alert: (title: string) => alerts.push(title) },
    unexpectedMutation, unexpectedMutation, { current: 0 }, { current: null },
    unexpectedMutation, (value: boolean) => busy.push(value), unexpectedMutation,
    { current: 0 }, { current: false }, { current: false },
  );
  await change('cod');
  assert.equal(cancellations, 1);
  assert.deepEqual(alerts, ['Payment still pending']);
  assert.deepEqual(busy, [true, false]);
  assert.equal(input.current?.idempotencyKey, 'stable-checkout');
  assert.equal(identity.current?.idempotencyKey, 'stable-checkout');
});