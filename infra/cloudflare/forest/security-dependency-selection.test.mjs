import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp, mkdir, cp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { verifyHandoff, APPROVED_CANDIDATE, here } from './consistency-handoff.mjs';
import { SECURITY_DEPENDENCY_CANDIDATE, verifyMainSecurityRuntimePins } from './security-dependency-selection.mjs';
import { SECURITY_CENTER_CANDIDATE } from './security-center-selection.mjs';

test('main selects the exact security revision without publication approval', async () => {
  const info = await verifyHandoff();
  assert.equal(APPROVED_CANDIDATE, SECURITY_CENTER_CANDIDATE);
  assert.equal(info.candidateSha256, SECURITY_CENTER_CANDIDATE);
  assert.equal(info.selectionApproved, true);
  assert.equal(info.publicationApproved, false);
  assert.equal(info.unchangedParentFiles, 1262);
});

test('actual main external dependencies match the approved security pins', async () => {
  assert.deepEqual(await verifyMainSecurityRuntimePins(), {
    sharp: '0.35.5', librsvg: '2.63.2', 'shell-quote': '1.11.0', 'music-metadata': '11.16.0',
  });
});

for (const [name, patch] of [
  ['missing selection approval', { selectionApproved: false }],
  ['unapproved publication', { publicationApproved: true }],
  ['unapproved client advancement', { clientAdvancementApproved: true }],
  ['missing backport mitigation acceptance', { testedBackportMitigationsAccepted: false }],
  ['different candidate approval', { candidateSha256: '0'.repeat(64) }],
]) {
  test(`selection rejects ${name}`, async () => {
    const temporary = await mkdtemp(resolve(tmpdir(), 'security-selection-negative-'));
    try {
      const review = resolve(temporary, 'security-dependency-review');
      await mkdir(review);
      for (const file of ['release-sources.tar.gz', 'scope.json', 'candidate.json', 'owner-approval.json']) {
        await cp(resolve(here, 'security-dependency-review', file), resolve(review, file));
      }
      const approvalPath = resolve(review, 'owner-approval.json');
      const approval = JSON.parse(await readFile(approvalPath));
      await writeFile(approvalPath, JSON.stringify({ ...approval, ...patch }));
      const source = (await readFile(resolve(here, 'security-dependency-selection.mjs'), 'utf8'))
        .replace("'./auth-upload-security.mjs'", JSON.stringify(pathToFileURL(resolve(here, 'auth-upload-security.mjs')).href));
      const modulePath = resolve(temporary, 'selection.mjs');
      await writeFile(modulePath, source);
      const verifier = await import(pathToFileURL(modulePath));
      await assert.rejects(verifier.verifySecurityDependencySelection(), /owner approval mismatch/);
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  });
}
