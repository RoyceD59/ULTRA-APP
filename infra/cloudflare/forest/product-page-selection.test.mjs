import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { PRODUCT_PAGE_CANDIDATE, verifyProductPageSelection, verifyProductPageStage } from './product-page-selection.mjs';
import { APPROVED_CANDIDATE, SOURCE_IDENTITY, archive, stage, verifyHandoff } from './consistency-handoff.mjs';

test('coordinated builder selects exact approved product source and preserves security ancestry', async () => {
  assert.equal(APPROVED_CANDIDATE, PRODUCT_PAGE_CANDIDATE);
  assert.equal(SOURCE_IDENTITY, 'consistency-' + PRODUCT_PAGE_CANDIDATE);
  assert.ok(archive.endsWith('product-page-review/release-sources.tar.gz'));
  const source = await verifyHandoff();
  assert.equal(source.selectionApproved, true);
  assert.equal(source.candidateSha256, PRODUCT_PAGE_CANDIDATE);
  assert.equal(source.sourceFiles, 1310);
});

test('prepared review stage must match every archived source byte and mode', () => {
  const result = verifyProductPageStage(stage);
  assert.equal(result.stageVerified, true);
  assert.equal(result.changedFiles, 68);
});

test('unmarked partial or modified stages cannot be adopted', async () => {
  const directory = await mkdtemp(resolve(tmpdir(), 'product-stage-negative-'));
  try {
    assert.throws(() => verifyProductPageStage(directory));
    execFileSync('tar', ['-xzf', archive, '-C', directory]);
    assert.equal(verifyProductPageStage(directory).stageVerified, true);
    await writeFile(resolve(directory, 'artifacts/api-server/src/unapproved.js'), 'process.exit(0);\n');
    assert.throws(() => verifyProductPageStage(directory));
    await rm(resolve(directory, 'artifacts/api-server/src/unapproved.js'));
    await writeFile(resolve(directory, 'package.json'), '{}\n');
    assert.throws(() => verifyProductPageStage(directory));
    await assert.rejects(readFile(resolve(directory, '.prepared')));
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('stage adoption remains local-only and every published client must retain rollback assets', async () => {
  const builder = await readFile(new URL('./build-approved-consistency.mjs', import.meta.url), 'utf8');
  assert.ok(builder.includes('adoptStage && !localOnly'));
  assert.ok(builder.includes('verifyProductPageStage(stage)'));
  assert.ok(builder.indexOf('verifyProductPageStage(stage)') < builder.indexOf('await writeFile(marker'));
  assert.ok(builder.includes('!localOnly && !retainedStatic'));
  assert.ok(builder.includes('Local-only verification output cannot be used as a published client'));
  const selected = await verifyProductPageSelection();
  assert.equal(selected.publicationRequested, true);
});
