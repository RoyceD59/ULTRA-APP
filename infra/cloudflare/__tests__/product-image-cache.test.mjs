import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../ucfilters-router.js', import.meta.url), 'utf8');
function worker(status = 200, contentType = 'image/webp', headerOverrides = {}) {
  let listener, fetches = 0;
  const stored = new Map();
  const context = vm.createContext({
    Request, Response, Headers, URL,
    addEventListener: (_event, callback) => { listener = callback; },
    fetch: async () => {
      fetches++;
      return new Response('fixture image', { status, headers: {
        'Content-Type': contentType, 'Cache-Control': 'public, max-age=31536000, immutable',
        ...headerOverrides,
      } });
    },
    caches: { default: {
      match: async key => stored.get(key.url)?.clone(),
      put: async (key, response) => { stored.set(key.url, response.clone()); },
    } },
  });
  vm.runInContext(source, context);
  return {
    async request(path, headers) {
      let response;
      const pending = [];
      listener({ request: new Request(`https://api.ucfilters.com${path}`, { headers }),
        respondWith: value => { response = value; }, waitUntil: value => pending.push(value) });
      const result = await response;
      await Promise.all(pending);
      return result;
    },
    get fetches() { return fetches; },
    get count() { return stored.size; },
  };
}
const photo = '/api/storage/objects/uploads/123e4567-e89b-42d3-a456-426614174000';
test('public image misses populate edge cache and equivalent widths hit', async () => {
  const instance = worker();
  const first = await instance.request(`${photo}?w=150`);
  assert.equal(first.headers.get('X-UC-Image-Cache'), 'miss');
  assert.match(first.headers.get('Cache-Control'), /public/);
  assert.equal((await instance.request(`${photo}?w=256`)).headers.get('X-UC-Image-Cache'), 'hit');
  assert.equal(instance.fetches, 1);
});
test('credentials, cookies, unknown parameters and private routes never enter the cache', async () => {
  for (const [path, headers] of [
    [photo, { authorization: 'Bearer fixture' }], [photo, { cookie: 'session=fixture' }],
    [`${photo}?unknown=1`, {}], [`${photo}?w=128&w=768`, {}], ['/api/oauth/token', {}],
    ['/api/uc/admin/restock-requests', {}], ['/api/uc/restock-requests', {}],
  ]) {
    const instance = worker();
    const result = await instance.request(path, headers);
    assert.equal(instance.count, 0);
    assert.match(result.headers.get('Cache-Control'), /no-store/);
  }
});
test('errors and non-image responses cannot be stored as product photographs', async () => {
  for (const [status, contentType] of [[404, 'image/webp'], [503, 'image/webp'], [200, 'text/html'], [200, 'application/json']]) {
    const instance = worker(status, contentType);
    const result = await instance.request(photo);
    assert.equal(instance.count, 0);
    assert.match(result.headers.get('Cache-Control'), /no-store/);
  }
});
test('private directives and Set-Cookie override an otherwise public image response', async () => {
  for (const headers of [
    { 'Cache-Control': 'public, private, max-age=600' },
    { 'Cache-Control': 'public, no-store' }, { 'Set-Cookie': 'fixture=value' },
  ]) {
    const instance = worker(200, 'image/webp', headers);
    assert.match((await instance.request(photo)).headers.get('Cache-Control'), /no-store/);
    assert.equal(instance.count, 0);
  }
});
