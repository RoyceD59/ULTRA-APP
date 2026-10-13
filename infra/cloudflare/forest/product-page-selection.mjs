import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SECURITY_CENTER_CANDIDATE, securityCenterArchive } from './security-center-selection.mjs';

const here = dirname(fileURLToPath(import.meta.url));
export const PRODUCT_PAGE_CANDIDATE = 'c49a560276fd7114eff73fdaa44e09f47c467265e260411bcdf944a1f32ad9ad';
export const PRODUCT_PAGE_PREDECESSOR = '34478f5c5d1d91f49575aa902f45e30e1f79e52325f9a4fc8dcf92fe5731caf8';
export const PRODUCT_PAGE_SCOPE = '78cb1881d0951614a723b87244f4af41998de2f34eaeea70c26731111cde8859';
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
