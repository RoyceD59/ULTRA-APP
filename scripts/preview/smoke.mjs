import assert from 'node:assert/strict';

const base = 'http://localhost';
async function check(path, expectedStatus = 200) {
  const response = await fetch(`${base}${path}`, { signal: AbortSignal.timeout(15000) });
  assert.equal(response.status, expectedStatus, `${path} returned ${response.status}`);
  return response;
}

const health = await (await check(':5000/api/healthz')).json();
assert.equal(health.status, 'ok');
const cors = await fetch(`${base}:5000/api/healthz`, { headers: { Origin: `${base}:3000` } });
assert.equal(cors.headers.get('access-control-allow-origin'), `${base}:3000`);
const rejected = await fetch(`${base}:5000/api/healthz`, { headers: { Origin: 'https://app.ucfilters.com' } });
assert.notEqual(rejected.headers.get('access-control-allow-origin'), 'https://app.ucfilters.com');
for (const port of [5055, 3000]) {
  const page = await check(`:${port}/`);
  assert.match(page.headers.get('content-type') ?? '', /text\/html/);
  assert.match(await page.text(), /<html/i);
}
await check(':3000/healthz');
for (const route of ['products', 'blog', 'support', 'map', 'account']) {
  const page = await check(`:3000/${route}`);
  assert.match(page.headers.get('content-type') ?? '', /text\/html/);
}
console.log('Preview API, CORS isolation, Project Hub, and Companion are reachable');