import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const { PublicDataError } = createRequire(import.meta.url)('../../../server/public-content.cjs');

export const fixtures = {
  products: [{ id: 101, name: 'Commerce wording must not leak', price: '4199', stockStatus: 'instock', shortDescription: 'Commerce summary must not leak',
    description: 'Commerce details must not leak', sku: 'UC-BOG-SSB-008', images: [{ src: 'https://media.example/image.png', alt: 'Filter front view' }] }],
  guides: [{ slug: 'filter-care', title: 'Filter care', summary: 'Care summary' }],
  guide: { slug: 'filter-care', title: 'Filter care', summary: 'Care summary',
    sections: [{ heading: 'Cleaning', body: 'Care instructions', steps: ['Rinse the filter', 'Allow to dry'],
      media: [{ kind: 'image', url: '/api/guide.png', altText: 'Cleaning illustration' }] }] },
  article: { slug: 'water-care', title: 'Water care', summary: 'Water care summary',
    body: '## Care advice\n\nRead [Water guidance](https://example.org/water).',
    publishedAt: '2026-09-01T10:00:00Z', sources: [{ title: 'Water guidance', url: 'https://example.org/water' }] },
  locations: [{ name: 'Verified location', address: 'Published address', hours: 'Published hours', accessNotes: 'Public access notes' }],
};
export const data = {
  products: async () => fixtures.products,
  productOperation: async id => fixtures.products.find(p => p.id === id),
  articles: async () => [fixtures.article],
  article: async slug => { if (slug !== fixtures.article.slug) throw new PublicDataError(404); return fixtures.article; },
  guides: async () => fixtures.guides,
  guide: async slug => { if (slug !== fixtures.guide.slug) throw new PublicDataError(404); return fixtures.guide; },
  locations: async () => fixtures.locations,
};

export async function startFixture({ enabled = true, bundle = '', basePath = '/uc-companion', noBundle = false, prepareBuild = null } = {}) {
  const requests = [];
  const state = { unavailable: false, catalogueProvenance: true };
  const api = createServer((req, res) => {
    requests.push({ path: req.url, headers: req.headers });
    res.setHeader('content-type', 'application/json');
    if (state.unavailable) { res.writeHead(503); res.end('{}'); return; }
    const route = new URL(req.url, 'http://fixture').pathname;
    if (route === '/api/uc/products' && state.catalogueProvenance) {
      res.setHeader('X-UC-Catalogue-Provenance', 'woocommerce-published');
    }
    if (route === '/api/uc/products/101' && state.catalogueProvenance) {
      res.setHeader('X-UC-Catalogue-Provenance', 'woocommerce-live');
    }
    const values = {
      '/api/uc/products': fixtures.products,
      '/api/uc/products/101': fixtures.products[0],
      '/api/uc/blog': { articles: [fixtures.article], nextCursor: null },
      '/api/uc/blog/water-care': { article: fixtures.article },
      '/api/uc/guides': { guides: fixtures.guides },
      '/api/uc/guides/filter-care': { guide: fixtures.guide },
      '/api/uc/locations': fixtures.locations,
    };
    res.writeHead(values[route] ? 200 : 404);
    res.end(JSON.stringify(values[route] || {}));
  });
  await new Promise(resolve => api.listen(0, '127.0.0.1', resolve));
  const reserve = net.createServer();
  await new Promise(resolve => reserve.listen(0, '127.0.0.1', resolve));
  const port = reserve.address().port;
  await new Promise(resolve => reserve.close(resolve));
  const projectRoot = mkdtempSync(join(tmpdir(), 'uc-public-server-'));
  const root = join(projectRoot, 'static-build');
  const buildDir = join(root, '100-1/_expo/static/js/web');
  mkdirSync(buildDir, { recursive: true });
  if (!noBundle) writeFileSync(join(buildDir, 'bundle.js'), bundle);
  writeFileSync(join(root, '100-1/build-info.json'), JSON.stringify({ buildId: '100-1' }));
  for (const platform of ['ios', 'android']) {
    mkdirSync(join(root, platform));
    writeFileSync(join(root, platform, 'manifest.json'), JSON.stringify({
      launchAsset: { key: 'bundle-100-1', url: `/100-1/${platform}.js` },
    }));
  }
  if (prepareBuild) prepareBuild({ projectRoot, root });
  const child = spawn(process.execPath, [fileURLToPath(new URL('../../../server/serve.js', import.meta.url))], {
    env: { ...process.env, PORT: String(port), STATIC_ROOT: root, BASE_PATH: basePath,
      PUBLIC_WEB_RENDERING_ENABLED: String(enabled), PUBLIC_WEB_CANONICAL_ORIGIN: 'https://public.example',
      PUBLIC_WEB_API_ORIGIN: `http://127.0.0.1:${api.address().port}` },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let logs = '';
  child.stdout.on('data', value => { logs += value; });
  child.stderr.on('data', value => { logs += value; });
  const base = `http://127.0.0.1:${port}${basePath}`;
  const close = async () => {
    if (child.exitCode === null) {
      child.kill();
      await new Promise(resolve => child.once('exit', resolve));
    }
    await new Promise(resolve => api.close(resolve));
    rmSync(projectRoot, { recursive: true, force: true });
  };
  try {
    let ready = false;
    for (let attempt = 0; attempt < 80; attempt++) {
      try { if ((await fetch(`${base}/status`)).ok) { ready = true; break; } } catch { /* startup */ }
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    assert.ok(ready, `Fixture server did not start: ${logs}`);
  } catch (error) { await close(); throw error; }
  return { base, child, requests, state, root, projectRoot, close };
}