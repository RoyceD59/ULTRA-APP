import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const here = dirname(fileURLToPath(import.meta.url));

test('isolated release is pinned, contains source only, and excludes unrelated newer features', async () => {
  const manifest = JSON.parse(await readFile(resolve(here, 'release-manifest.json'), 'utf8'));
  const archive = resolve(here, 'release-sources.tar.gz');
  const digest = createHash('sha256').update(await readFile(archive)).digest('hex');
  assert.equal(digest, manifest.sourceArchiveSha256);
  assert.equal(manifest.forestUrl, 'https://uc-hydrate-forest.pages.dev/');
  assert.equal(manifest.customDomainApproved, false);
  const paths = execFileSync('tar', ['-tzf', archive], { encoding: 'utf8' }).split('\n').filter(Boolean);
  for (const path of paths) {
    assert.ok(!path.startsWith('/') && !path.split('/').includes('..'));
    assert.ok(!/(^|\/)(node_modules|\.env(?:\.|$)|\.whatsapp-session|static-build|dist)(\/|$)/.test(path), path);
    assert.ok(!path.includes('forest-preview-fixture') && !path.includes('refill-governance') && !path.includes('alison-knowledge'));
  }
  assert.ok(paths.includes('artifacts/uc-companion/components/ImpactTreeSection.tsx'));
  assert.ok(paths.includes('artifacts/api-server/src/lib/hydrate-tree-schema.ts'));
  assert.ok(paths.includes('lib/db/migrations/0056_uc_hydrate_trees.sql'));
});