// Production-equivalent browser smoke check. Start server/serve.js separately.
// Public API requests are read-only; no sign-in or customer mutations occur.
import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';

const origin = 'https://app.ucfilters.com';
const localServer = process.env.UC_STATIC_TEST_SERVER || 'http://127.0.0.1:3010';
const base = (process.env.BASE_PATH || '/uc-companion').replace(/\/+$/, '');
const browser = await chromium.launch({
  headless: true,
  ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
  args: ['--no-sandbox'],
});
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  const scripts = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => {
    if (request.url().includes('/static/js/web/')) scripts.push(request.url());
  });
  let releaseFonts;
  const fontGate = new Promise(resolve => { releaseFonts = resolve; });
  let delayFonts = true;
  let failFonts = false;
  await page.route(`${origin}/**`, async route => {
    const url = new URL(route.request().url());
    if (url.pathname.startsWith('/api/')) return route.continue();
    if (url.pathname.includes('Inter_') && /\.(ttf|woff2?)(\?|$)/.test(url.pathname)) {
      if (failFonts) return route.abort('failed');
      if (delayFonts) await fontGate;
    }
    const response = await page.request.get(`${localServer}${url.pathname}${url.search}`);
    return route.fulfill({ response });
  });
  await page.goto(`${origin}${base}/`, { waitUntil: 'domcontentloaded' });
  await page.getByText('Your water, your health', { exact: true }).waitFor({ state: 'visible' });
  assert.equal(await page.evaluate(() =>
    [...document.fonts].filter(font => font.family.includes('Inter')).some(font => font.status === 'loaded')
  ), false, 'Content must paint before Inter responses are released');
  const homeHeader = page.locator('img[src*="home-water"]');
  await homeHeader.waitFor();
  assert.equal(await homeHeader.getAttribute('loading'), 'eager');
  assert.equal(await homeHeader.getAttribute('fetchpriority'), 'high');
  const before = await homeHeader.boundingBox();
  assert.equal(before.height, 128);
  assert.equal(scripts.some(url => /\/(checkout|cart|rewards|product-edit)-/.test(url)), false);
  delayFonts = false;
  releaseFonts();
  await page.evaluate(() => document.fonts.ready);
  const after = await homeHeader.boundingBox();
  assert.deepEqual(after, before, 'Font swap must preserve the header band');
  assert.equal(await page.evaluate(() =>
    [...document.fonts].filter(font => font.family.includes('Inter')).some(font => font.status === 'loaded')
  ), true);
  const homeScripts = [...scripts];

  // Real client navigation must fetch the deferred route rather than reloading.
  await page.getByRole('tab', { name: /Products/ }).click();
  await page.locator('img[src*="products-slide-shower"]').waitFor({ state: 'visible' });
  assert.ok(scripts.some(url => /\/products-/.test(url)));
  await page.getByRole('tab', { name: /Blog/ }).click();
  await page.locator('img[src*="blog-water"]').waitFor({ state: 'visible' });
  for (const asset of ['products-slide-shower', 'blog-water']) {
    const image = page.locator(`img[src*="${asset}"]`);
    if (await image.count()) {
      assert.equal(await image.getAttribute('loading'), 'eager');
      assert.equal(await image.getAttribute('fetchpriority'), 'high');
    }
  }
  for (const route of ['/products', '/blog', '/cart', '/auth/login', '/product/42']) {
    await page.goto(`${origin}${base}${route}`, { waitUntil: 'networkidle' });
    assert.ok((await page.locator('body').innerText()).trim().length > 20, `Empty deep route ${route}`);
  }
  failFonts = true;
  await page.goto(`${origin}${base}/`, { waitUntil: 'networkidle' });
  await page.getByText('Your water, your health', { exact: true }).waitFor({ state: 'visible' });
  assert.deepEqual(errors, [], 'Browser runtime errors');
  console.log(JSON.stringify({
    viewport: { width: 390, height: 844 },
    homeScripts,
    delayedFonts: 'content rendered before Inter loaded; band unchanged after swap',
    failedFonts: 'content remained visible',
    navigation: 'Products and Blog loaded deferred routes',
    deepLinks: ['products', 'blog', 'cart', 'auth/login', 'product/42'],
    errors,
    limitation: 'Local production artifact, not a throttled production LCP/CLS measurement or signed-in/native test.',
  }, null, 2));
} finally {
  await browser.close();
}