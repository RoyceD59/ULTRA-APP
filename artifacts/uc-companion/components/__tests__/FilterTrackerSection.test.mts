import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire, registerHooks } from 'node:module';
import { __testRender, useState } from '../../__mocks__/react.ts';
import type { FilterActivation } from '../../hooks/useNotifications.ts';

const require = createRequire(import.meta.url);
const url = (code: string) => 'data:text/javascript,' + encodeURIComponent(code);
const authUrl = url(`
  let user = { id: 41 };
  export function setUser(id) { user = id == null ? null : { id }; }
  export function useAuth() { return { user, token: null }; }
`);
const notificationsUrl = url(`
  let sync, read;
  export function configure(syncFn, readFn) { sync = syncFn; read = readFn; }
  export function syncActivationWithCatalogue(products, id) { return sync(products, id); }
  export function getZeroLifespanNotice(id) { return read(id); }
  export function effectiveLifespanDays(a) { return a.lifespanDays; }
  export function scheduleAllFilterNotifications() {}
  export function clearFilterActivation() {}
  export function getNotificationPermissionStatus() {}
  export function requestNotificationPermission() {}
`);
const catalogueUrl = url(`
  const products = [{ id: 1, name: 'Hydra Flux', lifespanDays: 90 }];
  export function useFilterProducts() { return { products, source: 'live', loading: false }; }
`);
const emptyComponent = url('export default function Component() { return null; }');
const mocks: Record<string, string> = {
  '@/context/AuthContext': authUrl,
  '@/hooks/useNotifications': notificationsUrl,
  '@/hooks/useFilterProducts': catalogueUrl,
  '@/hooks/useColors': url(`export function useColors() { return { text: '#000', primary: '#0054A6' }; }`),
  'expo-haptics': url('export const ImpactFeedbackStyle = {}; export function impactAsync() {}'),
  'expo-router': url('export function useRouter() { return {}; } export function useFocusEffect() {}'),
  '@tanstack/react-query': url('export function useQueryClient() {}'),
  '@/components/KeyboardAwareScrollViewCompat': url('export function KeyboardAwareScrollViewCompat() {}'),
  '@/lib/filterRegistrationCommit': url('export function commitPurchaseBackedRegistration() {}'),
  '@/hooks/useApi': url('export function useApi() {} export class ApiError extends Error {}'),
  '@/components/FilterLifeGauge': emptyComponent,
  '@/lib/filterRemainingLife': url(`
    export function resolveCapacityCycle() { return null; }
    export function calculateRemainingLife() { return { remainingDays: 60, percent: 66, status: 'green' }; }
  `),
  '@/lib/customerQueryKeys': url('export const customerQueryKeys = {};'),
  '@/components/ReminderOptInSheet': url('export default function Component() {} export function wasReminderOptInSeen() {}'),
  '@/components/PerformanceCheckInModal': emptyComponent,
  '@/components/SyncToast': emptyComponent,
  '@/hooks/filterNudge': url('export const DAY_OFFSETS = []; export function closestDayOffset() {}'),
};
const auth = await import(authUrl);
const notifications = await import(notificationsUrl);
const loader = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (mocks[specifier]) return { url: mocks[specifier], shortCircuit: true };
    return nextResolve(specifier, context);
  },
});
const FilterTrackerSection = require('../FilterTrackerSection.tsx').default;
loader.deregister();

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
const activation: FilterActivation = {
  productId: 1, productName: 'Hydra Flux', lifespanDays: 90,
  activatedAt: '2026-10-01', notifIds: [],
};
const roots: Array<{ dispose(): void }> = [];
afterEach(() => { for (const root of roots.splice(0)) root.dispose(); });

function render() {
  const delivered: FilterActivation[] = [];
  const props = { activation, onActivationChange: (value: FilterActivation) => delivered.push(value) };
  let forceRender!: (update: (previous: number) => number) => void;
  const root = __testRender(() => {
    [, forceRender] = useState(0);
    return { props: { value: FilterTrackerSection(props) } };
  }, {});
  roots.push(root);
  root.flush();
  return {
    root, props, delivered,
    rerender() { forceRender(previous => previous + 1); root.flush(); },
  };
}
function hasWarning(tree: any): boolean {
  if (typeof tree === 'string') return tree.includes("Reminder accuracy can't be confirmed");
  if (!tree || typeof tree !== 'object') return false;
  return [tree.props?.children].flat(Infinity).some(hasWarning);
}
async function settle() {
  for (let i = 0; i < 6; i++) await Promise.resolve();
}

describe('FilterTrackerSection account-scoped catalogue results', () => {
  it('delivers an in-flight sync to the latest callback after a same-account rerender', async () => {
    auth.setUser(41);
    const request = deferred<FilterActivation | null>();
    let syncCalls = 0;
    let notice = false;
    notifications.configure(() => { syncCalls++; return request.promise; }, async () => notice);
    const view = render();
    await settle();
    view.root.flush();
    const latest: FilterActivation[] = [];
    view.props.onActivationChange = value => latest.push(value);
    view.rerender();
    const updated = { ...activation, lifespanDays: 120 };
    notice = true;
    request.resolve(updated);
    await settle();
    view.root.flush();
    assert.equal(syncCalls, 1, 'callback changes must not restart or invalidate the sync');
    assert.deepEqual(latest, [updated]);
    assert.deepEqual(view.delivered, []);
    assert.equal(hasWarning(view.root.value), true);
  });

  it('ignores old-account sync and notice reads after switching with the same catalogue', async () => {
    auth.setUser(41);
    const oldSync = deferred<FilterActivation | null>();
    const newSync = deferred<FilterActivation | null>();
    const oldRead = deferred<boolean>();
    const syncedUsers: number[] = [];
    notifications.configure((_products: unknown, id: number) => {
      syncedUsers.push(id);
      return id === 41 ? oldSync.promise : newSync.promise;
    }, (id: number) => id === 41 ? oldRead.promise : Promise.resolve(false));
    const view = render();
    auth.setUser(42);
    view.rerender();
    oldSync.resolve({ ...activation, lifespanDays: 120 });
    oldRead.resolve(true);
    newSync.resolve(null);
    await settle();
    view.root.flush();
    assert.deepEqual(syncedUsers, [41, 42]);
    assert.deepEqual(view.delivered, []);
    assert.equal(hasWarning(view.root.value), false);
  });

  it('retries a cancelled sync when the activation changes during the request', async () => {
    auth.setUser(41);
    const oldSync = deferred<FilterActivation | null>();
    const replacementSync = deferred<FilterActivation | null>();
    let calls = 0;
    notifications.configure(() => ++calls === 1 ? oldSync.promise : replacementSync.promise,
      async () => false);
    const view = render();
    view.props.activation = { ...activation, activatedAt: '2026-10-02' };
    view.rerender();
    const updated = { ...view.props.activation, lifespanDays: 120 };
    oldSync.resolve({ ...activation, lifespanDays: 100 });
    replacementSync.resolve(updated);
    await settle();
    view.root.flush();
    assert.equal(calls, 2, 'dedupe must not suppress recovery after cancellation');
    assert.deepEqual(view.delivered, [updated]);
  });
});