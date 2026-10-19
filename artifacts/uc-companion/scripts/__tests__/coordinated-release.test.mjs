import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
const { stagePlatformManifest, activateStaticBuild, readActiveBuild } = createRequire(import.meta.url)('../active-static-build.cjs');

test('production activation rejects mismatched support/API metadata and keeps the previous release selected', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'coordinated-release-'));
  try {
    const buildId = '1000-1';
    const build = path.join(root, 'static-build', buildId);
    const infoFile = path.join(build, 'build-info.json');
    for (const platform of ['web', 'ios', 'android']) {
      const bundle = path.join(build, '_expo/static/js', platform, 'bundle.js');
      fs.mkdirSync(path.dirname(bundle), { recursive: true });
      fs.writeFileSync(bundle, 'fixture');
      if (platform !== 'web') stagePlatformManifest(root, buildId, platform, { launchAsset: { key: `bundle-${buildId}` } });
    }
    const info = { buildId, production: true, apiOrigin: 'https://api.ucfilters.com',
      supported: { web: buildId, expoGo: buildId, native: [] } };
    fs.writeFileSync(infoFile, JSON.stringify(info));
    activateStaticBuild(root, buildId);
    assert.equal(readActiveBuild(path.join(root, 'static-build')), buildId);
    fs.writeFileSync(infoFile, JSON.stringify({ ...info, supported: { ...info.supported, expoGo: 'wrong' } }));
    assert.throws(() => activateStaticBuild(root, buildId), /do not match/);
    assert.throws(() => readActiveBuild(path.join(root, 'static-build')), /do not match/);
    fs.writeFileSync(infoFile, JSON.stringify({ ...info, apiOrigin: 'https://another-api.example' }));
    assert.throws(() => activateStaticBuild(root, buildId), /unapproved API/);
    fs.writeFileSync(infoFile, JSON.stringify(info));
    assert.equal(readActiveBuild(path.join(root, 'static-build')), buildId);
    fs.mkdirSync(path.join(root, 'static-build', '2000-1'), { recursive: true });
    fs.writeFileSync(path.join(root, 'static-build', '2000-1/build-info.json'),
      JSON.stringify({ ...info, buildId: '2000-1' }));
    assert.throws(() => activateStaticBuild(root, '2000-1'), /do not match|Incomplete/);
    assert.equal(readActiveBuild(path.join(root, 'static-build')), buildId);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
