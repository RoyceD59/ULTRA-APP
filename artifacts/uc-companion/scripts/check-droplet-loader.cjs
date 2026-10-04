/** Read-only browser fixtures for the shared loader; never calls live APIs. */
const assert = require('node:assert/strict');
const { chromium } = require('@playwright/test');

async function main() {
  const base = process.argv[2] || `https://${process.env.REPLIT_EXPO_DEV_DOMAIN}`;
  const scenarios = process.argv[3] ? process.argv[3].split(',') :
    ['home', 'products', 'detail', 'dark', 'reduced', 'asset-failure', 'error'];
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || '/repl/tools/bin/chromium',
    headless: true, args: ['--no-sandbox'],
  });
  try {
    for (const scenario of scenarios) {
      const context = await browser.newContext({
        viewport: { width: 402, height: 874 },
        reducedMotion: scenario === 'reduced' ? 'reduce' : 'no-preference',
        colorScheme: scenario === 'dark' ? 'dark' : 'light',
      });
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      let release;
      const gate = new Promise(resolve => { release = resolve; });
      await page.route('**/*', async route => {
        const url = route.request().url();
        if (scenario === 'asset-failure' && /loading(?:\/|%2F)water/.test(url)) return route.abort();
        if (!url.includes('/api/')) return route.continue();
        if (scenario !== 'error') await gate;
        return route.fulfill({ status: 503, json: { error: 'Read-only fixture' } }).catch(() => {});
      });
      const path = scenario === 'products' ? '/products' : scenario === 'detail' ? '/product/900000' : '/';
      await page.goto(new URL(path, base).href);
      if (scenario === 'error') {
        const feedback = page.getByTestId('page-data-error').first();
        await feedback.waitFor({ timeout: 90000 });
        await feedback.getByTestId('water-loader-still').waitFor();
        assert.equal(await feedback.getByTestId('water-loader-animated').count(), 0);
        assert.ok(await page.getByRole('button', { name: /Retry:/ }).count());
      } else {
        const loader = page.getByTestId('page-data-loader').first();
        await loader.waitFor({ timeout: 90000 });
        assert.equal(await loader.getAttribute('aria-busy'), 'true');
        const label = await loader.getAttribute('aria-label');
        assert.ok(label);
        assert.ok((await loader.innerText()).includes(label), 'loading text stays visible');
        assert.equal(await loader.getAttribute('aria-live'), 'polite');
        const id = scenario === 'asset-failure' ? 'filter-drop-fallback'
          : scenario === 'reduced' ? 'water-loader-still' : 'water-loader-animated';
        await page.getByTestId(id).first().waitFor();
        assert.equal(await loader.getByTestId(id).count(), 1, 'one shared illustration beside text');
        if (scenario !== 'asset-failure') {
          await page.waitForFunction(testId => {
            const root = document.querySelector(`[data-testid="${testId}"]`);
            const image = root?.tagName === 'IMG' ? root : root?.querySelector('img');
            return image?.complete && image.naturalWidth === 96;
          }, id);
          const box = await page.getByTestId(id).first().boundingBox();
          assert.equal(box.width, 56);
          assert.equal(box.height, 64);
        }
        if (scenario === 'home') {
          // Native background/focus uses the same policy covered by unit checks.
          await page.emulateMedia({ reducedMotion: 'reduce' });
          await page.getByTestId('water-loader-still').first().waitFor();
          assert.equal(await page.getByTestId('water-loader-animated').count(), 0);
          await page.emulateMedia({ reducedMotion: 'no-preference' });
          await page.getByTestId('water-loader-animated').first().waitFor();
          await page.evaluate(() => {
            Object.defineProperty(document, 'hidden', { configurable: true, value: true });
            document.dispatchEvent(new Event('visibilitychange'));
          });
          await page.getByTestId('water-loader-still').first().waitFor();
          assert.equal(await page.getByTestId('water-loader-animated').count(), 0);
          await page.evaluate(() => {
            Object.defineProperty(document, 'hidden', { configurable: true, value: false });
            document.dispatchEvent(new Event('visibilitychange'));
          });
          await page.getByTestId('water-loader-animated').first().waitFor();
        }
      }
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      assert.deepEqual(errors, []);
      await page.screenshot({ path: `/tmp/uc-droplets-${scenario}.png` });
      release();
      await context.close();
      console.log(`${scenario}: passed`);
    }
  } finally {
    await browser.close();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });