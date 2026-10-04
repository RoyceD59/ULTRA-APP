/**
 * Repeatable production-export benchmark. No live customer/payment requests.
 * node scripts/measure-loading.cjs /tmp/export /tmp/results.json
 * Requires the workspace's Playwright (no mobile device emulation claim).
 */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const { chromium } = require('@playwright/test');

function scriptBytes(directory, urls) {
  return urls.map(url => {
    const bytes = fs.readFileSync(path.join(directory, decodeURIComponent(url)));
    return {
      name: path.basename(url),
      raw: bytes.length,
      gzip: zlib.gzipSync(bytes, { level: 9 }).length,
      brotli: zlib.brotliCompressSync(bytes, {
        params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 9 },
      }).length,
    };
  });
}

function serveExport(directory) {
  const root = path.resolve(directory);
  return http.createServer((req, res) => {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    const file = path.join(root, pathname === '/' ? 'index.html' : pathname);
    const target = fs.existsSync(file) && fs.statSync(file).isFile() ? file : path.join(root, 'index.html');
    res.setHeader('content-type', ({ '.js': 'text/javascript', '.html': 'text/html', '.ttf': 'font/ttf', '.png': 'image/png', '.jpg': 'image/jpeg', '.gif': 'image/gif' })[path.extname(target)] || 'application/octet-stream');
    res.end(fs.readFileSync(target));
  }).listen(8098, '127.0.0.1');
}

async function main() {
  const results = [];
  const server = serveExport(process.argv[2]);
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || '/repl/tools/bin/chromium', args: ['--no-sandbox'] });
  try {
    for (const slow of [false, true]) {
      for (let run = 0; run < 3; run++) {
        const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
        const page = await context.newPage();
        const profile = await context.newCDPSession(page);
        await profile.send('Performance.enable');
        const errors = [];
        page.on('pageerror', e => errors.push(e.message));
        page.on('console', msg => { if (msg.type() === 'error') console.error(msg.text()); });
        let requests = 0;
        const scripts = new Set();
        page.on('request', request => {
          requests++;
          const url = new URL(request.url());
          if (url.pathname.endsWith('.js')) scripts.add(url.pathname);
        });
        await page.route('**/*', async route => {
          const url = route.request().url();
          if (slow && /\.(ttf|otf)(\?|$)/.test(url)) await new Promise(r => setTimeout(r, 2000));
          if (url.includes('/api/')) {
            if (slow) await new Promise(r => setTimeout(r, 1800));
            const payload = url.includes('/blog') ? {
              articles: [{ id: 'benchmark', slug: 'benchmark', title: 'Benchmark water guide', category: 'Water', summary: 'Fixture only', publishedAt: '2026-01-01' }], nextCursor: null,
            } : url.includes('/products') ? [{
              id: 900000, name: 'Benchmark filter', price: '100', regularPrice: '100', salePrice: '', images: [], sku: 'BENCH', categories: [], tags: [], stockStatus: 'instock', stockQuantity: 1,
            }] : url.includes('/impact') ? { totalLitres: 0, treesPlanted: 0 } : [];
            return route.fulfill({ json: payload });
          }
          return route.continue();
        });
        const start = Date.now();
        await page.goto('http://localhost:8098/', { waitUntil: 'domcontentloaded' });
        await page.getByText('Your water, your health', { exact: true }).waitFor();
        const homeUsableMs = Date.now() - start;
        // Count all initially requested runtime/shared/layout/route scripts,
        // not just entry.js. Encoded bytes are estimates, not edge transfers.
        const initialScriptUrls = [...scripts];
        const startupMetrics = await profile.send('Performance.getMetrics');
        const startupJsWork = Object.fromEntries(startupMetrics.metrics
          .filter(m => ['ScriptDuration', 'TaskDuration'].includes(m.name))
          .map(m => [m.name, m.value]));
        await page.getByText('Benchmark filter', { exact: true }).first().waitFor();
        const homeProductsMs = Date.now() - start;
        let t = Date.now();
        await page.getByRole('tab', { name: 'Products', exact: true }).click();
        await page.getByPlaceholder('Search filters, systems…').waitFor();
        await page.getByText('Benchmark filter', { exact: true }).first().waitFor();
        const shopMs = Date.now() - t;
        t = Date.now();
        await page.getByRole('tab', { name: 'Blog', exact: true }).click();
        await page.getByText('Read article', { exact: true }).first().waitFor();
        const blogMs = Date.now() - t;
        t = Date.now();
        await page.getByRole('tab', { name: 'Home', exact: true }).click();
        await page.getByText('Your water, your health', { exact: true }).waitFor();
        const warmHomeMs = Date.now() - t;
        const resources = await page.evaluate(() => performance.getEntriesByType('resource').map(r => ({ name: r.name.split('/').pop(), duration: Math.round(r.duration), bytes: r.transferSize })));
        const { metrics } = await profile.send('Performance.getMetrics');
        const jsWork = Object.fromEntries(metrics.filter(m => ['ScriptDuration', 'TaskDuration', 'JSHeapUsedSize'].includes(m.name)).map(m => [m.name, m.value]));
        // Compression is deliberately outside the timed browser journey.
        const initialScripts = scriptBytes(process.argv[2], initialScriptUrls);
        results.push({ slow, run, homeUsableMs, homeProductsMs, shopMs, blogMs, warmHomeMs, requests, startupJsWork, initialScripts, jsWork, resources, errors });
        console.log({ slow, run, homeUsableMs, homeProductsMs, shopMs, blogMs, warmHomeMs, requests });
        if (errors.length) throw new Error(JSON.stringify(errors));
        await context.close();
      }
    }
    fs.writeFileSync(process.argv[3], JSON.stringify(results, null, 2));
    console.log(results.map(({ resources, ...rest }) => rest));
  } finally {
    await browser.close();
    server.close();
  }
}
module.exports = { serveExport };
if (require.main === module) main().catch(e => { console.error(e); process.exitCode = 1; });