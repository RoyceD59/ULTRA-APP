import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { QueryClient } from '@tanstack/react-query';
import {
  catalogueQueryKey,
  scheduleCatalogueSearch,
  type CatalogueParams,
} from '../../lib/catalogueQuery.js';

const wait = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

describe('catalogue request regression', () => {
  it('Home and unfiltered Products share one compatible cache entry', async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    let requests = 0;
    const fetchProducts = async () => {
      requests += 1;
      return [{ id: 1, name: 'Filter' }];
    };

    const home = await client.fetchQuery({
      queryKey: catalogueQueryKey(),
      queryFn: fetchProducts,
      staleTime: 60_000,
    });
    const products = await client.fetchQuery({
      queryKey: catalogueQueryKey({ category: undefined, search: '' }),
      queryFn: fetchProducts,
      staleTime: 60_000,
    });

    assert.equal(requests, 1);
    assert.strictEqual(products, home);
  });

  it('rapid search input only issues the settled debounced request', async () => {
    const settled: string[] = [];
    let cancel = scheduleCatalogueSearch('f', value => settled.push(value), 15);
    cancel();
    cancel = scheduleCatalogueSearch('fi', value => settled.push(value), 15);
    cancel();
    scheduleCatalogueSearch('filter', value => settled.push(value), 15);

    await wait(30);
    assert.deepEqual(settled, ['filter']);
  });

  it('a superseded in-flight search receives an abort signal', async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    let firstSignal: AbortSignal | undefined;
    const first = client.fetchQuery({
      queryKey: catalogueQueryKey({ search: 'fil' }),
      queryFn: ({ signal }) => {
        firstSignal = signal;
        return new Promise<never>((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(signal.reason), { once: true });
        });
      },
    });

    await wait(0);
    await client.cancelQueries({ queryKey: catalogueQueryKey({ search: 'fil' }), exact: true });
    await assert.rejects(first);
    assert.equal(firstSignal?.aborted, true);
  });

  it('category and search combinations keep distinct cache entries', () => {
    const combinations: CatalogueParams[] = [
      {},
      { category: 'Home Filters' },
      { search: 'shower' },
      { category: 'Home Filters', search: 'shower' },
      { category: 'Accessories', search: 'shower' },
    ];
    const serialized = combinations.map(params => JSON.stringify(catalogueQueryKey(params)));
    assert.equal(new Set(serialized).size, combinations.length);
  });
});