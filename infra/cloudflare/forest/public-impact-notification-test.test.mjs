import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { receiptTest, TEST_ID } from './public-impact-notification-test.mjs';

const env = {
  GITHUB_ACTIONS: 'true', GITHUB_REPOSITORY: 'RoyceD59/ULTRA-APP',
  GITHUB_WORKFLOW: 'Public impact isolated notification test',
  GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_REF: 'refs/heads/main',
  GITHUB_RUN_ATTEMPT: '1',
  GITHUB_WORKFLOW_REF: 'RoyceD59/ULTRA-APP/.github/workflows/public-impact-notification-test.yml@refs/heads/main',
  RECEIPT_TEST_CONFIRMATION: 'SEND TEST TO ISSUE 12', RECEIPT_TEST_TOKEN: 'PRIVATE_TOKEN',
};
const now = Date.parse('2026-10-26T01:40:00Z');
const issue = () => ({ number: 12, title: 'Public impact monitor — isolated notification receipt test',
  state: 'open', body: 'Isolated test issue. PRIVATE_BODY' });
const accepted = () => ({ user: { login: 'github-actions[bot]', email: 'PRIVATE_EMAIL' },
  html_url: 'https://github.com/RoyceD59/ULTRA-APP/issues/12#issuecomment-123',
  created_at: '2026-10-26T01:40:01Z' });
const json = value => new Response(JSON.stringify(value), {
  headers: { 'Content-Type': 'application/json' },
});
function harness({ target = issue(), failAt, badClaim = false, comment = accepted() } = {}) {
  const calls = [];
  let saved = target;
  const request = async (url, options) => {
    calls.push({ url, options });
    if (options.method === failAt) throw new Error('PRIVATE_PROVIDER_ERROR');
    if (options.method === 'GET') return json(saved);
    if (options.method === 'PATCH') {
      saved = { ...saved, body: JSON.parse(options.body).body };
      return json(badClaim ? target : saved);
    }
    return json(comment);
  };
  return { calls, request };
}
const run = options => receiptTest({ send: true, env, clock: () => now, ...options });

test('preview performs no requests even when send credentials are present', async () => {
  const result = await receiptTest({ env, clock: () => now,
    request: () => { throw new Error('must_not_call'); } });
  assert.equal(result.delivery, 'suppressed');
  assert.match(result.preview, /TEST ONLY — NOT A PRODUCTION INCIDENT/);
  assert.match(result.preview, new RegExp(TEST_ID));
});

for (const field of Object.keys(env).filter(field => field !== 'RECEIPT_TEST_TOKEN')) {
  test(`missing or wrong ${field} fails closed before any network request`, async () => {
    const h = harness();
    const result = await run({ request: h.request, env: { ...env, [field]: 'wrong' } });
    assert.equal(result.delivery, 'approval_or_workflow_invalid');
    assert.equal(h.calls.length, 0);
    const missing = { ...env }; delete missing[field];
    assert.equal((await run({ env: missing, request: h.request })).delivery,
      'approval_or_workflow_invalid');
    assert.equal(h.calls.length, 0);
  });
}

test('missing token fails closed', async () => {
  const h = harness();
  assert.equal((await run({ env: { ...env, RECEIPT_TEST_TOKEN: '' }, request: h.request })).delivery,
    'approval_or_workflow_invalid');
  assert.equal(h.calls.length, 0);
});

for (const patch of [{ number: 11 }, { title: 'other' }, { state: 'closed' },
  { pull_request: {} }, { body: null }, { body: 'x'.repeat(16_385) }]) {
  test(`rejects invalid isolated target ${JSON.stringify(Object.keys(patch))}`, async () => {
    const h = harness({ target: { ...issue(), ...patch } });
    assert.equal((await run(h)).delivery, 'isolated_target_invalid');
    assert.equal(h.calls.length, 1);
  });
}

test('one claim precedes one bot comment; only the isolated GitHub endpoints are called', async () => {
  const h = harness();
  const result = await run(h);
  assert.equal(result.delivery, 'github_accepted');
  assert.equal(result.receipt, 'unverified');
  assert.equal(result.sender, 'github-actions[bot]');
  assert.deepEqual(h.calls.map(c => c.options.method), ['GET', 'PATCH', 'POST']);
  for (const { url, options } of h.calls) {
    assert.match(url, /^https:\/\/api.github.com\/repos\/RoyceD59\/ULTRA-APP\/issues\/12(?:\/comments)?$/);
    assert.equal(options.redirect, 'error');
    assert.ok(options.signal instanceof AbortSignal);
  }
  assert.match(JSON.parse(h.calls[1].options.body).body, /isolated-impact-receipt-test-v1-claimed/);
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE_/);
  assert.equal((await run(h)).delivery, 'already_claimed_no_resend');
  assert.deepEqual(h.calls.map(c => c.options.method), ['GET', 'PATCH', 'POST', 'GET']);
});

for (const [failAt, expected] of [['GET', 'issue_unavailable'],
  ['PATCH', 'claim_uncertain_no_send'], ['POST', 'uncertain_no_resend']]) {
  test(`${failAt} failure is sanitized and never retried`, async () => {
    const h = harness({ failAt });
    const result = await run(h);
    assert.equal(result.delivery, expected);
    assert.equal(h.calls.filter(c => c.options.method === failAt).length, 1);
    assert.doesNotMatch(JSON.stringify(result), /PRIVATE_/);
    if (failAt === 'POST') {
      assert.equal((await run(h)).delivery, 'already_claimed_no_resend');
      assert.equal(h.calls.filter(c => c.options.method === 'POST').length, 1);
    }
  });
}

test('unverified claim response prevents sending', async () => {
  const h = harness({ badClaim: true });
  assert.equal((await run(h)).delivery, 'claim_uncertain_no_send');
  assert.equal(h.calls.length, 2);
});

for (const patch of [{ user: { login: 'owner' } },
  { html_url: 'https://example.com/private' }, { created_at: 'invalid' }]) {
  test('unexpected comment response remains uncertain without replay', async () => {
    const h = harness({ comment: { ...accepted(), ...patch } });
    assert.equal((await run(h)).delivery, 'uncertain_no_resend');
    assert.equal((await run(h)).delivery, 'already_claimed_no_resend');
    assert.equal(h.calls.filter(c => c.options.method === 'POST').length, 1);
  });
}

test('invalid or oversized provider bodies fail closed and do not leak content', async () => {
  for (const response of [new Response('PRIVATE_ERROR', { status: 403 }),
    json({ body: 'PRIVATE_'.repeat(10_000) }), json(null),
    new Response('PRIVATE_BODY', { headers: { 'Content-Type': 'text/html' } })]) {
    const result = await run({ request: async () => response });
    assert.notEqual(result.delivery, 'github_accepted');
    assert.doesNotMatch(JSON.stringify(result), /PRIVATE_/);
  }
});

test('workflow is manual-only, default preview, serialized, and uses no application secrets', async () => {
  const yaml = await readFile(new URL('../../../.github/workflows/public-impact-notification-test.yml', import.meta.url), 'utf8');
  assert.match(yaml, /workflow_dispatch:/);
  assert.doesNotMatch(yaml, /schedule:|cron:|secrets\.|PUBLIC_IMPACT_MONITOR_ENABLED/);
  assert.match(yaml, /type: boolean\n        default: true/);
  assert.match(yaml, /group: public-impact-isolated-notification-test\n  cancel-in-progress: false/);
  assert.match(yaml, /RECEIPT_TEST_TOKEN: \$\{\{ github.token \}\}/);
  assert.match(yaml, /issues: write/);
  assert.match(yaml, /retention-days: 14/);
});
