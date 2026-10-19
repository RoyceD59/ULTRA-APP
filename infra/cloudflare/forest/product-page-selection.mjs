import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SECURITY_CENTER_CANDIDATE, securityCenterArchive } from './security-center-selection.mjs';

const here = dirname(fileURLToPath(import.meta.url));
export const PRODUCT_PAGE_CANDIDATE = '41d38f627258152d7cc7132b275f7c495e44e1ca1503391a165efed316e5212a';
export const PRODUCT_PAGE_PREDECESSOR = '59f5a2386f58ede1500d56de7129b8e40b6a667e536a50c72927654f4552fa7c';
export const PRODUCT_PAGE_SCOPE = '72a9a9868009394b4a94eef015e4018ff8b3ed365c24c1855774b3a49b29a54c';
export const productPageArchive = resolve(here, 'product-page-review/release-sources.tar.gz');
const digest = bytes => createHash('sha256').update(bytes).digest('hex');

export async function verifyProductPageSelection() {
  const review = resolve(here, 'product-page-review');
  const meta = JSON.parse(await readFile(resolve(review, 'candidate.json'), 'utf8'));
  const approval = JSON.parse(await readFile(resolve(review, 'owner-approval.json'), 'utf8'));
  const scope = JSON.parse(await readFile(resolve(review, 'scope.json'), 'utf8'));
  assert.equal(meta.parentSha256, SECURITY_CENTER_CANDIDATE);
  assert.equal(meta.candidateSha256, PRODUCT_PAGE_CANDIDATE);
  assert.equal(meta.scopeSha256, PRODUCT_PAGE_SCOPE);
  assert.equal(meta.previousCandidateSha256, PRODUCT_PAGE_PREDECESSOR);
  assert.equal(digest(await readFile(resolve(review, 'published-predecessor-sources.tar.gz'))), PRODUCT_PAGE_PREDECESSOR);
  assert.equal(digest(await readFile(productPageArchive)), PRODUCT_PAGE_CANDIDATE);
  assert.equal(digest(JSON.stringify(scope)), PRODUCT_PAGE_SCOPE);
  assert.equal(approval.candidateSha256, PRODUCT_PAGE_CANDIDATE);
  assert.equal(approval.scopeSha256, PRODUCT_PAGE_SCOPE);
  assert.equal(approval.selectionApproved, true);
  assert.equal(approval.requiredCatalogueCartPrerequisitesApproved, true);
  assert.equal(approval.publicationRequested, true);
  assert.deepEqual(approval.approvedPhotoCodes, ['FCT', 'VDR', 'GMB']);
  assert.equal(approval.productionStockInitializationApproved, false);
  const verified = JSON.parse(execFileSync('python3', [
    resolve(here, 'verify-product-page-source.py'),
    productPageArchive,
    securityCenterArchive,
    resolve(review, 'scope.json'),
  ], { encoding: 'utf8', maxBuffer: 1024 * 1024 }));
  assert.equal(verified.sourceFiles, meta.sourceFiles);
  assert.equal(verified.unchangedParentFiles, meta.unchangedParentFiles);
  return { ...meta, selectionApproved: true, publicationRequested: true };
}

export function verifyProductPageStage(stage) {
  return JSON.parse(execFileSync('python3', [
    resolve(here, 'verify-product-page-source.py'), productPageArchive,
    securityCenterArchive,
    resolve(here, 'product-page-review/scope.json'), stage,
  ], { encoding: 'utf8', maxBuffer: 1024 * 1024 }));
}
