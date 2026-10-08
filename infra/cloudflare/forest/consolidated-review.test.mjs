import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { APPROVED_CANDIDATE, verifyHandoff } from './consistency-handoff.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../../..');
const folder = resolve(here, 'consolidated-review');
const digest = bytes => createHash('sha256').update(bytes).digest('hex');

test('review archive pins every changed byte and preserves exact consistency/security core', async () => {
  const meta = JSON.parse(await readFile(resolve(folder, 'candidate.json')));
  const scopeBytes = await readFile(resolve(folder, 'scope.json'));
  const scope = JSON.parse(scopeBytes);
  assert.ok(!scope.files.some(file => file.path === 'artifacts/api-server/src/lib/global-impact-store.ts'),
    'ordinary tar read-permission normalization is not an application-byte change');
  assert.equal(digest(scopeBytes), meta.scopeSha256);
  assert.equal(digest(await readFile(resolve(folder, 'release-sources.tar.gz'))), meta.candidateSha256);
  const temporary = await mkdtemp(resolve(tmpdir(), 'consolidated-scope-'));
  try {
    for (const [archive, name] of [[resolve(here, 'auth-upload-security/release-sources.tar.gz'), 'before'], [resolve(folder, 'release-sources.tar.gz'), 'after']]) {
      await mkdir(resolve(temporary, name));
      execFileSync('tar', ['-xzf', archive, '-C', resolve(temporary, name)]);
    }
    for (const file of scope.files) {
      for (const [name, expected] of [['before', file.beforeSha256], ['after', file.afterSha256]]) {
        const bytes = await readFile(resolve(temporary, name, file.path)).catch(error => {
          if (error.code === 'ENOENT') return null; throw error;
        });
        assert.equal(bytes ? digest(bytes) : null, expected, file.path);
      }
    }
    for (const path of scope.protectedExactParentPaths) {
      assert.deepEqual(await readFile(resolve(temporary, 'before', path)), await readFile(resolve(temporary, 'after', path)));
    }
  } finally { await rm(temporary, { recursive: true, force: true }); }
});

test('consolidated review covers merged feature/security modules without activating publication', async () => {
  const meta = JSON.parse(await readFile(resolve(folder, 'candidate.json')));
  assert.equal(meta.selectionApproved, false);
  assert.equal(meta.publicationApproved, false);
  assert.equal(meta.schemaApplied, false);
  assert.equal(meta.clientAdvancement, false);
  const paths = execFileSync('tar', ['-tzf', resolve(folder, 'release-sources.tar.gz')], { encoding: 'utf8' }).trim().split('\n');
  for (const path of [
    'artifacts/api-server/src/lib/ai-feedback-receipt.ts',
    'artifacts/api-server/src/lib/guest-pay.ts',
    'artifacts/api-server/src/lib/checkout-orders.ts',
    'artifacts/uc-companion/components/MyFiltersSection.tsx',
    'artifacts/uc-companion/components/OrderReceiptCard.tsx',
    'artifacts/uc-companion/server/public-rendering.cjs',
    'artifacts/uc-companion/server/guest-pay-page.cjs',
  ]) assert.ok(paths.includes(path), path);
  assert.ok(paths.every(path => !/\/(?:node_modules|dist|static-build|\.whatsapp-session)\//.test(path)
    && !path.startsWith('artifacts/api-server/data/') && !/(?:^|\/)\.env/.test(path)
    && !path.startsWith('artifacts/mockup-sandbox/') && !path.startsWith('.agents/')));
  assert.equal(APPROVED_CANDIDATE, meta.parentSha256);
  assert.equal((await verifyHandoff()).candidateSha256, meta.parentSha256);
});
