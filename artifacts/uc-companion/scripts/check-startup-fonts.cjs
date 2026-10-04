/**
 * Isolated production web export release guard. Never uses build.js/static-build.
 * pnpm run check:startup-fonts
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { once } = require('node:events');
const { spawnSync } = require('node:child_process');
const { chromium } = require('@playwright/test');
const { serveExport } = require('./measure-loading.cjs');
const { observeFonts, isFontRequest, fontFamilyConsumers, ICON_ALLOWLIST } = require('./startup-fonts.cjs');

const root = path.resolve(__dirname, '..');
const product = { id: 900000, name: 'Benchmark filter', price: '100', regularPrice: '100', salePrice: '', images: [], sku: 'BENCH', categories: [], tags: [], stockStatus: 'instock', stockQuantity: 1 };
const blog = { articles: [{ id: 'benchmark', slug: 'benchmark', title: 'Benchmark water guide', category: 'Water', summary: 'Fixture only', publishedAt: '2026-01-01' }], nextCursor: null };

function exportEnvironment(inherited, origin) {
  // Expo must not inline deployment settings or load local dotenv files.
  const env = Object.fromEntries(Object.entries(inherited).filter(([key]) => !key.startsWith('EXPO_PUBLIC_')));
  return {
    ...env, CI: '1', NODE_ENV: 'production', EXPO_NO_DOTENV: '1',
    // An explicit "/" makes SDK 57 emit "//assets/..." (an external hostname).
    // Empty leaves Expo's root base URL unset, as in the paired benchmark.
    UC_WEB_EXPORT_BASE_PATH: '', EXPO_NO_BUNDLE_SPLITTING: '0',
    EXPO_PUBLIC_PREVIEW_SAFE_MODE: '1', EXPO_PUBLIC_DOMAIN: origin,
    EXPO_PUBLIC_API_DOMAIN: origin,
  };
}

async function isolateRequests(context, origin, slow, violations) {
  await context.route('**/*', async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (!['GET', 'HEAD'].includes(request.method())) {
      violations.push(`Blocked ${request.method()} ${url.origin}${url.pathname}`);
      return route.abort('blockedbyclient');
    }
    if (url.pathname.startsWith('/api/')) {
      // Fulfill ALL API origins locally. Never forward customer reads or writes.
      return route.fulfill({ json: url.pathname.includes('/blog') ? blog
        : url.pathname.includes('/products') ? [product]
          : url.pathname.includes('/impact') ? { totalLitres: 0, treesPlanted: 0 } : [] });
    }
    if (url.origin !== origin) {
      violations.push(`Blocked external request ${url.origin}${url.pathname}`);
      return route.abort('blockedbyclient');
    }
    if (slow && isFontRequest(request)) await new Promise(resolve => setTimeout(resolve, 2000));
    return route.continue();
  });
}

async function measureStartup(browser, origin, slow) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
  const errors = [];
  const violations = [];
  await isolateRequests(context, origin, slow, violations);
  const page = await context.newPage();
  const observer = observeFonts(page);
  page.on('pageerror', error => errors.push(error.message));
  let greetingMs = null;
  const start = Date.now();
  try {
    await page.goto(origin, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.getByText('Your water, your health', { exact: true }).waitFor({ timeout: 30000 });
    greetingMs = Date.now() - start;
    // Do not stop at greeting/first paint: include root-effect and delayed transfers.
    // This is a bounded startup window, not a claim about fonts on later routes.
    await page.waitForTimeout(3000);
    await page.waitForLoadState('networkidle', { timeout: 15000 });
    await page.waitForFunction(() => document.fonts.status === 'loaded', null, { timeout: 15000 });
  } catch (error) { errors.push(error.message); }
  try {
    const fonts = await observer.report();
    return {
      slow, greetingMs, observationMs: Date.now() - start, fonts,
      totalBodyBytes: fonts.reduce((total, font) => total + (font.bodyBytes || 0), 0),
      errors, violations,
      passed: errors.length === 0 && violations.length === 0
        && fonts.every(font => font.allowed && font.complete && !font.error && font.bodyBytes > 0),
    };
  } finally {
    observer.stop();
    await context.close();
  }
}

async function main() {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'uc-startup-fonts-'));
  const directory = path.join(temporary, 'export');
  fs.mkdirSync(directory);
  const reportPath = path.resolve(process.argv[2] || path.join(os.tmpdir(), 'uc-startup-fonts-report.json'));
  if (reportPath.startsWith(path.join(root, 'static-build') + path.sep)) {
    throw new Error('Font evidence must not be written into retained builds');
  }
  const server = serveExport(directory, 0);
  let browser;
  try {
    await once(server, 'listening');
    const origin = `http://127.0.0.1:${server.address().port}`;
    const exported = spawnSync('pnpm', [
      'exec', 'expo', 'export', '--platform', 'web', '--clear', '--output-dir', directory,
    ], { cwd: root, env: exportEnvironment(process.env, origin), stdio: 'inherit', timeout: 180000 });
    if (exported.error) throw exported.error;
    if (exported.status !== 0) throw new Error(`Production fixture export failed (${exported.status})`);
    browser = await chromium.launch({
      executablePath: process.env.CHROMIUM_PATH || '/repl/tools/bin/chromium',
      headless: true, args: ['--no-sandbox'],
      env: { ...process.env, HOME: temporary, XDG_CONFIG_HOME: temporary, XDG_CACHE_HOME: temporary },
    });
    const runs = [];
    for (const slow of [false, true]) runs.push(await measureStartup(browser, origin, slow));
    const report = {
      scope: 'Fresh production web export; Home startup only; loopback fixtures; no publication or phone claims.',
      byteDefinition: 'Actual response body bytes, uncompressed local server; not headers, edge transfer or estimates.',
      allowlist: ICON_ALLOWLIST.map(({ family, consumer }) => ({ family, consumer })),
      fontFamilyConsumers: fontFamilyConsumers(root),
      runs, passed: runs.every(run => run.passed),
    };
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
    for (const run of runs) {
      console.log(`Startup fonts (${run.slow ? '2s delayed fonts' : 'normal'}): ${run.totalBodyBytes} body bytes`);
      console.table(run.fonts.map(({ asset, status, bodyBytes, allowed, error }) => ({ asset, status, bodyBytes, allowed, error })));
    }
    console.log(`Font evidence: ${reportPath}`);
    if (!report.passed) throw new Error('Startup font guard failed: inspect report for unapproved downloads, incomplete bodies, browser errors or isolation violations. Review fontFamily consumers before changing the allowlist.');
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}

module.exports = { exportEnvironment, isolateRequests, measureStartup };
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });