import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseGlobalImpact, impactFreshness, fetchGlobalImpact } from '../globalImpact.ts';
import { compareRelease, verifiedUpdateUrl } from '../releasePolicy.ts';
import { QueryClient } from '@tanstack/react-query';
import { GLOBAL_IMPACT_QUERY_KEY } from '../queryFreshness.ts';

const snapshot = { totalUsers: 5, litresFiltered: 1150, plasticsAvoided: 2300, cleanWaterDays: 0,
  snapshotId: 'a'.repeat(64), calculatedAt: '2026-10-05T00:00:00Z', adjustmentRevision: 1, maxAgeSeconds: 60, lifespanAvailable: false };
test('public transport sends no account headers and cancelled late responses cannot replace a new snapshot or private data', async () => {
  const originalFetch = globalThis.fetch;
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  let release!: (response: Response) => void;
  let requestOptions: RequestInit | undefined;
  globalThis.fetch = async (_url, options) => {
    requestOptions = options;
    return new Promise<Response>(resolve => { release = resolve; });
  };
  try {
    client.setQueryData(['customer', 2, 'personal-impact'], { litres: 40 });
    const old = client.fetchQuery({ queryKey: GLOBAL_IMPACT_QUERY_KEY, queryFn: ({ signal }) =>
      fetchGlobalImpact('https://api.example.invalid', signal) });
    const cancelled = assert.rejects(old);
    await client.cancelQueries({ queryKey: GLOBAL_IMPACT_QUERY_KEY });
    client.setQueryData(GLOBAL_IMPACT_QUERY_KEY, { ...snapshot, snapshotId: 'b'.repeat(64) });
    release(new Response(JSON.stringify(snapshot), { status: 200 }));
    await cancelled;
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(requestOptions?.headers, undefined);
    assert.equal(requestOptions?.cache, 'no-store');
    assert.equal(requestOptions?.signal?.aborted, true);
    assert.equal((client.getQueryData(GLOBAL_IMPACT_QUERY_KEY) as typeof snapshot).snapshotId, 'b'.repeat(64));
    assert.deepEqual(client.getQueryData(['customer', 2, 'personal-impact']), { litres: 40 });
    globalThis.fetch = async () => new Response('{}', { status: 503 });
    await assert.rejects(fetchGlobalImpact('https://api.example.invalid', new AbortController().signal), /refresh failed/);
  } finally { globalThis.fetch = originalFetch; client.clear(); }
});
test('missing identity, fabricated numbers and legacy responses fail explicitly', () => {
  assert.equal(parseGlobalImpact(snapshot).snapshotId, snapshot.snapshotId);
  for (const patch of [{ snapshotId: undefined }, { litresFiltered: NaN }, { calculatedAt: 'invalid' }, { maxAgeSeconds: 999 }]) {
    assert.throws(() => parseGlobalImpact({ ...snapshot, ...patch }));
  }
});
test('offline, failed refresh and elapsed time never label last-known data current', () => {
  const data = parseGlobalImpact(snapshot);
  assert.equal(impactFreshness(data, 1000, 2000, false, true), 'CURRENT');
  assert.equal(impactFreshness(data, 1000, 61000, false, true), 'STALE');
  assert.equal(impactFreshness(data, 1000, 2000, true, true), 'STALE');
  assert.equal(impactFreshness(data, 1000, 2000, false, false), 'STALE');
  assert.equal(impactFreshness(undefined, 0, 0, true, true), 'UNAVAILABLE');
});
test('Home/About and successive account observers share only the public key', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const data = parseGlobalImpact(snapshot);
  let reads = 0;
  const load = () => client.fetchQuery({ queryKey: GLOBAL_IMPACT_QUERY_KEY, staleTime: 60000, queryFn: async () => { reads++; return data; } });
  await load(); // Signed out.
  client.setQueryData(['customer', 1, 'impact'], { totalLitres: 25 });
  await load(); // Customer 1.
  client.removeQueries({ queryKey: ['customer', 1] });
  client.setQueryData(['customer', 2, 'impact'], { totalLitres: 90 });
  assert.equal((await load()).snapshotId, data.snapshotId); // Customer 2.
  assert.equal(reads, 1);
  assert.equal(client.getQueryData(['customer', 1, 'impact']), undefined);
  assert.deepEqual(client.getQueryData(['customer', 2, 'impact']), { totalLitres: 90 });
  client.clear();
});
const loaded = { delivery: 'web' as const, buildId: '100-1', platform: 'web', runtime: '1', version: '1' };
const metadata = { buildId: '200-2', apiOrigin: 'https://api.example.com',
  supported: { web: '200-2', expoGo: '200-2', native: [] } };
test('release comparison is advisory, detects rollback and rejects partial/API-origin rollouts', () => {
  assert.equal(compareRelease(loaded, metadata, metadata.apiOrigin).status, 'different');
  assert.equal(compareRelease({ ...loaded, buildId: '200-2' }, metadata, metadata.apiOrigin).status, 'supported');
  assert.equal(compareRelease(loaded, { ...metadata, buildId: '50-1', supported: { ...metadata.supported, web: '50-1', expoGo: '50-1' } }, metadata.apiOrigin).status, 'different');
  assert.equal(compareRelease(loaded, { ...metadata, supported: { ...metadata.supported, expoGo: '100-1' } }, metadata.apiOrigin).status, 'unknown');
  assert.equal(compareRelease(loaded, metadata, 'https://wrong.example.com').status, 'unknown');
  assert.equal(compareRelease(loaded, undefined, metadata.apiOrigin).status, 'unknown');
  assert.equal(compareRelease({ ...loaded, delivery: 'standalone', platform: 'android' }, metadata, metadata.apiOrigin).status, 'unknown');
});
test('native actions require compatible runtime and a verified application store destination', () => {
  const native = { ...loaded, delivery: 'standalone' as const, platform: 'android' };
  const target = { platform: 'android' as const, runtime: '1', version: '2', release: '200-2',
    updateUrl: 'https://play.google.com/store/apps/details?id=com.ultraclean.companion' };
  const policy = { ...metadata, supported: { ...metadata.supported, native: [target] } };
  assert.equal(compareRelease(native, policy, metadata.apiOrigin).updateUrl, target.updateUrl);
  assert.equal(compareRelease({ ...native, runtime: '0' }, policy, metadata.apiOrigin).status, 'unknown');
  assert.equal(verifiedUpdateUrl('android', 'https://play.google.com.evil.example/store/apps/details?id=com.ultraclean.companion'), false);
  assert.equal(verifiedUpdateUrl('android', 'https://play.google.com/store/apps/details?id=another.app'), false);
  const go = { ...loaded, delivery: 'expo-go' as const, platform: 'android' };
  assert.equal(compareRelease(go, { ...metadata, expoGoLaunchUrl: 'exps://app.example.com/companion' },
    metadata.apiOrigin, 'https://app.example.com').reopenUrl, 'exps://app.example.com/companion');
  assert.equal(compareRelease(go, { ...metadata, expoGoLaunchUrl: 'exps://evil.example.com' },
    metadata.apiOrigin, 'https://app.example.com').reopenUrl, undefined);
});
