import { it } from 'node:test';
import assert from 'node:assert/strict';
import { QueryClient } from '@tanstack/react-query';
import { GLOBAL_IMPACT_QUERY_KEY, sharedDataRefreshInterval } from '../queryFreshness.js';
import { customerQueryKeys } from '../customerQueryKeys.js';

it('refreshes shared data at a bounded interval without polling private or unknown queries', () => {
  for (const key of [['products', 'catalogue'], ['locations'], ['companion', 'blog'], ['companion', 'guides'], ['impact', 'global']]) {
    assert.equal(sharedDataRefreshInterval(key), 60_000);
  }
  for (const key of [customerQueryKeys.rewards(1), customerQueryKeys.locationRating(2, 'a'), ['payment'], []]) {
    assert.equal(sharedDataRefreshInterval(key), false);
  }
});

it('reward updates invalidate the same customer across consumers without invalidating another account', async () => {
  const client = new QueryClient();
  try {
    client.setQueryData(customerQueryKeys.rewards(1), { balance: 10 });
    client.setQueryData(customerQueryKeys.rewards(2), { balance: 90 });
    await client.invalidateQueries({ queryKey: customerQueryKeys.rewards(1), refetchType: 'none' });
    assert.equal(client.getQueryState(customerQueryKeys.rewards(1))?.isInvalidated, true);
    assert.equal(client.getQueryState(customerQueryKeys.rewards(2))?.isInvalidated, false);
    assert.equal(client.getQueryData(customerQueryKeys.locationRating(2, 'location')), undefined);
  } finally { client.clear(); }
});

it('global figures are shared without replacing either customer’s personal impact', async () => {
  const client = new QueryClient();
  try {
    const global = { litresFiltered: 4850, plasticsAvoided: 9700 };
    client.setQueryData(GLOBAL_IMPACT_QUERY_KEY, global);
    client.setQueryData(customerQueryKeys.rewards(1), { impact: { totalLitres: 12 } });
    client.setQueryData(customerQueryKeys.rewards(2), { impact: { totalLitres: 40 } });
    await client.invalidateQueries({ queryKey: GLOBAL_IMPACT_QUERY_KEY, refetchType: 'none' });
    assert.deepEqual(client.getQueryData(GLOBAL_IMPACT_QUERY_KEY), global);
    assert.deepEqual(client.getQueryData(customerQueryKeys.rewards(1)), { impact: { totalLitres: 12 } });
    assert.deepEqual(client.getQueryData(customerQueryKeys.rewards(2)), { impact: { totalLitres: 40 } });
    assert.equal(client.getQueryState(customerQueryKeys.rewards(1))?.isInvalidated, false);
    assert.equal(client.getQueryState(customerQueryKeys.rewards(2))?.isInvalidated, false);
  } finally { client.clear(); }
});
