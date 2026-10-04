import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fixtures, data } from './fixtures/public-web.mjs';
const require = createRequire(import.meta.url);
const { createPublicRenderer, renderHead } = require('../../server/public-rendering.cjs');
const { createPublicData, PublicDataError } = require('../../server/public-content.cjs');
const { classifyWebRoute } = require('../../server/web-routes.cjs');
const { publishWebIcon } = require('../publish-web-icon.cjs');
const { prepareStaticBuild } = require('../prepare-static-build.cjs');

const renderer = overrides => createPublicRenderer({
  canonicalOrigin: 'https://public.example', basePath: '/uc-companion', data: { ...data, ...overrides },
});
const schemaOf = (page, type) => page.schemas[0]['@graph'].find(node => node['@type'] === type);

test('every represented public template has initial primary content, unique metadata and links', async () => {
  const titles = new Set();
  for (const route of ['/', '/products', '/product/101', '/blog', '/blog/water-care', '/guide/filter-care', '/support', '/map', '/about', '/enquiry', '/water-test']) {
    const page = await renderer().render(route);
    assert.equal(page.status, 200, route);
    assert.match(page.body, /<h1>/);
    assert.match(page.body, /<a href="\/uc-companion\//);
    assert.ok(page.meta.description);
    assert.equal(page.meta.canonical, `https://public.example${route}`);
    assert.equal(page.meta.robots, 'index, follow');
    assert.equal(page.meta.url, page.meta.canonical);
    assert.match(page.meta.image, /^https:\/\//);
    assert.ok(!titles.has(page.meta.title), `${route} has a duplicated title`);
    titles.add(page.meta.title);
    const head = renderHead(page.meta, page.schemas);
    assert.match(head, /property="og:title"/);
    assert.match(head, /name="twitter:card"/);
    for (const [, json] of head.matchAll(/type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
      assert.equal(JSON.parse(json)['@context'], 'https://schema.org');
    }
  }
});
test('public schemas reflect available data, never fabricate offers or guide steps', async () => {
  const product = await renderer().render('/product/101');
  assert.equal(schemaOf(product, 'Product').sku, 'FILTER-101');
  assert.equal(schemaOf(product, 'Product').name, fixtures.products[0].name);
  assert.equal(schemaOf(product, 'Product').offers.priceCurrency, 'KES');
  assert.match(product.body, /KES /);
  const quoteOnly = await renderer({
    products: async () => [{ ...fixtures.products[0], enquiryOnly: true }],
  }).render('/product/101');
  assert.equal(schemaOf(quoteOnly, 'Product').offers, undefined);
  assert.match(quoteOnly.body, /Pricing on request/);
  assert.match(product.body, /Filter front view/);
  const withoutImages = await renderer({
    products: async () => [{ ...fixtures.products[0], images: [] }],
  }).render('/product/101');
  assert.equal(withoutImages.meta.image, 'https://public.example/favicon.png');
  assert.ok(!('image' in schemaOf(withoutImages, 'Product')));
  const article = await renderer().render('/blog/water-care');
  assert.equal(schemaOf(article, 'BlogPosting').datePublished, fixtures.article.publishedAt);
  assert.match(article.body, /href="https:\/\/example.org\/water">Water guidance/);
  assert.doesNotMatch(article.body, /\[Water guidance\]/);
  const howTo = await renderer().render('/guide/filter-care');
  assert.equal(schemaOf(howTo, 'HowTo')['@type'], 'HowTo');
  assert.deepEqual(schemaOf(howTo, 'HowTo').step.flatMap(section => section.itemListElement.map(step => step.text)), fixtures.guide.sections[0].steps);
  const noSteps = await renderer({ guide: async () => ({ ...fixtures.guide, sections: [{ heading: 'Overview', body: 'Information only' }] }) }).render('/guide/filter-care');
  assert.equal(schemaOf(noSteps, 'HowTo'), undefined);
  assert.ok(schemaOf(noSteps, 'WebPage'));
});
test('unknown, invalid and unpublished identifiers are actual 404s', async () => {
  for (const route of ['/missing', '/product/999', '/product/101garbage', '/product/-1', '/blog/missing', '/guide/missing', '/guide/filter-care/nested', '/blog/%2f']) {
    const page = await renderer().render(route);
    assert.equal(page.status, 404, route);
    assert.equal(page.meta.robots, 'noindex, follow');
    assert.ok(!page.meta.canonical);
  }
});
test('provider failures are 503 rather than cached mock content or false 404s', async () => {
  const failing = renderer({ products: async () => { throw new PublicDataError(); } });
  assert.equal((await failing.render('/product/101')).status, 503);
  await assert.rejects(() => failing.sitemap(), PublicDataError);
});
test('escaping keeps untrusted HTML, metadata and JSON non-executable', async () => {
  const hostile = '</script><script>alert(1)</script>';
  const page = await renderer({
    article: async () => ({ ...fixtures.article, title: hostile, summary: '" onload="evil', body: hostile }),
  }).render('/blog/water-care');
  assert.doesNotMatch(page.body, /<script>/);
  const head = renderHead(page.meta, page.schemas);
  assert.doesNotMatch(head, /<script>alert/);
  const json = [...head.matchAll(/type="application\/ld\+json">([\s\S]*?)<\/script>/g)][0][1];
  assert.equal(JSON.parse(json)['@graph'].find(node => node['@type'] === 'BlogPosting').headline, hostile);
  assert.match(head, /&quot; onload=&quot;evil/);
});
test('sitemap lists only canonical public inventory and never generates modification dates', async () => {
  const xml = await renderer().sitemap();
  assert.match(xml, /<loc>https:\/\/public.example\/product\/101<\/loc>/);
  assert.match(xml, /\/blog\/water-care/);
  assert.match(xml, /\/guide\/filter-care/);
  assert.doesNotMatch(xml, /\/account|\/auth|\/checkout|\/rewards|\/admin|\/orders|uc-companion|lastmod|<loc>[^<]*\?/);
  assert.match(renderer().robots(), /Sitemap: https:\/\/public.example\/sitemap.xml/);
});
test('route classification preserves private journeys and rejects malformed content routes', () => {
  for (const route of ['/auth/reset-password', '/auth/login', '/account', '/cart', '/checkout', '/orders', '/order/42', '/admin/product-edit', '/review/new', '/ticket/new', '/referral', '/rewards', '/care', '/hydration', '/notification-preferences', '/ai-chat']) {
    assert.equal(classifyWebRoute(route), 'private', route);
  }
  for (const route of ['/product/1/nested', '/blog/slug/nested', '/guide', '/missing']) assert.equal(classifyWebRoute(route), 'unknown');
  assert.equal(classifyWebRoute('/about'), 'public');
});
test('data adapter follows all public article cursors with no credentials or visitor headers', async () => {
  const calls = [];
  const adapter = createPublicData('https://api.example', async (url, options) => {
    calls.push({ url, options });
    return { ok: true, json: async () => url.searchParams.has('cursor')
      ? { articles: [{ slug: 'second' }], nextCursor: null }
      : { articles: [{ slug: 'first' }], nextCursor: 'next-token' } };
  });
  assert.deepEqual((await adapter.articles()).map(article => article.slug), ['first', 'second']);
  assert.equal(calls[1].url.searchParams.get('cursor'), 'next-token');
  assert.deepEqual(calls[0].options.headers, { Accept: 'application/json' });
  assert.equal(calls[0].options.redirect, 'error');
  assert.ok(calls[0].options.signal);
});
test('data adapter rejects repeated cursors, malformed inventories and provider errors', async () => {
  const repeated = createPublicData('https://api.example', async () => ({
    ok: true, json: async () => ({ articles: [], nextCursor: 'repeat' }),
  }));
  await assert.rejects(() => repeated.articles(), PublicDataError);
  const broken = createPublicData('https://api.example', async () => ({ ok: false, status: 502 }));
  await assert.rejects(() => broken.products(), error => error.status === 503);
  const missing = createPublicData('https://api.example', async () => ({ ok: false, status: 404 }));
  await assert.rejects(() => missing.article('missing'), error => error.status === 404);
  assert.throws(() => createPublicData('https://user:password@api.example'), /origin/);
  assert.throws(() => createPublicRenderer({ canonicalOrigin: 'http://public.example', data }), /HTTPS/);
});
test('publication-safe adapter requires positive WooCommerce provenance and never accepts mock-compatible 200s', async () => {
  for (const provenance of [null, 'demo', 'woocommerce-published']) {
    const calls = [];
    const adapter = createPublicData('https://api.example', async url => {
      calls.push(url);
      return new Response(JSON.stringify(fixtures.products), {
        headers: provenance ? { 'X-UC-Catalogue-Provenance': provenance } : {},
      });
    });
    if (provenance === 'woocommerce-published') {
      assert.deepEqual(await adapter.products(), fixtures.products);
    } else {
      await assert.rejects(() => adapter.products(), error => error.status === 503);
    }
    assert.equal(calls[0].searchParams.get('publicationSafe'), 'true');
  }
});
test('icon publication verifies the PNG and build preparation preserves rollback assets/manifests', () => {
  const root = mkdtempSync(join(tmpdir(), 'uc-public-build-'));
  try {
    mkdirSync(join(root, 'assets/images'), { recursive: true });
    writeFileSync(join(root, 'assets/images/icon.png'), Buffer.from([137,80,78,71,13,10,26,10,0]));
    const icon = publishWebIcon(root);
    assert.deepEqual(readFileSync(icon), readFileSync(join(root, 'assets/images/icon.png')));
    const oldBundle = join(root, 'static-build/100-1/_expo/static/js/web');
    mkdirSync(oldBundle, { recursive: true });
    writeFileSync(join(oldBundle, 'bundle.js'), 'last-known-good');
    mkdirSync(join(root, 'static-build/ios'), { recursive: true });
    writeFileSync(join(root, 'static-build/ios/manifest.json'), JSON.stringify({ launchAsset: { key: 'bundle-100-1' } }));
    prepareStaticBuild(root, '200-2');
    assert.equal(readFileSync(join(oldBundle, 'bundle.js'), 'utf8'), 'last-known-good');
    assert.ok(readFileSync(join(root, 'static-build/100-1/ios/manifest.json')));
    writeFileSync(join(root, 'assets/images/icon.png'), 'invalid');
    assert.throws(() => publishWebIcon(root), /PNG/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});