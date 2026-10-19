import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const { chromium, expect } = require('@playwright/test');
const { build } = createRequire(require.resolve('tsx/package.json'))('esbuild');
const appDir = fileURLToPath(new URL('../..', import.meta.url));
let server;
let browser;
let origin;
let browserHome;

// Render the actual screens and React Native Web controls. Only the surrounding
// auth provider, Expo navigation bridge, and native/decorative dependencies are
// replaced; neither recovery handler nor email initialization is duplicated.
async function screenBundle() {
  const result = await build({
    stdin: {
      contents: `
        import React, {useSyncExternalStore} from 'react';
        import {createRoot} from 'react-dom/client';
        import LoginScreen from './app/auth/login';
        import ForgotPasswordScreen from './app/auth/forgot-password';
        const subscribe = callback => {
          window.addEventListener('fixture-navigation', callback);
          return () => window.removeEventListener('fixture-navigation', callback);
        };
        function App() {
          const path = useSyncExternalStore(subscribe, () => location.pathname);
          return path === '/auth/forgot-password'
            ? <ForgotPasswordScreen /> : <LoginScreen />;
        }
        createRoot(document.getElementById('root')).render(<App />);
      `,
      resolveDir: appDir,
      loader: 'jsx',
    },
    bundle: true,
    write: false,
    format: 'iife',
    platform: 'browser',
    tsconfig: join(appDir, 'tsconfig.json'),
    alias: { 'react-native': 'react-native-web' },
    define: { 'process.env.NODE_ENV': '"production"', __DEV__: 'false' },
    plugins: [{
      name: 'auth-screen-fixture',
      setup(builder) {
        const stubs = {
          'expo-router': `
            function navigate(destination) {
              const url = typeof destination === 'string' ? destination
                : destination.pathname + '?' + new URLSearchParams(destination.params);
              window.history.pushState({}, '', url);
              window.dispatchEvent(new Event('fixture-navigation'));
            }
            export const useRouter = () => ({push: navigate, replace: navigate});
            export const useLocalSearchParams = () =>
              Object.fromEntries(new URLSearchParams(location.search));
          `,
          '@/context/AuthContext': `
            export const useAuth = () => ({
              login: async () => { throw new Error('Recovery must not sign in'); },
              mustChangePassword: false, sessionNotice: null,
              dismissSessionNotice: () => {},
            });
          `,
          'expo-haptics': 'export const ImpactFeedbackStyle = {Light: "light"}; export const impactAsync = async () => {};',
          '@expo/vector-icons/Ionicons': 'export default function Icon() { return null; }',
          '@/components/BrandLogo': 'export default function BrandLogo() { return null; }',
          '@/components/SocialAuthButtons': 'export default function SocialAuthButtons() { return null; }',
          'react-native-keyboard-controller': 'export {ScrollView as KeyboardAwareScrollView} from "react-native-web";',
        };
        builder.onResolve({ filter: /.*/ }, args => {
          if (Object.hasOwn(stubs, args.path)) {
            return { path: args.path, namespace: 'auth-fixture' };
          }
        });
        builder.onLoad({ filter: /.*/, namespace: 'auth-fixture' }, args => ({
          contents: stubs[args.path], loader: 'js', resolveDir: appDir,
        }));
      },
    }],
  });
  return result.outputFiles[0].text;
}

before(async () => {
  const bundle = await screenBundle();
  server = createServer((request, response) => {
    if (request.url === '/bundle.js') {
      response.setHeader('Content-Type', 'application/javascript');
      response.end(bundle);
      return;
    }
    response.setHeader('Content-Type', 'text/html');
    response.end(`<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1">
      <style>html,body,#root{height:100%;margin:0}#root{display:flex;flex-direction:column}</style>
      </head><body><div id="root"></div><script src="/bundle.js"></script></body></html>`);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
  browserHome = mkdtempSync(join(tmpdir(), 'uc-recovery-browser-'));
  browser = await chromium.launch({
    executablePath: execFileSync('which', ['chromium'], { encoding: 'utf8' }).trim(),
    headless: true,
    args: ['--no-sandbox'],
    env: { ...process.env, HOME: browserHome, XDG_CONFIG_HOME: browserHome, XDG_CACHE_HOME: browserHome },
  });
});

after(async () => {
  await browser?.close();
  if (server) await new Promise(resolve => server.close(resolve));
  if (browserHome) rmSync(browserHome, { recursive: true, force: true });
});

for (const viewport of [{ width: 390, height: 844 }, { width: 1440, height: 900 }]) {
  for (const scenario of [
    { name: 'typed email', typed: 'customer+recovery@example.com', expected: 'customer+recovery@example.com' },
    { name: 'surrounding whitespace', typed: '  customer@example.com  ', expected: 'customer@example.com' },
    { name: 'empty email', typed: '', expected: '' },
    { name: 'whitespace-only email', typed: '   ', expected: '' },
  ]) {
    test(`${viewport.width}px: recovery below Sign In opens with ${scenario.name}`, async () => {
      const page = await browser.newPage({ viewport, hasTouch: viewport.width === 390 });
      const errors = [];
      const resetRequests = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.route('**/api/uc/auth/**', route => {
        resetRequests.push(route.request().url());
        return route.abort();
      });
      try {
        await page.goto(`${origin}/auth/login`);
        const identifier = page.getByTestId('login-identifier');
        const recovery = page.getByTestId('forgot-password-link');
        const signIn = page.getByText('Sign In', { exact: true });
        await expect(signIn).toBeVisible();
        await expect(recovery).toBeVisible();
        await expect(recovery).toHaveText('Forgot password?');
        const signInBox = await signIn.boundingBox();
        const recoveryBox = await recovery.boundingBox();
        assert.ok(signInBox && recoveryBox);
        assert.ok(recoveryBox.y >= signInBox.y + signInBox.height, 'Recovery link must be below Sign In');

        await identifier.fill(scenario.typed);
        // Keep focus in the field: customers should not need to blur it first.
        await expect(identifier).toBeFocused();
        if (viewport.width === 390) await recovery.tap();
        else await recovery.click();
        await expect(page).toHaveURL(/\/auth\/forgot-password(?:\?|$)/);
        assert.equal(new URL(page.url()).searchParams.get('email'), scenario.expected || null);
        await expect(page.getByTestId('reset-email')).toBeVisible();
        await expect(page.getByTestId('reset-email')).toHaveValue(scenario.expected);
        await expect(page.getByText('Forgot Password?', { exact: true })).toBeVisible();
        assert.deepEqual(resetRequests, [], 'Opening recovery must not submit a reset request');
        assert.deepEqual(errors, []);
      } finally {
        await page.close();
      }
    });
  }
}