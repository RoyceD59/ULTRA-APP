import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const require = createRequire(import.meta.url);
const { writeBuildInfo } = require('../build-info.js');

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
    assert.deepEqual(JSON.parse(readFileSync(join(root, 'static-build', 'test-build', 'build-info.json'), 'utf8')), info);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
