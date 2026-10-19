import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const require = createRequire(import.meta.url);
const { writeBuildInfo } = require('../build-info.js');
const configure = require('../../app.config.js');

test('standalone production config preserves disabled OTA and requires approved origin plus release identity', () => {
  const keys = ['EAS_BUILD_PROFILE', 'EXPO_PUBLIC_API_DOMAIN', 'EXPO_PUBLIC_COMPANION_BUILD_ID', 'EAS_BUILD_ID'];
  const before = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  try {
    process.env.EAS_BUILD_PROFILE = 'production';
    delete process.env.EXPO_PUBLIC_COMPANION_BUILD_ID;
    delete process.env.EAS_BUILD_ID;
    process.env.EXPO_PUBLIC_API_DOMAIN = 'localhost:8080';
    assert.throws(() => configure({ config: {} }), /approved API/);
    process.env.EXPO_PUBLIC_API_DOMAIN = 'api.ucfilters.com';
    assert.throws(() => configure({ config: {} }), /identifiable release/);
    process.env.EAS_BUILD_ID = 'approved-binary-fixture';
    const config = configure({ config: { updates: { enabled: false }, runtimeVersion: '1.0.0' } });
    assert.equal(config.extra.companionRelease, 'approved-binary-fixture');
    assert.equal(config.updates.enabled, false);
    assert.equal(config.runtimeVersion, '1.0.0');
  } finally {
    for (const key of keys) if (before[key] === undefined) delete process.env[key]; else process.env[key] = before[key];
  }
});

test('release metadata records the build revision and fails if a tab is missing', () => {
  const root = mkdtempSync(join(tmpdir(), 'uc-release-'));
  try {
    mkdirSync(join(root, 'app', '(tabs)'), { recursive: true });
    mkdirSync(join(root, 'static-build', 'test-build'), { recursive: true });
    for (const tab of ['index','products','support','map','account']) writeFileSync(join(root, 'app', '(tabs)', `${tab}.tsx`), '');
    assert.throws(() => writeBuildInfo(root, 'test-build', { SOURCE_REVISION: 'abc' }), /missing the blog tab/);
    writeFileSync(join(root, 'app', '(tabs)', 'blog.tsx'), '');
    const info = writeBuildInfo(root, 'test-build', { SOURCE_REVISION: 'abc' });
    assert.equal(info.revision, 'abc');
    assert.equal(info.tabs.length, 6);
    assert.equal(info.supported.web, 'test-build');
    assert.equal(info.supported.expoGo, 'test-build');
    mkdirSync(join(root, 'data'), { recursive: true });
    const structure = require('../../data/product-page-structure.json');
    writeFileSync(join(root, 'data/product-page-structure.json'), JSON.stringify(structure));
    const layered = writeBuildInfo(root, 'test-build', { SOURCE_REVISION: 'layered-test' });
    assert.deepEqual(layered.productPageStructure, structure);
    assert.equal(layered.productPageStructure.layers.length, 9);
    assert.equal(layered.productPageStructure.navigationGroups.length, 5);
    assert.equal(JSON.parse(readFileSync(join(root, 'static-build/test-build/build-info.json'), 'utf8'))
      .productPageStructure.referenceSha256, structure.referenceSha256);
    assert.throws(() => writeBuildInfo(root, 'test-build', { NODE_ENV: 'production' }), /Missing production API/);
    assert.throws(() => writeBuildInfo(root, 'test-build', { NODE_ENV: 'production', EXPO_PUBLIC_API_DOMAIN: 'http://localhost:8080' }), /Invalid production API/);
    assert.throws(() => writeBuildInfo(root, 'test-build', { NODE_ENV: 'production', EXPO_PUBLIC_API_DOMAIN: 'preview.replit.dev' }), /Invalid production API/);
    assert.deepEqual(JSON.parse(readFileSync(join(root, 'static-build', 'test-build', 'build-info.json'), 'utf8')), layered);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
