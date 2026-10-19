import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { records, editorialProduct } from './fixtures/editorial-records.mjs';

test('production response exposes valid public JSON-LD without running any JavaScript', async () => {
  const fixture = http.createServer(async (req, res) => {
    res.setHeader('content-type', 'application/json');
    res.setHeader('x-uc-catalogue-provenance', 'companion-published');
    if (req.url === '/api/uc/product-records') {
      res.end(JSON.stringify(records));
    } else if (req.url.startsWith('/api/uc/product-records/')) {
      const product = await editorialProduct(req.url.split('/').at(-1), []);
      res.writeHead(product ? 200 : 404);
      res.end(JSON.stringify(product || {}));
    } else if (req.url === '/api/uc/products?publicationSafe=true') {
      res.end(JSON.stringify([{ id: 123, name: 'Public filter', price: '4199', sku: 'UC-BOG-SSB-008', stockStatus: 'instock' }]));
    } else if (req.url === '/api/uc/blog/published') {
      res.end(JSON.stringify({ article: { slug: 'published', title: 'Published article', summary: 'Summary', body: 'Real body', publishedAt: '2026-09-01T00:00:00Z' } }));
    } else if (req.url === '/api/uc/guides/steps') {
      res.end(JSON.stringify({ guide: { slug: 'steps', title: 'Steps', sections: [{ heading: 'Install', steps: ['Connect the filter'] }] } }));
    } else if (req.url === '/api/uc/guides/info') {
      res.end(JSON.stringify({ guide: { slug: 'info', title: 'Information', sections: [{ heading: 'Overview', body: 'General information' }] } }));
    } else { res.writeHead(404); res.end('{}'); }
  });
  await new Promise(resolve => fixture.listen(0, '127.0.0.1', resolve));
  const apiPort = fixture.address().port;
  const root = mkdtempSync(join(tmpdir(), 'uc-public-schema-'));
  const bundle = join(root, '2026-test', '_expo', 'static', 'js', 'web', 'bundle.js');
  mkdirSync(dirname(bundle), { recursive: true });
  writeFileSync(bundle, '// fixture');
  const child = spawn(process.execPath, [fileURLToPath(new URL('../../server/serve.js', import.meta.url))], {
    env: { ...process.env, PORT: '0', BASE_PATH: '/uc-companion', STATIC_ROOT: root,
      PUBLIC_WEB_RENDERING_ENABLED: 'true', PUBLIC_WEB_CANONICAL_ORIGIN: 'https://public.example',
      PUBLIC_WEB_API_ORIGIN: `http://127.0.0.1:${apiPort}` },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  try {
    const port = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Server did not start')), 5000);
      child.stdout.on('data', chunk => {
        const match = chunk.toString().match(/port (\d+)/);
        if (match) { clearTimeout(timeout); resolve(Number(match[1])); }
      });
      child.on('error', reject);
    });
    for (const [path, type] of [['product/123', 'Product'], ['blog/published', 'BlogPosting'], ['guide/steps', 'HowTo'], ['guide/info', null]]) {
      const response = await fetch(`http://127.0.0.1:${port}/uc-companion/${path}?tracking=ignored`, { headers: { 'x-forwarded-host': 'evil.test' } });
      assert.equal(response.status, 200);
      const html = await response.text();
      const script = html.match(/type="application\/ld\+json">([\s\S]*?)<\/script>/);
      assert.ok(script);
      const nodes = JSON.parse(script[1])['@graph'];
      if (type) assert.ok(nodes.some(node => node['@type'] === type));
      else assert.ok(nodes.every(node => node['@type'] !== 'HowTo'));
      assert.match(html, /<div id="uc-public-content"><main>/);
      assert.match(html, /<script defer src="\/uc-companion\/2026-test\//);
      assert.doesNotMatch(script[1], /tracking|evil\.test/);
    }
    const missing = await fetch(`http://127.0.0.1:${port}/uc-companion/guide/draft`);
    assert.equal(missing.status, 404);
    assert.equal(missing.headers.get('x-robots-tag'), 'noindex, follow');
    assert.doesNotMatch(await missing.text(), /application\/ld\+json/);
    const privatePage = await fetch(`http://127.0.0.1:${port}/uc-companion/account`);
    assert.doesNotMatch(await privatePage.text(), /application\/ld\+json/);
  } finally {
    child.kill();
    await new Promise(resolve => fixture.close(resolve));
    rmSync(root, { recursive: true, force: true });
  }
});