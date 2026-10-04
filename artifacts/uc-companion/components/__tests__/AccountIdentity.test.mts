import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire, registerHooks } from 'node:module';
import { __testRender, useState } from '../../__mocks__/react.ts';

const require = createRequire(import.meta.url);
const code = (text: string) => 'data:text/javascript,' + encodeURIComponent(text);
const authUrl = code(`
 let user = { id: 4, email: 'fixture@test.invalid', firstName: 'Fixture', lastName: '', phone: '', address: '' };
 export function setUser(id) { user = { ...user, id }; }
 export function useAuth() { return { user, logout: async () => {}, updateUser: async () => {} }; }
`);
const empty = code('export default function Empty() { return null; }');
const notifications = code(`
 export function getNotificationPermissionStatus() { return Promise.resolve('denied'); }
 export function requestNotificationPermission() { return Promise.resolve(false); }
 export function getFilterActivation() { return Promise.resolve(null); }
 export function hydrateAssignedFilter() { return Promise.resolve(null); }
`);
const mocks: Record<string, string> = {
  '@/context/AuthContext': authUrl,
  '@/hooks/useColors': code(`export function useColors() { return { primary: '#0054a6', background: '#fff', text: '#111' }; }`),
  '@/hooks/useApi': code(`export function useApi() { return {}; }`),
  '@/hooks/useNotifications': notifications,
  '@/hooks/useCartBarInset': code('export function useCartBarInset() { return 0; }'),
  '@/hooks/useRewardsQrToken': code('export function useRewardsQrToken() { return {}; }'),
  '@/components/CountryPicker': code('export function CountryPicker() {}'),
  '@/lib/customerQueryKeys': code(`export const customerQueryKeys = new Proxy({}, {get: (_t, key) => id => [key, id]});`),
  '@/lib/profileDraft': code(`
    export function clearProfileDraft() {} export function loadProfileDraft() {}
    export function preserveProfileDraftAfterSaveError() {} export function saveProfileDraft() {}
    export const PROFILE_SESSION_EXPIRED_MESSAGE = '', PROFILE_SIGN_IN_AGAIN_LABEL = '';
  `),
  'expo-router': code(`export function useRouter() { return {}; } export function useLocalSearchParams() { return {}; } export function useFocusEffect() {}`),
  'expo-haptics': code(`export const ImpactFeedbackStyle = {}; export function impactAsync() { return Promise.resolve(); }`),
  'expo-sharing': code('export function shareAsync() {}'),
  '@workspace/api-zod/instant-water-identity': code('export function normalizeInstantPhone() {} export function isValidInstantPhone() {}'),
  '@tanstack/react-query': code(`
    export function useQueryClient() { return { invalidateQueries() {} }; }
    export function useQuery({queryKey}) {
      const data = queryKey[0] === 'customer-filter-assignments' ? [{id: 4, productName:'Assigned Hydra Flux', installationDate:'2026-01-01'}]
        : queryKey[0] === 'rewards' ? {balance:0, ledger:[], impact:{filters:[], history:[], totalLitres:0}} : [];
      return {data, isLoading:false, isError:false, refetch:async () => {}};
    }
  `),
};
const loader = registerHooks({ resolve(specifier, context, next) {
  if (mocks[specifier]) return { url: mocks[specifier], shortCircuit: true };
  if (specifier.startsWith('@/components/')) return { url: empty + '#' + specifier, shortCircuit: true };
  return next(specifier, context);
}});
const Account = require('../../app/(tabs)/account.tsx').default;
const AccountContent = Account().props.children.type;
loader.deregister();
const auth = await import(authUrl);
const roots: Array<{dispose(): void}> = [];
afterEach(() => roots.splice(0).forEach(root => root.dispose()));
function elements(tree: any): any[] {
  if (!tree || typeof tree !== 'object') return [];
  return [tree, ...[tree.props?.children].flat(Infinity).flatMap(elements)];
}
function duplicateKeys(tree: any): string[] {
  const failures: string[] = [];
  for (const node of elements(tree)) {
    const keys = [node.props?.children].flat(Infinity).filter(x => x && typeof x === 'object' && (x.key ?? x.props?.key) != null).map(x => String(x.key ?? x.props?.key));
    for (const key of keys) if (keys.filter(k => k === key).length > 1) failures.push(key);
  }
  return failures;
}
describe('Account section identities', () => {
  it('renders assignment 4 alongside account 4 with unique sibling keys and remounts account-owned sections on switch', async () => {
    auth.setUser(4);
    let rerender!: (updater: (n: number) => number) => void;
    const root = __testRender(() => {
      [, rerender] = useState(0);
      return { props: { value: AccountContent() } };
    }, {});
    roots.push(root); root.flush();
    const tree = root.value;
    assert.deepEqual(duplicateKeys(tree), []);
    const keys = elements(tree).map(n => n.key ?? n.props?.key);
    assert.ok(keys.includes('assignment:4'));
    for (const key of ['personal-impact:4', 'water-tests:4', 'offline-purchases:4']) assert.ok(keys.includes(key), key);
    auth.setUser(5); rerender(n => n + 1); root.flush();
    const changed = elements(root.value).map(n => n.key ?? n.props?.key);
    assert.deepEqual(duplicateKeys(root.value), []);
    for (const key of ['personal-impact:5', 'water-tests:5', 'offline-purchases:5']) assert.ok(changed.includes(key), key);
    assert.ok(!changed.includes('water-tests:4'));
    assert.ok(changed.includes('assignment:4'), 'numeric assignment identity does not change with the account ID');
  });
});