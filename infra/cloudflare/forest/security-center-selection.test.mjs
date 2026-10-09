import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { validateSecurityCenterApproval, verifyMainSecurityCenterRuntimePins } from './security-center-selection.mjs';
const approval = JSON.parse(await readFile(new URL('./security-center-cache-review/owner-approval.json', import.meta.url)));
test('exact-source selection approval does not approve publication or clients', () => {
  validateSecurityCenterApproval(approval);
});
for (const [name, patch] of [
  ['wrong package', { candidateSha256: '0'.repeat(64) }],
  ['wrong scope', { scopeSha256: '0'.repeat(64) }],
  ['missing selection', { selectionApproved: false }],
  ['missing mitigation acceptance', { testedBackportMitigationsAccepted: false }],
  ['publication escalation', { publicationApproved: true }],
  ['client escalation', { clientAdvancementApproved: true }],
  ['extra unreviewed risk exception', { acceptedAdvisoryIds: [...approval.acceptedAdvisoryIds, 'unreviewed'] }],
]) {
  test(`rejects ${name}`, () => assert.throws(() => validateSecurityCenterApproval({ ...approval, ...patch })));
}
test('actual main consumers and manifest match all selected security pins', async () => {
  assert.deepEqual(await verifyMainSecurityCenterRuntimePins(), {
    sharp: '0.35.5', librsvg: '2.63.2', 'shell-quote': '1.11.0', 'music-metadata': '11.16.0',
    'fast-copy': '4.1.0', 'postcss-selector-parser': '7.1.6', 'http-cache-semantics': '4.3.0',
  });
});
