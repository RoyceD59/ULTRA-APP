import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const here = dirname(fileURLToPath(import.meta.url));

test('isolated release is pinned, contains source only, and preserves already published features', async () => {
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
    assert.ok(!path.includes('forest-preview-fixture'));
  }
  assert.ok(paths.includes('artifacts/uc-companion/components/ImpactTreeSection.tsx'));
  assert.ok(paths.includes('artifacts/api-server/src/lib/hydrate-tree-schema.ts'));
  assert.ok(paths.includes('lib/db/migrations/0057_uc_hydrate_trees.sql'));
  // Already shipped changes must not disappear in a narrow Hydrate release.
  assert.ok(paths.includes('lib/db/migrations/0056_review_analysis.sql'));
  assert.ok(paths.includes('artifacts/api-server/src/routes/customer-reviews.ts'));
  assert.ok(paths.includes('artifacts/projecthub/src/pages/admin/customer-reviews.tsx'));
  const migration = execFileSync('tar', ['-xOzf', archive, 'lib/db/migrations/0057_uc_hydrate_trees.sql'], { encoding: 'utf8' });
  assert.equal(migration.trim(), (await readFile('lib/db/migrations/0057_uc_hydrate_trees.sql', 'utf8')).trim());
});

test('frozen release preserves typed API errors and background-free preview startup', () => {
  const archive = resolve(here, 'release-sources.tar.gz');
  const source = path => execFileSync('tar', ['-xOzf', archive, path], { encoding: 'utf8' });
  const client = source('artifacts/uc-companion/hooks/useApi.ts');
  assert.ok(client.includes("import { ApiError } from './apiError'"));
  assert.ok(client.includes("import { handleRejectedSessionResponse } from './deletedAccountResponse'"));
  assert.ok(client.includes('export { ApiError }'));
  const startup = source('artifacts/api-server/src/index.ts');
  const preview = startup.match(/if \(process\.env\["PREVIEW_SAFE_MODE"\] === "1"\) \{([\s\S]*?)\n    \}/)?.[1];
  assert.ok(preview);
  assert.ok(preview.includes('app.listen') && preview.includes('return;'));
  assert.doesNotMatch(preview, /startScheduler|startReviewAnalysisWorker|processPendingReferralSettlements|setInterval|setTimeout/);
});

test('the approved UI refresh preserves every unrelated archived source file', async () => {
  const manifest = JSON.parse(await readFile(resolve(here, 'release-manifest.json'), 'utf8'));
  if (!manifest.uiSourceBaseRevision) return;
  const before = execFileSync('git', ['show', `${manifest.uiSourceBaseRevision}:infra/cloudflare/forest/release-sources.tar.gz`], { maxBuffer: 40 * 1024 * 1024 });
  assert.equal(createHash('sha256').update(before).digest('hex'), manifest.previousSourceArchiveSha256);
  const work = await mkdtemp(resolve(tmpdir(), 'hydrate-ui-package-test-'));
  const approved = new Set([
    'artifacts/api-server/src/routes/uc-impact.ts',
    'artifacts/uc-companion/app/(tabs)/account.tsx',
    'artifacts/uc-companion/app/(tabs)/index.tsx',
    'artifacts/uc-companion/app/_layout.tsx',
    'artifacts/uc-companion/app/about.tsx',
    'artifacts/uc-companion/components/ImpactBubble.tsx',
    'artifacts/uc-companion/components/ImpactTreeSection.tsx',
    'artifacts/uc-companion/components/PersonalImpactSection.tsx',
    'artifacts/uc-companion/components/ForestLink.tsx',
    'artifacts/uc-companion/hooks/useGlobalImpact.ts',
    'artifacts/uc-companion/lib/impactTree.ts',
    'artifacts/uc-companion/lib/queryFreshness.ts',
    'artifacts/uc-companion/lib/sessionPersistence.ts',
    'artifacts/uc-companion/lib/__tests__/impactTree.test.mts',
    'artifacts/uc-companion/lib/__tests__/queryFreshness.test.mts',
    'artifacts/uc-companion/lib/__tests__/sessionPersistence.test.mts',
  ]);
  try {
    const old = resolve(work, 'before.tar.gz');
    await writeFile(old, before);
    const current = resolve(here, 'release-sources.tar.gz');
    const oldDir = resolve(work, 'old');
    const newDir = resolve(work, 'new');
    await Promise.all([mkdir(oldDir), mkdir(newDir)]);
    execFileSync('tar', ['-xzf', old, '-C', oldDir]);
    execFileSync('tar', ['-xzf', current, '-C', newDir]);
    const list = archive => [...new Set(execFileSync('tar', ['-tzf', archive], { encoding: 'utf8' })
      .split('\n').filter(path => path && !path.endsWith('/')))];
    const oldPaths = list(old);
    const newPaths = new Set(list(current));
    for (const path of oldPaths) {
      assert.ok(newPaths.has(path), `Must retain ${path}`);
      if (!approved.has(path)) {
        assert.ok((await readFile(resolve(oldDir, path))).equals(
          await readFile(resolve(newDir, path))), `Unexpected archive change: ${path}`);
      }
    }
    for (const path of newPaths) assert.ok(oldPaths.includes(path) || approved.has(path), `Unapproved new module: ${path}`);
    const source = path => execFileSync('tar', ['-xOzf', current, path], { encoding: 'utf8' });
    assert.ok(source('artifacts/uc-companion/components/ImpactBubble.tsx').includes('<ForestLink light'));
    assert.ok(source('artifacts/uc-companion/app/about.tsx').includes('<ImpactBubble'));
    assert.ok(source('artifacts/uc-companion/components/PersonalImpactSection.tsx').includes('useState(true)'));
    assert.ok(source('artifacts/uc-companion/components/ImpactTreeSection.tsx').includes('impact-tree-public-forest'));
    assert.ok(source('artifacts/uc-companion/lib/sessionPersistence.ts').includes("typeof profile.phone === 'string'"));
  } finally { await rm(work, { recursive: true, force: true }); }
});