import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire, registerHooks } from 'node:module';
import { __testRender } from '../../__mocks__/react.ts';
import * as fixture from './fixtures/my-filters.mjs';

const require = createRequire(import.meta.url);
const fixtureUrl = new URL('./fixtures/my-filters.mjs', import.meta.url).href;
const loader = registerHooks({ resolve(specifier, context, next) {
  if (['@/context/AuthContext', '@/hooks/useColors', '@/hooks/useMyFilters', 'expo-router', '@/components/FilterTrackerSection'].includes(specifier)) {
    return { url: fixtureUrl, shortCircuit: true };
  }
  return next(specifier, context);
} });
const MyFilters = require('../MyFiltersSection.tsx').default;
const Compact = require('../PurchaseActivationSection.tsx').default;
loader.deregister();
const roots: Array<{ dispose(): void }> = [];
afterEach(() => roots.splice(0).forEach(r => r.dispose()));
const units = [
  { key: 'app:a', name: 'Very long Hydra Flux product name that wraps without truncation', label: 'Order #12 · Item 5 · Unit 2 of 3', sourceBadge: 'App purchase',
    purchaseSelection: { source: 'app', orderId: 12, phone: '', unitId: 'a', productId: 1, name: 'Hydra Flux', lifespanDays: 90 } },
  { key: 'offline:b', name: 'Hydra Flux', label: 'Sale #12 · Item 1 · Available unit 1 of 1', sourceBadge: 'Offline sale',
    offlineSelection: { saleId: 12, saleDate: '2026-01-01', unitId: 'b', item: {} } },
];
function all(tree: any): any[] {
  if (!tree || typeof tree !== 'object') return [];
  // Expand only stateless children, never the modal (we inspect its contract).
  if (typeof tree.type === 'function' && tree.type.name !== 'RegisterModal') return all(tree.type(tree.props));
  return [tree, ...[tree.props?.children].flat(Infinity).flatMap(all)];
}
function render(Component: any, activation: any = null) {
  const wrapper = Component({ activation, onRegistered() {} });
  const root = __testRender(() => ({ props: { value: wrapper.type(wrapper.props) } }), {});
  roots.push(root); root.flush();
  return root;
}
function text(tree: any) { return all(tree).flatMap(n => [n.props?.children].flat(Infinity)).filter(v => typeof v === 'string' || typeof v === 'number').join(' ').replace(/\s+/g, ' ').trim(); }
test('Account has one heading, all eligible units and collapsed history; selection has no guessed date', () => {
  fixture.configure(units, { other: [{ key: 'reg:7', name: 'Registered', sourceBadge: 'Staff linked', description: 'Installed yesterday' }] });
  const root = render(MyFilters);
  assert.equal(all(root.value).filter(n => n.props?.children === 'My Filters').length, 1);
  assert.match(text(root.value), /Ready to activate/);
  assert.doesNotMatch(text(root.value), /Installed yesterday/);
  const activate = all(root.value).filter(n => n.props?.accessibilityLabel?.startsWith('Activate '));
  assert.equal(activate.length, 2);
  assert.ok(activate.every(n => n.props.style.minHeight >= 44));
  activate[1].props.onPress(); root.flush();
  const modal = all(root.value).find(n => n.type.name === 'RegisterModal');
  assert.equal(modal.props.offlineSelection.unitId, 'b');
  assert.equal(modal.props.offlineSelection.registeredInstallationDate, undefined);
  modal.props.onSave({ productName: 'Existing cycle' }); root.flush();
  assert.equal(fixture.calls.invalidations, 1);
});
test('Home keeps every unit reachable while primary active and links to Account block', () => {
  fixture.configure(units);
  const primary = { productId: 1, cleanCount: 5, notifIds: ['keep'] };
  const root = render(Compact, primary);
  assert.equal(all(root.value).filter(n => n.props?.accessibilityLabel?.startsWith('Activate ')).length, 1);
  const selector = all(root.value).find(n => n.props?.accessibilityState?.expanded === false);
  selector.props.onPress(); root.flush();
  assert.equal(all(root.value).filter(n => n.props?.accessibilityLabel?.startsWith('Activate ')).length, 2);
  all(root.value).find(n => n.props?.children === 'View all filters').type; // link stays visible
  const nav = all(root.value).find(n => n.props?.onPress && text(n) === 'View all filters');
  nav.props.onPress();
  assert.match(fixture.calls.navigation[0], /section=my-filters/);
  all(root.value).filter(n => n.props?.accessibilityLabel?.startsWith('Activate '))[0].props.onPress(); root.flush();
  assert.equal(all(root.value).find(n => n.type.name === 'RegisterModal').props.existingActivation, primary);
  assert.deepEqual(primary.notifIds, ['keep']);
});
test('partial failure preserves available units, saved data label and source-specific retry', () => {
  fixture.configure([units[1]], { online: fixture.source('online', { isError: true }) });
  const root = render(Compact);
  assert.match(text(root.value), /Showing saved data/);
  assert.equal(all(root.value).filter(n => n.props?.accessibilityLabel?.startsWith('Activate ')).length, 1);
  const retry = all(root.value).find(n => n.props?.onPress && text(n) === 'Retry App and store purchases');
  retry.props.onPress();
  assert.deepEqual(fixture.calls.retries, ['online']);
});
test('successful empty Home hides card; pending/offline reads never claim no filters', () => {
  fixture.configure([]);
  const empty = render(Compact);
  assert.equal(empty.value, null);
  fixture.configure([], { offline: fixture.source('offline', { data: undefined, isPending: true, isSuccess: false }) });
  const pending = render(Compact);
  assert.match(text(pending.value), /Loading Offline sales/);
  assert.doesNotMatch(text(pending.value), /No filters|No purchases|No linked/);
});
test('a store read error inside a successful app response stays actionable and never claims empty', () => {
  fixture.configure([], { storeError: 'Store purchases unavailable. App purchases are shown independently.' });
  const home = render(Compact, { compact: true, activation: null, onRegistered() {} });
  assert.match(text(home.value), /Store purchases unavailable/);
  assert.ok(!text(home.value).includes('No filters'));
  const retry = all(home.value).find(n => n.props?.onPress && text(n) === 'Retry Store purchases');
  assert.ok(retry); retry.props.onPress();
  assert.deepEqual(fixture.calls.retries, ['online']);
});
test('account-owned selection boundary changes key rather than carrying selection across accounts', () => {
  fixture.configure(units); fixture.setUser(41);
  const first = MyFilters({ activation: null, onRegistered() {} });
  fixture.setUser(42);
  const second = MyFilters({ activation: null, onRegistered() {} });
  assert.notEqual(first.key ?? first.props.key, second.key ?? second.props.key);
  fixture.setUser(null);
  assert.equal(MyFilters({ activation: null, onRegistered() {} }), null);
  fixture.setUser(41);
});
