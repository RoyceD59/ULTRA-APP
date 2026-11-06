#!/usr/bin/env node
// Read-only interactive Expo WEB regression check. Not physical-device evidence.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { chromium, expect } = require('@playwright/test');

async function main() {
  const baseURL = process.env.ALISON_TEST_BASE_URL
    || (process.env.REPLIT_EXPO_DEV_DOMAIN && `https://${process.env.REPLIT_EXPO_DEV_DOMAIN}`);
  if (!baseURL) throw new Error('Set ALISON_TEST_BASE_URL to the running Companion web origin.');
  const productsURL = new URL('products', `${baseURL.replace(/\/$/, '')}/`);
  let readiness;
  try { readiness = await fetch(productsURL, { signal: AbortSignal.timeout(15000) }); }
  catch (error) { throw new Error(`Companion preview is not reachable. Start its API and Companion workflows before this browser check. ${error.message}`); }
  if (!readiness.ok) {
    await readiness.body?.cancel();
    throw new Error(`Companion preview returned HTTP ${readiness.status}. Start/check the API and Companion workflows before testing the welcome bubble.`);
  }
  await readiness.body?.cancel();
  const executablePath = process.env.CHROMIUM_PATH
    || (fs.existsSync('/repl/tools/bin/chromium') ? '/repl/tools/bin/chromium' : undefined);
  const browser = await chromium.launch({ executablePath, headless: true });
  let page;
  const errors = [];
  const consoleErrors = [];
  try {
    page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => {
      if (message.type() === 'error') consoleErrors.push(message.text().slice(0, 2000));
    });
    if (process.env.ALISON_TEST_FIXTURE_MODE === '1') {
      assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(productsURL.hostname), 'Catalogue fixture mode is local-preview-only');
      await page.route(url => url.pathname === '/api/uc/products', route => {
        const headers = {
          'Access-Control-Allow-Origin': productsURL.origin,
          'Access-Control-Allow-Methods': 'GET, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        };
        if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
        assert.equal(route.request().method(), 'GET', 'Catalogue fixture only handles reads');
        return route.fulfill({
          status: 200, contentType: 'application/json', headers,
          body: JSON.stringify([{
            id: 990001, name: 'Isolated filter fixture', slug: 'isolated-filter-fixture',
            price: '100', regularPrice: '100', salePrice: '', description: 'UI fixture only',
            shortDescription: 'UI fixture only', tagline: 'Isolated UI fixture',
            sku: 'UI-FIXTURE-990001', images: [], tags: [], stockStatus: 'instock', stockQuantity: 1,
            categories: [{ id: 990001, name: 'Bottles & On-the-Go', slug: 'bottles' }],
            type: 'simple', purchasable: true, inStock: true,
          }]),
        });
      });
    }
    await page.clock.install();
    await page.clock.pauseAt(new Date(Date.now() + 100));
    await page.goto(productsURL.href);
    // React Query notifications also use timers: allow short ticks while real
    // catalogue reads finish, but never advance the eight-second deadline.
    let elapsed = 0;
    while (!await page.getByText(/^\d+ products?$/).count() && elapsed < 6000) {
      await page.clock.runFor(50);
      elapsed += 50;
      await page.waitForTimeout(100);
    }
    await expect(page.getByText(/^\d+ products?$/)).toBeVisible({ timeout: 5000 });
    const bubble = page.getByTestId('products-alison-nudge');
    const search = page.getByPlaceholder('Search filters, systems…');
    const all = page.getByText('All', { exact: true });
    const category = page.getByText('Bottles & On-the-Go', { exact: true });
    const productCount = await page.getByText(/^\d+ products?$/).innerText();

    await expect(bubble).toHaveCount(0);
    await page.clock.runFor(7999 - elapsed);
    await expect(bubble).toHaveCount(0);
    await page.clock.runFor(1);
    await expect(bubble).toBeVisible();
    assert.equal(await page.getByText(/^\d+ products?$/).innerText(), productCount);
    assert.equal(await bubble.evaluate(el => getComputedStyle(el).position), 'absolute');
    const bounds = await bubble.boundingBox();
    assert.ok(bounds && bounds.x >= 0 && bounds.x + bounds.width <= 390);
    assert.ok(bounds.y >= 0 && bounds.y + bounds.height < 772, 'Bubble clears bottom navigation');
    console.log('PASS: absent at 7999 ms; visible at 8000 ms; floating within phone-sized viewport.');

    await search.fill('filter');
    await expect(bubble).toHaveCount(0);
    await search.fill('');
    await expect(bubble).toBeVisible();
    await category.click();
    await expect(bubble).toHaveCount(0);
    await all.click();
    await expect(bubble).toBeVisible();
    console.log('PASS: search and category selection suppress; clearing restores.');

    await page.getByTestId('products-alison-nudge-open').click();
    await expect(page).toHaveURL(/\/ai-chat(?:\?|$)/);
    await page.goBack();
    await expect(bubble).toBeVisible();
    await page.getByTestId('products-alison-nudge-dismiss').click();
    await expect(bubble).toHaveCount(0);
    await page.clock.runFor(10000);
    await search.fill('filter');
    await search.fill('');
    await category.click();
    await all.click();
    await expect(bubble).toHaveCount(0);
    // Navigate away/back through the tab bar, preserving the mounted Products scene.
    await page.getByRole('tab', { name: 'Support' }).click();
    await page.getByRole('tab', { name: 'Products' }).click();
    await expect(bubble).toHaveCount(0);
    console.log('PASS: recommendation opens chat; dismissal survives filters, wait and tab return.');

    await page.reload();
    elapsed = 0;
    while (!await page.getByText(/^\d+ products?$/).count() && elapsed < 6000) {
      await page.clock.runFor(50);
      elapsed += 50;
      await page.waitForTimeout(100);
    }
    await expect(page.getByText(/^\d+ products?$/)).toBeVisible({ timeout: 5000 });
    await expect(bubble).toHaveCount(0);
    await page.clock.runFor(8000 - elapsed);
    await expect(bubble).toBeVisible();
    assert.deepEqual(errors, [], 'No browser runtime errors');
    console.log('PASS: fresh mount resets session-only dismissal; no browser runtime errors.');
  } catch (error) {
    console.error('Alison browser diagnostics:', { pageErrors: errors, consoleErrors });
    if (page && process.env.ALISON_TEST_EVIDENCE_DIR) {
      fs.mkdirSync(process.env.ALISON_TEST_EVIDENCE_DIR, { recursive: true });
      await page.screenshot({ path: require('node:path').join(process.env.ALISON_TEST_EVIDENCE_DIR, 'failure.png'), fullPage: true }).catch(() => {});
    }
    throw error;
  } finally {
    await browser.close();
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
