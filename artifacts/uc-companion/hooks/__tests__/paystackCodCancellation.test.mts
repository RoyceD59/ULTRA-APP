import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import ts from 'typescript';
import { ApiError } from '../apiError.ts';
import { classifyPaymentInitError } from '../rateLimitAlert.ts';

// Run the production handlers, including the real alert callbacks, with only
// API/browser/UI boundaries stubbed. Deferred requests reproduce the race.
const source = readFileSync(new URL('../../app/checkout.tsx', import.meta.url), 'utf8');
function section(from: string, to: string) {
  const start = source.indexOf(from);
  const end = source.indexOf(to, start);
  assert.ok(start >= 0 && end > start);
  return source.slice(start, end);
}
const handlers = ts.transpileModule([
  section('  async function changePaymentMethod(', '\n  function validateAddress'),
  section('  async function handleConfirm(', '\n  /**'),
  section('  async function handlePaystackVerify(', '\n  async function applyPromoCode'),
].join('\n'), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

type Verification = { success: boolean; status: string | null };
type Button = { text: string; onPress: () => Promise<void> | void };
function harness() {
  const retry = deferred<Verification>();
  const cancellation = deferred<void>();
  const alerts: { title: string; buttons?: Button[] }[] = [];
  const orders: string[] = [];
  const references: string[] = [];
  const cancellations: string[] = [];
  const state = {
    processing: false, paymentFrozen: false, paymentMethod: 'paystack',
    paymentInputRef: { current: null as { idempotencyKey: string } | null },
    orderIdentityRef: { current: null as { idempotencyKey: string } | null },
    lastCheckoutRequestIdRef: { current: null },
    paystackVerifyAttemptRef: { current: 0 },
    paystackVerifyingRef: { current: false },
    pendingPaystackReferenceRef: { current: null as string | null },
    paymentMethodChangingRef: { current: false },
    attemptRef: { current: 0 }, pollRef: { current: null },
    total: 100, user: { email: 'customer@example.test' },
    fulfillment: 'collection', baseQuote: { total: 100 }, quoteCurrent: true,
    quoteLoading: false, quoteError: '', validateAddress: () => true,
    Haptics: { ImpactFeedbackStyle: { Medium: 'medium' }, impactAsync() {} },
    setProcessing(value: boolean) { state.processing = value; },
    setPaymentFrozen(value: boolean) { state.paymentFrozen = value; },
    setPaymentMethod(value: string) { state.paymentMethod = value; },
    setMpesaWaiting() {}, clearMpesaRetryCheck() {},
    cancelMpesaPoll() {},
    checkoutPaymentInput() {
      state.paymentInputRef.current = { idempotencyKey: 'original-checkout' };
      state.orderIdentityRef.current = state.paymentInputRef.current;
      state.paymentFrozen = true;
      return state.paymentInputRef.current;
    },
    createOrder: async (method: string) => { orders.push(method); },
    Alert: { alert(title: string, _message: string, buttons?: Button[]) { alerts.push({ title, buttons }); } },
    classifyPaymentInitError,
    WebBrowser: { openBrowserAsync: async () => { browserOpens++; return { type: 'cancel' }; } },
    api: {
      paystackInit: async () => { initializations++; return { authorizationUrl: 'https://paystack.example.test', reference: 'original-reference' }; },
      paystackVerify: async (reference: string) => {
        references.push(reference);
        if (references.length === 1) throw new ApiError('Verification unavailable', 500, { retryable: true });
        return retry.promise;
      },
      cancelCheckout: async (key: string) => { cancellations.push(key); return cancellation.promise; },
    },
  };
  let browserOpens = 0;
  let initializations = 0;
  // A mutable scope models React re-renders rather than freezing processing at
  // its initial value. Old alert callbacks still retain their attempt token.
  const run = new Function('scope', `with (scope) { ${handlers}
    return { handlePaystack, handlePaystackVerify, changePaymentMethod, handleConfirm }; }`)(state);
  return { state, run, retry, cancellation, alerts, orders, references, cancellations,
    get browserOpens() { return browserOpens; }, get initializations() { return initializations; } };
}

async function abandonAndRetry(h: ReturnType<typeof harness>) {
  await h.run.handlePaystack();
  assert.equal(h.browserOpens, 1);
  assert.equal(h.initializations, 1);
  assert.equal(h.state.processing, false);
  assert.equal(h.alerts.length, 1);
  assert.equal(h.alerts[0].title, 'Paystack Unavailable');
  const buttons = h.alerts[0].buttons!;
  assert.deepEqual(buttons.map(button => button.text), ['Try again', 'Pay with COD instead']);
  const pending = buttons[0].onPress();
  assert.equal(h.state.processing, true);
  assert.deepEqual(h.references, ['original-reference', 'original-reference']);
  return { pending, buttons };
}

for (const lateResult of ['abandoned', 'success', 'failed', 'error'] as const) {
  test(`abandoned browser → verify 500 → COD during retry ignores late ${lateResult}`, async () => {
    const h = harness();
    const { pending, buttons } = await abandonAndRetry(h);
    // The alert's COD callback uses the real server-guarded method switch.
    buttons[1].onPress();
    assert.deepEqual(h.cancellations, ['original-checkout']);
    assert.equal(h.state.processing, true); // only while cancellation is pending
    h.cancellation.resolve();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(h.state.paymentMethod, 'cod');
    assert.equal(h.state.processing, false);
    assert.equal(h.state.paymentFrozen, false);
    assert.equal(h.state.paymentInputRef.current, null);
    assert.equal(h.state.orderIdentityRef.current, null);
    // Simulate a fresh COD confirmation already showing its own spinner.
    h.state.processing = true;
    if (lateResult === 'error') h.retry.reject(new ApiError('Late server error', 500, {}));
    else h.retry.resolve({ success: lateResult === 'success', status: lateResult });
    await pending;
    assert.equal(h.state.processing, true, 'retired verification cannot clear a newer spinner');
    h.state.processing = false;
    assert.equal(h.state.paymentMethod, 'cod');
    assert.equal(h.alerts.length, 1, 'no second alert');
    assert.deepEqual(h.orders, [], 'no late paid order');
    assert.equal(h.browserOpens, 1);
    assert.equal(h.initializations, 1);
    await buttons[0].onPress();
    assert.equal(h.references.length, 2, 'old retry callback cannot revive retired checkout');
    await h.run.handleConfirm();
    assert.deepEqual(h.orders, ['cod'], 'COD is ready for an explicit confirmation');
  });
}

test('retry settling during cancellation cannot show another alert or order', async () => {
  const h = harness();
  const { pending, buttons } = await abandonAndRetry(h);
  buttons[1].onPress();
  h.retry.reject(new ApiError('Late server error', 500, {}));
  await pending;
  assert.equal(h.alerts.length, 1);
  assert.equal(h.state.processing, true);
  // Another tap cannot start parallel cancellation or verification.
  buttons[1].onPress();
  await h.run.handlePaystackVerify('original-reference');
  assert.equal(h.cancellations.length, 1);
  assert.equal(h.references.length, 2);
  h.cancellation.resolve();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.state.processing, false);
  assert.equal(h.state.paymentMethod, 'cod');
});

test('server refusal keeps original payment, clears spinner, and ignores retired retry', async () => {
  const h = harness();
  const { pending, buttons } = await abandonAndRetry(h);
  buttons[1].onPress();
  h.cancellation.reject(new ApiError('Payment may still complete', 409, {}));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.state.paymentMethod, 'paystack');
  assert.equal(h.state.paymentFrozen, true);
  assert.equal(h.state.paymentInputRef.current?.idempotencyKey, 'original-checkout');
  assert.equal(h.state.processing, false);
  assert.deepEqual(h.alerts.map(alert => alert.title), ['Paystack Unavailable', 'Payment still pending']);
  h.retry.resolve({ success: true, status: 'success' });
  await pending;
  assert.equal(h.alerts.length, 2);
  assert.deepEqual(h.orders, []);
});

test('ordinary verification still creates a paid order when no cancellation occurs', async () => {
  const h = harness();
  const { pending } = await abandonAndRetry(h);
  h.retry.resolve({ success: true, status: 'success' });
  await pending;
  assert.deepEqual(h.orders, ['paystack']);
  assert.equal(h.state.processing, false);
  assert.deepEqual(h.cancellations, []);
});

test('COD switch cancels an independently verified abandoned checkout through the production server guard', async () => {
  const h = harness();
  const cancellationSource = readFileSync(
    new URL('../../../api-server/src/lib/checkout-cancellation.ts', import.meta.url), 'utf8',
  ).replace(/^import .*;\r?\n/gm, '').replace(/export /g, '');
  const server = ts.transpileModule(cancellationSource, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const order = {
    id: 123, user_id: '42', checkout_idempotency_key: 'original-checkout',
    status: 'pending', checkout_state: 'payment_pending',
    checkout_snapshot: { provider: { reference: 'original-reference' }, paymentAttemptId: 'attempt-1' },
    payment_method: 'paystack', payment_reference: 'original-reference',
  };
  const queries: string[] = [];
  const checked: string[] = [];
  const client = {
    async query(sql: string) {
      queries.push(sql);
      if (sql.startsWith('SELECT * FROM uc_orders')) return { rows: [order] };
      if (sql.startsWith('UPDATE uc_orders')) {
        order.status = 'cancelled';
        order.checkout_state = 'cancelled';
      }
      return { rows: [] };
    },
    release() {},
  };
  const cancel = new Function('pool', 'verifyPaymentOnServer', `${server}\nreturn cancelCheckout;`)(
    { query: client.query, connect: async () => client },
    async (method: string, reference: string) => {
      assert.equal(method, 'paystack');
      checked.push(reference);
      return { ok: false, failureFinal: true, reason: 'Paystack status: abandoned' };
    },
  );
  h.state.api.cancelCheckout = async (key: string) => { await cancel(key, '42'); };
  const { pending, buttons } = await abandonAndRetry(h);
  buttons[1].onPress();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(checked, ['original-reference']);
  assert.equal(order.status, 'cancelled');
  assert.ok(queries.includes('COMMIT'));
  assert.equal(h.state.processing, false);
  assert.equal(h.state.paymentMethod, 'cod');
  h.retry.resolve({ success: false, status: 'abandoned' });
  await pending;
  assert.equal(h.alerts.length, 1);
  assert.deepEqual(h.orders, []);
  await h.run.handleConfirm();
  assert.deepEqual(h.orders, ['cod']);
});