import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import ts from 'typescript';

// Execute the screen's actual handler with boundary stubs, without rendering
// the entire checkout or opening a real payment page.
const screen = readFileSync(new URL('../../app/checkout.tsx', import.meta.url), 'utf8');
const start = screen.indexOf('  async function handleStripeCheckout()');
const end = screen.indexOf('\n  /**', start);
assert.ok(start >= 0 && end > start);
const handler = ts.transpileModule(screen.slice(start, end), {
  compilerOptions: { target: ts.ScriptTarget.ES2022 },
}).outputText;

class ApiError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

function harness(error: Error, initFails = false) {
  const alerts: { title: string; message: string; buttons: { text: string; onPress: () => unknown; style?: string }[] }[] = [];
  const processing: boolean[] = [];
  const methods: string[] = [];
  let sessions = 0;
  let browserOpens = 0;
  const references: string[] = [];
  const run = new Function(
    'api', 'WebBrowser', 'createOrder', 'setProcessing', 'checkoutPaymentInput',
    'total', 'Alert', 'changePaymentMethod', 'classifyPaymentInitError', 'ApiError',
    `${handler}\nreturn handleStripeCheckout;`,
  )(
    { stripeSession: async () => {
      sessions++;
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
    () => ({ kind: 'retry_dialog' }),
    ApiError,
  ) as () => Promise<void>;
  return { run, alerts, processing, methods, references,
    get sessions() { return sessions; }, get browserOpens() { return browserOpens; } };
}

test('unpaid Stripe checkout offers a working retry and guarded COD switch', async () => {
  for (const reason of ['Stripe session status: unpaid', 'Stripe payment was not completed. No order was created.']) {
    const h = harness(new ApiError(reason, 402));
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
  const h = harness(new ApiError('Verified payment does not match this checkout total or currency', 402));
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
  let cancellations = 0;
  const unexpectedMutation = () => assert.fail('Must not clear payment state or switch to COD');
  const change = new Function(
    'paymentMethod', 'processing', 'paymentFrozen', 'paymentInputRef',
    'orderIdentityRef', 'lastCheckoutRequestIdRef', 'api', 'Alert',
    'setPaymentFrozen', 'cancelMpesaPoll', 'attemptRef', 'pollRef',
    'setMpesaWaiting', 'setProcessing', 'setPaymentMethod',
    `${methodHandler}\nreturn changePaymentMethod;`,
  )(
    'stripe', false, true, input, identity, { current: null },
    { cancelCheckout: async (key: string) => {
      assert.equal(key, 'stable-checkout');
      cancellations++;
      const result = await release(order, 'customer');
      assert.equal(result, 'retained');
      throw new ApiError('Resume the original payment before changing method.', 409);
    } },
    { alert: (title: string) => alerts.push(title) },
    unexpectedMutation, unexpectedMutation, { current: 0 }, { current: null },
    unexpectedMutation, unexpectedMutation, unexpectedMutation,
  );
  await change('cod');
  assert.equal(cancellations, 1);
  assert.deepEqual(alerts, ['Payment still pending']);
  assert.equal(input.current?.idempotencyKey, 'stable-checkout');
  assert.equal(identity.current?.idempotencyKey, 'stable-checkout');
});