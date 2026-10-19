import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { QueryClient, QueryObserver } from '@tanstack/react-query';
import { RewardsQrController } from '../../lib/RewardsQrController';
import { customerQueryKeys } from '../../lib/customerQueryKeys';

function resolved(userId: number) {
  return { userId, token: String(userId).repeat(43), version: null, recoveryRequired: false, persistenceWarning: false };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
describe('bounded account-scoped QR loading', () => {
  it('cancels old-account completions and clears the old QR immediately', async () => {
    const worker = new RewardsQrController();
    await worker.load(1, async () => resolved(1));
    const old = deferred<ReturnType<typeof resolved>>();
    const first = worker.load(1, () => old.promise);
    const rejected = assert.rejects(first, /cancelled/);
    const next = deferred<ReturnType<typeof resolved>>();
    const second = worker.load(2, () => next.promise);
    assert.equal(worker.state.token, null);
    assert.equal(worker.state.loading, true);
    old.resolve(resolved(1));
    next.resolve(resolved(2));
    await Promise.all([rejected, second]);
    assert.equal(worker.state.token, resolved(2).token);
  });
  it('times out a hanging bridge, then permits a clean retry', async () => {
    const worker = new RewardsQrController();
    await assert.rejects(worker.load(1, () => new Promise(() => {}), undefined, 10), /timed out/);
    assert.equal(worker.state.loading, false);
    assert.equal(worker.state.token, null);
    await worker.load(1, async () => resolved(1));
    assert.equal(worker.state.error, null);
  });
  it('cancellation/unmount stops late writes to controller state', async () => {
    const worker = new RewardsQrController();
    const signal = new AbortController();
    const delayed = deferred<ReturnType<typeof resolved>>();
    const request = worker.load(1, () => delayed.promise, signal.signal);
    signal.abort();
    await assert.rejects(request, /cancelled/);
    delayed.resolve(resolved(1));
    await Promise.resolve();
    assert.equal(worker.state.token, null);
    assert.equal(worker.state.loading, false);
  });
  it('account/rewards observers share one in-flight server read, with keys isolating other accounts', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    const pending = deferred<ReturnType<typeof resolved>>();
    let reads = 0;
    const options = {
      queryKey: customerQueryKeys.rewardsQr(1),
      queryFn: () => { reads++; return pending.promise; },
      staleTime: 0,
    };
    const account = new QueryObserver(client, options);
    const rewards = new QueryObserver(client, options);
    const stopAccount = account.subscribe(() => {});
    const stopRewards = rewards.subscribe(() => {});
    const first = account.refetch();
    const second = rewards.refetch();
    pending.resolve(resolved(1));
    await Promise.all([first, second]);
    assert.equal(reads, 1);
    assert.deepEqual(account.getCurrentResult().data, rewards.getCurrentResult().data);
    assert.equal(client.getQueryData(customerQueryKeys.rewardsQr(2)), undefined);
    stopAccount(); stopRewards(); client.clear();
  });
});