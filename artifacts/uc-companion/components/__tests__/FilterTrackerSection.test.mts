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
  let saved;
  export const scheduled = [];
  export function configureRegistration(value) { saved = value; scheduled.length = 0; }
  export function configure(syncFn, readFn) { sync = syncFn; read = readFn; }
  export function syncActivationWithCatalogue(products, id) { return sync(products, id); }
  export function getZeroLifespanNotice(id) { return read(id); }
  export function effectiveLifespanDays(a) { return a.lifespanDays; }
  export async function scheduleAllFilterNotifications(a) { scheduled.push(a); return a; }
  export async function getFilterActivation() { return saved ?? null; }
  export function clearFilterActivation() {}
  export function getNotificationPermissionStatus() {}
  export function requestNotificationPermission() {}
`);
const catalogueUrl = url(`
  const products = [{ id: 1, name: 'Hydra Flux', lifespanDays: 90 }];
  export function useFilterProducts() { return { products, source: 'live', loading: false }; }
`);
const emptyComponent = url('export default function Component() { return null; }');
const apiUrl = url(`
  let register;
  export const calls = [];
  export function configureRegister(fn) { register = fn; calls.length = 0; }
  export function useApi() { return {
    registerFilterPurchase(...args) { calls.push(['online', ...args]); return register(); },
    registerOfflinePurchase(...args) { calls.push(['offline', ...args]); return register(); }
  }; }
  export class ApiError extends Error {}
`);
const mocks: Record<string, string> = {
  '@/context/AuthContext': authUrl,
  '@/hooks/useNotifications': notificationsUrl,
  '@/hooks/useFilterProducts': catalogueUrl,
  '@/hooks/useColors': url(`export function useColors() { return { text: '#000', primary: '#0054A6' }; }`),
  'expo-haptics': url('export const ImpactFeedbackStyle = {}; export function impactAsync() {}'),
  'expo-router': url('export function useRouter() { return {}; } export function useFocusEffect() {}'),
  '@tanstack/react-query': url('export function useQueryClient() { return { async invalidateQueries() {} }; }'),
  '@/components/KeyboardAwareScrollViewCompat': url('export function KeyboardAwareScrollViewCompat() {}'),
  '@/hooks/useApi': apiUrl,
  '@/components/FilterLifeGauge': emptyComponent,
  '@/lib/filterRemainingLife': url(`
    export function resolveCapacityCycle() { return null; }
    export function calculateRemainingLife() { return { remainingDays: 60, percent: 66, status: 'green' }; }
  `),
  '@/lib/customerQueryKeys': url('export const customerQueryKeys = { rewards: id => ["rewards", id] };'),
  '@/components/ReminderOptInSheet': url('export default function Component() {} export function wasReminderOptInSeen() {}'),
  '@/components/PerformanceCheckInModal': emptyComponent,
  '@/components/SyncToast': emptyComponent,
  '@/hooks/filterNudge': url('export const DAY_OFFSETS = []; export function closestDayOffset() {}'),
};
const auth = await import(authUrl);
const notifications = await import(notificationsUrl);
const registrationApi = await import(apiUrl);
const loader = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (mocks[specifier]) return { url: mocks[specifier], shortCircuit: true };
    return nextResolve(specifier, context);
  },
});
const trackerModule = require('../FilterTrackerSection.tsx');
const FilterTrackerSection = trackerModule.default;
const RegisterModal = trackerModule.RegisterModal;
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

describe('source-specific registrations preserve the primary cycle', () => {
  const primary = { productId: 1, productName: 'Current', activatedAt: '2026-01-01T00:00:00Z', lifespanDays: 90,
    registeredFilterId: 7, cleanCount: 4, lastCleanedAt: '2026-03-02', notifIds: ['keep'], perfCheckedAt: '2026-03-01' };
  const online = { source: 'app', orderId: 12, phone: '+254712345678', unitId: 'app:12:3:2',
    productId: 1, name: 'Another filter', lifespanDays: 90 };
  const offline = { saleId: 3, saleDate: '2026-01-01', unitId: 'unit-b',
    item: { productId: 1, name: 'Offline filter', lifespanDays: 90, capacityLitres: 150 } };
  function all(tree: any): any[] {
    if (!tree || typeof tree !== 'object') return [];
    return [tree, ...[tree.props?.children].flat(Infinity).flatMap(all)];
  }
  function modal(selection: any, saved: any[] = []) {
    const props = { visible: true, userId: 41, filterProducts: [],
      existingActivation: primary, productsLoading: false, ...selection,
      onSave: (a: any) => saved.push(a), onClose() {} };
    const root = __testRender(() => ({ props: { value: RegisterModal(props) } }), {});
    roots.push(root); root.flush(); return root;
  }
  function date(root: any) {
    return all(root.value).find(n => n.props?.accessibilityLabel === 'Installation date YYYY-MM-DD');
  }
  function confirm(root: any) {
    return all(root.value).find(n => n.props?.testID === 'offline-register-confirm'
      || n.props?.accessibilityRole === 'button' && n.props?.onPress?.name === 'handleSelectedPurchaseSave');
  }
  it('online and linked offline commits retain installation, cleaning and reminder identities', async () => {
    notifications.configureRegistration(primary);
    for (const selection of [{ purchaseSelection: online }, { offlineSelection: offline }]) {
      registrationApi.configureRegister(async () => ({ registration: { id: 8 }, activatedAt: '2026-04-01' }));
      const saved: any[] = [], root = modal(selection, saved);
      assert.equal(date(root).props.value, '', 'purchase date is not installation date');
      date(root).props.onChangeText('2026-04-01'); root.flush();
      await confirm(root).props.onPress(); root.flush();
      assert.equal(saved[0], primary);
      assert.deepEqual(saved[0].notifIds, ['keep']);
      assert.equal(saved[0].cleanCount, 4);
      assert.equal(notifications.scheduled.length, 0);
      assert.equal(registrationApi.calls.length, 1);
      root.dispose();
    }
  });
  it('blank date makes no write; restore keeps original date without restarting reminders', async () => {
    notifications.configureRegistration(primary);
    registrationApi.configureRegister(async () => ({}));
    const blank = modal({ offlineSelection: offline });
    await confirm(blank).props.onPress(); blank.flush();
    assert.equal(registrationApi.calls.length, 0);
    blank.dispose();
    const saved: any[] = [], restore = modal({ offlineSelection: { ...offline, registeredInstallationDate: '2026-02-03' } }, saved);
    assert.equal(date(restore).props.value, '2026-02-03');
    assert.equal(date(restore).props.editable, false);
    await confirm(restore).props.onPress(); restore.flush();
    assert.equal(registrationApi.calls[0][3], '2026-02-03');
    assert.equal(saved[0], primary);
    assert.equal(notifications.scheduled.length, 0);
  });
  it('late registration after account unmount never schedules or exposes the old activation', async () => {
    notifications.configureRegistration(null);
    let complete: any;
    registrationApi.configureRegister(() => new Promise(resolve => { complete = resolve; }));
    const saved: any[] = [], root = modal({ purchaseSelection: online, existingActivation: null }, saved);
    date(root).props.onChangeText('2026-04-01'); root.flush();
    const pending = confirm(root).props.onPress();
    root.dispose();
    complete({ registration: { id: 8, activatedAt: '2026-04-01' } });
    await pending;
    assert.equal(saved.length, 0);
    assert.equal(notifications.scheduled.length, 0);
    assert.equal(registrationApi.calls.length, 1, 'a pending write is never replayed');
  });
});

describe('FilterTrackerSection account-scoped catalogue results', () => {
  it('account 4 can open Register Filter without a duplicate row or omitted modal', () => {
    auth.setUser(4);
    notifications.configure(async () => null, async () => false);
    const root = __testRender(() => ({
      props: { value: FilterTrackerSection({ activation: null, onActivationChange() {} }) },
    }), {});
    roots.push(root); root.flush();
    function all(tree: any): any[] {
      if (!tree || typeof tree !== 'object') return [];
      return [tree, ...[tree.props?.children].flat(Infinity).flatMap(all)];
    }
    const open = all(root.value).find(n => n.props?.onPress && all(n).some(c => c.props?.children === "Can't find your filter?"));
    assert.ok(open);
    open.props.onPress(); root.flush();
    assert.ok(all(root.value).some(n => n.props?.visible === true && n.props?.userId === 4));
  });
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