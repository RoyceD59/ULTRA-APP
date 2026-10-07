import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire, registerHooks } from 'node:module';
import { __testRender, useState } from '../../__mocks__/react.ts';

const require = createRequire(import.meta.url);
const mockedModules = new Set([
  '@/context/AuthContext', '@/hooks/useColors', '@/hooks/useApi', '@/hooks/useNotifications',
  '@/hooks/useCartBarInset', '@/hooks/useRewardsQrToken', '@/hooks/useFilterStatus',
  '@/lib/customerQueryKeys', '@/lib/profileDraft', 'expo-router', 'expo-haptics', 'expo-sharing',
  '@workspace/api-zod/instant-water-identity', '@tanstack/react-query',
]);
const fixtureUrl = new URL('./fixtures/account-identity.mjs', import.meta.url).href;
const auth = await import(fixtureUrl);
const loader = registerHooks({ resolve(specifier, context, next) {
  if (mockedModules.has(specifier)) return { url: fixtureUrl, shortCircuit: true };
  if (specifier.startsWith('@/components/')) return { url: fixtureUrl, shortCircuit: true };
  return next(specifier, context);
}});
const Account = require('../../app/(tabs)/account.tsx').default;
const AccountContent = Account().props.children.type;
loader.deregister();
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
    for (const key of ['personal-impact:4', 'water-tests:4', 'my-filters:4']) assert.ok(keys.includes(key), key);
    auth.setUser(5); rerender(n => n + 1); root.flush();
    const changed = elements(root.value).map(n => n.key ?? n.props?.key);
    assert.deepEqual(duplicateKeys(root.value), []);
    for (const key of ['personal-impact:5', 'water-tests:5', 'my-filters:5']) assert.ok(changed.includes(key), key);
    assert.ok(!changed.includes('water-tests:4'));
    assert.ok(!changed.includes('my-filters:4'), 'all filter selections remount with the account ID');
  });
});