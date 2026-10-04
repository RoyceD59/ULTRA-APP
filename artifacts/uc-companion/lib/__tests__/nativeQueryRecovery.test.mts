import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { connectionOnline, installNativeQueryRecovery, nativeRecoveryDefaults, type ConnectionState } from '../nativeQueryRecovery';
import { pageDataState } from '../pageLoading';
import { preferenceReadBlocked } from '../notificationPreferenceState';

// The app's .ts helpers compile as CJS in this Node harness. Use the same
// package instance so the onlineManager singleton is shared (Metro has one).
const { QueryClient, QueryObserver, MutationObserver } =
  createRequire(import.meta.url)('@tanstack/react-query') as typeof import('@tanstack/react-query');

const tick = () => new Promise(resolve => setTimeout(resolve, 0));
async function until(predicate: () => boolean) {
  for (let i = 0; i < 100; i++) {
    if (predicate()) return;
    await tick();
  }
  assert.fail('Reconnect did not settle');
}

function harness() {
  let connected = true;
  let emit!: (state: ConnectionState) => void;
  let removed = false;
  const stop = installNativeQueryRecovery(listener => {
    emit = listener;
    listener({ isConnected: true, isInternetReachable: true });
    return () => { removed = true; };
  });
  const defaults = nativeRecoveryDefaults('ios');
  const client = new QueryClient({ defaultOptions: {
    ...defaults, queries: { ...defaults.queries, retry: false, gcTime: 0, refetchOnReconnect: 'always' },
  } });
  client.mount();
  return {
    client,
    isConnected: () => connected,
    connect(value: boolean) {
      connected = value;
      emit({ isConnected: value, isInternetReachable: value });
    },
    close() { client.unmount(); client.clear(); stop(); assert.equal(removed, true); },
  };
}

describe('native read-only reconnect recovery', () => {
  it('ignores unknown reachability and preserves browser defaults', () => {
    assert.equal(connectionOnline({ isConnected: null, isInternetReachable: null }), undefined);
    assert.equal(connectionOnline({ isConnected: true, isInternetReachable: null }), undefined);
    assert.equal(connectionOnline({ isConnected: true, isInternetReachable: false }), false);
    assert.equal(connectionOnline({ isConnected: false, isInternetReachable: null }), false);
    assert.equal(connectionOnline({ isConnected: true, isInternetReachable: true }), true);
    assert.deepEqual(nativeRecoveryDefaults('web'), {});
    assert.deepEqual(nativeRecoveryDefaults('android'), nativeRecoveryDefaults('ios'));
    const web = readFileSync(new URL('../queryConnectivity.ts', import.meta.url), 'utf8');
    assert.doesNotMatch(web, /import .*NetInfo|onlineManager\.set/);
  });

  it('recovers a failed initial read when connectivity returns, without manual retry', async () => {
    const h = harness();
    h.connect(false);
    let reads = 0;
    const observer = new QueryObserver(h.client, {
      queryKey: ['products'], queryFn: async () => {
        reads++;
        if (!h.isConnected()) throw new TypeError('Network request failed');
        return [];
      },
    });
    const unsubscribe = observer.subscribe(() => {});
    try {
      await until(() => observer.getCurrentResult().isError);
      assert.equal(pageDataState(false, false, true), 'error');
      h.connect(true);
      await until(() => observer.getCurrentResult().isSuccess);
      assert.deepEqual(observer.getCurrentResult().data, []);
      assert.equal(reads, 2);
      h.connect(true);
      await tick();
      assert.equal(reads, 2, 'duplicate online snapshots do not repeat reads');
    } finally { unsubscribe(); observer.destroy(); h.close(); }
  });

  it('retains cached content and blocks preference edits until persisted values reload', async () => {
    const h = harness();
    const saved = { enabled: true, intervalHours: 4 };
    h.client.setQueryData(['preferences'], saved);
    h.connect(false);
    let finish!: (value: typeof saved) => void;
    const observer = new QueryObserver(h.client, {
      queryKey: ['preferences'], queryFn: async () => {
        if (!h.isConnected()) throw new TypeError('Network request failed');
        return new Promise<typeof saved>(resolve => { finish = resolve; });
      },
    });
    const unsubscribe = observer.subscribe(() => {});
    try {
      await until(() => observer.getCurrentResult().isError);
      let result = observer.getCurrentResult();
      assert.deepEqual(result.data, saved);
      assert.equal(pageDataState(result.data !== undefined, result.isLoading, result.isError), 'ready');
      assert.equal(preferenceReadBlocked(result.data, result.isError, result.isFetching), true);
      h.connect(true);
      await until(() => !!finish);
      result = observer.getCurrentResult();
      assert.deepEqual(result.data, saved);
      assert.equal(preferenceReadBlocked(result.data, result.isError, result.isFetching), true);
      const persisted = { enabled: false, intervalHours: 2 };
      finish(persisted);
      await until(() => observer.getCurrentResult().isSuccess && !observer.getCurrentResult().isFetching);
      result = observer.getCurrentResult();
      assert.deepEqual(result.data, persisted);
      assert.equal(preferenceReadBlocked(result.data, result.isError, result.isFetching), false);
    } finally { unsubscribe(); observer.destroy(); h.close(); }
  });

  it('does not queue or replay a write and does not refetch disabled queries', async () => {
    const h = harness();
    let writes = 0;
    let disabledReads = 0;
    const disabled = new QueryObserver(h.client, {
      queryKey: ['signed-out'], enabled: false,
      queryFn: async () => { disabledReads++; return []; },
    });
    const unsubscribe = disabled.subscribe(() => {});
    const mutation = new MutationObserver(h.client, {
      mutationFn: async () => { writes++; throw new TypeError('Network request failed'); },
    });
    try {
      h.connect(false);
      await assert.rejects(mutation.mutate());
      assert.equal(mutation.getCurrentResult().isPaused, false);
      assert.equal(writes, 1);
      h.connect(true);
      await tick();
      assert.equal(writes, 1);
      assert.equal(disabledReads, 0);
    } finally { unsubscribe(); disabled.destroy(); h.close(); }
  });
});