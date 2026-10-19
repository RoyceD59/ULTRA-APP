import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire, registerHooks } from 'node:module';
import { __testRender, useState } from '../../__mocks__/react.ts';
import * as fixture from './fixtures/my-filters-queries.mjs';

const require = createRequire(import.meta.url);
const fixtureUrl = new URL('./fixtures/my-filters-queries.mjs', import.meta.url).href;
const loader = registerHooks({ resolve(specifier, context, next) {
  if (['@/context/AuthContext', '@/hooks/useApi', '@/hooks/useActivationPurchases', '@tanstack/react-query', 'expo-router'].includes(specifier)) {
    return { url: fixtureUrl, shortCircuit: true };
  }
  return next(specifier, context);
} });
const { useMyFilters } = require('../useMyFilters.ts');
loader.deregister();

test('account switch cancels old source reads and scopes new selection snapshots/invalidation', async () => {
  let rerender: any;
  fixture.setAccount(41);
  const root = __testRender(() => {
    [, rerender] = useState(0);
    return { props: { value: useMyFilters(null) } };
  }, {});
  root.flush();
  for (const source of ['offline-purchases', 'customer-filter-assignments']) {
    const controller = new AbortController();
    const key = JSON.stringify([source, 41]);
    fixture.controllers.set(key, controller);
    const options = fixture.queries.get(key)!;
    await options.queryFn({ signal: controller.signal });
    assert.ok(fixture.reads.some(r => r.owner === 41 && r.signal === controller.signal));
  }
  fixture.setAccount(42); rerender((n: number) => n + 1); root.flush();
  for (const source of ['activation-purchases', 'offline-purchases', 'customer-filter-assignments']) {
    assert.ok(fixture.cancelled.some(c => c.exact && c.queryKey[0] === source && c.queryKey[1] === 41));
  }
  assert.ok([...fixture.controllers.values()].every(controller => controller.signal.aborted));
  assert.equal(root.value.ready.length, 0, 'old reads/units are not carried into new account');
  root.value.invalidate();
  assert.ok(fixture.invalidated.length >= 5);
  assert.ok(fixture.invalidated.every(key => key.includes(42) && !key.includes(41)));
  for (const key of [['offline-purchases', 42], ['customer-filter-assignments', 42]]) {
    const options = fixture.queries.get(JSON.stringify(key))!;
    assert.ok(options.enabled);
    const controller = new AbortController();
    await options.queryFn({ signal: controller.signal });
    assert.ok(fixture.reads.some(r => r.owner === 42 && r.signal === controller.signal));
  }
  root.dispose();
});
