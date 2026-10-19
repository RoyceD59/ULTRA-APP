import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { browserExecutablePath } from './fixtures/browser.mjs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startFixture } from './fixtures/public-web.mjs';
const require = createRequire(import.meta.url);
const { chromium } = require('@playwright/test');
// Reuse the compiler already provisioned by this package's tsx test toolchain.
const { build } = createRequire(require.resolve('tsx/package.json'))('esbuild');
// Chromium writes config/crash state outside its Playwright profile too.
// Keep review/CI tests usable when the inherited HOME is read-only.
const browserHome = mkdtempSync(join(tmpdir(), 'uc-browser-home-'));
after(() => rmSync(browserHome, { recursive: true, force: true }));
const launchBrowser = () => chromium.launch({
  executablePath: browserExecutablePath(),
  headless: true, args: ['--no-sandbox'],
  env: { ...process.env, HOME: browserHome, XDG_CONFIG_HOME: browserHome, XDG_CACHE_HOME: browserHome },
});

async function clientBundle() {
  const result = await build({
    stdin: {
      contents: `
        import React from 'react';
        import {createRoot} from 'react-dom/client';
        import {usePublicWebDocument} from './hooks/usePublicWebDocument';
        import PublicRecordDocument from './components/PublicRecordDocument';
        import {usePathname} from 'expo-router';
        function App() {
          usePublicWebDocument();
          const path = usePathname();
          const actions = () => React.createElement('div', null,
            React.createElement('button', {onClick: () => window.navigate('/checkout')}, 'Checkout'),
            React.createElement('button', {onClick: () => window.navigate('/blog/water-care')}, 'Article'),
            React.createElement('button', {onClick: () => window.navigate('/topic/plastic-waste')}, 'Topic'));
          if (/^\\/(product|topic)\\//.test(path)) return React.createElement(PublicRecordDocument, {route:path, controls:actions});
          return React.createElement('div', null,
            React.createElement('h1', null, 'Interactive Companion fixture'),
            actions());
        }
        window.navigate = path => {
          window.history.pushState({}, '', '/uc-companion' + path);
          window.dispatchEvent(new Event('fixture-route'));
        };
        createRoot(document.getElementById('root')).render(React.createElement(App));
      `,
      resolveDir: fileURLToPath(new URL('../..', import.meta.url)), loader: 'js',
    },
    bundle: true, write: false, format: 'iife', platform: 'browser',
    define: { 'process.env.NODE_ENV': '"production"' },
    plugins: [{
      name: 'fixture-platform',
      setup(builder) {
        builder.onResolve({ filter: /^(react-native|expo-router)$/ }, args => ({ path: args.path, namespace: 'fixture' }));
        builder.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({
          contents: args.path === 'react-native' ? 'export const Platform = { OS: "web" }; export const Text = "p"; export const View = "div";' : `
            import {useSyncExternalStore} from 'react';
            const subscribe = cb => { window.addEventListener('fixture-route', cb); return () => window.removeEventListener('fixture-route', cb); };
            const snapshot = () => window.location.pathname.replace(/^\\/uc-companion/, '') || '/';
            export const usePathname = () => useSyncExternalStore(subscribe, snapshot);
          `,
          loader: 'js', resolveDir: fileURLToPath(new URL('../..', import.meta.url)),
        }));
      },
    }],
  });
  return result.outputFiles[0].text;
}

test('desktop and phone browsers read public HTML without JavaScript', async () => {
  const server = await startFixture();
  const browser = await launchBrowser();
  try {
    for (const viewport of [{ width: 390, height: 844 }, { width: 768, height: 1024 }, { width: 1440, height: 900 }]) {
      const context = await browser.newContext({ javaScriptEnabled: false, viewport });
      const page = await context.newPage();
      await page.goto(`${server.base}/product/101`);
      assert.equal(await page.locator('h1').textContent(), 'Hydra Flux');
      assert.ok(await page.getByRole('link', { name: 'Ultra Clear Support', exact: true }).isVisible());
      assert.equal(await page.locator('html').getAttribute('lang'), 'en');
      assert.equal(await page.locator('link[rel=canonical]').getAttribute('href'), 'https://public.example/product/hydra-flux');
      assert.ok(await page.evaluate(() => document.documentElement.scrollHeight > innerHeight));
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      assert.equal(await page.locator('#uc-public-content').evaluate(node => getComputedStyle(node).position), 'static');
      await page.getByRole('link', { name: 'Ultra Clear Support', exact: true }).click();
      assert.equal(await page.locator('h1').textContent(), 'Ultra Clear Support');
      assert.ok(await page.getByRole('link', { name: 'Filter care', exact: true }).isVisible());
      await page.keyboard.press('Tab');
      assert.equal(await page.evaluate(() => document.activeElement.tagName), 'A');
      await context.close();
    }
  } finally { await browser.close(); await server.close(); }
});

test('actual web metadata hook hands off public HTML and removes stale public schema on private navigation', async () => {
  const server = await startFixture({ bundle: await clientBundle() });
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/bundle.js', async route => {
      await new Promise(resolve => setTimeout(resolve, 350));
      await route.continue();
    });
    await page.goto(`${server.base}/product/101`, { waitUntil: 'domcontentloaded' });
    await page.locator('[data-uc-record-ready]').waitFor();
    await page.waitForFunction(() => !document.getElementById('uc-public-content'));
    assert.equal(await page.title(), 'Hydra Flux 750 ml Insulated Water Filter Bottle | Ultra Clear');
    assert.equal(await page.locator('h1').count(), 1);
    assert.equal(await page.locator('h1').textContent(), 'Hydra Flux');
    for (const viewport of [{ width: 390, height: 844 }, { width: 768, height: 1024 }, { width: 1440, height: 900 }]) {
      await page.setViewportSize(viewport);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      assert.ok(await page.evaluate(() => document.documentElement.scrollHeight > innerHeight));
      assert.equal(await page.locator('.uc-record-document').evaluate(node => getComputedStyle(node).overflow), 'visible');
    }
    await page.setViewportSize({ width: 390, height: 844 });
    const question = page.locator('.uc-record-document details summary').first();
    assert.equal(await question.count(), 1, 'published product exposes a keyboard-operable accordion');
    await question.focus();
    await page.keyboard.press('Enter');
    assert.equal(await question.evaluate(node => node.parentElement.open), true);
    await page.screenshot({ path: join(tmpdir(), 'uc-record-enhanced-phone.jpg') });
    await page.getByRole('button', { name: 'Topic', exact: true }).click();
    await page.getByRole('heading', { name: 'plastic waste', exact: true }).waitFor();
    await page.waitForFunction(() => document.querySelector('meta[name=robots]')?.content === 'noindex, follow');
    assert.equal(await page.locator('[aria-label="Topic article"]').textContent(), '');
    assert.equal(await page.locator('h1').count(), 1);
    await page.getByRole('link', { name: 'Hydra Flux', exact: true }).click();
    await page.locator('[data-uc-record-ready]').waitFor();
    await page.getByRole('button', { name: 'Checkout', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('meta[name=robots]')?.content === 'noindex, follow'
      && !document.querySelector('link[rel=canonical]'));
    assert.equal(await page.locator('script[type="application/ld+json"]').count(), 0);
    assert.equal(await page.locator('html').getAttribute('data-uc-record-mode'), null);
    await page.getByRole('button', { name: 'Article', exact: true }).click();
    await page.waitForFunction(() => document.title === 'Water care | Ultra-Clear Companion');
    assert.equal(await page.locator('meta[property="og:type"]').getAttribute('content'), 'article');
    assert.equal(await page.locator('link[rel=canonical]').getAttribute('href'), 'https://public.example/blog/water-care');
    assert.equal(await page.locator('script[type="application/ld+json"]').count(), 1);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); await server.close(); }
});

test('previous compiled bundles can take over the initial document without the new hook', async () => {
  const server = await startFixture({ bundle: `document.getElementById('root').innerHTML = '<h1>Previous Companion bundle</h1>';` });
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage();
    await page.goto(`${server.base}/about`);
    await page.waitForFunction(() => !document.getElementById('uc-public-content'));
    assert.equal(await page.locator('h1').textContent(), 'Previous Companion bundle');
  } finally { await browser.close(); await server.close(); }
});
