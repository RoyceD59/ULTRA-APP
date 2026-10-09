import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifySecurityDependencySelection, verifyMainSecurityRuntimePins } from './security-dependency-selection.mjs';

export const SECURITY_CENTER_CANDIDATE = 'd7ee99bdc3df01868cab10da1aa61bcde14f9737c659d306f09ddbf597dfc921';
export const SECURITY_CENTER_SCOPE = 'f2f190773180b02ec45fde79addbb39a48c9cdd5f583071b026892d20ef5b320';
const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../../..');
const review = resolve(here, 'security-center-cache-review');
export const securityCenterArchive = resolve(review, 'release-sources.tar.gz');
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
export function validateSecurityCenterApproval(approval) {
  assert.equal(approval.candidateSha256, SECURITY_CENTER_CANDIDATE, 'Wrong approved package');
  assert.equal(approval.scopeSha256, SECURITY_CENTER_SCOPE, 'Wrong approved scope');
  assert.equal(approval.selectionApproved, true, 'Selection not approved');
  assert.equal(approval.testedBackportMitigationsAccepted, true, 'Backports not accepted');
  assert.equal(approval.publicationApproved, false, 'Publication remains separate');
  assert.equal(approval.clientAdvancementApproved, false, 'Clients must not advance');
  assert.deepEqual(approval.acceptedAdvisoryIds, ['GHSA-vfj7-8cjw-p6xm', 'GHSA-86w9-cpqp-85rv']);
}
export async function verifySecurityCenterSelection() {
  const parent = await verifySecurityDependencySelection();
  const approval = JSON.parse(await readFile(resolve(review, 'owner-approval.json')));
  validateSecurityCenterApproval(approval);
  assert.equal(digest(await readFile(securityCenterArchive)), SECURITY_CENTER_CANDIDATE);
  assert.equal(digest(await readFile(resolve(review, 'scope.json'))), SECURITY_CENTER_SCOPE);
  // Reuse the safe exact-byte/mode/scope reader and strict complete lock graph
  // verifier; immutable preparation metadata is deliberately not rewritten.
  const meta = JSON.parse(execFileSync('python3', [
    resolve(here, 'prepare-security-center-cache-review.py'), '--verify',
  ], { encoding: 'utf8', env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' } }));
  assert.equal(meta.parentSha256, parent.candidateSha256);
  assert.equal(meta.candidateSha256, SECURITY_CENTER_CANDIDATE);
  assert.equal(meta.scopeSha256, SECURITY_CENTER_SCOPE);
  assert.equal(meta.unchangedParentFiles, 1262);
  assert.deepEqual(meta.changedPaths, ['package.json', 'pnpm-lock.yaml']);
  return { ...parent, ...meta, selectionApproved: true, publicationApproved: false };
}
export async function verifyMainSecurityCenterRuntimePins() {
  const original = await verifyMainSecurityRuntimePins();
  const api = createRequire(resolve(root, 'artifacts/api-server/package.json'));
  const hub = createRequire(resolve(root, 'artifacts/projecthub/package.json'));
  const companion = createRequire(resolve(root, 'artifacts/uc-companion/package.json'));
  const pretty = createRequire(api.resolve('pino-pretty'));
  const typography = createRequire(hub.resolve('@tailwindcss/typography'));
  const ngrok = createRequire(companion.resolve('@expo/ngrok'));
  const got = createRequire(ngrok.resolve('got'));
  const cache = createRequire(got.resolve('cacheable-request'));
  assert.match(pretty.resolve('fast-copy'), /fast-copy@4\.1\.0/);
  assert.match(typography.resolve('postcss-selector-parser'), /postcss-selector-parser@7\.1\.6/);
  const entry = cache.resolve('http-cache-semantics');
  assert.match(entry, /http-cache-semantics@4\.3\.0.*patch_hash/);
  assert.match(await readFile(entry, 'utf8'), /max-stale must not revive/);
  const main = JSON.parse(await readFile(resolve(root, 'package.json')));
  const pins = { 'fast-copy': '4.1.0', 'postcss-selector-parser': '7.1.6', 'http-cache-semantics': '4.3.0' };
  for (const [name, value] of Object.entries(pins)) assert.equal(main.pnpm.overrides[name], value);
  assert.equal(main.pnpm.patchedDependencies['http-cache-semantics@4.3.0'], 'patches/http-cache-semantics@4.2.0.patch');
  assert.equal(main.pnpm.patchedDependencies['http-cache-semantics@4.2.0'], undefined);
  return { ...original, ...pins };
}
