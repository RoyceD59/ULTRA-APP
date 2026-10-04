import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire, registerHooks } from 'node:module';
import { __testRender, useState } from '../../__mocks__/react.ts';
import type { ServerNotifPrefs } from '../../hooks/useApi.ts';
import { _reset, _setGates, _storage } from '../../__mocks__/@react-native-async-storage/async-storage.ts';
import { reminderOptInSeenKey } from '../../hooks/reminderOptInStorage.ts';

const require = createRequire(import.meta.url);
// Stub only native dependencies and the API boundary. The component's effect,
// pre-fill helper, state updates, and button condition all run unchanged.
const apiStubUrl = 'data:text/javascript,' + encodeURIComponent(`
  let fetchPrefs;
  let updatePrefs;
  export function setFetchPrefs(fetch) { fetchPrefs = fetch; }
  export function setUpdatePrefs(update) { updatePrefs = update; }
  export function useApi() {
    return {
      getServerNotifPrefs: () => fetchPrefs(),
      updatePushPrefs: prefs => updatePrefs(prefs),
    };
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
  return buttonWithText(tree, 'Enable Reminders');
}

function buttonWithText(tree: any, text: string) {
  const button = find(tree, element =>
    element.type === 'TouchableOpacity'
    && element.props.children?.props?.children === text);
  assert.ok(button, `the rendered ${text} button must exist`);
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

describe('ReminderOptInSheet — failed dismissal persistence', () => {
  beforeEach(() => {
    _reset();
    apiStub.setFetchPrefs(() => Promise.resolve(prefs({ reminderEmail: true })));
  });

  for (const action of ['Enable Reminders', 'Skip for now']) {
    it(`${action} stays open with a warning, then retries storage without repeating preference updates`, async () => {
      let updates = 0;
      let closes = 0;
      apiStub.setUpdatePrefs(async (value: any) => {
        updates++;
        assert.deepEqual(value, {
          reminderEmail: true, reminderSms: false, reminderWhatsapp: false,
        });
      });
      _setGates({ set: async () => { throw new Error('Disk full'); } });
      const { root, props } = render();
      props.onClose = () => { closes++; };
      try {
        await Promise.resolve();
        root.flush();
        await buttonWithText(root.value, action).props.onPress();
        root.flush();
        assert.equal(closes, 0, 'failed persistence must not silently close the sheet');
        const warning = find(root.value, element => element.props.accessibilityRole === 'alert');
        assert.match(warning.props.children, /Could not save.*on your device/);
        assert.match(warning.props.children, /may appear again next time/);
        if (action === 'Enable Reminders') {
          assert.match(warning.props.children, /reminder preferences were saved/);
        }
        const retry = buttonWithText(root.value, 'Retry saving dismissal');
        assert.equal(retry.props.disabled, false);
        assert.equal(_storage.has(reminderOptInSeenKey(props.productId, props.activatedAt, props.userId)), false);
        // Repeated failures stay recoverable rather than reporting success.
        await retry.props.onPress();
        root.flush();
        assert.equal(closes, 0);
        _setGates({});
        await buttonWithText(root.value, 'Retry saving dismissal').props.onPress();
        root.flush();
        assert.equal(closes, 1);
        assert.equal(updates, action === 'Enable Reminders' ? 1 : 0);
        assert.equal(_storage.get(reminderOptInSeenKey(props.productId, props.activatedAt, props.userId)), '1');
      } finally {
        root.dispose();
      }
    });

    it(`${action} allows an explicit close without pretending dismissal was persisted`, async () => {
      let closes = 0;
      apiStub.setUpdatePrefs(async () => {});
      _setGates({ set: async () => { throw new Error('Storage unavailable'); } });
      const { root, props } = render();
      props.onClose = () => { closes++; };
      try {
        await Promise.resolve();
        root.flush();
        await buttonWithText(root.value, action).props.onPress();
        root.flush();
        await buttonWithText(root.value, 'Close without saving').props.onPress();
        assert.equal(closes, 1);
        assert.equal(_storage.size, 0);
      } finally {
        root.dispose();
      }
    });
  }

  it('does not persist dismissal or offer storage retry when saving preferences fails', async () => {
    let closes = 0;
    apiStub.setUpdatePrefs(async () => { throw new Error('Offline'); });
    const { root, props } = render();
    props.onClose = () => { closes++; };
    try {
      await Promise.resolve();
      root.flush();
      await enableButton(root.value).props.onPress();
      root.flush();
      assert.equal(closes, 0);
      assert.equal(_storage.size, 0);
      assert.ok(find(root.value, element =>
        element.props.children === 'Could not save your preferences. Please try again.'));
      assert.equal(enableButton(root.value).props.disabled, false);
    } finally {
      root.dispose();
    }
  });

  for (const control of ['close icon', 'Android back']) {
    it(`${control} shows the same recoverable storage failure as Skip for now`, async () => {
      let closes = 0;
      _setGates({ set: async () => { throw new Error('Storage unavailable'); } });
      const { root, props } = render();
      props.onClose = () => { closes++; };
      try {
        await Promise.resolve();
        root.flush();
        if (control === 'close icon') {
          await find(root.value, element =>
            element.props.accessibilityLabel === 'Skip reminder opt-in').props.onPress();
        } else {
          find(root.value, element => element.type === 'Modal').props.onRequestClose();
          // onRequestClose intentionally returns void; drain the async write.
          await new Promise(resolve => setImmediate(resolve));
        }
        root.flush();
        assert.equal(closes, 0);
        assert.ok(find(root.value, element => element.props.accessibilityRole === 'alert'));
        assert.equal(buttonWithText(root.value, 'Retry saving dismissal').props.disabled, false);
      } finally {
        root.dispose();
      }
    });
  }

  it('ignores double taps and Android back while the dismissal write is pending', async () => {
    let closes = 0;
    let writes = 0;
    const gate = deferred<void>();
    _setGates({ set: async () => { writes++; await gate.promise; } });
    const { root, props } = render();
    props.onClose = () => { closes++; };
    try {
      await Promise.resolve();
      root.flush();
      const skip = buttonWithText(root.value, 'Skip for now');
      const pending = skip.props.onPress();
      await skip.props.onPress();
      find(root.value, element => element.type === 'Modal').props.onRequestClose();
      root.flush();
      assert.equal(buttonWithText(root.value, 'Skip for now').props.disabled, true);
      assert.equal(writes, 1);
      assert.equal(closes, 0);
      gate.resolve();
      await pending;
      assert.equal(closes, 1);
    } finally {
      root.dispose();
    }
  });
});