import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { records, editorialProduct } from './fixtures/editorial-records.mjs';

const require = createRequire(import.meta.url);
const { productModel, articleModel, guideModel, jsonLd, publicUrl } = require('../../server/public-schema.cjs');
const { createPublicRenderer, renderHead } = require('../../server/public-rendering.cjs');
const { createPublicData } = require('../../server/public-content.cjs');
const { classifyWebRoute } = require('../../server/web-routes.cjs');
const apiOrigin = 'https://api.example.test';
const product = { id: 123, name: 'Filter </script><script>alert(1)</script>', sku: 'SKU-123',
  description: '<p>A &amp; B</p>', images: [{ src: '/api/storage/objects/uploads/example.jpg', alt: 'Filter' }],
  price: '1500', regularPrice: '1700', salePrice: '1200', stockStatus: 'instock',
  stockQuantity: 99, enquiryOnly: false, customerEmail: 'PRIVATE', averageRating: 5 };
const article = { slug: 'clean-water', title: 'Clean water', summary: 'Article summary',
  body: 'Published body\nwith instructions', publishedAt: '2026-09-01T12:00:00.000Z',
  updatedAt: '2026-10-03T12:00:00.000Z', createdBy: 'PRIVATE' };
const guide = { slug: 'installation', title: 'Install the filter', summary: 'Installation guide',
  readTime: '3 min read', updatedAt: '2026-10-01', sections: [
    { heading: 'Before installing', body: 'Check the fittings', warning: 'Turn water off', steps: ['Turn off water', 'Connect filter'],
      media: [{ kind: 'image', url: '/api/storage/objects/library/guides/figure.jpg', altText: 'Fitting', caption: 'Connect here' },
        { kind: 'video', url: 'https://media.example.test/install.mp4', posterUrl: 'https://media.example.test/poster.jpg', altText: 'Installation video' }] },
    { heading: 'After installing', steps: ['Check for leaks'] },
  ] };

async function publicPage(path, { apiOrigin = 'https://api.example.test', basePath = '', editorialAvailable = true, fetchImpl = async () =>
  Response.json([], { headers: { 'x-uc-catalogue-provenance': 'companion-published' } }) } = {}) {
  if (classifyWebRoute(path) !== 'public') return null;
  const page = await createPublicRenderer({
    canonicalOrigin: 'https://app.ucfilters.com', basePath,
    data: createPublicData(apiOrigin, async (url, options) => {
      if (url.pathname === '/api/uc/product-records') {
        return editorialAvailable ? Response.json(records) : new Response('', { status: 503 });
      }
      if (url.pathname.startsWith('/api/uc/product-records/')) {
        const response = await fetchImpl(new URL('/api/uc/products?publicationSafe=true', apiOrigin), options);
        if (!response.ok) return response;
        const product = await editorialProduct(url.pathname.split('/').at(-1), await response.json(), apiOrigin);
        return product ? Response.json(product) : new Response('', { status: 404 });
      }
      return fetchImpl(url, options);
    }),
  }).render(path);
  return { ...page, head: renderHead(page.meta, page.schemas) };
}

function graph(page) {
  const script = page.head.match(/<script data-uc-seo type="application\/ld\+json">([\s\S]*?)<\/script>/);
  assert.ok(script);
  return JSON.parse(script[1])['@graph'];
}

test('Product maps displayed sale precedence, KES, images and stock; never private fields or ratings', () => {
  const model = productModel(product, '/product/123', apiOrigin);
  assert.equal(model.schema.offers.price, '1200');
  assert.equal(model.schema.offers.priceCurrency, 'KES');
  assert.equal(model.schema.offers.availability, 'https://schema.org/InStock');
  assert.equal(model.schema.description, 'A & B');
  assert.deepEqual(model.schema.image, [`${apiOrigin}/api/storage/objects/uploads/example.jpg`]);
  assert.equal(model.schema.sku, product.sku);
  assert.doesNotMatch(JSON.stringify(model.schema), /PRIVATE|rating|stockQuantity|certification/);
  assert.equal(productModel({ ...product, stockStatus: 'outofstock' }, '/product/123', apiOrigin).schema.offers.availability, 'https://schema.org/OutOfStock');
  assert.equal(productModel({ ...product, stockStatus: 'onbackorder' }, '/product/123', apiOrigin).schema.offers.availability, undefined);
});

test('quote-only, missing, invalid prices do not produce fictional Offers', () => {
  for (const patch of [{ enquiryOnly: true }, { salePrice: '', price: '', regularPrice: '' },
    { salePrice: '-1' }, { salePrice: 'free' }, { salePrice: '1oops' }]) {
    assert.equal(productModel({ ...product, ...patch }, '/product/123', apiOrigin).schema.offers, undefined);
  }
});

test('published article uses only public snapshot and actual date, no invented author or freshness', () => {
  const model = articleModel(article, '/blog/clean-water');
  assert.equal(model.schema.headline, article.title);
  assert.equal(model.schema.articleBody, article.body);
  assert.equal(model.schema.description, article.summary);
  assert.equal(model.schema.datePublished, article.publishedAt);
  assert.equal(model.schema.author, undefined);
  assert.equal(model.schema.dateModified, undefined);
  assert.equal(articleModel({ ...article, publishedAt: 'invalid' }, '/blog/clean-water').schema.datePublished, undefined);
});

test('HowTo requires real steps, retains section sequence and media; readTime is not totalTime', () => {
  const model = guideModel(guide, '/guide/installation', apiOrigin);
  assert.equal(model.schema['@type'], 'HowTo');
  assert.deepEqual(model.schema.step.flatMap(section => section.itemListElement.map(step => step.text)),
    ['Turn off water', 'Connect filter', 'Check for leaks']);
  assert.deepEqual(model.schema.step[0].image, [`${apiOrigin}/api/storage/objects/library/guides/figure.jpg`]);
  assert.equal(model.sections[0].media[1].posterUrl, 'https://media.example.test/poster.jpg');
  for (const key of ['totalTime', 'estimatedCost', 'supply', 'tool', 'dateModified']) assert.equal(model.schema[key], undefined);
  assert.equal(guideModel({ ...guide, sections: [{ heading: 'Overview', body: 'Information', steps: ['', '  '] }] }, '/guide/info', apiOrigin).schema, null);
});

test('JSON-LD survives script terminators, HTML entities, quotes and Unicode separators', () => {
  const value = `</script><img src=x onerror=alert(1)> " & \u2028 \u2029`;
  const script = jsonLd([{ '@type': 'Product', name: value }]);
  assert.equal((script.match(/<\/script>/g) || []).length, 1);
  assert.doesNotMatch(script, /<img|<script>alert|\u2028|\u2029/);
  const parsed = JSON.parse(script.slice(script.indexOf('>') + 1, script.lastIndexOf('</script>')));
  assert.equal(parsed['@graph'][0].name, value);
  for (const unsafe of ['javascript:alert(1)', 'data:text/html,x', 'https://user:password@host.test']) {
    assert.equal(publicUrl(unsafe), undefined);
  }
});

test('public HTML renders schema and the same visible data with matching real breadcrumbs', async () => {
  for (const [path, payload, type] of [
    ['/product/hydra-flux', { ...product, id: 123, sku: 'UC-BOG-SSB-008' }, 'Product'],
    ['/blog/clean-water', { article }, 'BlogPosting'],
    ['/guide/installation', { guide }, 'HowTo'],
  ]) {
    const page = await publicPage(path, { apiOrigin, basePath: '/uc-companion', fetchImpl: async (_url, options) => {
      assert.deepEqual(options.headers, { Accept: 'application/json' });
      return Response.json(type === 'Product' ? [payload] : payload, { headers: { 'x-uc-catalogue-provenance': 'companion-published' } });
    } });
    const nodes = graph(page);
    assert.ok(nodes.some(node => node['@type'] === type));
    const crumbs = nodes.find(node => node['@type'] === 'BreadcrumbList');
    for (const crumb of crumbs.itemListElement) {
      assert.ok(page.body.includes(crumb.name.replace(/</g, '&lt;').replace(/>/g, '&gt;')));
      assert.ok(crumb.item.startsWith('https://app.ucfilters.com/'));
    }
    assert.match(page.body, /href="\/uc-companion\//);
    assert.doesNotMatch(page.head + page.body, /PRIVATE|<script>alert/);
    if (type === 'Product') {
      assert.match(page.body, /KES 4,199/);
      assert.match(page.body, /<summary>Specifications<\/summary>/);
      assert.doesNotMatch(page.body, /<summary>Questions<\/summary>/);
      assert.doesNotMatch(page.head, /FAQPage/);
    }
    if (type === 'BlogPosting') assert.ok(page.body.includes(article.body));
    if (type === 'HowTo') assert.match(page.body, /Turn off water|<video controls/);
  }
});

test('lists contain only visible public entries and canonical links; no FAQ or location schemas', async () => {
  const page = await publicPage('/blog', { fetchImpl: async () => Response.json({ articles: [article], nextCursor: null }) });
  const list = graph(page).find(node => node['@type'] === 'ItemList');
  assert.deepEqual(list.itemListElement, [{ '@type': 'ListItem', position: 1, name: article.title, url: 'https://app.ucfilters.com/blog/clean-water' }]);
  assert.match(page.body, /href="\/blog\/clean-water"/);
  assert.doesNotMatch(page.head, /FAQPage|LocalBusiness/);
  const map = await publicPage('/map', { fetchImpl: async () => Response.json([]) });
  assert.doesNotMatch(map.head, /LocalBusiness/);
});

test('shared identity IDs remain stable across public pages; private pages never fetch', async () => {
  const home = graph(await publicPage('/'));
  const blog = graph(await publicPage('/blog', { fetchImpl: async () => Response.json({ articles: [], nextCursor: null }) }));
  for (const type of ['Organization', 'WebSite']) {
    assert.equal(home.find(node => node['@type'] === type)['@id'], blog.find(node => node['@type'] === type)['@id']);
  }
  for (const path of ['/account', '/checkout', '/orders', '/admin/blog', '/auth/login', '/product/123abc', '/blog/%2fadmin']) {
    const page = await publicPage(path, { fetchImpl: () => { throw new Error('must not fetch'); } });
    assert.ok(page === null || (page.status === 404 && page.schemas.length === 0));
  }
});

test('unverified/demo products and unpublished/API failures fail closed', async () => {
  for (const path of ['/product/123']) {
    assert.equal((await publicPage(path, { fetchImpl: async () => Response.json(product) })).status, 503);
  }
  assert.equal((await publicPage('/guide/draft', { fetchImpl: async () => new Response('', { status: 404 }) })).status, 404);
  assert.equal((await publicPage('/blog/article', { fetchImpl: async () => { throw new Error('offline'); } })).status, 503);
  const unavailable = await publicPage('/', { editorialAvailable: false });
  assert.equal(unavailable.status, 503, 'missing authoritative editorial catalogue must never fall back to bundled records');
  assert.doesNotMatch(unavailable.head, /application\/ld\+json/);
});