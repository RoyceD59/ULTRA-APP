import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';

const root = process.cwd();
const serverOnly = process.argv.includes('--server-only');
const review = resolve(root, 'infra/cloudflare/forest/product-page-review');
const candidate = JSON.parse(await readFile(resolve(review, 'candidate.json'), 'utf8'));
assert.equal(createHash('sha256').update(await readFile(resolve(review, 'release-sources.tar.gz')))
  .digest('hex'), candidate.candidateSha256);
const stage = resolve(root, '.consistency-build', candidate.candidateSha256);
const companion = resolve(stage, 'artifacts/uc-companion');
const require = createRequire(resolve(companion, 'package.json'));
const { readActiveBuild } = require('./scripts/active-static-build.cjs');
const staticRoot = resolve(companion, 'static-build');
const buildId = readActiveBuild(staticRoot);
assert.ok(buildId);
const info = JSON.parse(await readFile(resolve(staticRoot, buildId, 'build-info.json'), 'utf8'));
if (!serverOnly) assert.equal(info.revision, 'consistency-' + candidate.candidateSha256);
assert.equal(info.apiOrigin, 'https://api.ucfilters.com');
for (const platform of ['ios', 'android', 'web']) {
  assert.ok((await stat(resolve(staticRoot, buildId, '_expo/static/js', platform, 'bundle.js'))).size > 1000000);
  if (platform !== 'web') {
    const manifest = JSON.parse(await readFile(resolve(staticRoot, buildId, platform, 'manifest.json'), 'utf8'));
    assert.ok(manifest.launchAsset.url.includes(`/${buildId}/_expo/static/js/${platform}/bundle.js`));
  }
}
await stat(resolve(stage, 'artifacts/api-server/dist/product-records/records/retail-prices_v7.json'));
const apiDomain = process.env.REPLIT_DEV_DOMAIN;
assert.ok(apiDomain, 'Read-only development API origin required for public HTML checks');
const reservation = createServer();
reservation.listen(0, '127.0.0.1');
await once(reservation, 'listening');
const port = reservation.address().port;
await new Promise(done => reservation.close(done));
// A temporary local server reads real development product records. No fixtures
// or placeholder product data are presented as publication evidence.
const child = spawn(process.execPath, ['server/serve.js'], {
  cwd: companion, stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env, PORT: String(port), BASE_PATH: '/uc-companion/',
    PUBLIC_WEB_API_ORIGIN: `https://${apiDomain}`, PUBLIC_WEB_RENDERING_ENABLED: 'true' },
});
let output = '';
let errors = '';
child.stderr.on('data', b => { errors += b.toString(); });
const ready = new Promise((done, reject) => {
  const timer = setTimeout(() => reject(new Error('Local product server did not start')), 15000);
  child.stdout.on('data', b => {
    output += b.toString();
    const match = output.match(/(?:port|localhost:)\s*(\d+)/i);
    if (match && match[1] !== '0') { clearTimeout(timer); done(Number(match[1])); }
  });
  child.once('exit', () => { clearTimeout(timer); reject(new Error('Local server exited: ' + errors)); });
});
try {
  await ready;
  for (const slug of ['sweet-home', 'viva-drop', 'gym-buddy']) {
    const response = await fetch(`http://127.0.0.1:${port}/uc-companion/product/${slug}`, { signal: AbortSignal.timeout(20000) });
    assert.equal(response.status, 200);
    const html = await response.text();
    assert.ok(html.includes('application/ld+json'));
    assert.ok(html.includes('/api/storage/objects/') || html.includes('/api/objects/'));
    console.log('Public HTML verified:', slug);
  }
  const native = await fetch(`http://127.0.0.1:${port}/uc-companion/`, { headers: { 'expo-platform': 'ios' } });
  assert.equal(native.status, 200);
  assert.ok((await native.json()).launchAsset.url.includes('/' + buildId + '/'));
  console.log(JSON.stringify({ candidateSha256: candidate.candidateSha256, buildId,
    exports: serverOnly ? 'not-revalidated' : ['web', 'android', 'ios'],
    publicHtml: 'passed', published: false }));
} catch (error) {
  throw new Error('Packaged public-server check failed: ' + errors, { cause: error });
} finally {
  child.kill('SIGTERM');
  if (child.exitCode === null) await once(child, 'exit');
}
