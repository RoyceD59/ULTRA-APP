import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire, registerHooks } from 'node:module';
import { __testRender } from '../../__mocks__/react.ts';
import type { RewardsQrDisplayState } from '../RewardsQrDisplay';

const require = createRequire(import.meta.url);
const url = (source: string) => `data:text/javascript,${encodeURIComponent(source)}`;
const mocks: Record<string, string> = {
  '@/hooks/useColors': url(`export function useColors() { return { text: '#000', primary: '#0054A6', primaryForeground: '#fff', mutedForeground: '#666' }; }`),
  'react-native-qrcode-svg': url('export default function QRCode() {}'),
  './PageDataLoader': url('export default function PageDataLoader() {}'),
  './PageDataError': url('export default function PageDataError() {}'),
};
const loader = registerHooks({
  resolve(specifier, context, nextResolve) {
    return mocks[specifier] ? { url: mocks[specifier], shortCircuit: true } : nextResolve(specifier, context);
  },
});
const Display = require('../RewardsQrDisplay.tsx').default;
loader.deregister();
const roots: { dispose(): void }[] = [];
afterEach(() => { roots.splice(0).forEach(root => root.dispose()); });
const state = (overrides: Partial<RewardsQrDisplayState> = {}): RewardsQrDisplayState => ({
  token: 'x'.repeat(43), loading: false, error: null, recoveryRequired: false,
  persistenceWarning: false, retry: async () => {}, recover: async () => {}, ...overrides,
});
function render(value: RewardsQrDisplayState, size = 150) {
  const root = __testRender(() => ({ props: { value: Display({ state: value, size, testID: 'rewards-qr' }) } }), {});
  roots.push(root);
  return root;
}
function nodes(tree: any): any[] {
  if (!tree || typeof tree !== 'object') return [];
  return [tree, ...[tree.props?.children].flat(Infinity).flatMap(nodes)];
}
function tree(root: any) { return root.value; }

describe('rendered rewards QR content', () => {
  it('renders the complete opaque payload with fixed contrast and white quiet zone at both screen sizes', () => {
    for (const size of [120, 150]) {
      const rendered = tree(render(state(), size));
      const items = nodes(rendered);
      const qr = items.find(node => node.type?.name === 'QRCode');
      assert.equal(qr.props.value, `uc-rewards:v1:${'x'.repeat(43)}`);
      assert.equal(qr.props.size, size);
      assert.equal(qr.props.color, '#1a1a1a');
      assert.equal(qr.props.backgroundColor, '#ffffff');
      assert.ok(items.some(node => node.props?.style?.padding === 12 && node.props.style.backgroundColor === '#ffffff'));
    }
  });
  it('hides cached codes during validation and after failed validation', () => {
    assert.equal(tree(render(state({ loading: true }))).type.name, 'PageDataLoader');
    const failed = tree(render(state({ error: new Error('offline') })));
    assert.equal(failed.type.name, 'PageDataError');
    assert.equal(nodes(failed).some(node => node.type?.name === 'QRCode'), false);
  });
  it('provides explicit recovery separately from read-only retry', async () => {
    let recovered = 0, read = 0;
    const root = render(state({ token: null, recoveryRequired: true, recover: async () => { recovered++; }, retry: async () => { read++; } }));
    const button = nodes(tree(root)).find(node => node.props?.testID === 'recover-rewards-qr');
    assert.ok(button);
    button.props.onPress(); button.props.onPress();
    await Promise.resolve();
    assert.equal(recovered, 1);
    assert.equal(read, 0);
    const error = tree(render(state({ error: { status: 401 } })));
    assert.equal(error.props.error.status, 401);
    await error.props.onRetry();
    assert.equal(recovered, 1);
  });
  it('makes storage limitations visible without marking a verified code unavailable', () => {
    const items = nodes(tree(render(state({ persistenceWarning: true }))));
    assert.ok(items.some(node => node.type?.name === 'QRCode'));
    assert.ok(items.some(node => node.props?.testID === 'rewards-qr-storage-warning'));
  });
});