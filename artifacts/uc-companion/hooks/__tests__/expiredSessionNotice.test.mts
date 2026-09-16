import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { __testRender } from 'react';
import { __setPlatform } from 'react-native';
import { _reset as resetStorage } from '@react-native-async-storage/async-storage';
import { AuthProvider } from '../../context/AuthContext.tsx';
import { ExpiredSessionNotice } from '../../components/ExpiredSessionNotice.tsx';
import { handleRejectedSessionResponse } from '../deletedAccountResponse.js';
import { shouldRedirectToLogin } from '../../lib/authSessionRedirect.js';

const NOTICE = 'Your session has expired. Please sign in again.';
const realFetch = globalThis.fetch;

type Element = {
  props?: {
    accessibilityLiveRegion?: string;
    accessibilityRole?: string;
    children?: unknown;
    testID?: string;
  };
};

function descendants(node: unknown): unknown[] {
  if (node == null || typeof node !== 'object') return [node];
  const element = node as Element;
  const children = Array.isArray(element.props?.children)
    ? element.props.children
    : [element.props?.children];
  return [node, ...children.flatMap(descendants)];
}

function renderNotice(message: string | null): unknown {
  return ExpiredSessionNotice({
    message,
    backgroundColor: '#fff4db',
    borderColor: '#b66a00',
    textColor: '#111111',
  });
}

async function signIn(auth: ReturnType<typeof __testRender>): Promise<void> {
  globalThis.fetch = async () => new Response(
    JSON.stringify({
      token: 'current-token',
      user: {
        id: 1,
        email: 'customer@example.com',
        phone: '+254700000001',
        firstName: 'Test',
        lastName: 'Customer',
      },
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
  assert.equal((await auth.value.login('customer@example.com', 'password')).success, true);
  auth.flush();
}

afterEach(() => {
  globalThis.fetch = realFetch;
  resetStorage();
  __setPlatform('ios');
});

describe('expired-session notice integration', () => {
  it('turns an authenticated 401 into the login state and consumes its explanation once', async () => {
    const auth = __testRender(AuthProvider, { children: null });
    await signIn(auth);
    assert.equal(auth.value.token, 'current-token');
    const tokenBeforeRejection = auth.value.token;

    assert.equal(await handleRejectedSessionResponse(401, 'current-token'), true);
    auth.flush();

    assert.equal(auth.value.token, null);
    assert.equal(
      shouldRedirectToLogin(tokenBeforeRejection, auth.value.token),
      true,
      'the root auth guard must redirect this transition to login',
    );
    assert.equal(auth.value.sessionNotice, NOTICE);
    assert.ok(descendants(renderNotice(auth.value.sessionNotice)).includes(NOTICE));

    auth.value.dismissSessionNotice();
    auth.flush();
    assert.equal(auth.value.sessionNotice, null);
    assert.equal(renderNotice(auth.value.sessionNotice), null, 'returning to login must not repeat a consumed notice');
  });

  it('shows no explanation on first launch or explicit sign-out', async () => {
    const firstLaunch = __testRender(AuthProvider, { children: null });
    assert.equal(firstLaunch.value.sessionNotice, null);
    assert.equal(renderNotice(firstLaunch.value.sessionNotice), null);

    await signIn(firstLaunch);
    await firstLaunch.value.logout();
    firstLaunch.flush();
    assert.equal(firstLaunch.value.token, null);
    assert.equal(firstLaunch.value.sessionNotice, null);
    assert.equal(renderNotice(firstLaunch.value.sessionNotice), null);
  });

  for (const platform of ['ios', 'android', 'web'] as const) {
    it(`renders alert semantics on ${platform}`, () => {
      __setPlatform(platform);
      const rendered = descendants(renderNotice(NOTICE));
      const alert = rendered.find(
        (node) => (node as Element)?.props?.testID === 'expired-session-notice',
      ) as Element | undefined;

      assert.equal(alert?.props?.accessibilityRole, 'alert');
      assert.equal(alert?.props?.accessibilityLiveRegion, 'polite');
      assert.ok(rendered.includes(NOTICE));
    });
  }
});