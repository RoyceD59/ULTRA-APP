import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { once } from 'node:events';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('@playwright/test');
const { inspectFonts, fontFamilyConsumers } = require('../startup-fonts.cjs');
const { exportEnvironment, isolateRequests, measureStartup } = require('../check-startup-fonts.cjs');

test('allowlist is limited to used icon families, never text or an entire icon barrel', () => {
  const names = [
    'Ionicons.ttf', `Feather.${'a'.repeat(32)}.ttf`,
    'Inter_400Regular.ttf', 'MaterialIcons.ttf', 'Ionicons-extra.ttf', 'Feather.woff2',
  ];
  const fonts = inspectFonts(names.map(name => ({ url: `http://127.0.0.1/assets/${name}?v=1` })));
  assert.deepEqual(fonts.map(font => font.allowed), [true, true, false, false, false, false]);
  assert.ok(fonts.filter(font => !font.allowed).every(font => font.review.includes('fontFamily')));
  for (const font of fonts.filter(font => font.allowed)) {
    const consumer = fs.readFileSync(path.resolve(import.meta.dirname, '../..', font.consumer), 'utf8');
    assert.match(consumer, new RegExp(`@expo/vector-icons/${font.family}`));
  }
});

test('fixture export clears public production configuration and disables dotenv', () => {
  const env = exportEnvironment({
    PATH: '/tools', EXPO_PUBLIC_ANALYTICS_URL: 'https://real.example',
    EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY: 'fixture', EXPO_PUBLIC_PREVIEW_SAFE_MODE: '0',
  }, 'http://127.0.0.1:12345');
  assert.equal(env.PATH, '/tools');
  assert.equal(env.EXPO_PUBLIC_ANALYTICS_URL, undefined);
  assert.equal(env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY, undefined);
  assert.equal(env.EXPO_PUBLIC_API_DOMAIN, 'http://127.0.0.1:12345');
  assert.equal(env.EXPO_PUBLIC_PREVIEW_SAFE_MODE, '1');
  assert.equal(env.EXPO_NO_DOTENV, '1');
  assert.equal(env.NODE_ENV, 'production');
  assert.equal(env.CI, '1');
  assert.equal(env.UC_WEB_EXPORT_BASE_PATH, '');
});

test('isolation blocks mutations and external assets; every API read is fulfilled locally', async () => {
  let handler;
  const violations = [];
  await isolateRequests({ route: async (_, callback) => { handler = callback; } },
    'http://127.0.0.1:12345', false, violations);
  async function request(url, method = 'GET') {
    let action;
    await handler({
      request: () => ({ url: () => url, method: () => method }),
      abort: async () => { action = 'abort'; },
      fulfill: async () => { action = 'fixture'; },
      continue: async () => { action = 'continue'; },
    });
    return action;
  }
  assert.equal(await request('https://customer.example/api/uc/orders', 'POST'), 'abort');
  assert.equal(await request('https://customer.example/api/uc/products'), 'fixture');
  assert.equal(await request('https://fonts.example/text.woff2'), 'abort');
  assert.equal(await request('http://127.0.0.1:12345/assets/Ionicons.ttf'), 'continue');
  assert.equal(violations.length, 2);
});

test('consumer report includes real fontFamily declarations, not font registration as proof of use', () => {
  const consumers = fontFamilyConsumers(path.resolve(import.meta.dirname, '../..'));
  assert.ok(consumers.some(match => match.file === 'components/ErrorFallback.tsx'));
  assert.ok(consumers.every(match => match.line > 0 && match.source.includes('fontFamily')));
});

test('browser guard counts delayed background bodies, MIME-only fonts, failures and duplicate requests', { timeout: 60000 }, async () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'uc-font-guard-test-'));
  const body = Buffer.from('fixture-font-body');
  let regression = false;
  const server = http.createServer((req, res) => {
    if (req.url === '/') {
      res.setHeader('content-type', 'text/html');
      res.end(`<h1>Your water, your health</h1><script>
        fetch('/Ionicons.ttf');
        ${regression ? `
          setTimeout(() => {
            fetch('/Inter_400Regular.ttf');
            fetch('/Inter_400Regular.ttf?repeat=1');
            fetch('/opaque-font');
            fetch('/Feather.ttf');
          }, 700);
        ` : ''}
      </script>`);
    } else {
      res.setHeader('content-type', 'font/ttf');
      if (req.url === '/Feather.ttf') res.statusCode = 404;
      // Finish after the greeting and after the initial idle gap.
      setTimeout(() => res.end(body), 1000);
    }
  }).listen(0, '127.0.0.1');
  let browser;
  try {
    await once(server, 'listening');
    browser = await chromium.launch({
      executablePath: process.env.CHROMIUM_PATH || '/repl/tools/bin/chromium',
      headless: true, args: ['--no-sandbox'],
      env: { ...process.env, HOME: temporary, XDG_CONFIG_HOME: temporary, XDG_CACHE_HOME: temporary },
    });
    const origin = `http://127.0.0.1:${server.address().port}`;
    const passing = await measureStartup(browser, origin, false);
    assert.equal(passing.passed, true, JSON.stringify(passing));
    assert.equal(passing.fonts.length, 1);
    assert.equal(passing.totalBodyBytes, body.length);
    regression = true;
    const failing = await measureStartup(browser, origin, true);
    assert.equal(failing.passed, false);
    assert.equal(failing.fonts.length, 5);
    assert.equal(failing.totalBodyBytes, body.length * 5);
    assert.ok(failing.fonts.every(font => font.bodyBytes === body.length && font.complete));
    assert.equal(failing.fonts.filter(font => font.asset === 'Inter_400Regular.ttf').length, 2);
    assert.ok(failing.fonts.some(font => font.asset === 'opaque-font' && !font.allowed));
    assert.ok(failing.fonts.some(font => font.asset === 'Feather.ttf' && font.error === 'HTTP 404'));
    assert.ok(failing.fonts.some(font => font.finishedMs > failing.greetingMs + 2000));
    assert.deepEqual(failing.errors, []);
    assert.deepEqual(failing.violations, []);
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});