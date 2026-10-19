import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import http from 'node:http';
import vm from 'node:vm';
const require = createRequire(import.meta.url);
const { renderGuestPayPage } = require('../../server/guest-pay-page.cjs');
const { createGuestPayDelivery } = require('../../server/guest-pay-delivery.cjs');
const { isWebAppRoute } = require('../../server/web-routes.cjs');
describe('private isolated guest pay document', () => {
  it('has generic noindex metadata, no token/customer markup or external resources by default; scripts parse', () => {
    const html = renderGuestPayPage({ apiBase: '/uc-companion', basePath: '/uc-companion' });
    assert.match(html, /noindex, nofollow, noarchive/);
    assert.match(html, /name="referrer" content="no-referrer"/);
    assert.doesNotMatch(html, /<script[^>]*src=|<link|<iframe|<img|shippingAddress|address1|lastName/);
    assert.match(html, /history\.replaceState/);
    assert.ok(!html.includes('Nothing has been charged'));
    for (const [, source] of html.matchAll(/<script>([\s\S]*?)<\/script>/g)) new vm.Script(source);
    assert.equal(isWebAppRoute('/pay/opaque'), true);
  });
  it('private delivery uses same-origin POST-only redacted proxy with no account cookies/auth forwarded', async () => {
    const requests = [];
    const deliver = createGuestPayDelivery({ basePath: '/uc-companion', apiOrigin: 'https://api.fixture.test',
      fetchImpl: async (url, init) => { requests.push({ url, init }); return new Response('{"state":"ready"}'); } });
    const server = http.createServer((req, res) => { void deliver(req, res, new URL(req.url, 'http://fixture').pathname)
      .then(handled => { if (!handled) { res.writeHead(404); res.end(); } }); });
    await new Promise(r => server.listen(0, '127.0.0.1', r));
    const base = `http://127.0.0.1:${server.address().port}`;
    try {
      const doc = await fetch(base + '/pay/' + 'a'.repeat(43));
      assert.equal(doc.status, 200); assert.match(doc.headers.get('cache-control'), /private, no-store/);
      assert.match(doc.headers.get('content-security-policy'), /default-src 'none'/);
      assert.equal(doc.headers.get('referrer-policy'), 'no-referrer');
      assert.ok(!(await doc.text()).includes('a'.repeat(43)));
      const response = await fetch(base + '/guest-pay/summary', { method: 'POST',
        headers: { 'content-type': 'application/json', authorization: 'Bearer unrelated', cookie: 'private', referer: 'https://fixture/pay/secret' },
        body: JSON.stringify({ token: 'test-bearer', checkout: { private: 'drop' }, amount: 1 }) });
      assert.equal(response.status, 200);
      assert.deepEqual(requests[0].init.headers, { 'content-type': 'application/json', accept: 'application/json' });
      assert.deepEqual(JSON.parse(requests[0].init.body), { token: 'test-bearer' });
      assert.equal((await fetch(base + '/guest-pay/initialize')).status, 405);
      assert.equal(requests.length, 1);
    } finally { await new Promise(r => server.close(r)); }
  });
});
