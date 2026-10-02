/** Production-export checks using fixtures, not live customer or payment data. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { chromium } = require('@playwright/test');
const { serveExport } = require('./measure-loading.cjs');

async function main() {
  const server = serveExport(process.argv[2]);
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || '/repl/tools/bin/chromium',
    headless: true, args: ['--no-sandbox'],
  });
  const results = [];
  const product = { id: 900000, name: 'Benchmark filter', price: '100', regularPrice: '100', salePrice: '', images: [], sku: 'BENCH', categories: [], tags: [], stockStatus: 'instock', stockQuantity: 1 };
  const blog = { articles: [{ id: 'benchmark', slug: 'benchmark', title: 'Benchmark water guide', category: 'Water', summary: 'Fixture only', publishedAt: '2026-01-01' }], nextCursor: null };
  try {
    for (const scenario of ['slow', 'reduced', 'error', 'empty', 'wide-dark']) {
      const context = await browser.newContext({
        viewport: scenario === 'wide-dark' ? { width: 1440, height: 900 } : { width: 320, height: 740 },
        reducedMotion: scenario === 'reduced' ? 'reduce' : 'no-preference',
        colorScheme: scenario === 'wide-dark' ? 'dark' : 'light',
      });
      const page = await context.newPage();
      if (scenario === 'wide-dark') {
        await context.addInitScript(() => {
          if (!localStorage.getItem('uc_cart_v1')) localStorage.setItem('uc_cart_v1', JSON.stringify([
            { id: 900000, name: 'Benchmark filter', price: 100, quantity: 2, image: '', sku: 'BENCH' },
          ]));
        });
      }
      const errors = [];
      page.on('pageerror', e => errors.push(e.message));
      let failed = scenario === 'error';
      let refreshFails = false;
      let catalogueRequests = 0;
      await page.route('**/*', async route => {
        const url = route.request().url();
        // Force local photographic failures in the error case; content must survive.
        if (scenario === 'error' && /(?:home-water|blog-water|shop-filter).*\.(?:jpg|jpeg)/.test(url)) return route.abort();
        if (!url.includes('/api/')) return route.continue();
        if (url.includes('/products?')) catalogueRequests++;
        if (scenario === 'slow' || scenario === 'reduced') await new Promise(r => setTimeout(r, 1800));
        if (failed || refreshFails) return route.fulfill({ status: 503, json: { error: 'Fixture unavailable' } });
        const empty = scenario === 'empty';
        return route.fulfill({ json: url.includes('/blog') ? (empty ? { articles: [], nextCursor: null } : blog)
          : url.includes('/products') ? (empty ? [] : [product]) : [] });
      });
      await page.goto('http://localhost:8098/');
      await page.getByText('Your water, your health', { exact: true }).waitFor();
      await page.getByRole('tab', { name: 'Products', exact: true }).waitFor();
      if (scenario === 'slow' || scenario === 'reduced') {
        const loader = page.getByTestId('page-data-loader').first();
        await loader.waitFor();
        assert.equal(await loader.getAttribute('aria-busy'), 'true');
        await page.getByTestId(scenario === 'reduced' ? 'water-loader-still' : 'water-loader-animated').first().waitFor();
        // Home navigation works while both independent data sections still wait.
        await page.getByRole('tab', { name: 'Blog', exact: true }).click();
        await page.getByPlaceholder('Search articles').waitFor();
        await page.getByTestId('page-data-loader').first().waitFor();
        await page.getByText('Read article', { exact: true }).waitFor();
        assert.equal(await page.getByTestId('page-data-loader').count(), 0);
      } else if (scenario === 'error') {
        await page.getByText("Products couldn't load. Tap to retry.", { exact: true }).waitFor();
        assert.equal(await page.getByTestId('page-data-loader').count(), 0);
        await page.getByRole('tab', { name: 'Blog', exact: true }).click();
        await page.getByTestId('blog-retry').waitFor();
        failed = false;
        await page.getByTestId('blog-retry').click();
        await page.getByText('Read article', { exact: true }).waitFor();
        await page.getByRole('tab', { name: 'Products', exact: true }).click();
        await page.getByPlaceholder('Search filters, systems…').waitFor();
        await page.getByText('Benchmark filter', { exact: true }).first().waitFor();
      } else if (scenario === 'empty') {
        await page.getByText('No featured products yet. Browse the shop.', { exact: true }).waitFor();
        assert.equal(await page.getByTestId('page-data-loader').count(), 0);
        await page.getByRole('tab', { name: 'Blog', exact: true }).click();
        await page.getByText('No articles yet', { exact: true }).waitFor();
        assert.equal(await page.getByTestId('page-data-loader').count(), 0);
      } else {
        await page.getByText('Benchmark filter', { exact: true }).first().waitFor();
        await page.getByText('Subtotal KES 200', { exact: true }).waitFor();
        await page.screenshot({ path: '/tmp/uc-wide-home.png' });
      }
      if (scenario !== 'empty') {
        await page.getByRole('tab', { name: 'Products', exact: true }).click();
        await page.getByText('Benchmark filter', { exact: true }).first().waitFor();
        const countBeforeReturn = catalogueRequests;
        await page.getByRole('tab', { name: 'Home', exact: true }).click();
        await page.getByText('Your water, your health', { exact: true }).waitFor();
        await page.getByRole('tab', { name: 'Products', exact: true }).click();
        await page.getByText('Benchmark filter', { exact: true }).first().waitFor();
        assert.equal(catalogueRequests, countBeforeReturn, 'warm tabs must share catalogue data');
        assert.equal(await page.getByTestId('page-data-loader').count(), 0);
        // Fail a background update; retained cards remain usable, not replaced by a loader.
        refreshFails = true;
        await page.evaluate(() => window.dispatchEvent(new Event('offline')));
        await page.evaluate(() => window.dispatchEvent(new Event('online')));
        await page.getByText('Showing saved products. Tap to retry the update.', { exact: true }).first().waitFor();
        await page.getByText('Benchmark filter', { exact: true }).first().waitFor();
        assert.equal(await page.getByTestId('page-data-loader').count(), 0);
      }
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
      assert.equal(overflow, false, `${scenario}: no horizontal page overflow`);
      assert.deepEqual(errors, []);
      results.push({ scenario, passed: true, catalogueRequests });
      if (scenario === 'slow') await page.screenshot({ path: '/tmp/uc-small-shop.png' });
      await context.close();
      console.log(results.at(-1));
    }
    fs.writeFileSync(process.argv[3] || '/tmp/uc-loading-checks.json', JSON.stringify(results, null, 2));
  } finally {
    await browser.close();
    server.close();
  }
}
main().catch(e => { console.error(e); process.exitCode = 1; });