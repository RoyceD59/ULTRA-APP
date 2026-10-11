import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdir, mkdtemp, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { cp } from 'node:fs/promises';
import net from 'node:net';
import { resolve } from 'node:path';
import { APPROVED_CANDIDATE, PREDECESSOR, SOURCE_IDENTITY, archive, here, verifyHandoff, validateSnapshot, verifyLiveApi, retainRollback } from './consistency-handoff.mjs';

const now = Date.parse('2026-10-05T09:00:00Z');
const snapshot = {
  snapshotId: 'a'.repeat(64), adjustmentRevision: 1, maxAgeSeconds: 60,
  calculatedAt: new Date(now).toISOString(), lifespanAvailable: false,
  totalUsers: 5, litresFiltered: 1150, plasticsAvoided: 2300, cleanWaterDays: 0,
  override: { lastUpdatedBy: 'private-fixture-attribution' },
};
test('saved candidate is the exact approved source, with untouched predecessor and inactive production configuration', async () => {
  const info = await verifyHandoff();
  assert.equal(info.candidateSha256, APPROVED_CANDIDATE);
  assert.equal(info.baselineSha256, PREDECESSOR);
  assert.equal(info.unchangedFrozenFiles, 1221);
  assert.equal(info.securityChangedPaths.length, 10);
  const frozenManifest = JSON.parse(await readFile(resolve(here, 'release-manifest.json')));
  assert.equal(frozenManifest.sourceArchiveSha256, PREDECESSOR);
  const builder = await readFile(resolve(here, 'release-build.mjs'), 'utf8');
  assert.doesNotMatch(builder, /build-approved-consistency/);
});
test('saved source has no secrets, runtime records, compiled output or updates activation', () => {
  const paths = execFileSync('tar', ['-tzf', archive], { encoding: 'utf8' }).split('\n').filter(Boolean);
  for (const path of paths) {
    assert.ok(!path.startsWith('/') && !path.split('/').includes('..'), path);
    assert.doesNotMatch(path, /(^|\/)(node_modules|dist|static-build|\.env(?:\.|$)|\.whatsapp-session)(\/|$)/);
    assert.ok(!path.startsWith('artifacts/api-server/data/'), path);
  }
  const app = JSON.parse(execFileSync('tar', ['-xOf', archive, 'artifacts/uc-companion/app.json']));
  assert.equal(app.expo.updates.enabled, false);
});
test('old zero-filled API responses cannot authorize new client delivery', () => {
  assert.throws(() => validateSnapshot({ totalUsers: 5, litresFiltered: 1150, override: { litresOffset: 0 } }, now), /snapshot unavailable/);
});
test('missing, stale, future, invalid and fractional-revision snapshots are rejected', () => {
  for (const patch of [
    { snapshotId: '' }, { adjustmentRevision: 0 }, { adjustmentRevision: 1.5 },
    { maxAgeSeconds: 600 }, { calculatedAt: 'invalid' },
    { calculatedAt: new Date(now - 61_000).toISOString() },
    { calculatedAt: new Date(now + 61_000).toISOString() },
    { lifespanAvailable: undefined }, { litresFiltered: NaN }, { totalUsers: -1 },
  ]) assert.throws(() => validateSnapshot({ ...snapshot, ...patch }, now));
});
test('API gate compares both public hosts without credentials or private attribution', async () => {
  const calls = [];
  const result = await verifyLiveApi(async (url, options) => {
    calls.push({ url, options });
    return { ok: true, json: async () => ({ ...snapshot }) };
  }, now);
  assert.equal(calls.length, 2);
  assert.ok(calls.every(call => !call.options.headers.Authorization));
  assert.equal(result[0].snapshotId, snapshot.snapshotId);
  assert.ok(!JSON.stringify(result).includes('private-fixture-attribution'));
});
test('API failures and disagreement block client preparation', async () => {
  await assert.rejects(verifyLiveApi(async () => ({ ok: false, status: 503 }), now), /unavailable/);
  let index = 0;
  await assert.rejects(verifyLiveApi(async () => ({
    ok: true, json: async () => ({ ...snapshot, litresFiltered: index++ ? 1200 : 1150 }),
  }), now), /disagree/);
});
test('local verification cannot copy deployment outputs and staging never deletes retained builds', async () => {
  const builder = await readFile(resolve(here, 'build-approved-consistency.mjs'), 'utf8');
  assert.match(builder, /copyOutput && \(localOnly/);
  assert.match(builder, /Local-only verification output cannot be used as a published client/);
  assert.doesNotMatch(builder, /\brm\s*\(|rmSync|publishRepl|executeSql/);
  assert.match(builder, /typecheck:libs/);
  assert.match(builder, /requires --retain-static/);
});

test('rollback retention upgrades legacy manifests without advancing selection or deleting assets', async () => {
  const temporary = await mkdtemp(resolve(tmpdir(), 'consistency-retention-'));
  const source = resolve(temporary, 'old'), destination = resolve(temporary, 'new');
  const id = '1000-1';
  try {
    await mkdir(resolve(source, id), { recursive: true });
    await writeFile(resolve(source, id, 'build-info.json'), JSON.stringify({ buildId: id }));
    for (const platform of ['web', 'ios', 'android']) {
      await mkdir(resolve(source, id, '_expo/static/js', platform), { recursive: true });
      await writeFile(resolve(source, id, '_expo/static/js', platform, 'bundle.js'), platform);
      if (platform !== 'web') {
        await mkdir(resolve(source, platform), { recursive: true });
        await writeFile(resolve(source, platform, 'manifest.json'), JSON.stringify({
          launchAsset: { key: `bundle-${id}`, url: `https://app.ucfilters.com/uc-companion/${id}/_expo/static/js/${platform}/bundle.js` },
        }));
      }
    }
    await writeFile(resolve(source, 'active-build.json'), JSON.stringify({ buildId: id }));
    await mkdir(destination);
    await writeFile(resolve(destination, 'active-build.json'), JSON.stringify({ buildId: '2000-1' }));
    const retained = await retainRollback(source, destination, id);
    assert.equal(retained.retainedFiles, 6);
    assert.equal(JSON.parse(await readFile(resolve(destination, 'active-build.json'))).buildId, '2000-1');
    assert.equal(JSON.parse(await readFile(resolve(destination, id, 'ios/manifest.json'))).launchAsset.key, `bundle-${id}`);
    assert.equal(await readFile(resolve(destination, id, '_expo/static/js/web/bundle.js'), 'utf8'), 'web');
    await retainRollback(source, destination, id); // Idempotent.
    const webBundle = resolve(source, id, '_expo/static/js/web/bundle.js');
    await writeFile(webBundle, `const font="https://app.ucfilters.com/uc-companion/${id}/_expo/static/js/fonts/missing.ttf";`);
    await assert.rejects(retainRollback(source, destination, id), /ENOENT/);
    await writeFile(webBundle, 'web');
    await writeFile(resolve(destination, id, '_expo/static/js/web/bundle.js'), 'different');
    await assert.rejects(retainRollback(source, destination, id), /collision/);
    await assert.rejects(retainRollback(source, destination, '3000-1'));
  } finally { await rm(temporary, { recursive: true, force: true }); }
});

test('production serving works with all external fetches unavailable, while client builds remain gated', async () => {
  const fixture = await mkdtemp(resolve(tmpdir(), 'consistency-startup-'));
  const tools = resolve(fixture, 'infra/cloudflare/forest');
  const frozenStage = resolve(fixture, '.consistency-build', APPROVED_CANDIDATE);
  const serverDir = resolve(frozenStage, 'artifacts/uc-companion/server');
  let server;
  try {
    await mkdir(resolve(tools, 'approved-consistency'), { recursive: true });
    await mkdir(resolve(tools, 'security-consistency'), { recursive: true });
    await mkdir(resolve(tools, 'auth-upload-security'), { recursive: true });
    await mkdir(resolve(tools, 'security-dependency-review'), { recursive: true });
    await mkdir(serverDir, { recursive: true });
    await mkdir(resolve(tools, 'security-center-cache-review'));
    await symlink(resolve(here, '../../../node_modules'), resolve(fixture, 'node_modules'), 'dir');
    for (const name of ['build-approved-consistency.mjs', 'consistency-handoff.mjs', 'consistency-security.mjs', 'auth-upload-security.mjs', 'security-dependency-selection.mjs', 'security-center-selection.mjs', 'security-patch-installation.mjs', 'prepare-security-center-cache-review.py', 'prepare-security-center-review.py', 'prepare-security-dependency-review.py', 'verify-security-center-lock.mjs', 'release-manifest.json', 'release-sources.tar.gz']) {
      await cp(resolve(here, name), resolve(tools, name));
    }
    for (const name of ['candidate.json', 'release-sources.tar.gz']) {
      await cp(resolve(here, 'approved-consistency', name), resolve(tools, 'approved-consistency', name));
      await cp(resolve(here, 'security-consistency', name), resolve(tools, 'security-consistency', name));
    }
    for (const name of ['candidate.json', 'release-sources.tar.gz', 'scope.json', 'owner-approval.json']) {
      await cp(resolve(here, 'auth-upload-security', name), resolve(tools, 'auth-upload-security', name));
      await cp(resolve(here, 'security-dependency-review', name), resolve(tools, 'security-dependency-review', name));
      await cp(resolve(here, 'security-center-cache-review', name), resolve(tools, 'security-center-cache-review', name));
    }
    await writeFile(resolve(frozenStage, '.prepared'), APPROVED_CANDIDATE);
    await writeFile(resolve(frozenStage, 'companion-build.json'), JSON.stringify({
      sourceSha256: APPROVED_CANDIDATE, buildId: '1000-1', localOnly: false,
    }));
    // A sentinel child server isolates the wrapper's production-startup gates
    // from the separately verified real frozen static server.
    await writeFile(resolve(serverDir, 'serve.js'), `
      const http = require('node:http');
      http.createServer((req, res) => res.end('approved-static-fixture'))
        .listen(Number(process.env.PORT), '127.0.0.1', () => console.log('FIXTURE_READY'));
    `);
    const unavailable = resolve(fixture, 'unavailable.mjs');
    await writeFile(unavailable, `globalThis.fetch = async () => { throw new Error('NO_EXTERNAL_STARTUP_REQUESTS'); };`);
    const probe = net.createServer();
    await new Promise(done => probe.listen(0, '127.0.0.1', done));
    const port = probe.address().port;
    await new Promise(done => probe.close(done));
    server = spawn(process.execPath, ['--import', unavailable, resolve(tools, 'build-approved-consistency.mjs'), 'serve-companion'], {
      env: { ...process.env, PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'],
    });
    await new Promise((done, fail) => {
      let output = '';
      const timer = setTimeout(() => fail(new Error('Production wrapper failed to serve without APIs')), 10_000);
      const consume = chunk => {
        output += chunk;
        if (output.includes('FIXTURE_READY')) { clearTimeout(timer); done(); }
      };
      server.stdout.on('data', consume); server.stderr.on('data', consume);
      server.once('exit', code => { clearTimeout(timer); fail(new Error(`Server exited ${code}: ${output}`)); });
    });
    const response = await fetch(`http://127.0.0.1:${port}/`);
    assert.equal(response.status, 200);
    assert.equal(await response.text(), 'approved-static-fixture');
    const apiOutage = resolve(fixture, 'api-outage.mjs');
    await writeFile(apiOutage, `
      globalThis.fetch = async url => {
        if (String(url).endsWith('/version.json')) return { ok: true, json: async () => ({ revision: '${SOURCE_IDENTITY}' }) };
        throw new Error('API_OUTAGE_FIXTURE');
      };
    `);
    for (const args of [['hub'], ['companion', '--retain-static=fixture']]) {
      const result = spawnSync(process.execPath, ['--import', apiOutage, resolve(tools, 'build-approved-consistency.mjs'), ...args], {
        encoding: 'utf8', timeout: 10_000,
      });
      assert.equal(result.status, 1);
      assert.match(result.stderr, /API_OUTAGE_FIXTURE/);
    }
  } finally {
    if (server && server.exitCode === null) {
      server.kill('SIGTERM');
      await new Promise(done => server.once('exit', done));
    }
    await rm(fixture, { recursive: true, force: true });
  }
});
