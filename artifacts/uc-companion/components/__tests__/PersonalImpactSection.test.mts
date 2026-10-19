import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire, registerHooks } from 'node:module';
import { __testRender } from '../../__mocks__/react.ts';
import type { PersonalImpact } from '../../hooks/useApi.ts';

const require = createRequire(import.meta.url);
const url = (code: string) => 'data:text/javascript,' + encodeURIComponent(code);
const apiUrl = url(`
  let submit;
  export function configure(fn) { submit = fn; }
  export function useApi() { return { addPersonalImpact: input => submit(input) }; }
`);
const mocks: Record<string, string> = {
  '@/hooks/useApi': apiUrl,
  '@/hooks/useColors': url('export function useColors() { return {}; }'),
  'expo-haptics': url(`
    export const NotificationFeedbackType = { Success: 'success' };
    export function notificationAsync() { return Promise.resolve(); }
    export function selectionAsync() { return Promise.resolve(); }
  `),
  '@/components/ImpactTreeSection': url('export default function Component() { return null; }'),
};
const api = await import(apiUrl);
const loader = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (mocks[specifier]) return { url: mocks[specifier], shortCircuit: true };
    return nextResolve(specifier, context);
  },
});
const PersonalImpactSection = require('../PersonalImpactSection.tsx').default;
loader.deregister();

function fixture(): PersonalImpact {
  return {
    totalLitres: 30, starLevel: 0, hasRefilled: true, remainingCapacityLitres: 270,
    filters: [
      { id: 11, productId: 1, productName: 'Hydra Flux', ratedCapacityLitres: 150,
        usedLitres: 20, remainingCapacityLitres: 130, sourceOrderId: 101,
        activatedAt: '2026-07-01T12:00:00Z' },
      { id: 22, productId: 1, productName: 'Hydra Flux', ratedCapacityLitres: 150,
        usedLitres: 10, remainingCapacityLitres: 140, sourceOrderId: 202,
        activatedAt: '2026-09-01T12:00:00Z' },
    ],
    history: [
      { id: 1, registeredFilterId: 11, productName: 'Hydra Flux', litres: 20,
        reason: 'Customer refilled water', actor: 'customer', createdAt: '2026-07-02' },
      { id: 2, registeredFilterId: 22, productName: 'Hydra Flux', litres: 10,
        reason: 'Customer refilled water', actor: 'customer', createdAt: '2026-09-02' },
    ],
  };
}

function nodes(tree: any): any[] {
  if (!tree || typeof tree !== 'object') return [];
  return [tree, ...[tree.props?.children].flat(Infinity).flatMap(nodes)];
}
function text(tree: any): string {
  if (typeof tree === 'string' || typeof tree === 'number') return String(tree);
  return tree && typeof tree === 'object'
    ? [tree.props?.children].flat(Infinity).map(text).join('') : '';
}
const roots: Array<{ dispose(): void }> = [];
afterEach(() => { for (const root of roots.splice(0)) root.dispose(); });
function render(impact = fixture()) {
  const root = __testRender(() => ({
    props: { value: PersonalImpactSection({ impact, onUpdated() {} }) },
  }), {});
  roots.push(root);
  return {
    root,
    find(id: string) {
      const node = nodes(root.value).find(node => node.props?.testID === id);
      assert.ok(node, `Missing ${id}`);
      return node;
    },
    caption() {
      return nodes(root.value).map(text).find(value => value.startsWith('Adding to:'))!;
    },
  };
}

describe('PersonalImpactSection purchase-backed filter context', () => {
  it('distinguishes identical models in Details and the caption and submits the chosen registration', async () => {
    const impact = fixture();
    const before = structuredClone(impact);
    const requests: any[] = [];
    api.configure(async (input: any) => {
      requests.push(input);
      throw new Error('Retry later');
    });
    const view = render(impact);
    const firstDate = new Date(impact.filters[0].activatedAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
    const secondDate = new Date(impact.filters[1].activatedAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
    assert.match(text(view.find('impact-filter-11')), /Receipt\/order #101/);
    assert.ok(text(view.find('impact-filter-11')).includes(`Activated ${firstDate}`));
    assert.match(text(view.find('impact-filter-22')), /Receipt\/order #202/);
    assert.ok(text(view.find('impact-filter-22')).includes(`Activated ${secondDate}`));
    assert.match(view.caption(), /Receipt\/order #101/);
    view.find('impact-litres-input').props.onChangeText('5');
    view.root.flush();
    await view.find('impact-confirm').props.onPress();
    view.root.flush();
    await view.find('impact-confirm').props.onPress();
    view.root.flush();
    assert.equal(requests[0].registeredFilterId, 11);
    assert.equal(requests[0].litres, 5);
    assert.equal(requests[1].idempotencyKey, requests[0].idempotencyKey);
    view.find('impact-filter-22').props.onPress();
    view.root.flush();
    assert.match(view.caption(), /Receipt\/order #202/);
    assert.ok(view.caption().includes(`Activated ${secondDate}`));
    assert.doesNotMatch(view.caption(), /#101/);
    view.find('impact-litres-input').props.onChangeText('7');
    view.root.flush();
    await view.find('impact-confirm').props.onPress();
    assert.equal(requests[2].registeredFilterId, 22);
    assert.equal(requests[2].litres, 7);
    assert.deepEqual(impact, before, 'Rendering and selection must not transfer usage or change cycles/history');
  });

  it('labels missing context without inventing receipt or activation information', () => {
    const impact = fixture();
    impact.filters = [{ ...impact.filters[0], sourceOrderId: null, activatedAt: '' }];
    const view = render(impact);
    assert.match(text(view.find('impact-filter-11')), /Receipt\/order not available · Activation date not available/);
    assert.match(view.caption(), /Receipt\/order not available · Activation date not available/);
    assert.doesNotMatch(view.caption(), /Invalid Date|Change in Details/);
  });
});