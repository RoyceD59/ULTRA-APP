import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const here = dirname(fileURLToPath(import.meta.url));
const whatsappRecoveryPaths = [
  'artifacts/api-server/src/lib/whatsapp-operations.ts',
  'artifacts/api-server/src/lib/whatsapp.ts',
  'artifacts/api-server/src/routes/whatsapp.ts',
  'artifacts/api-server/src/tests/whatsapp-operations.test.ts',
  'artifacts/projecthub/src/components/whatsapp-qr-card.test.tsx',
  'artifacts/projecthub/src/components/whatsapp-qr-card.tsx',
  'artifacts/projecthub/src/lib/whatsapp-request.test.ts',
  'artifacts/projecthub/src/lib/whatsapp-request.ts',
];
const dependencySecurityPaths = [
  'package.json',
  'pnpm-lock.yaml',
  'artifacts/api-server/package.json',
  'patches/braces@3.0.3.patch',
  'patches/http-cache-semantics@4.2.0.patch',
  'patches/node-forge@1.4.0.patch',
  'patches/README.md',
  'scripts/tests/dependency-security.test.mjs',
];

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
    ...dependencySecurityPaths,
    ...whatsappRecoveryPaths,
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

test('dependency security refresh changes only approved packaging sources', async () => {
  const manifest = JSON.parse(await readFile(resolve(here, 'release-manifest.json'), 'utf8'));
  assert.deepEqual(manifest.dependencySecurityPaths, dependencySecurityPaths);
  const before = execFileSync('git', ['show',
    `${manifest.dependencySecuritySourceBaseRevision}:infra/cloudflare/forest/release-sources.tar.gz`],
  { maxBuffer: 40 * 1024 * 1024 });
  assert.equal(createHash('sha256').update(before).digest('hex'), manifest.dependencySecuritySourceArchiveSha256);
  const work = await mkdtemp(resolve(tmpdir(), 'dependency-security-package-test-'));
  try {
    const oldArchive = resolve(work, 'before.tar.gz');
    await writeFile(oldArchive, before);
    const archive = resolve(here, 'release-sources.tar.gz');
    const list = path => execFileSync('tar', ['-tzf', path], { encoding: 'utf8' })
      .split('\n').filter(path => path && !path.endsWith('/'));
    const oldPaths = list(oldArchive);
    const newPaths = new Set(list(archive));
    const allowed = new Set([...dependencySecurityPaths, ...whatsappRecoveryPaths]);
    const oldDir = resolve(work, 'old');
    const newDir = resolve(work, 'new');
    await Promise.all([mkdir(oldDir), mkdir(newDir)]);
    execFileSync('tar', ['-xzf', oldArchive, '-C', oldDir]);
    execFileSync('tar', ['-xzf', archive, '-C', newDir]);
    for (const path of oldPaths) {
      assert.ok(newPaths.has(path), `Security refresh must retain ${path}`);
      if (!allowed.has(path)) {
        assert.ok((await readFile(resolve(oldDir, path))).equals(
          await readFile(resolve(newDir, path))), `Unrelated security refresh change: ${path}`);
      }
    }
    for (const path of newPaths) {
      assert.ok(oldPaths.includes(path) || allowed.has(path), `Unexpected new security module: ${path}`);
    }
    for (const path of dependencySecurityPaths) {
      assert.ok(newPaths.has(path), `Missing release security source: ${path}`);
    }
    for (const path of dependencySecurityPaths.filter(path => path.startsWith('patches/') || path.startsWith('scripts/'))) {
      assert.ok((await readFile(resolve(newDir, path))).equals(await readFile(path)), `Release patch/test differs: ${path}`);
    }
    const packed = JSON.parse(await readFile(resolve(newDir, 'package.json'), 'utf8'));
    const original = JSON.parse(await readFile(resolve(oldDir, 'package.json'), 'utf8'));
    assert.equal(packed.scripts['test:dependency-security'], 'node --test scripts/tests/dependency-security.test.mjs');
    const overrides = { ...packed.pnpm.overrides };
    for (const key of ['brace-expansion@>=5.0.7 <6', 'ip-address@>=10 <11', 'markdown-it@>=14 <15', 'undici@>=8 <9']) delete overrides[key];
    overrides['brace-expansion@>=5.0.7'] = original.pnpm.overrides['brace-expansion@>=5.0.7'];
    overrides['fast-uri'] = original.pnpm.overrides['fast-uri'];
    const restored = structuredClone(packed);
    restored.pnpm.overrides = overrides;
    delete restored.pnpm.patchedDependencies;
    delete restored.scripts['test:dependency-security'];
    assert.deepEqual(restored, original, 'No unrelated root manifest changes');
    assert.deepEqual(packed.pnpm.patchedDependencies, {
      'braces@3.0.3': 'patches/braces@3.0.3.patch',
      'http-cache-semantics@4.2.0': 'patches/http-cache-semantics@4.2.0.patch',
      'node-forge@1.4.0': 'patches/node-forge@1.4.0.patch',
    });
    const api = JSON.parse(await readFile(resolve(newDir, 'artifacts/api-server/package.json'), 'utf8'));
    const oldApi = JSON.parse(await readFile(resolve(oldDir, 'artifacts/api-server/package.json'), 'utf8'));
    assert.equal(api.dependencies.nodemailer, '^10.0.9');
    api.dependencies.nodemailer = oldApi.dependencies.nodemailer;
    assert.deepEqual(api, oldApi, 'No unrelated API manifest changes');
    const lock = await readFile(resolve(newDir, 'pnpm-lock.yaml'), 'utf8');
    for (const version of ['brace-expansion@5.0.12:', 'fast-uri@4.2.1:', 'ip-address@10.7.3:', 'markdown-it@14.3.2:', 'nodemailer@10.0.13:', 'undici@8.11.2:']) {
      assert.ok(lock.includes(version), `Missing fixed release dependency: ${version}`);
    }
    for (const version of ['brace-expansion@5.0.9:', 'fast-uri@4.1.4:', 'ip-address@10.5.0:', 'markdown-it@14.3.0:', 'nodemailer@9.1.1:', 'undici@8.10.0:']) {
      assert.ok(!lock.includes(`\n  ${version}`), `Vulnerable release dependency retained: ${version}`);
    }
    assert.match(lock, /braces@3\.0\.3\(patch_hash=/);
    assert.match(lock, /http-cache-semantics@4\.2\.0\(patch_hash=/);
    assert.match(lock, /node-forge@1\.4\.0\(patch_hash=/);
  } finally { await rm(work, { recursive: true, force: true }); }
});

test('published package includes the approved WhatsApp recovery UI and cleanup implementation', async () => {
  const manifest = JSON.parse(await readFile(resolve(here, 'release-manifest.json'), 'utf8'));
  assert.match(manifest.whatsappRecoveryRevision, /^[a-f0-9]{40}$/);
  const archive = resolve(here, 'release-sources.tar.gz');
  for (const path of whatsappRecoveryPaths) {
    const packed = execFileSync('tar', ['-xOzf', archive, path]);
    const approved = execFileSync('git', ['show', `${manifest.whatsappRecoveryRevision}:${path}`]);
    assert.ok(packed.equals(approved), `${path} must match the approved recovery change`);
  }
});

test('WhatsApp packaging preserves every newer non-recovery release source', async () => {
  const manifest = JSON.parse(await readFile(resolve(here, 'release-manifest.json'), 'utf8'));
  const before = execFileSync('git', ['show',
    `${manifest.whatsappRecoverySourceBaseRevision}:infra/cloudflare/forest/release-sources.tar.gz`],
  { maxBuffer: 40 * 1024 * 1024 });
  assert.equal(createHash('sha256').update(before).digest('hex'), manifest.whatsappRecoverySourceArchiveSha256);
  const work = await mkdtemp(resolve(tmpdir(), 'whatsapp-package-test-'));
  try {
    const old = resolve(work, 'before.tar.gz');
    await writeFile(old, before);
    const current = resolve(here, 'release-sources.tar.gz');
    const oldDir = resolve(work, 'old');
    const newDir = resolve(work, 'new');
    await Promise.all([mkdir(oldDir), mkdir(newDir)]);
    execFileSync('tar', ['-xzf', old, '-C', oldDir]);
    execFileSync('tar', ['-xzf', current, '-C', newDir]);
    const list = archive => new Set(execFileSync('tar', ['-tzf', archive], { encoding: 'utf8' })
      .split('\n').filter(path => path && !path.endsWith('/')));
    const oldPaths = list(old);
    const newPaths = list(current);
    const allowed = new Set(whatsappRecoveryPaths);
    for (const path of oldPaths) {
      assert.ok(newPaths.has(path), `Recovery release must retain ${path}`);
      if (!allowed.has(path)) {
        assert.ok((await readFile(resolve(oldDir, path))).equals(
          await readFile(resolve(newDir, path))), `Unrelated recovery release change: ${path}`);
      }
    }
    for (const path of newPaths) {
      assert.ok(oldPaths.has(path) || allowed.has(path), `Unexpected recovery source: ${path}`);
    }
  } finally { await rm(work, { recursive: true, force: true }); }
});