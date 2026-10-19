import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../..');
const output = path.join(root, '.companion-consistency-release');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const baseline = fs.readFileSync(path.join(here, 'release-sources.tar.gz'));
const manifest = fs.readFileSync(path.join(here, 'release-manifest.json'));
before(() => execFileSync(process.execPath, [path.join(here, 'prepare-companion-consistency.mjs')], { cwd: root }));

test('source-only preparation preserves the approved release and every unrelated frozen byte', () => {
  assert.deepEqual(fs.readFileSync(path.join(here, 'release-sources.tar.gz')), baseline);
  assert.deepEqual(fs.readFileSync(path.join(here, 'release-manifest.json')), manifest);
  const info = JSON.parse(fs.readFileSync(path.join(output, 'candidate.json'), 'utf8'));
  assert.equal(info.baselineSha256, hash(baseline));
  assert.equal(info.candidateSha256, hash(fs.readFileSync(path.join(output, 'release-sources.tar.gz'))));
  assert.equal(info.status, 'prepared-source-only-not-built-not-active-not-published');
  const originalPaths = execFileSync('tar', ['-tzf', path.join(here, 'release-sources.tar.gz')], { encoding: 'utf8' })
    .split('\n').filter(p => p && !p.endsWith('/'));
  const changed = new Set(info.changedPaths);
  const frozen = fs.mkdtempSync(path.join(os.tmpdir(), 'consistency-frozen-'));
  try {
    execFileSync('tar', ['-xzf', path.join(here, 'release-sources.tar.gz'), '-C', frozen]);
    for (const p of originalPaths) {
      if (!changed.has(p)) assert.deepEqual(fs.readFileSync(path.join(output, 'source', p)), fs.readFileSync(path.join(frozen, p)), p);
    }
  } finally { fs.rmSync(frozen, { recursive: true, force: true }); }
  const app = JSON.parse(fs.readFileSync(path.join(output, 'source/artifacts/uc-companion/app.json'), 'utf8'));
  assert.equal(app.expo.updates.enabled, false);
  assert.match(app.expo.updates.url, /REPLACE_AFTER_EAS_PROJECT_INIT/);
  const layout = fs.readFileSync(path.join(output, 'source/artifacts/uc-companion/app/_layout.tsx'), 'utf8');
  assert.match(layout, /mutations: nativeRecoveryDefaults\(Platform\.OS\)\.mutations/);
  assert.match(layout, /\.\.\.nativeRecoveryDefaults\(Platform\.OS\)\.queries/);
});

test('prepared frozen server pairs browser/version and both native manifests at one selection boundary', async () => {
  const candidateApp = path.join(output, 'source/artifacts/uc-companion');
  const require = createRequire(import.meta.url);
  const { activateStaticBuild, stagePlatformManifest } = require(path.join(candidateApp, 'scripts/active-static-build.cjs'));
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'consistency-delivery-'));
  let server;
  try {
    for (const id of ['1000-1', '2000-1']) {
      const build = path.join(fixture, 'static-build', id);
      for (const platform of ['web', 'ios', 'android']) {
        const file = path.join(build, '_expo/static/js', platform, 'bundle.js');
        fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, `/* ${id} */`);
        if (platform !== 'web') stagePlatformManifest(fixture, id, platform,
          { launchAsset: { key: `bundle-${id}`, url: `https://fixture.invalid/${id}/bundle.js` } });
      }
      fs.writeFileSync(path.join(build, 'build-info.json'), JSON.stringify({
        buildId: id, production: true, apiOrigin: 'https://api.ucfilters.com',
        supported: { web: id, expoGo: id, native: [] },
      }));
    }
    activateStaticBuild(fixture, '1000-1');
    const probe = net.createServer();
    await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve));
    const assignedPort = probe.address().port;
    await new Promise(resolve => probe.close(resolve));
    server = spawn(process.execPath, [path.join(candidateApp, 'server/serve.js')], {
      env: { ...process.env, PORT: String(assignedPort), BASE_PATH: '', STATIC_ROOT: path.join(fixture, 'static-build') },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const port = await new Promise((resolve, reject) => {
      let output = '';
      const timer = setTimeout(() => reject(new Error(`Prepared fixture server did not start: ${output}`)), 10_000);
      const consume = chunk => {
        output += chunk;
        const match = output.match(/on port (\d+)/);
        if (match) { clearTimeout(timer); resolve(Number(match[1])); }
      };
      server.stdout.on('data', consume); server.stderr.on('data', consume);
      server.on('exit', () => { clearTimeout(timer); reject(new Error(output)); });
    });
    const origin = `http://127.0.0.1:${port}`;
    const check = async id => {
      const version = await fetch(`${origin}/version.json`);
      assert.equal(version.headers.get('cache-control'), 'no-store');
      assert.equal((await version.json()).buildId, id);
      assert.match(await (await fetch(origin)).text(), new RegExp(`${id}/_expo/static/js/web/bundle.js`));
      for (const platform of ['ios', 'android']) {
        const manifest = await (await fetch(`${origin}/manifest`, { headers: { 'expo-platform': platform } })).json();
        assert.equal(manifest.launchAsset.key, `bundle-${id}`);
      }
    };
    await check('1000-1'); // Newer retained files are not activation.
    activateStaticBuild(fixture, '2000-1'); await check('2000-1');
    activateStaticBuild(fixture, '1000-1'); await check('1000-1');
  } finally {
    if (server && server.exitCode === null) { server.kill(); await new Promise(resolve => server.once('exit', resolve)); }
    fs.rmSync(fixture, { recursive: true, force: true });
  }
});
