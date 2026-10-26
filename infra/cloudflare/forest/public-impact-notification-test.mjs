/** Isolated one-shot receipt test. Never imports or runs the production checker. */
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { boundedJson } from './public-impact-monitor.mjs';

const REPOSITORY = 'RoyceD59/ULTRA-APP';
const TITLE = 'Public impact monitor — isolated notification receipt test';
const BASE = `https://api.github.com/repos/${REPOSITORY}/issues/12`;
const CLAIM = '<!-- isolated-impact-receipt-test-v1-claimed -->';
export const TEST_ID = 'IMPACT-BOT-RECEIPT-TEST-v1';
const WORKFLOW = 'Public impact isolated notification test';

export function testComment(at) {
  return `TEST ONLY — NOT A PRODUCTION INCIDENT

Test identifier: ${TEST_ID}
UTC test time: ${at}

This single, separately approved notification comes from the GitHub Actions bot.
No production probes, outage, database writes, monitor activation or live
incident-state changes were performed. No real warning or recovery is asserted.

Please confirm this identifier and receipt channel in the Replit conversation:
email, GitHub inbox or mobile notification. Do not share private addresses,
headers or customer information. GitHub acceptance is not proof of receipt.
No automatic resend will occur.`;
}

export async function receiptTest({ send = false, env = {}, request = fetch, clock = Date.now } = {}) {
  const observedAt = new Date(clock()).toISOString();
  const report = { observedAt, testId: TEST_ID, targetIssue: 12,
    mode: send ? 'send' : 'preview', delivery: 'suppressed', receipt: 'unverified' };
  if (!send) return { ...report, preview: testComment(observedAt) };
  if (env.GITHUB_ACTIONS !== 'true' || env.GITHUB_REPOSITORY !== REPOSITORY
      || env.GITHUB_WORKFLOW !== WORKFLOW || env.GITHUB_EVENT_NAME !== 'workflow_dispatch'
      || env.GITHUB_REF !== 'refs/heads/main' || env.GITHUB_RUN_ATTEMPT !== '1'
      || env.GITHUB_WORKFLOW_REF !== `${REPOSITORY}/.github/workflows/public-impact-notification-test.yml@refs/heads/main`
      || env.RECEIPT_TEST_CONFIRMATION !== 'SEND TEST TO ISSUE 12'
      || !env.RECEIPT_TEST_TOKEN) {
    return { ...report, delivery: 'approval_or_workflow_invalid' };
  }
  async function api(method, suffix = '', body) {
    const response = await request(`${BASE}${suffix}`, {
      method, redirect: 'error', signal: AbortSignal.timeout(15_000),
      headers: { Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${env.RECEIPT_TEST_TOKEN}`,
        'X-GitHub-Api-Version': '2022-11-28', 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error('receipt_test_provider_unavailable');
    }
    return boundedJson(response, 65_536);
  }
  let issue;
  try { issue = await api('GET'); }
  catch { return { ...report, delivery: 'issue_unavailable' }; }
  if (!issue || issue.number !== 12 || issue.title !== TITLE || issue.state !== 'open'
      || issue.pull_request || typeof issue.body !== 'string'
      || Buffer.byteLength(issue.body) > 16_384) {
    return { ...report, delivery: 'isolated_target_invalid' };
  }
  // A claim is never cleared, even if sending fails. No recovery/replay by rerun.
  if (issue.body.includes(CLAIM)) return { ...report, delivery: 'already_claimed_no_resend' };
  const claimedBody = `${issue.body}\n\n${CLAIM}\nTest identifier: ${TEST_ID}\nClaim UTC: ${observedAt}`;
  try {
    const saved = await api('PATCH', '', { body: claimedBody });
    if (saved.number !== 12 || saved.body !== claimedBody) throw new Error('claim_unverified');
  } catch { return { ...report, delivery: 'claim_uncertain_no_send' }; }
  try {
    const comment = await api('POST', '/comments', { body: testComment(observedAt) });
    if (comment.user?.login !== 'github-actions[bot]'
        || !/^https:\/\/github\.com\/RoyceD59\/ULTRA-APP\/issues\/12#issuecomment-\d+$/.test(comment.html_url || '')
        || !Number.isFinite(Date.parse(comment.created_at))) {
      throw new Error('comment_acceptance_unverified');
    }
    return { ...report, delivery: 'github_accepted', commentUrl: comment.html_url,
      acceptedAt: new Date(comment.created_at).toISOString(), sender: 'github-actions[bot]' };
  } catch { return { ...report, delivery: 'uncertain_no_resend' }; }
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length !== 1 || !['--preview', '--send'].includes(args[0])) {
    throw new Error('receipt_test_arguments_invalid');
  }
  const report = await receiptTest({ send: args[0] === '--send', env: process.env });
  const output = resolve('generated-artifacts/public-impact-notification-test/evidence.json');
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  console.log(JSON.stringify(report));
  if (!['suppressed', 'github_accepted', 'already_claimed_no_resend'].includes(report.delivery)) {
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(() => {
    console.error(JSON.stringify({ category: 'isolated_receipt_test_unavailable' }));
    process.exitCode = 1;
  });
}
