import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { __testRender } from 'react';
import { __setPlatform } from 'react-native';
import { _reset as resetStorage, _storage } from '@react-native-async-storage/async-storage';
import { AuthProvider } from '../../context/AuthContext.tsx';
import { ExpiredSessionNotice } from '../../components/ExpiredSessionNotice.tsx';
import { DELETED_ACCOUNT_ERROR, PASSWORD_RESET_SESSION_ERROR, handleRejectedSessionResponse } from '../deletedAccountResponse.js';
import { shouldRedirectToLogin } from '../../lib/authSessionRedirect.js';
import { AUTH_SESSION_KEY } from '../../lib/sessionPersistence.js';
import { getHydrateCustomerTree } from '@workspace/api-client-react/companion/customer';

const NOTICE = 'Your session has expired. Please sign in again.';
const realFetch = globalThis.fetch;
const authRoots: ReturnType<typeof __testRender>[] = [];
function renderAuth() {
  const root = __testRender(AuthProvider, { children: null });
  authRoots.push(root);
  return root;
}

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

async function signIn(auth: ReturnType<typeof __testRender>, token = 'current-token'): Promise<void> {
  globalThis.fetch = async () => new Response(
    JSON.stringify({
      token,
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
  for (const root of authRoots.splice(0)) root.dispose();
  globalThis.fetch = realFetch;
  resetStorage();
  __setPlatform('ios');
});

describe('expired-session notice integration', () => {
  for (const error of [DELETED_ACCOUNT_ERROR, PASSWORD_RESET_SESSION_ERROR]) {
  it(`returns ${error} to login and consumes its explanation once`, async () => {
    const auth = renderAuth();
    await signIn(auth);
    assert.equal(auth.value.token, 'current-token');
    const tokenBeforeRejection = auth.value.token;

    assert.equal(await handleRejectedSessionResponse(401, 'current-token', { error }), true);
    auth.flush();

    assert.equal(auth.value.token, null);
    assert.equal(auth.value.user, null);
    assert.equal(_storage.has(AUTH_SESSION_KEY), false);
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
    await handleRejectedSessionResponse(401, 'current-token', { error });
    auth.flush();
    assert.equal(auth.value.sessionNotice, null, 'a delayed duplicate must not restore the notice');
    assert.equal(shouldRedirectToLogin(null, auth.value.token), false);
  });
  }

  it('cleans up simultaneous password-reset failures only once before a render', async () => {
    const auth = renderAuth();
    await signIn(auth);
    const first = handleRejectedSessionResponse(401, 'current-token', { error: PASSWORD_RESET_SESSION_ERROR });
    const duplicate = handleRejectedSessionResponse(401, 'current-token', { error: PASSWORD_RESET_SESSION_ERROR });
    await Promise.all([first, duplicate]);
    auth.flush();
    assert.equal(auth.value.token, null);
    assert.equal(_storage.has(AUTH_SESSION_KEY), false, 'a duplicate must not supersede queued durable cleanup');
  });

  it('keeps unrelated authentication errors and wrong-status responses signed in', async () => {
    const auth = renderAuth();
    await signIn(auth);
    for (const [status, error] of [[401, 'Unauthorized'], [401, 'Invalid credentials'],
      [403, PASSWORD_RESET_SESSION_ERROR], [503, DELETED_ACCOUNT_ERROR]] as const) {
      assert.equal(await handleRejectedSessionResponse(status, 'current-token', { error }), false);
      auth.flush();
      assert.equal(auth.value.token, 'current-token');
      assert.equal(auth.value.sessionNotice, null);
      assert.equal(_storage.has(AUTH_SESSION_KEY), true);
    }
  });

  it('does not clear a newer session when a rejected old request finishes', async () => {
    const auth = renderAuth();
    await signIn(auth);
    await handleRejectedSessionResponse(401, 'old-token', { error: PASSWORD_RESET_SESSION_ERROR });
    auth.flush();
    assert.equal(auth.value.token, 'current-token');
    assert.equal(auth.value.sessionNotice, null);
    assert.equal(_storage.has(AUTH_SESSION_KEY), true);
  });

  it('handles the same password-reset response through the generated API client', async () => {
    const auth = renderAuth();
    await signIn(auth);
    globalThis.fetch = async () => new Response(
      JSON.stringify({ error: PASSWORD_RESET_SESSION_ERROR }),
      { status: 401, headers: { 'Content-Type': 'application/json' } },
    );
    await assert.rejects(
      getHydrateCustomerTree({ headers: { Authorization: 'Bearer current-token' } }),
      (error: { status?: number }) => error.status === 401,
    );
    auth.flush();
    assert.equal(auth.value.token, null);
    assert.equal(auth.value.sessionNotice, NOTICE);
    assert.equal(_storage.has(AUTH_SESSION_KEY), false);
  });

  it('keeps unrelated generated-client 401s signed in', async () => {
    const auth = renderAuth();
    await signIn(auth);
    globalThis.fetch = async () => new Response(
      JSON.stringify({ error: 'Unauthorized' }),
      { status: 401, headers: { 'Content-Type': 'application/json' } },
    );
    await assert.rejects(getHydrateCustomerTree({
      headers: { Authorization: 'Bearer current-token' },
    }));
    auth.flush();
    assert.equal(auth.value.token, 'current-token');
    assert.equal(auth.value.sessionNotice, null);
  });

  it('preserves a newer login when an old generated-client request finishes late', async () => {
    const auth = renderAuth();
    await signIn(auth);
    let resolveResponse!: (response: Response) => void;
    globalThis.fetch = async () => new Promise<Response>(resolve => { resolveResponse = resolve; });
    const pending = getHydrateCustomerTree({
      headers: { Authorization: 'Bearer current-token' },
    });
    await signIn(auth, 'new-token');
    resolveResponse(new Response(
      JSON.stringify({ error: PASSWORD_RESET_SESSION_ERROR }),
      { status: 401, headers: { 'Content-Type': 'application/json' } },
    ));
    await assert.rejects(pending);
    auth.flush();
    assert.equal(auth.value.token, 'new-token');
    assert.equal(auth.value.sessionNotice, null);
    assert.equal(JSON.parse(_storage.get(AUTH_SESSION_KEY)!).token, 'new-token');
  });

  it('shows no explanation on first launch or explicit sign-out', async () => {
    const firstLaunch = renderAuth();
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