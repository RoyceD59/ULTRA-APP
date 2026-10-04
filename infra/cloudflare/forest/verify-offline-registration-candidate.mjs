/**
 * Verify the prepared candidate's actual native launch responses and bundle
 * bytes through its own static server. Not a phone/Expo Go interaction test.
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import net from 'node:net';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const candidate = resolve(root, '.offline-filter-release');
const app = resolve(candidate, 'source/artifacts/uc-companion');
const provenance = JSON.parse(await readFile(resolve(candidate, 'candidate.json'), 'utf8'));
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
assert.equal(digest(await readFile(resolve(candidate, 'release-sources.tar.gz'))), provenance.candidateSha256);
const probe = net.createServer();
await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve));
const port = probe.address().port;
await new Promise(resolve => probe.close(resolve));
const server = spawn(process.execPath, ['server/serve.js'], { cwd: app,
  env: { ...process.env, PORT: String(port), BASE_PATH: '/' }, stdio: ['ignore', 'pipe', 'pipe'] });
const origin = `http://127.0.0.1:${port}`;
try {
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Candidate server did not start')), 10000);
    server.once('error', reject);
    server.stdout.on('data', () => { clearTimeout(timer); resolve(); });
    server.once('exit', code => { clearTimeout(timer); reject(new Error(`Candidate server exited: ${code}`)); });
  });
  const evidence = [];
  for (const platform of ['ios', 'android']) {
    const response = await fetch(`${origin}/manifest`, { headers: { 'expo-platform': platform } });
    assert.equal(response.status, 200);
    const manifest = await response.json();
    assert.ok(manifest.launchAsset?.url);
    const path = new URL(manifest.launchAsset.url).pathname;
    const bundleResponse = await fetch(origin + path);
    assert.equal(bundleResponse.status, 200, `Selected ${platform} launch asset must be served`);
    const body = Buffer.from(await bundleResponse.arrayBuffer());
    assert.equal(digest(body), digest(await readFile(resolve(app, 'static-build', path.replace(/^\/+/, '')))));
    for (const marker of ['water-tests:', 'personal-impact:', '/api/uc/purchases/offline',
      'Register Offline Filter', 'offline-installation-date', 'Restore existing registration']) {
      assert.ok(body.includes(marker), `${platform} selected launch asset is missing ${marker}`);
    }
    evidence.push({ platform, manifestId: manifest.id, launchPath: path, bytes: body.length, sha256: digest(body) });
  }
  const web = await fetch(origin);
  assert.equal(web.status, 200);
  const html = await web.text();
  const scripts = [...html.matchAll(/<script[^>]+src="([^"]+)"/g)].map(match => match[1]);
  assert.ok(scripts.length, 'Candidate landing must select a built web entry');
  for (const script of scripts) assert.equal((await fetch(new URL(script, origin))).status, 200);
  const dirs = (await readdir(resolve(app, 'static-build'))).filter(p => /^\d/.test(p));
  assert.equal(dirs.length, 1, 'This candidate has exactly one prepared build; no active release is changed');
  console.log(JSON.stringify({ status: 'verified-not-active-not-published', candidate: provenance.candidateSha256, evidence, webScripts: scripts }, null, 2));
} finally {
  server.kill('SIGTERM');
}