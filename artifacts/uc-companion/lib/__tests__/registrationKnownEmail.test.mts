import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { __testRender } from 'react';
import { AuthProvider } from '../../context/AuthContext.tsx';
import { RegistrationErrorNotice } from '../../components/RegistrationErrorNotice.tsx';

type Element = {
  props?: {
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

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe('known-email registration recovery', () => {
  it('passes the forgot_password hint through AuthContext and renders the recovery button', async () => {
    const error = 'An account with this email already exists.';
    globalThis.fetch = async () => new Response(
      JSON.stringify({ error, hint: 'forgot_password' }),
      { status: 409, headers: { 'Content-Type': 'application/json' } },
    );

    const auth = __testRender(AuthProvider, { children: null });
    const result = await auth.value.register({
      firstName: 'Known',
      lastName: 'Customer',
      email: 'known@example.com',
      phone: '+254712345678',
      password: 'password',
    });

    assert.deepEqual(result, {
      success: false,
      error,
      hint: 'forgot_password',
    });

    const notice = RegistrationErrorNotice({
      message: result.error!,
      hint: result.hint,
      primaryColor: '#005d8f',
      cardColor: '#ffffff',
      onForgotPassword: () => {},
    });
    const rendered = descendants(notice);

    assert.ok(rendered.includes(error), 'the server error message should be rendered');
    assert.ok(rendered.includes('Forgot password?'), 'the recovery button label should be rendered');
    assert.ok(
      rendered.some((node) => (node as Element)?.props?.testID === 'register-forgot-password'),
      'the recovery action should be tappable',
    );
  });

  it('renders the registration error without the recovery button when no hint is returned', async () => {
    const error = 'An active account already uses this phone number.';
    globalThis.fetch = async () => new Response(
      JSON.stringify({ error }),
      { status: 409, headers: { 'Content-Type': 'application/json' } },
    );

    const auth = __testRender(AuthProvider, { children: null });
    const result = await auth.value.register({
      firstName: 'Another',
      lastName: 'Customer',
      email: 'another@example.com',
      phone: '+254700000001',
      password: 'password',
    });

    assert.deepEqual(result, { success: false, error, hint: undefined });

    const notice = RegistrationErrorNotice({
      message: result.error!,
      hint: result.hint,
      primaryColor: '#005d8f',
      cardColor: '#ffffff',
      onForgotPassword: () => {},
    });
    const rendered = descendants(notice);

    assert.ok(rendered.includes(error), 'the server error message should still be rendered');
    assert.ok(!rendered.includes('Forgot password?'));
    assert.ok(
      !rendered.some((node) => (node as Element)?.props?.testID === 'register-forgot-password'),
      'no recovery action should render without the hint',
    );
  });
});