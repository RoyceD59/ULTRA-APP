import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { QueryClient } from '@tanstack/react-query';
import { customerQueryKeys } from '../customerQueryKeys.js';

describe('customer query cache isolation', () => {
  it('scopes every private resource key to the authenticated customer', () => {
    const forCustomer = (customerId: number) => [
      customerQueryKeys.orders(customerId),
      customerQueryKeys.locationRating(customerId, 'location-1'),
      customerQueryKeys.rewards(customerId),
      customerQueryKeys.referral(customerId),
      customerQueryKeys.profile(customerId),
      customerQueryKeys.wishlist(customerId),
      customerQueryKeys.reviews(customerId, 321),
      customerQueryKeys.tickets(customerId),
      customerQueryKeys.returnRequest(customerId, 123),
      customerQueryKeys.adminProductMedia(customerId, 456),
    ];

    const first = forCustomer(41).map(JSON.stringify);
    const second = new Set(forCustomer(99).map(JSON.stringify));

    for (const key of first) assert.equal(second.has(key), false);
  });

  it('fetches the next customer instead of returning the previous customer cache', async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const requests: number[] = [];
    const fetchOrders = async (customerId: number) => {
      requests.push(customerId);
      return [{ customerId, orderId: `order-${customerId}` }];
    };

    const first = await client.fetchQuery({
      queryKey: customerQueryKeys.orders(41),
      queryFn: () => fetchOrders(41),
      staleTime: 60_000,
    });
    const second = await client.fetchQuery({
      queryKey: customerQueryKeys.orders(99),
      queryFn: () => fetchOrders(99),
      staleTime: 60_000,
    });

    assert.deepEqual(requests, [41, 99]);
    assert.deepEqual(first, [{ customerId: 41, orderId: 'order-41' }]);
    assert.deepEqual(second, [{ customerId: 99, orderId: 'order-99' }]);
    assert.deepEqual(client.getQueryData(customerQueryKeys.orders(41)), first);
    assert.deepEqual(client.getQueryData(customerQueryKeys.orders(99)), second);
  });

  it('does not expose cached private data while the next identity is unresolved', () => {
    const client = new QueryClient();
    client.setQueryData(customerQueryKeys.rewards(41), { balance: 750 });

    assert.equal(client.getQueryData(customerQueryKeys.rewards(undefined)), undefined);
    assert.equal(client.getQueryData(customerQueryKeys.rewards(99)), undefined);
  });

  it('keeps personalized review consumers and invalidation on the scoped key', async () => {
    const files = await Promise.all([
      readFile(new URL('../../app/product/[id].tsx', import.meta.url), 'utf8'),
      readFile(new URL('../../app/review/list.tsx', import.meta.url), 'utf8'),
      readFile(new URL('../../app/review/new.tsx', import.meta.url), 'utf8'),
    ]);

    for (const source of files) {
      assert.match(source, /customerQueryKeys\.reviews\(user\?\.id, pid\)/);
      assert.doesNotMatch(source, /queryKey:\s*\['reviews',\s*pid\]/);
    }
    assert.match(
      files[2]!,
      /invalidateQueries\(\{\s*queryKey:\s*customerQueryKeys\.reviews\(user\?\.id, pid\)/,
    );
    assert.match(files[2]!, /<NewReviewScreenContent key=\{user\?\.id \?\? 'guest'\} \/>/);
  });

  it('keeps a return mutation tied to the customer that initiated it', async () => {
    const source = await readFile(new URL('../../app/order/[id].tsx', import.meta.url), 'utf8');

    assert.match(source, /mutationFn: \(\{ customerId: _customerId \}: \{ customerId: number \}\)/);
    assert.match(source, /onSuccess: \(data, \{ customerId \}\)/);
    assert.match(
      source,
      /invalidateQueries\(\{ queryKey: customerQueryKeys\.returnRequest\(customerId, id\) \}\)/,
    );
    assert.match(source, /returnMutation\.mutate\(\{ customerId: user\.id \}\)/);
    assert.doesNotMatch(
      source,
      /invalidateQueries\(\{ queryKey: customerQueryKeys\.returnRequest\(user\?\.id, id\) \}\)/,
    );

    const client = new QueryClient();
    client.setQueryData(customerQueryKeys.returnRequest(41, 123), { request: null });
    client.setQueryData(customerQueryKeys.returnRequest(99, 123), { request: null });
    await client.invalidateQueries({
      queryKey: customerQueryKeys.returnRequest(41, 123),
      exact: true,
      refetchType: 'none',
    });

    assert.equal(
      client.getQueryState(customerQueryKeys.returnRequest(41, 123))?.isInvalidated,
      true,
    );
    assert.equal(
      client.getQueryState(customerQueryKeys.returnRequest(99, 123))?.isInvalidated,
      false,
    );
  });
});
