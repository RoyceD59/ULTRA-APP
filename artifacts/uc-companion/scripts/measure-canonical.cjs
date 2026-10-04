/**
 * Read-only canonical browser baseline, not physical-phone evidence.
 * node scripts/measure-canonical.cjs https://app.ucfilters.com output.json [routes] [runs]
 * Cold = fresh browser HTTP cache; warm = same-context reload. Neither resets
 * the CDN/server cache. No customer sessions, submissions or analytics clicks.
 */
const fs = require('node:fs');
const { chromium } = require('@playwright/test');

async function main() {
  const origin = new URL(process.argv[2]).origin;
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || '/repl/tools/bin/chromium',
    args: ['--no-sandbox'],
  });
  const samples = [];
  try {
    for (const throttled of [false, true]) {
      for (let run = 0; run < Number(process.argv[5] || 3); run++) {
        const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
        // Lab visits must never contaminate production analytics, even when a
        // field collector is approved later. Block the existing tracker too.
        await context.route(/https:\/\/(?:[^/]+\.)?umami\.is\//, route => route.abort());
        const page = await context.newPage();
        const cdp = await context.newCDPSession(page);
        await cdp.send('Performance.enable');
        if (throttled) {
          await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
          await cdp.send('Network.enable');
          await cdp.send('Network.emulateNetworkConditions', {
            offline: false, latency: 150,
            downloadThroughput: 1_600_000 / 8, uploadThroughput: 750_000 / 8,
          });
        }
        await page.addInitScript(() => {
          window.companionPerformanceFixture = true;
          window.__speed = { lcp: null, cls: 0, interactions: [] };
          for (const type of ['largest-contentful-paint', 'layout-shift', 'event']) {
            try {
              new PerformanceObserver(list => {
                for (const e of list.getEntries()) {
                  if (type === 'largest-contentful-paint') window.__speed.lcp = e.startTime;
                  if (type === 'layout-shift' && !e.hadRecentInput) window.__speed.cls += e.value;
                  if (type === 'event' && e.interactionId) window.__speed.interactions.push(e.duration);
                }
              }).observe({ type, buffered: true, ...(type === 'event' ? { durationThreshold: 16 } : {}) });
            } catch {}
          }
        });
        for (const warmth of ['cold', 'warm']) {
          // Public read-only routes, same browser context for the warm reload.
          for (const route of (process.argv[4] ? process.argv[4].split(',') : ['/', '/products', '/product/10170', '/blog', '/support', '/guide/survivor-straw-guide'])) {
            const errors = [];
            const onError = e => errors.push(e.message);
            page.on('pageerror', onError);
            const start = Date.now();
            await page.goto(`${origin}${route}`, { waitUntil: 'domcontentloaded', timeout: 90000 });
            await page.waitForTimeout(throttled ? 18000 : 7000);
            const snapshot = await page.evaluate(() => ({
              build: document.querySelector('meta[name="uc-build-id"]')?.content,
              vitals: window.__speed,
              resources: performance.getEntriesByType('resource').map(r => ({
                url: r.name, duration: r.duration, transfer: r.transferSize,
                encoded: r.encodedBodySize, decoded: r.decodedBodySize,
              })),
              navigation: performance.getEntriesByType('navigation')[0]?.toJSON(),
              visibleText: document.body.innerText.slice(0, 1200),
            }));
            const { metrics } = await cdp.send('Performance.getMetrics');
            samples.push({ throttled, run, warmth, route, observationMs: Date.now() - start,
              ...snapshot, errors, cpu: Object.fromEntries(metrics
                .filter(m => ['ScriptDuration', 'TaskDuration'].includes(m.name))
                .map(m => [m.name, m.value])) });
            fs.writeFileSync(process.argv[3], JSON.stringify({ measuredAt: new Date().toISOString(), origin,
              evidence: 'lab', analyticsSuppressed: true,
              note: 'Workspace Chromium; browser-cold/warm only, not CDN cold or physical phone. INP not established without representative interactions.',
              samples }, null, 2));
            page.off('pageerror', onError);
            console.log({ throttled, run, warmth, route, lcp: snapshot.vitals.lcp, errors });
          }
        }
        await context.close();
      }
    }
  } finally {
    fs.writeFileSync(process.argv[3], JSON.stringify({
      measuredAt: new Date().toISOString(), origin,
      evidence: 'lab', analyticsSuppressed: true,
      note: 'Chromium workspace simulation. Cold/warm refer to browser cache only. LCP/CLS are lab observations; INP requires representative interactions/field data. No physical Android/iPhone claims.',
      samples,
    }, null, 2));
    await browser.close();
  }
}
main().catch(e => { console.error(e); process.exitCode = 1; });