import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire, registerHooks } from 'node:module';
import { __testRender, useState } from '../../__mocks__/react.ts';
import type { ServerNotifPrefs } from '../../hooks/useApi.ts';

const require = createRequire(import.meta.url);
// Stub only native dependencies and the API boundary. The component's effect,
// pre-fill helper, state updates, and button condition all run unchanged.
const apiStubUrl = 'data:text/javascript,' + encodeURIComponent(`
  let fetchPrefs;
  export function setFetchPrefs(fetch) { fetchPrefs = fetch; }
  export function useApi() {
    return { getServerNotifPrefs: () => fetchPrefs() };
  }
`);
const apiStub = await import(apiStubUrl);
const loader = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === '@/hooks/useApi') {
      return { url: apiStubUrl, shortCircuit: true };
    }
    if (specifier === 'expo-haptics') {
      return { url: 'data:text/javascript,export {}', shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});
const ReminderOptInSheet = require('../ReminderOptInSheet.tsx').default;
loader.deregister();

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

function prefs(overrides: Partial<ServerNotifPrefs> = {}): ServerNotifPrefs {
  return {
    optOutOrders: false,
    reminderEmail: false,
    reminderSms: false,
    reminderWhatsapp: false,
    ...overrides,
  };
}

function find(tree: any, predicate: (element: any) => boolean): any {
  if (!tree || typeof tree !== 'object') return undefined;
  if (predicate(tree)) return tree;
  for (const child of [tree.props?.children].flat(Infinity)) {
    const match = find(child, predicate);
    if (match) return match;
  }
}

function enableButton(tree: any) {
  const button = find(tree, element =>
    element.type === 'TouchableOpacity'
    && element.props.children?.props?.children === 'Enable Reminders');
  assert.ok(button, 'the rendered Enable Reminders button must exist');
  return button;
}

function render() {
  const props = {
    visible: true,
    productId: 10,
    activatedAt: '2026-10-04',
    userId: 1,
    onClose() {},
  };
  let forceRender!: (update: (previous: number) => number) => void;
  const root = __testRender(() => {
    [, forceRender] = useState(0);
    return { props: { value: ReminderOptInSheet(props) } };
  }, {});
  root.flush();
  return {
    root,
    props,
    rerender() {
      forceRender(previous => previous + 1);
      root.flush();
    },
  };
}

function assertLoading(tree: any) {
  assert.ok(find(tree, element => element.type === 'ActivityIndicator'),
    'loading spinner must be visible while the fetch is pending');
  assert.equal(find(tree, element => typeof element.type === 'function'
    && element.props.label === 'Email reminders'), undefined,
  'channel rows must not be shown before preferences load');
  assert.equal(enableButton(tree).props.disabled, true);
}

describe('ReminderOptInSheet — Enable Reminders pre-fill gate', () => {
  it('is disabled during the pending fetch with all channels initially OFF', async () => {
    const request = deferred<ServerNotifPrefs>();
    apiStub.setFetchPrefs(() => request.promise);
    const { root } = render();
    try {
      assertLoading(root.value);
      // Keep the request unresolved across an async turn.
      await Promise.resolve();
      root.flush();
      assertLoading(root.value);
      request.resolve(prefs());
      await request.promise;
      root.flush();
    } finally {
      root.dispose();
    }
  });

  for (const channel of ['reminderEmail', 'reminderSms', 'reminderWhatsapp'] as const) {
    it(`becomes enabled only after the fetch resolves with ${channel} ON`, async () => {
      const request = deferred<ServerNotifPrefs>();
      apiStub.setFetchPrefs(() => request.promise);
      const { root } = render();
      try {
        assertLoading(root.value);
        request.resolve(prefs({ [channel]: true }));
        await request.promise;
        root.flush();
        assert.equal(find(root.value, element => element.type === 'ActivityIndicator'), undefined);
        assert.equal(enableButton(root.value).props.disabled, false);
        const labels = {
          reminderEmail: 'Email reminders',
          reminderSms: 'Text message (SMS)',
          reminderWhatsapp: 'WhatsApp',
        };
        for (const key of Object.keys(labels) as (keyof typeof labels)[]) {
          const row = find(root.value, element => element.props.label === labels[key]);
          assert.ok(row);
          assert.equal(row.props.value, key === channel);
        }
      } finally {
        root.dispose();
      }
    });
  }

  it('stays disabled after the fetch resolves with every channel OFF', async () => {
    const request = deferred<ServerNotifPrefs>();
    apiStub.setFetchPrefs(() => request.promise);
    const { root } = render();
    try {
      assertLoading(root.value);
      request.resolve(prefs());
      await request.promise;
      root.flush();
      assert.equal(find(root.value, element => element.type === 'ActivityIndicator'), undefined);
      for (const label of ['Email reminders', 'Text message (SMS)', 'WhatsApp']) {
        const row = find(root.value, element => element.props.label === label);
        assert.ok(row);
        assert.equal(row.props.value, false);
      }
      assert.equal(enableButton(root.value).props.disabled, true);
    } finally {
      root.dispose();
    }
  });

  it('disables again while reopening fetches prefs, even with a previous channel ON', async () => {
    apiStub.setFetchPrefs(() => Promise.resolve(prefs({ reminderEmail: true })));
    const { root, props, rerender } = render();
    try {
      await Promise.resolve();
      root.flush();
      assert.equal(enableButton(root.value).props.disabled, false);

      props.visible = false;
      rerender();
      const request = deferred<ServerNotifPrefs>();
      apiStub.setFetchPrefs(() => request.promise);
      props.visible = true;
      rerender();
      assertLoading(root.value);
      request.resolve(prefs({ reminderEmail: true }));
      await request.promise;
      root.flush();
      assert.equal(enableButton(root.value).props.disabled, false);
    } finally {
      root.dispose();
    }
  });
});