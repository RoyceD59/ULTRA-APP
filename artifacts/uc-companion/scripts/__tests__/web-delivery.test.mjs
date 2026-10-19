import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import http from 'node:http';
import { brotliDecompressSync, gunzipSync } from 'node:zlib';

const require = createRequire(import.meta.url);
const { pairWebResources, precompressAssets } = require('../web-export.js');
const { preserveLegacyManifests } = require('../build-retention.js');
const { preferredEncoding, staticCachePolicy } = require('../../server/static-delivery.cjs');
const BUILD = '1790705576693-2655';
const NEXT = '1790705576694-2656';
const BASE = '/uc-companion';

test('legacy native manifests survive subsequent builds without overwriting retained versions', () => {
  const root = mkdtempSync(join(tmpdir(), 'uc-legacy-retention-'));
  try {
    mkdirSync(join(root, BUILD));
    for (const platform of ['ios', 'android']) {
      mkdirSync(join(root, platform));
      writeFileSync(join(root, platform, 'manifest.json'), JSON.stringify({
        launchAsset: { url: `https://app.ucfilters.com${BASE}/${BUILD}/_expo/static/js/${platform}/bundle.js` },
      }));
    }
    preserveLegacyManifests(root);
    for (const platform of ['ios', 'android']) {
      const saved = readFileSync(join(root, BUILD, platform, 'manifest.json'), 'utf8');
      writeFileSync(join(root, platform, 'manifest.json'), '{}');
      preserveLegacyManifests(root);
      assert.equal(readFileSync(join(root, BUILD, platform, 'manifest.json'), 'utf8'), saved);
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('encoding negotiation respects q=0 and preference', () => {
  assert.equal(preferredEncoding('gzip, br'), 'br');
  assert.equal(preferredEncoding('br;q=0, gzip'), 'gzip');
  assert.equal(preferredEncoding('gzip;q=0.9, br;q=0.2'), 'gzip');
  assert.equal(preferredEncoding('identity'), undefined);
  assert.equal(preferredEncoding('*;q=0'), undefined);
});

test('immutable caching is limited to versioned public resources', () => {
  assert.match(staticCachePolicy(`/${BUILD}/web/_expo/static/js/web/entry.js`), /immutable/);
  assert.match(staticCachePolicy(`/${BUILD}/_expo/static/js/ios/bundle.js`), /immutable/);
  assert.match(staticCachePolicy(`/${BUILD}/web/assets/font.ttf`), /immutable/);
  for (const url of ['/version.json', '/active-build.json', '/api/uc/orders',
    `/${BUILD}/web/index.html`, `/${BUILD}/build-info.json`, `/${BUILD}/ios/manifest.json`,
    `/${BUILD}/web/assets/private.json`, '/assets/font.ttf']) {
    assert.equal(staticCachePolicy(url), 'no-store', url);
  }
});

test('split web export and server preserve versions, deep links, compression and native manifests', async () => {
  const root = mkdtempSync(join(tmpdir(), 'uc-split-delivery-'));
  let child;
  function fixture(id) {
    const web = join(root, id, 'web');
    mkdirSync(join(web, '_expo/static/js/web'), { recursive: true });
    mkdirSync(join(web, 'assets'), { recursive: true });
    writeFileSync(join(web, 'index.html'), `<html><head></head><body><div id="root"></div><script defer src="${BASE}/_expo/static/js/web/entry.js"></script></body></html>`);
    writeFileSync(join(web, '_expo/static/js/web/entry.js'), `window.entry="${id}";window.chunk="${BASE}/_expo/static/js/web/cart.js";window.font="${BASE}/assets/font.ttf";`);
    writeFileSync(join(web, '_expo/static/js/web/cart.js'), 'window.cart=true;');
    writeFileSync(join(web, 'assets/font.ttf'), 'font fixture');
    writeFileSync(join(root, id, 'build-info.json'), JSON.stringify({ buildId: id }));
    for (const platform of ['ios', 'android']) {
      mkdirSync(join(root, id, platform), { recursive: true });
      writeFileSync(join(root, id, platform, 'manifest.json'), JSON.stringify({ launchAsset: { url: `/${id}/_expo/static/js/${platform}/bundle.js` } }));
    }
    pairWebResources(web, BASE, id);
    precompressAssets(join(root, id));
  }
  function request(port, url, headers = {}, method = 'GET') {
    return new Promise((resolve, reject) => {
      const req = http.request({ hostname: '127.0.0.1', port, path: url, method, headers }, res => {
        const chunks = [];
        res.on('data', data => chunks.push(data));
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
      });
      req.on('error', reject); req.end();
    });
  }
  try {
    fixture(BUILD);
    writeFileSync(join(root, 'active-build.json'), JSON.stringify({ buildId: BUILD }));
    child = spawn(process.execPath, [fileURLToPath(new URL('../../server/serve.js', import.meta.url))], {
      env: { ...process.env, STATIC_ROOT: root, BASE_PATH: BASE, PORT: '0' }, stdio: ['ignore', 'pipe', 'pipe'],
    });
    const port = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('server startup timeout')), 10000);
      child.stdout.on('data', data => {
        const match = data.toString().match(/port (\d+)/);
        if (match) { clearTimeout(timeout); resolve(Number(match[1])); }
      });
      child.once('exit', code => { clearTimeout(timeout); reject(new Error(`server exited ${code}`)); });
    });
    for (const route of ['/', '/products', '/blog', '/cart', '/auth/login', '/product/42']) {
      const response = await request(port, `${BASE}${route}`, { accept: 'text/html' });
      assert.equal(response.status, 200);
      assert.equal(response.headers['cache-control'], 'no-store');
      assert.match(response.body.toString(), new RegExp(`${BUILD}/web/_expo/static/js/web/entry.js`));
      assert.match(response.body.toString(), /uc-build-id/);
    }
    const entryPath = `${BASE}/${BUILD}/web/_expo/static/js/web/entry.js`;
    for (const encoding of ['br', 'gzip', 'identity']) {
      const response = await request(port, entryPath, { 'accept-encoding': encoding });
      assert.equal(response.status, 200);
      assert.match(response.headers['cache-control'], /immutable/);
      assert.equal(response.headers.vary, 'Accept-Encoding');
      const decoded = encoding === 'br' ? brotliDecompressSync(response.body)
        : encoding === 'gzip' ? gunzipSync(response.body) : response.body;
      assert.equal(decoded.toString(), readFileSync(join(root, BUILD, 'web/_expo/static/js/web/entry.js'), 'utf8'));
      assert.match(decoded.toString(), new RegExp(`${BUILD}/web/_expo/static/js/web/cart.js`));
      assert.match(decoded.toString(), new RegExp(`${BUILD}/web/assets/font.ttf`));
    }
    assert.equal((await request(port, entryPath, {}, 'HEAD')).body.length, 0);
    const missing = await request(port, `${BASE}/${BUILD}/web/_expo/static/js/web/missing.js`, { accept: 'text/html' });
    assert.equal(missing.status, 404);
    assert.equal(missing.headers['cache-control'], 'no-store');
    fixture(NEXT);
    writeFileSync(join(root, 'active-build.json'), JSON.stringify({ buildId: NEXT }));
    assert.equal(JSON.parse((await request(port, `${BASE}/version.json`)).body).buildId, NEXT);
    assert.equal((await request(port, entryPath)).status, 200); // existing tab's old chunks survive
    for (const platform of ['ios', 'android']) {
      const manifest = await request(port, `${BASE}/manifest`, { 'expo-platform': platform });
      assert.equal(manifest.headers['cache-control'], 'no-store');
      assert.match(JSON.parse(manifest.body).launchAsset.url, new RegExp(NEXT));
    }
    writeFileSync(join(root, 'active-build.json'), JSON.stringify({ buildId: BUILD })); // rollback
    assert.equal(JSON.parse((await request(port, `${BASE}/version.json`)).body).buildId, BUILD);
  } finally {
    child?.kill();
    rmSync(root, { recursive: true, force: true });
  }
});
