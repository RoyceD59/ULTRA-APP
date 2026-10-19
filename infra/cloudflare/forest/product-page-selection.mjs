import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SECURITY_CENTER_CANDIDATE, securityCenterArchive } from './security-center-selection.mjs';

const here = dirname(fileURLToPath(import.meta.url));
export const PRODUCT_PAGE_CANDIDATE = 'ee734d2d0e4d0fbb890900b694809b552e409e21a57e0fb8b53d3732dda75c7f';
export const PRODUCT_PAGE_BROWSER_PREDECESSOR = '41d38f627258152d7cc7132b275f7c495e44e1ca1503391a165efed316e5212a';
export const PRODUCT_PAGE_PREDECESSOR = '59f5a2386f58ede1500d56de7129b8e40b6a667e536a50c72927654f4552fa7c';
export const PRODUCT_PAGE_SCOPE = 'a131754065ed3f533e2807ca48b1133201c71afb4269f2827568dbc7c530a159';
export const productPageArchive = resolve(here, 'product-browser-restock-review/release-sources.tar.gz');
const digest = bytes => createHash('sha256').update(bytes).digest('hex');

export async function verifyProductPageSelection() {
  const review = resolve(here, 'product-browser-restock-review');
  const meta = JSON.parse(await readFile(resolve(review, 'candidate.json'), 'utf8'));
  const approval = JSON.parse(await readFile(resolve(review, 'owner-approval.json'), 'utf8'));
  const scope = JSON.parse(await readFile(resolve(review, 'scope.json'), 'utf8'));
  assert.equal(meta.parentSha256, SECURITY_CENTER_CANDIDATE);
  assert.equal(meta.candidateSha256, PRODUCT_PAGE_CANDIDATE);
  assert.equal(meta.scopeSha256, PRODUCT_PAGE_SCOPE);
  assert.equal(meta.previousCandidateSha256, PRODUCT_PAGE_PREDECESSOR);
  assert.equal(meta.browserRestockPredecessorSha256, PRODUCT_PAGE_BROWSER_PREDECESSOR);
  assert.equal(digest(await readFile(resolve(here, 'product-page-review/published-predecessor-sources.tar.gz'))), PRODUCT_PAGE_PREDECESSOR);
  assert.equal(digest(await readFile(productPageArchive)), PRODUCT_PAGE_CANDIDATE);
  assert.equal(digest(JSON.stringify(scope)), PRODUCT_PAGE_SCOPE);
  assert.equal(approval.candidateSha256, PRODUCT_PAGE_CANDIDATE);
  assert.equal(approval.scopeSha256, PRODUCT_PAGE_SCOPE);
  assert.equal(approval.selectionApproved, true);
  assert.equal(approval.browserRestockDesignApproved, true);
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
    resolve(here, 'product-browser-restock-review/scope.json'), stage,
  ], { encoding: 'utf8', maxBuffer: 1024 * 1024 }));
}
