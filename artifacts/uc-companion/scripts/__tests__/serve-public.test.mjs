import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startFixture } from './fixtures/public-web.mjs';
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
const { activateStaticBuild, stagePlatformManifest } = createRequire(import.meta.url)('../active-static-build.cjs');

test('split exports activate with native platforms while preserving public HTML and metadata', async () => {
  const server = await startFixture();
  try {
    const id = '200-2';
    const directory = join(server.root, id, 'web/_expo/static/js/web');
    mkdirSync(directory, { recursive: true });
    for (const name of ['runtime', 'entry']) writeFileSync(join(directory, `${name}.js`), `window.${name}=true;`);
    const resourceBase = `/uc-companion/${id}/web/_expo/static/js/web`;
    writeFileSync(join(server.root, id, 'web/index.html'), `<html><head><title>Generic export</title><style>body{margin:0}</style></head><body><div id="root"></div><script defer src="${resourceBase}/runtime.js"></script><script defer src="${resourceBase}/entry.js"></script></body></html>`);
    writeFileSync(join(server.root, id, 'build-info.json'), JSON.stringify({ buildId: id }));
    assert.throws(() => activateStaticBuild(server.projectRoot, id), /Incomplete ios/);
    assert.equal((await (await fetch(`${server.base}/version.json`)).json()).buildId, '100-1');
    for (const platform of ['ios', 'android']) {
      const native = join(server.root, id, '_expo/static/js', platform);
      mkdirSync(native, { recursive: true });
      writeFileSync(join(native, 'bundle.js'), `${platform} bundle`);
      stagePlatformManifest(server.projectRoot, id, platform, {
        launchAsset: { key: `bundle-${id}`, url: `${server.base}/${id}/_expo/static/js/${platform}/bundle.js` },
      });
      if (platform === 'ios') assert.throws(() => activateStaticBuild(server.projectRoot, id), /Incomplete android/);
      assert.equal((await (await fetch(`${server.base}/version.json`)).json()).buildId, '100-1');
    }
    activateStaticBuild(server.projectRoot, id);
    const response = await fetch(`${server.base}/product/101`);
    const html = await response.text();
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.match(html, /Published Filter/);
    assert.match(html, /rel="canonical" href="https:\/\/public\.example\/product\/101"/);
    assert.match(html, /id="uc-public-content"/);
    assert.match(html, /uc-public-meta-endpoint/);
    assert.match(html, /body\{margin:0\}/);
    assert.doesNotMatch(html, /Generic export/);
    assert.ok(html.indexOf(`${resourceBase}/runtime.js`) < html.indexOf(`${resourceBase}/entry.js`));
    for (const name of ['runtime', 'entry']) {
      const script = await fetch(`${server.base}/${id}/web/_expo/static/js/web/${name}.js`);
      assert.equal(script.status, 200);
      assert.match(script.headers.get('cache-control'), /immutable/);
    }
    const missing = await fetch(`${server.base}/${id}/web/_expo/static/js/web/missing.js`, { headers: { Accept: 'text/html' } });
    assert.equal(missing.status, 404);
    assert.equal((await (await fetch(`${server.base}/version.json`)).json()).buildId, id);
    for (const platform of ['ios', 'android']) {
      const manifest = await (await fetch(`${server.base}/manifest`, { headers: { 'expo-platform': platform } })).json();
      assert.equal(manifest.launchAsset.key, `bundle-${id}`);
    }
    assert.equal((await fetch(`${server.base}/checkout`)).headers.get('x-robots-tag'), 'noindex, follow');
  } finally { await server.close(); }
});

test('cold legacy startup ignores a newer staged bundle and follows the live native release', async () => {
  const server = await startFixture({ prepareBuild: ({ root }) => {
    const directory = join(root, '200-2/_expo/static/js/web');
    mkdirSync(directory, { recursive: true });
    writeFileSync(join(directory, 'bundle.js'), 'incomplete-replacement');
  } });
  try {
    assert.match(await (await fetch(`${server.base}/about`)).text(), /\/100-1\/_expo\/static\/js\/web\/bundle\.js/);
    assert.equal((await (await fetch(`${server.base}/version.json`)).json()).buildId, '100-1');
    for (const platform of ['ios', 'android']) {
      const manifest = await (await fetch(`${server.base}/manifest`, { headers: { 'expo-platform': platform } })).json();
      assert.equal(manifest.launchAsset.key, 'bundle-100-1');
    }
  } finally { await server.close(); }
});

test('legacy upgrade stages manifests without live mutation and a failed build cannot advance any active platform', async () => {
  const server = await startFixture();
  const oldRoots = Object.fromEntries(['ios', 'android'].map(platform =>
    [platform, readFileSync(join(server.root, platform, 'manifest.json'), 'utf8')]));
  const assertActive = async buildId => {
    assert.match(await (await fetch(`${server.base}/about`)).text(), new RegExp(`/${buildId}/_expo/static/js/web/bundle\\.js`));
    assert.equal((await (await fetch(`${server.base}/version.json`)).json()).buildId, buildId);
    for (const platform of ['ios', 'android']) {
      for (const route of ['/manifest', `/${platform}/manifest.json`]) {
        const result = await (await fetch(`${server.base}${route}`, { headers: { 'expo-platform': platform } })).json();
        assert.equal(result.launchAsset.key, `bundle-${buildId}`);
      }
      assert.equal(readFileSync(join(server.root, platform, 'manifest.json'), 'utf8'), oldRoots[platform]);
    }
  };
  try {
    assert.equal(existsSync(join(server.root, 'active-build.json')), false);
    await assertActive('100-1');
    for (const platform of ['web', 'ios', 'android']) {
      const directory = join(server.root, '200-2/_expo/static/js', platform);
      mkdirSync(directory, { recursive: true });
      writeFileSync(join(directory, 'bundle.js'), 'new-retained-build');
    }
    // Failure after staging only iOS: no Android manifest or metadata yet.
    stagePlatformManifest(server.projectRoot, '200-2', 'ios', { launchAsset: { key: 'bundle-200-2' } });
    assert.throws(() => activateStaticBuild(server.projectRoot, '200-2'));
    assert.equal(existsSync(join(server.root, 'active-build.json')), false);
    await assertActive('100-1');
    stagePlatformManifest(server.projectRoot, '200-2', 'android', { launchAsset: { key: 'bundle-200-2' } });
    // Failure after both native stages: missing build metadata still forbids activation.
    assert.throws(() => activateStaticBuild(server.projectRoot, '200-2'));
    await assertActive('100-1');
    writeFileSync(join(server.root, '200-2/build-info.json'), JSON.stringify({ buildId: '200-2' }));
    // Even a complete staged release remains inactive until the atomic pointer.
    await assertActive('100-1');
    activateStaticBuild(server.projectRoot, '200-2');
    await assertActive('200-2');
  } finally { await server.close(); }
});

test('retained bundles switch only at completion, pairing HTML/version/native manifests and supporting rollback', async () => {
  const server = await startFixture();
  const release = buildId => {
    const root = join(server.root, buildId);
    for (const platform of ['web', 'ios', 'android']) {
      const directory = join(root, '_expo/static/js', platform);
      mkdirSync(directory, { recursive: true });
      writeFileSync(join(directory, 'bundle.js'), `fixture-${buildId}-${platform}`);
      if (platform !== 'web') {
        mkdirSync(join(root, platform), { recursive: true });
        writeFileSync(join(root, platform, 'manifest.json'), JSON.stringify({
          launchAsset: { key: `bundle-${buildId}`, url: `${server.base}/${buildId}/_expo/static/js/${platform}/bundle.js` },
        }));
      }
    }
    writeFileSync(join(root, 'build-info.json'), JSON.stringify({ buildId }));
    activateStaticBuild(server.projectRoot, buildId);
  };
  const assertRelease = async buildId => {
    const html = await (await fetch(`${server.base}/about`)).text();
    assert.match(html, new RegExp(`/${buildId}/_expo/static/js/web/bundle\\.js`));
    assert.match(html, new RegExp(`name="uc-build-id" content="${buildId}"`));
    assert.equal((await (await fetch(`${server.base}/version.json`)).json()).buildId, buildId);
    for (const platform of ['ios', 'android']) {
      const manifest = await (await fetch(`${server.base}/manifest`, { headers: { 'expo-platform': platform } })).json();
      assert.equal(manifest.launchAsset.key, `bundle-${buildId}`);
      assert.equal((await fetch(manifest.launchAsset.url)).status, 200);
    }
  };
  try {
    release('100-1');
    await assertRelease('100-1');
    const incomplete = join(server.root, '200-2/_expo/static/js/web');
    mkdirSync(incomplete, { recursive: true });
    writeFileSync(join(incomplete, 'bundle.js'), 'partial-new-build');
    assert.throws(() => activateStaticBuild(server.projectRoot, '200-2'));
    await assertRelease('100-1');
    release('200-2');
    await assertRelease('200-2');
    assert.equal(await (await fetch(`${server.base}/100-1/_expo/static/js/web/bundle.js`)).text(), 'fixture-100-1-web');
    activateStaticBuild(server.projectRoot, '100-1');
    await assertRelease('100-1');
    assert.equal((await fetch(`${server.base}/200-2/_expo/static/js/web/bundle.js`)).status, 200);
    writeFileSync(join(server.root, 'active-build.json'), '{"buildId":"../outside"}');
    for (const route of ['/bundle-status', '/version.json', '/manifest']) {
      const response = await fetch(`${server.base}${route}`, { headers: { 'expo-platform': 'ios' } });
      assert.equal(response.status, 503);
      assert.equal(response.headers.get('cache-control'), 'no-store');
    }
  } finally { await server.close(); }
});

test('HTTP 200 demo/legacy catalogue responses without provenance cannot enter HTML, schemas or sitemap', async () => {
  const server = await startFixture();
  try {
    server.state.catalogueProvenance = false;
    for (const route of ['/', '/products', '/product/101', '/sitemap.xml', '/public-page-meta?path=%2Fproduct%2F101']) {
      const response = await fetch(`${server.base}${route}`);
      assert.equal(response.status, 503, route);
      assert.equal(response.headers.get('cache-control'), 'no-store');
      const body = await response.text();
      assert.doesNotMatch(body, /Published Filter|<loc>|"@type":"Product"/);
    }
    assert.ok(server.requests.filter(request => request.path.startsWith('/api/uc/products'))
      .every(request => request.path === '/api/uc/products?publicationSafe=true'));
  } finally { await server.close(); }
});

test('production server emits public documents, private exclusions, crawler files and real 404s', async () => {
  const server = await startFixture();
  try {
    for (const route of ['/', '/products', '/product/101', '/blog', '/blog/water-care', '/guide/filter-care', '/support', '/map', '/about', '/enquiry', '/water-test']) {
      const response = await fetch(`${server.base}${route}`, { headers: { Accept: 'text/html', Cookie: 'private=secret', Authorization: 'Bearer private-token' } });
      assert.equal(response.status, 200, route);
      assert.match(response.headers.get('content-type'), /text\/html/);
      assert.equal(response.headers.get('cache-control'), 'no-store');
      assert.equal(response.headers.get('x-robots-tag'), null);
      const html = await response.text();
      assert.match(html, /<html lang="en">/);
      assert.match(html, /<h1>/);
      assert.match(html, /rel="icon".*\/uc-companion\/favicon.png/);
      assert.match(html, /rel="canonical"/);
      assert.doesNotMatch(html, /private-token|private=secret/);
      const script = html.match(/<script defer src="([^"]+)"/)[1];
      assert.equal((await fetch(new URL(script, server.base))).status, 200);
    }
    for (const route of ['/account', '/cart', '/checkout', '/orders', '/order/42', '/auth/login', '/auth/reset-password?resetToken=private', '/rewards', '/referral', '/review/new', '/ticket/new', '/admin/product-edit', '/hydration']) {
      const response = await fetch(`${server.base}${route}`, { headers: { Accept: 'text/html' } });
      assert.equal(response.status, 200, route);
      assert.equal(response.headers.get('x-robots-tag'), 'noindex, follow');
      const html = await response.text();
      assert.match(html, /name="robots" content="noindex, follow"/);
      assert.doesNotMatch(html, /rel="canonical"|application\/ld\+json|resetToken|<h1>/);
    }
    for (const route of ['/missing', '/product/999', '/product/101invalid', '/blog/unpublished', '/guide/unpublished', '/blog/water-care/nested']) {
      const response = await fetch(`${server.base}${route}`, { headers: { Accept: 'text/html' } });
      assert.equal(response.status, 404, route);
      assert.match(await response.text(), /<h1>Page not found<\/h1>/);
    }
    for (const accept of ['text/html', '*/*', 'application/xml']) {
      const robots = await fetch(`${server.base}/robots.txt`, { headers: { Accept: accept } });
      assert.equal(robots.status, 200);
      assert.match(robots.headers.get('content-type'), /text\/plain/);
      assert.match(await robots.text(), /Sitemap: https:\/\/public.example\/sitemap.xml/);
      const sitemap = await fetch(`${server.base}/sitemap.xml`, { headers: { Accept: accept } });
      assert.equal(sitemap.status, 200);
      assert.match(sitemap.headers.get('content-type'), /application\/xml/);
      assert.match(await sitemap.text(), /<urlset /);
    }
    const icon = await fetch(`${server.base}/favicon.png`);
    assert.equal(icon.status, 200);
    assert.equal(icon.headers.get('content-type'), 'image/png');
    assert.deepEqual([...new Uint8Array(await icon.arrayBuffer()).slice(0, 8)], [137,80,78,71,13,10,26,10]);
    for (const platform of ['ios', 'android']) {
      for (const route of ['/', '/manifest']) {
        const response = await fetch(`${server.base}${route}`, { headers: { 'expo-platform': platform } });
        assert.equal(response.status, 200);
        assert.match(response.headers.get('content-type'), /application\/json/);
        assert.equal(response.headers.get('expo-protocol-version'), '1');
        assert.ok((await response.json()).launchAsset);
      }
    }
    const version = await fetch(`${server.base}/version.json`);
    assert.equal((await version.json()).buildId, '100-1');
    assert.ok(server.requests.length);
    assert.ok(server.requests.every(request => !request.headers.cookie && !request.headers.authorization));
    server.state.unavailable = true;
    assert.equal((await fetch(`${server.base}/product/101`)).status, 503);
    const unavailable = await fetch(`${server.base}/sitemap.xml`);
    assert.equal(unavailable.status, 503);
    assert.match(unavailable.headers.get('content-type'), /text\/plain/);
    assert.equal(unavailable.headers.get('cache-control'), 'no-store');
  } finally { await server.close(); }
});

test('metadata endpoint changes public/private policy without serializing queries or customer data', async () => {
  const server = await startFixture();
  try {
    const publicResponse = await fetch(`${server.base}/public-page-meta?path=${encodeURIComponent('/product/101')}`);
    const product = await publicResponse.json();
    assert.equal(product.meta.canonical, 'https://public.example/product/101');
    const privateResponse = await fetch(`${server.base}/public-page-meta?path=${encodeURIComponent('/checkout')}`);
    const privatePage = await privateResponse.json();
    assert.equal(privatePage.meta.robots, 'noindex, follow');
    assert.equal(privatePage.meta.canonical, undefined);
    assert.deepEqual(privatePage.schemas, []);
    assert.equal((await fetch(`${server.base}/public-page-meta?path=${encodeURIComponent('https://evil.example/')}`)).status, 404);
    assert.equal((await fetch(`${server.base}/missing.js`)).status, 404);
    const head = await fetch(`${server.base}/sitemap.xml`, { method: 'HEAD' });
    assert.equal(head.status, 200);
    assert.equal(await head.text(), '');
  } finally { await server.close(); }
});
test('flag-off rollback preserves the original bundle and native paths, while adding language/icon/private noindex', async () => {
  const server = await startFixture({ enabled: false });
  try {
    const response = await fetch(`${server.base}/`, { headers: { Accept: 'text/html' } });
    assert.equal(response.status, 200);
    const html = await response.text();
    assert.match(html, /<html lang="en">/);
    assert.match(html, /<div id="root"><\/div>/);
    assert.doesNotMatch(html, /<h1>|uc-public-meta-endpoint/);
    const privateResponse = await fetch(`${server.base}/account`);
    assert.equal(privateResponse.headers.get('x-robots-tag'), 'noindex, follow');
    assert.equal((await fetch(`${server.base}/manifest`, { headers: { 'expo-platform': 'ios' } })).status, 200);
  } finally { await server.close(); }
});
test('public HTML remains readable when no compiled bundle is available', async () => {
  const server = await startFixture({ noBundle: true, basePath: '' });
  try {
    const response = await fetch(`${server.base}/about`);
    assert.equal(response.status, 200);
    const html = await response.text();
    assert.match(html, /<h1>About Ultra Clear Companion<\/h1>/);
    assert.doesNotMatch(html, /<script defer/);
    assert.equal((await fetch(`${server.base}/blog/unpublished`)).status, 404);
  } finally { await server.close(); }
});