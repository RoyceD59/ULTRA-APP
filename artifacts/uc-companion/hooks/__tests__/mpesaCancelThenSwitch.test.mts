/**
 * Cancel-then-switch regression tests. The waiting screen hides the picker;
 * Cancel stops local polling, while changing method separately requires the
 * server to confirm the original checkout can be cancelled.
 *
 * Run the actual checkout handlers with simulated UI/API boundaries and real
 * poll guards, rather than copying their state-reset logic into the test.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test, type TestContext } from 'node:test';
import ts from 'typescript';
import { cancelMpesaPoll, isCancelledAttempt } from '../mpesaPollManager.js';
import { classifyMpesaStatus, pollSettleClearsRef, type MpesaStatusResponse } from '../mpesaStatusClassifier.js';

const source = readFileSync(new URL('../../app/checkout.tsx', import.meta.url), 'utf8');
function section(from: string, to: string): string {
  const start = source.indexOf(from);
  const end = source.indexOf(to, start);
  assert.ok(start >= 0 && end > start, `checkout section missing: ${from}`);
  return source.slice(start, end);
}

const waitingScreen = section('  if (mpesaWaiting) {', '\n  // Show the load-error');
const cancelBody = waitingScreen.match(/onPress=\{\(\) => \{([\s\S]*?)\}\}/)?.[1];
assert.ok(cancelBody, 'waiting screen must provide a Cancel callback');
assert.doesNotMatch(waitingScreen, /<PaymentMethodPicker/, 'picker is not available while waiting');
assert.match(source, /onChange=\{\(method\) => \{ void changePaymentMethod\(method\); \}\}/);
const handlers = ts.transpileModule([
  section('  async function changePaymentMethod(', '\n  function validateAddress'),
  section('  async function handleConfirm(', '\n  /**'),
  section('  function startMpesaPoll(', '\n  async function handleMpesa'),
  `function cancelWaiting() { ${cancelBody} }`,
].join('\n'), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function harness(t: TestContext) {
  const status = deferred<MpesaStatusResponse>();
  const cancellation = deferred<void>();
  const statusRequests: string[] = [];
  const cancellationRequests: string[] = [];
  const orders: string[] = [];
  const alerts: string[] = [];
  const activeIntervals = new Set<ReturnType<typeof setInterval>>();
  const realClearInterval = globalThis.clearInterval;
  t.mock.method(globalThis, 'clearInterval', (id: Parameters<typeof clearInterval>[0]) => {
    realClearInterval(id);
    if (typeof id === 'object' && id !== null) activeIntervals.delete(id);
  });
  let tick!: () => Promise<void>;
  let paystackStarts = 0;
  const state = {
    processing: true, mpesaWaiting: false, paymentMethod: 'mpesa',
    paymentFrozen: true,
    attemptRef: { current: 1 },
    pollRef: { current: null as ReturnType<typeof setInterval> | null },
    paystackVerifyAttemptRef: { current: 0 },
    paystackVerifyingRef: { current: false },
    pendingPaystackReferenceRef: { current: 'older-paystack-reference' as string | null },
    paymentMethodChangingRef: { current: false },
    paymentInputRef: { current: { idempotencyKey: 'original-checkout' } as { idempotencyKey: string } | null },
    orderIdentityRef: { current: { idempotencyKey: 'original-checkout' } as { idempotencyKey: string } | null },
    lastCheckoutRequestIdRef: { current: 'original-stk' as string | null },
    total: 100, fulfillment: 'collection', baseQuote: { total: 100 },
    quoteCurrent: true, quoteLoading: false, quoteError: '',
    validateAddress: () => true,
    setShowMpesaModal() {},
    clearMpesaRetryCheck() {},
    setProcessing(value: boolean) { state.processing = value; },
    setMpesaWaiting(value: boolean) { state.mpesaWaiting = value; },
    setPaymentFrozen(value: boolean) { state.paymentFrozen = value; },
    setPaymentMethod(value: string) { state.paymentMethod = value; },
    cancelMpesaPoll, isCancelledAttempt, classifyMpesaStatus, pollSettleClearsRef,
    Haptics: { ImpactFeedbackStyle: { Medium: 'medium' }, impactAsync() {} },
    Alert: { alert(title: string) { alerts.push(title); } },
    setInterval(callback: () => Promise<void>, delay: number) {
      assert.equal(delay, 3000);
      tick = callback;
      // A real timer handle verifies clearInterval is called, but ticks are
      // driven manually so the test never sleeps or depends on elapsed time.
      const id = setInterval(() => {}, 60_000);
      id.unref();
      activeIntervals.add(id);
      return id;
    },
    clearInterval(id: ReturnType<typeof setInterval>) {
      clearInterval(id);
      activeIntervals.delete(id);
    },
    api: {
      async mpesaStatus(reference: string) {
        statusRequests.push(reference);
        return status.promise;
      },
      async cancelCheckout(key: string) {
        cancellationRequests.push(key);
        return cancellation.promise;
      },
    },
    async createOrder(method: string) { orders.push(method); return true; },
    async handlePaystack() { paystackStarts++; },
    async handleStripeCheckout() { assert.fail('unexpected Stripe flow'); },
  };
  // Mutable scope models re-renders: callbacks read the latest UI state.
  const run = new Function('scope', `with (scope) { ${handlers}
    return { startMpesaPoll, cancelWaiting, changePaymentMethod, handleConfirm }; }`)(state) as {
      startMpesaPoll(reference: string, attempt: number): void;
      cancelWaiting(): void;
      changePaymentMethod(method: string): Promise<void>;
      handleConfirm(): Promise<void>;
    };
  run.startMpesaPoll('original-stk', state.attemptRef.current);
  const interval = state.pollRef.current!;
  return {
    state, run, status, cancellation, statusRequests, cancellationRequests,
    orders, alerts, activeIntervals, interval,
    tick: () => tick(),
    get paystackStarts() { return paystackStarts; },
    dispose() { clearInterval(interval); },
  };
}

for (const method of ['paystack', 'cod']) {
  test(`Cancel then switch to ${method} clears waiting state and discards stale ticks`, async (t) => {
    const h = harness(t);
    t.after(() => h.dispose());
    const originalAttempt = h.state.attemptRef.current;
    assert.equal(h.state.mpesaWaiting, true);
    assert.equal(h.state.processing, true);
    assert.notEqual(h.state.pollRef.current, null);

    // A status request starts before Cancel and resolves after the switch.
    const inFlightTick = h.tick();
    assert.deepEqual(h.statusRequests, ['original-stk']);
    h.run.cancelWaiting();
    assert.equal(h.state.mpesaWaiting, false, 'Cancel dismisses the spinner');
    assert.equal(h.state.processing, false, 'Cancel unlocks checkout');
    assert.equal(h.state.pollRef.current, null);
    assert.equal(h.activeIntervals.size, 0, 'the real poll interval is stopped');
    assert.ok(isCancelledAttempt(originalAttempt, h.state.attemptRef));

    const afterCancelAttempt = h.state.attemptRef.current;
    const switching = h.run.changePaymentMethod(method);
    assert.deepEqual(h.cancellationRequests, ['original-checkout']);
    assert.equal(h.state.processing, true, 'server cancellation temporarily locks checkout');
    assert.equal(h.state.paymentMethod, 'mpesa', 'no switch before server approval');
    h.cancellation.resolve();
    await switching;

    assert.equal(h.state.mpesaWaiting, false, 'switch does not restore the spinner');
    assert.equal(h.state.processing, false, 'switch finally unlocks checkout');
    assert.equal(h.state.paymentMethod, method);
    assert.equal(h.state.paymentMethodChangingRef.current, false);
    assert.equal(h.state.attemptRef.current, afterCancelAttempt + 1, 'picker also retires the old attempt');
    assert.equal(h.state.pollRef.current, null, 'no stale poll survives the switch');
    assert.equal(h.state.paymentFrozen, false);
    assert.equal(h.state.paymentInputRef.current, null);
    assert.equal(h.state.orderIdentityRef.current, null);
    assert.equal(h.state.lastCheckoutRequestIdRef.current, null);
    assert.equal(h.state.pendingPaystackReferenceRef.current, null, 'successful switch clears the saved Paystack attempt');

    await h.tick();
    assert.equal(h.statusRequests.length, 1, 'queued stale tick is discarded before the API call');
    assert.equal(h.activeIntervals.size, 0, 'stale pre-await guard clears the old timer');
    h.status.resolve({ status: 'success' });
    await inFlightTick;
    assert.deepEqual(h.orders, [], 'late success is discarded after await, not converted to an order');
    assert.equal(h.state.mpesaWaiting, false);
    assert.equal(h.state.processing, false);
    assert.deepEqual(h.alerts, []);

    // Run the production Confirm dispatcher, stubbing only provider boundaries.
    await h.run.handleConfirm();
    assert.equal(h.paystackStarts, method === 'paystack' ? 1 : 0);
    assert.deepEqual(h.orders, method === 'cod' ? ['cod'] : []);
    assert.equal(h.state.pollRef.current, null, 'new method starts without a stale interval');
  });
}

test('picker cannot switch away from an actively processing M-Pesa poll', async (t) => {
  const h = harness(t);
  t.after(() => h.dispose());
  await h.run.changePaymentMethod('cod');
  assert.equal(h.state.paymentMethod, 'mpesa');
  assert.equal(h.state.mpesaWaiting, true);
  assert.equal(h.state.processing, true);
  assert.equal(h.state.pollRef.current, h.interval);
  assert.equal(h.state.attemptRef.current, 1);
  assert.deepEqual(h.cancellationRequests, []);
});

test('Cancel then refused server cancellation leaves checkout unlocked but keeps the original method', async (t) => {
  const h = harness(t);
  t.after(() => h.dispose());
  h.run.cancelWaiting();
  const switching = h.run.changePaymentMethod('cod');
  h.cancellation.reject(new Error('Original payment is still pending'));
  await switching;
  assert.deepEqual(h.cancellationRequests, ['original-checkout']);
  assert.equal(h.state.paymentMethod, 'mpesa');
  assert.equal(h.state.paymentFrozen, true);
  assert.equal(h.state.paymentInputRef.current?.idempotencyKey, 'original-checkout');
  assert.equal(h.state.orderIdentityRef.current?.idempotencyKey, 'original-checkout');
  assert.equal(h.state.lastCheckoutRequestIdRef.current, 'original-stk');
  assert.equal(h.state.pendingPaystackReferenceRef.current, 'older-paystack-reference');
  assert.equal(h.state.mpesaWaiting, false);
  assert.equal(h.state.processing, false);
  assert.equal(h.state.paymentMethodChangingRef.current, false);
  assert.equal(h.state.pollRef.current, null);
  assert.equal(h.activeIntervals.size, 0);
  assert.deepEqual(h.alerts, ['Payment still pending']);
  assert.deepEqual(h.orders, []);
  assert.equal(h.paystackStarts, 0);
});