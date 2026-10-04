import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import ts from 'typescript';
import { cancelMpesaPoll, isCancelledAttempt } from '../mpesaPollManager.js';
import { classifyMpesaStatus, pollSettleClearsRef } from '../mpesaStatusClassifier.js';

// Inline simulation in the cancel-guard style, but execute the real checkout
// functions so changes to the timeout boundary or alert callbacks break tests.
const source = readFileSync(new URL('../../app/checkout.tsx', import.meta.url), 'utf8');
function section(from: string, to: string) {
  const start = source.indexOf(from);
  const end = source.indexOf(to, start);
  assert.ok(start >= 0 && end > start, `Cannot find checkout handler: ${from}`);
  return source.slice(start, end);
}
const handlers = ts.transpileModule([
  section('  async function changePaymentMethod(', '\n  function validateAddress'),
  section('  function startMpesaPoll(', '\n  async function handleMpesa'),
].join('\n'), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;

type Status = Parameters<typeof classifyMpesaStatus>[0];
type Button = { text: string; onPress: () => void };
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(yes => { resolve = yes; });
  return { promise, resolve };
}
function harness() {
  const cancellation = deferred<void>();
  const alerts: { title: string; buttons?: Button[] }[] = [];
  const queries: string[] = [];
  const cancellations: string[] = [];
  const orders: string[] = [];
  let tick!: () => Promise<void>;
  let clears = 0;
  let resets = 0;
  // No real clock or Daraja calls: capture the interval callback and run ticks
  // manually, including callbacks that were already queued before it cleared.
  const intervalId = 123;
  const state = {
    processing: true, mpesaWaiting: false, showMpesaModal: true,
    paymentMethod: 'mpesa', paymentFrozen: true,
    paymentInputRef: { current: { idempotencyKey: 'checkout-key' } as { idempotencyKey: string } | null },
    orderIdentityRef: { current: { idempotencyKey: 'checkout-key' } as { idempotencyKey: string } | null },
    lastCheckoutRequestIdRef: { current: 'original-push' as string | null },
    attemptRef: { current: 1 },
    pollRef: { current: null as ReturnType<typeof setInterval> | null },
    paystackVerifyAttemptRef: { current: 0 },
    paystackVerifyingRef: { current: false },
    paymentMethodChangingRef: { current: false },
    setProcessing(value: boolean) { resets++; state.processing = value; },
    setMpesaWaiting(value: boolean) { resets++; state.mpesaWaiting = value; },
    setShowMpesaModal(value: boolean) { state.showMpesaModal = value; },
    setPaymentFrozen(value: boolean) { state.paymentFrozen = value; },
    setPaymentMethod(value: string) { state.paymentMethod = value; },
    clearMpesaRetryCheck() {},
    cancelMpesaPoll, isCancelledAttempt, classifyMpesaStatus, pollSettleClearsRef,
    setInterval(callback: () => Promise<void>, delay: number) {
      assert.equal(delay, 3000);
      tick = callback;
      return intervalId;
    },
    clearInterval(id: number) { assert.equal(id, intervalId); clears++; },
    Alert: { alert(title: string, _message: string, buttons?: Button[]) { alerts.push({ title, buttons }); } },
    createOrder: async (method: string) => { orders.push(method); return true; },
    api: {
      mpesaStatus: async (id: string): Promise<Status> => {
        queries.push(id);
        return { status: 'pending' };
      },
      cancelCheckout: async (key: string) => { cancellations.push(key); return cancellation.promise; },
    },
  };
  const run = new Function('scope', `with (scope) { ${handlers}
    return { startMpesaPoll, changePaymentMethod }; }`)(state) as {
      startMpesaPoll: (id: string, attempt: number) => void;
      changePaymentMethod: (method: string) => Promise<void>;
    };
  run.startMpesaPoll('original-push', 1);
  return { state, alerts, queries, cancellations, orders, cancellation,
    tick: () => tick(), get clears() { return clears; }, get resets() { return resets; } };
}

async function reachTimeout(h: ReturnType<typeof harness>) {
  assert.equal(h.state.mpesaWaiting, true);
  assert.equal(h.state.processing, true);
  assert.equal(h.state.showMpesaModal, false);
  for (let i = 1; i <= 19; i++) {
    await h.tick();
    assert.equal(h.state.mpesaWaiting, true, `Waiting must remain active at tick ${i}`);
    assert.equal(h.state.processing, true);
    assert.equal(h.alerts.length, 0);
  }
  await h.tick();
  assert.equal(h.queries.length, 20);
  assert.ok(h.queries.every(id => id === 'original-push'));
  assert.equal(h.state.mpesaWaiting, false, 'Spinner dismisses on tick 20');
  assert.equal(h.state.processing, false, 'Checkout unlocks on tick 20');
  assert.equal(h.state.pollRef.current, null);
  assert.equal(h.clears, 1);
  assert.equal(h.alerts.length, 1);
  assert.equal(h.alerts[0].title, 'M-Pesa Timed Out');
  assert.deepEqual(h.alerts[0].buttons?.map(button => button.text), ['Try again', 'Pay with COD instead']);
  assert.equal(h.state.lastCheckoutRequestIdRef.current, 'original-push');
  assert.deepEqual(h.orders, []);
}

describe('M-Pesa timeout — waiting state and retry identity', () => {
  it('settles at tick 20 and discards queued tick 21 and later ticks', async () => {
    const h = harness();
    await reachTimeout(h);
    const resets = h.resets;
    for (let i = 0; i < 5; i++) await h.tick();
    assert.equal(h.queries.length, 20);
    assert.equal(h.alerts.length, 1);
    assert.equal(h.clears, 1);
    assert.equal(h.resets, resets, 'Settled ticks must not reset UI again');
    assert.equal(h.state.lastCheckoutRequestIdRef.current, 'original-push');
  });

  it('Try again opens the entry modal without discarding the previous push', async () => {
    const h = harness();
    await reachTimeout(h);
    h.alerts[0].buttons![0].onPress();
    assert.equal(h.state.showMpesaModal, true);
    assert.equal(h.state.processing, false);
    assert.equal(h.state.mpesaWaiting, false);
    assert.equal(h.state.lastCheckoutRequestIdRef.current, 'original-push');
    assert.deepEqual(h.cancellations, []);
  });

  it('COD clears the push only after server cancellation accepts the switch', async () => {
    const h = harness();
    await reachTimeout(h);
    h.alerts[0].buttons![1].onPress();
    assert.deepEqual(h.cancellations, ['checkout-key']);
    assert.equal(h.state.lastCheckoutRequestIdRef.current, 'original-push');
    assert.equal(h.state.processing, true, 'Only the cancellation request temporarily locks checkout');
    h.cancellation.resolve();
    // Flush the server cancellation continuation and the alert's void callback.
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.equal(h.state.paymentMethod, 'cod');
    assert.equal(h.state.lastCheckoutRequestIdRef.current, null);
    assert.equal(h.state.paymentInputRef.current, null);
    assert.equal(h.state.paymentFrozen, false);
    assert.equal(h.state.processing, false);
    assert.equal(h.state.mpesaWaiting, false);
    assert.deepEqual(h.orders, [], 'Switching method must not place an order');
  });

  it('ignores a late successful response from a tick in flight when timeout settles', async () => {
    const h = harness();
    const late = deferred<Status>();
    h.state.api.mpesaStatus = async id => {
      h.queries.push(id);
      return late.promise;
    };
    const inFlight = Array.from({ length: 20 }, () => h.tick());
    await h.tick(); // Pending requests exhausted the budget; queued tick times out.
    assert.equal(h.state.processing, false);
    assert.equal(h.state.mpesaWaiting, false);
    assert.equal(h.alerts.length, 1);
    late.resolve({ status: 'success' });
    await Promise.all(inFlight);
    assert.deepEqual(h.orders, []);
    assert.equal(h.alerts.length, 1);
    assert.equal(h.clears, 1);
    assert.equal(h.state.lastCheckoutRequestIdRef.current, 'original-push');
  });

  for (const status of ['success', 'failed'] as const) {
    it(`honors a ${status} response at tick 20 instead of showing a timeout`, async () => {
      const h = harness();
      h.state.api.mpesaStatus = async id => {
        h.queries.push(id);
        return h.queries.length === 20 ? { status, retriable: false } : { status: 'pending' };
      };
      for (let i = 0; i < 20; i++) await h.tick();
      assert.equal(h.queries.length, 20);
      assert.equal(h.clears, 1);
      assert.equal(h.state.lastCheckoutRequestIdRef.current, null);
      assert.deepEqual(h.orders, status === 'success' ? ['mpesa'] : []);
      assert.ok(h.alerts.every(alert => alert.title !== 'M-Pesa Timed Out'));
      await h.tick();
      assert.equal(h.queries.length, 20);
    });
  }

  it('also dismisses the waiting UI when all 20 status checks throw', async () => {
    const h = harness();
    h.state.api.mpesaStatus = async id => {
      h.queries.push(id);
      throw new Error('Temporary network failure');
    };
    await reachTimeout(h);
    await h.tick();
    assert.equal(h.queries.length, 20);
    assert.equal(h.alerts.length, 1);
  });
});