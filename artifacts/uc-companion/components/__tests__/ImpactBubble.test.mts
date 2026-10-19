import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire, registerHooks } from 'node:module';
import { readFileSync } from 'node:fs';
import { __testRender } from '../../__mocks__/react.ts';

const require = createRequire(import.meta.url);
const nativeUrl = new URL('./fixtures/impact-native.mjs', import.meta.url).href;
const impact = await import(nativeUrl);
const loader = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'react-native') return { url: nativeUrl, shortCircuit: true };
    if (specifier === '@/hooks/useGlobalImpact') return { url: nativeUrl, shortCircuit: true };
    if (specifier === '@/hooks/useColors') return {
      url: nativeUrl,
      shortCircuit: true,
    };
    return nextResolve(specifier, context);
  },
});
const ImpactBubble = require('../ImpactBubble.tsx').default;
const ForestLink = require('../ForestLink.tsx').default;
loader.deregister();

function nodes(tree: any): any[] {
  if (!tree || typeof tree !== 'object') return [];
  return [tree, ...[tree.props?.children].flat(Infinity).flatMap(nodes)];
}
function text(tree: any): string {
  if (typeof tree === 'string') return tree;
  return tree && typeof tree === 'object'
    ? [tree.props?.children].flat(Infinity).map(text).join('') : '';
}
const roots: Array<{ dispose(): void }> = [];
afterEach(() => { roots.splice(0).forEach(root => root.dispose()); });
const brief = 'Hydrate the Future™ receives 3% of eligible paid purchases, split equally between tree growing in our community and clean-water access. Logged refills do not add funding.';
const data = { totalUsers: 2, litresFiltered: 450, plasticsAvoided: 900, cleanWaterDays: 0,
  snapshotId: 'a'.repeat(64), calculatedAt: '2026-10-05T00:00:00Z' };

for (const [name, state] of Object.entries({
  loaded: { data, isPending: false, isError: false },
  loading: { data: undefined, isPending: true, isError: false },
  unavailable: { data: undefined, isPending: false, isError: true },
  'failed refresh with previous figures': { data, isPending: false, isError: true },
})) {
  test(`programme policy and anonymous forest remain available: ${name}`, () => {
    let retries = 0;
    impact.configure({ ...state, freshness: state.isError ? (state.data ? 'STALE' : 'UNAVAILABLE') : state.data ? 'CURRENT' : 'LOADING',
      dataUpdatedAt: Date.now(), isFetching: false, refetch() { retries++; } });
    const root = __testRender(() => ({ props: { value: ImpactBubble() } }), {});
    roots.push(root);
    const all = nodes(root.value);
    const programme = all.find(n => n.props?.testID === 'global-impact-programme');
    assert.ok(programme);
    assert.equal(text(all.find(n => n.props?.testID === 'global-impact-programme-brief')), brief);
    assert.match(text(root.value), /Together, we're replacing single-use plastic/);
    assert.match(text(root.value), /Shared global totals managed through ProjectHub/);
    assert.equal(programme.props.children[0].props.children, 'Programme policy');
    const link = programme.props.children.at(-1);
    assert.equal(link.type.default ?? link.type, ForestLink);
    assert.equal(link.props.label, 'Explore the global forest');
    assert.equal(link.props.light, true);
    assert.equal(link.props.treeId, undefined);
    assert.equal(programme.props.children[1].props.numberOfLines, undefined);
    assert.equal(programme.props.children[1].props.maxFontSizeMultiplier, undefined);
    if (state.isError) {
      assert.match(text(root.value), state.data ? /Last-known figures/ : /Global impact is unavailable/);
      all.find(n => n.props?.testID === 'global-impact-retry').props.onPress();
      assert.equal(retries, 1);
    }
  });
}

test('Home and About continue using the same shared badge', () => {
  for (const path of ['../../app/(tabs)/index.tsx', '../../app/about.tsx']) {
    const source = readFileSync(new URL(path, import.meta.url), 'utf8');
    assert.match(source, /import ImpactBubble from '@\/components\/ImpactBubble'/);
    assert.match(source, /<ImpactBubble \/>/);
  }
});

test('public forest opening retains anonymous URL and visible failure feedback', async () => {
  const previous = impact.Linking.openURL;
  const destinations: string[] = [];
  impact.Linking.openURL = async (destination: string) => {
    destinations.push(destination);
    throw new Error('Opening failed');
  };
  try {
    const root = __testRender(() => ({ props: { value: ForestLink({ label: 'Explore the global forest', light: true }) } }), {});
    roots.push(root);
    const link = nodes(root.value).find(n => n.props?.testID === 'global-impact-forest-link');
    assert.equal(link.props.accessibilityRole, 'link');
    const label = link.props.children[0];
    assert.equal(label.props.style[0].flexShrink, 1);
    assert.equal(label.props.numberOfLines, undefined);
    await link.props.onPress();
    root.flush();
    assert.match(text(root.value), /Unable to open the forest. Please try again./);
    const destination = new URL(destinations[0]);
    assert.equal(destination.protocol, 'https:');
    assert.equal(destination.search, '');
    assert.equal(destination.hash, '');
    assert.equal(destination.username, '');
  } finally {
    impact.Linking.openURL = previous;
  }
});