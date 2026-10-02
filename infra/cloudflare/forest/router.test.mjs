import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

test('Cloudflare grants credential-free access only to exact public forest reads', async () => {
  const context = vm.createContext({
    Request, Response, Headers, URL, addEventListener() {},
    fetch: async () => new Response('{}', {
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Credentials': 'true' },
    }),
  });
  vm.runInContext(await readFile('infra/cloudflare/ucfilters-router.js', 'utf8'), context);
  for (const path of ['/api/uc/customer/tree', '/api/uc/impact/forest/private', '/api/uc/impact/forest/']) {
    const response = await context.routeRequest(new Request(`https://api.ucfilters.com${path}`, {
      headers: { Origin: 'https://forest.ucfilters.com' },
    }));
    assert.equal(response.headers.get('Access-Control-Allow-Origin'), null);
    assert.equal(response.headers.get('Access-Control-Allow-Credentials'), null);
  }
  for (const origin of ['https://forest.ucfilters.com', 'https://release-hydrate-the-future.uc-hydrate-forest.pages.dev']) {
    const response = await context.routeRequest(new Request('https://api.ucfilters.com/api/uc/impact/forest', { headers: { Origin: origin } }));
    assert.equal(response.headers.get('Access-Control-Allow-Origin'), '*');
    assert.equal(response.headers.get('Access-Control-Allow-Credentials'), null);
  }
  const options = await context.routeRequest(new Request('https://api.ucfilters.com/api/uc/impact/forest', {
    method: 'OPTIONS', headers: { Origin: 'https://forest.ucfilters.com', 'Access-Control-Request-Method': 'GET' },
  }));
  assert.equal(options.status, 204);
  assert.equal(options.headers.get('Access-Control-Allow-Methods'), 'GET, HEAD, OPTIONS');
  const post = await context.routeRequest(new Request('https://api.ucfilters.com/api/uc/impact/forest', {
    method: 'OPTIONS', headers: { Origin: 'https://forest.ucfilters.com', 'Access-Control-Request-Method': 'POST' },
  }));
  assert.equal(post.headers.get('Access-Control-Allow-Origin'), null);
});