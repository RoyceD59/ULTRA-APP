import { it } from 'node:test';
import assert from 'node:assert/strict';
import { QueryClient } from '@tanstack/react-query';
import { sharedDataRefreshInterval } from '../queryFreshness.js';
import { customerQueryKeys } from '../customerQueryKeys.js';

it('refreshes shared data at a bounded interval without polling private or unknown queries', () => {
  for (const key of [['products', 'catalogue'], ['locations'], ['companion', 'blog'], ['companion', 'guides']]) {
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
