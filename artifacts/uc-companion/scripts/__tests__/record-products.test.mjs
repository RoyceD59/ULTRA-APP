import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
const require = createRequire(import.meta.url);
const { createRecordCollection, records } = require('../../server/product-records.cjs');
const { createPublicRenderer, renderHead } = require('../../server/public-rendering.cjs');
const { resolveIdentity, uploadedPhotos } = require('../../server/record-operations.cjs');
const { PublicDataError, createPublicData } = require('../../server/public-content.cjs');
const source = require('../../server/records/products_v2.4.json');
const inventory = records.products.map((p, i) => ({ id: i + 101, sku: p.parentSku,
  name: 'Wrong Woo name', description: 'PRIVATE commerce description', price: String(p.price || 0),
  stockStatus: 'instock', images: [{ src: 'https://media.example/product.jpg', alt: 'Approved product photo' }] }));
const data = { mediaOrigin: 'https://api.example', products: async () => inventory,
  productOperation: async id => inventory.find(p => p.id === id),
  guides: async () => [], articles: async () => [] };
const renderer = overrides => createPublicRenderer({ canonicalOrigin: 'https://public.example', basePath: '/uc-companion',
  data: { ...data, ...overrides } });
const graph = page => page.schemas[0]?.['@graph'] || [];
const productNode = page => graph(page).find(n => n['@type'] === 'Product');

test('supplied files are imported verbatim and every record is validated and allowlisted', () => {
  for (const [file, attachment] of [
    ['products_v2.4.json', '1_products_v2.4_1791349056443.json'],
    ['product_content_v2.4.schema.json', '0_product_content_v2.4.schema_1791349056441.json'],
  ]) assert.deepEqual(readFileSync(new URL(`../../server/records/${file}`, import.meta.url)),
    readFileSync(new URL(`../../../../attached_assets/${attachment}`, import.meta.url)));
  assert.equal(records.products.length, 21);
  assert.equal(records.topics.length, 9);
  const publicJson = JSON.stringify(records.products);
  for (const word of ['internal', 'missing_launch_inputs', 'manufacturer_model', 'confirm', 'images/', 'held_back']) {
    assert.ok(!publicJson.includes(word), word);
  }
  const clone = () => structuredClone(source);
  for (const corrupt of [
    value => { value.products[0].price_kes = '4199'; },
    value => { value.products[0].extraPrivateField = true; },
    value => { value.products[1].slug = value.products[0].slug; },
    value => { value.products[1].parent_sku = value.products[0].variants[0].child_sku; },
    value => { value.products[0].faq[0].a = 42; },
    value => { value.products[0].images[1].slot = 1; },
    value => { value.topic_pages[0].products.push('UNKNOWN'); },
    value => { value.topic_pages[0].products.push('ATM'); },
    value => { value.products[0].seo.topics.push('nonexistent'); },
    value => { value.products[0].publishable = false; },
  ]) {
    const value = clone(); corrupt(value);
    assert.throws(() => createRecordCollection(value));
  }
});

test('every authored product has visible fields, exact SEO, FAQ parity, safe public payload and one canonical', async () => {
  for (const p of records.products) {
    const page = await renderer().render(`/product/${p.slug}?sku=private&utm_source=test`);
    assert.equal(page.status, 200, p.code);
    assert.equal(page.meta.title, p.seo.title);
    assert.equal(page.meta.description, p.seo.description);
    assert.equal(page.meta.canonical, `https://public.example/product/${p.slug}`);
    assert.equal(page.meta.url, page.meta.canonical);
    assert.equal(page.publicRecord.seo.status, p.seo.status);
    const product = productNode(page);
    assert.equal(product.name, p.seo.h1);
    assert.equal(product.sku, p.parentSku);
    assert.deepEqual(product.image, ['https://media.example/product.jpg']);
    if (p.purchasable && p.price !== null) {
      assert.equal(product.offers.price, String(p.price));
      assert.equal(product.offers.priceCurrency, 'KES');
      assert.equal(product.offers.availability, 'https://schema.org/InStock');
    } else assert.equal(product.offers, undefined);
    const faq = graph(page).find(n => n['@type'] === 'FAQPage');
    assert.deepEqual(faq?.mainEntity.map(q => ({ q: q.name, a: q.acceptedAnswer.text })), p.faq.length ? p.faq : undefined);
    for (const f of p.faq) {
      const escape = s => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
      assert.ok(page.body.includes(escape(f.q)));
      assert.ok(page.body.includes(escape(f.a)));
    }
    assert.doesNotMatch(JSON.stringify(page), /Wrong Woo name|PRIVATE commerce description|manufacturer_model|missing_launch_inputs/);
    for (const forbidden of source.products.find(r => r.code === p.code).evidence.claims.filter(c => c.status === 'confirm')) {
      assert.ok(!JSON.stringify(page).includes(forbidden.text));
    }
  }
  const hydra = await renderer().render('/product/hydra-flux');
  assert.match(hydra.body, /<h1>Hydra Flux<\/h1>/);
  assert.match(hydra.body, /750 ml Insulated Water Filter Bottle/);
  assert.match(hydra.body, /KES 4,199/);
  assert.match(hydra.body, /Remove the filter before filling with hot or boiling liquids, juice, coffee or tea\./);
});

test('all declared topic memberships resolve reciprocally, without article prose or indexing', async () => {
  for (const topic of records.topics) {
    const page = await renderer().render(`/topic/${topic.slug}`);
    assert.equal(page.status, 200);
    assert.equal(page.meta.robots, 'noindex, follow');
    assert.match(page.body, /<section aria-label="Topic article"><\/section>/);
    assert.doesNotMatch(page.body, /<p>/);
    for (const p of topic.products) {
      assert.ok(page.body.includes(`/product/${p.slug}`));
      const product = await renderer().render(`/product/${p.slug}`);
      assert.ok(product.body.includes(`/topic/${topic.slug}`));
    }
  }
  const xml = await renderer().sitemap();
  assert.equal((xml.match(/<loc>[^<]*\/product\//g) || []).length, 21);
  assert.doesNotMatch(xml, /\/topic\/|\/product\/101|Timbo|Breeze|Flex|Ultra Fold|<loc>[^<]*\?/);
  for (const slug of ['timbo', 'breeze', 'flex', 'ultra-fold', 'missing']) {
    assert.equal((await renderer().render(`/product/${slug}`)).status, 404);
  }
  assert.equal((await renderer().render('/topic/missing')).status, 404);
});

test('exact SKU identities retain numeric links; ambiguity and matching names never establish identity', async () => {
  const hydra = records.identities[0];
  assert.equal(resolveIdentity(hydra, inventory).id, 101);
  assert.equal(resolveIdentity(hydra, [{ ...inventory[0], sku: 'legacy-hydra-flux', name: 'Hydra Flux' }]).id, undefined);
  assert.match(resolveIdentity(hydra, [...inventory, { ...inventory[0], id: 999 }]).diagnostic, /ambiguous/);
  assert.equal(resolveIdentity(hydra, [{ id: 101, sku: '' }, {
    id: 300, parentId: 101, sku: hydra.variants[0],
  }]).id, 101);
  assert.equal(resolveIdentity(hydra, [{ id: 300, sku: hydra.variants[0] }]).id, undefined);
  const alias = await renderer().render('/product/101?private=true');
  assert.equal(alias.meta.canonical, 'https://public.example/product/hydra-flux');
  const ambiguous = renderer({ products: async () => [...inventory, { ...inventory[0], id: 999 }] });
  assert.equal((await ambiguous.render('/product/101')).status, 404);
  assert.equal((await ambiguous.render('/product/hydra-flux')).publicRecord.commerceId, null);
});

test('live stock cannot inherit a snapshot; failures retain readable records but never fabricate availability or photos', async () => {
  for (const overrides of [
    { productOperation: undefined },
    { productOperation: async () => { throw new PublicDataError(); } },
    { productOperation: async () => ({ ...inventory[0], sku: 'different' }) },
    { productOperation: async () => ({ ...inventory[0], stockStatus: 'unknown' }) },
    { products: async () => { throw new PublicDataError(); } },
  ]) {
    const page = await renderer(overrides).render('/product/hydra-flux');
    assert.equal(page.status, 200);
    assert.equal(page.publicRecord.availability, null);
    assert.equal(productNode(page).offers.availability, undefined);
    assert.match(page.body, /Live stock unavailable/);
    assert.ok(page.publicRecord.diagnostics.length);
  }
  const outage = renderer({ products: async () => { throw new PublicDataError(); } });
  assert.equal((await outage.render('/product/101')).status, 503);
  const noIdentity = await renderer({ products: async () => [] }).render('/product/hydra-flux');
  assert.equal(noIdentity.publicRecord.commerceId, null);
  assert.equal(productNode(noIdentity).image, undefined);
  assert.equal(noIdentity.meta.image, null);
  assert.doesNotMatch(renderHead(noIdentity.meta, noIdentity.schemas), /og:image|favicon|logo/);
  const mismatch = await renderer({ productOperation: async () => ({ ...inventory[0], price: '999' }) }).render('/product/hydra-flux');
  assert.ok(mismatch.publicRecord.diagnostics.includes('record-commerce-price-disagreement'));
  assert.equal(productNode(mismatch).offers.price, '4199');
});

test('six photo slots keep gaps and back-office alt text; placeholders, logos and unsafe paths never become product images', () => {
  const images = uploadedPhotos({
    images: [{ src: 'https://media.example/base.jpg', alt: 'Base photo' }],
    uploadedPhotos: [
      { slot: 1, src: '/api/uc/product-images/upload.jpg', alt: 'Back-office alternative' },
      { slot: 3, src: '/api/storage/objects/uploads/diagram.jpg', alt: 'Parts diagram' },
      { slot: 6, src: 'https://media.example/size.jpg', alt: 'Size' },
      { slot: 4, src: 'https://media.example/placeholder.jpg', alt: 'Not uploaded' },
      { slot: 5, src: 'https://media.example/logo.png' },
      { slot: 2, src: 'javascript:alert(1)' },
      { slot: 7, src: 'https://media.example/seventh.jpg' },
    ],
  }, 'https://api.example');
  assert.deepEqual(images.map(p => p.slot), [1, 3, 6]);
  assert.equal(images[0].alt, 'Back-office alternative');
});

test('operational data adapter requires live provenance, query-safe requests and no visitor credentials', async () => {
  for (const provenance of [null, 'woocommerce-published', 'woocommerce-live']) {
    const adapter = createPublicData('https://api.example', async (url, options) => {
      assert.equal(url.pathname, '/api/uc/products/101');
      assert.equal(url.search, '?publicationSafe=true');
      assert.deepEqual(options.headers, { Accept: 'application/json' });
      return new Response(JSON.stringify(inventory[0]), { headers: provenance ? { 'X-UC-Catalogue-Provenance': provenance } : {} });
    });
    if (provenance === 'woocommerce-live') assert.equal((await adapter.productOperation(101)).id, 101);
    else await assert.rejects(() => adapter.productOperation(101), PublicDataError);
  }
});
