import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { API_ORIGINS, validateSnapshot } from './consistency-handoff.mjs';
import { POLICY, SIGNALS, emptyState, validateState, boundedJson,
  collectEvidence, advanceState, observations } from './public-impact-monitor.mjs';
import { ISSUE_TITLE, issueBody, parseIssueBody, githubStore, persistTransition,
  initialIssueBody } from './public-impact-monitor-github.mjs';
import { runMonitor } from './run-public-impact-monitor.mjs';

const now = Date.parse('2026-10-10T12:00:00.000Z');
const at = index => new Date(now + index * POLICY.intervalMs).toISOString();
const snapshot = (patch = {}) => ({ snapshotId: 'a'.repeat(64), adjustmentRevision: 1,
  maxAgeSeconds: 60, calculatedAt: at(0), lifespanAvailable: false,
  totalUsers: 6, litresFiltered: 1550, plasticsAvoided: 3100, cleanWaterDays: 0,
  override: { lastUpdatedBy: 'PRIVATE_ATTRIBUTION' }, ...patch });
const json = (value, status = 200) => new Response(JSON.stringify(value), {
  status, headers: { 'Content-Type': 'application/json' },
});
const checks = (patch = {}) => ({ ...Object.fromEntries(SIGNALS.map(key => [key, 'healthy'])), ...patch });
const requestFor = (impact = () => snapshot()) => async url =>
  json(url.endsWith('healthz') ? { status: 'ok', private: 'PRIVATE_HEALTH' } : impact(url));
async function evidenceFor(patch) {
  return collectEvidence({ request: requestFor(() => snapshot(patch)), clock: () => now });
}
function repeat(code, count, previous = emptyState(), start = 0) {
  let result;
  for (let index = start; index < start + count; index++) {
    result = advanceState(previous, checks({ 'impact:0': code }), at(index));
    previous = result.state;
  }
  return result;
}

test('probes only fixed unauthenticated GET paths with bounded time and no redirects', async () => {
  const calls = [];
  const evidence = await collectEvidence({ clock: () => now, request: async (url, options) => {
    calls.push([url, options]); return requestFor()(url);
  } });
  assert.equal(calls.length, 4);
  for (const [url, options] of calls) {
    assert.ok(API_ORIGINS.some(origin => url === `${origin}/api/healthz` || url === `${origin}/api/uc/impact`));
    assert.equal(options.method, 'GET');
    assert.equal(options.redirect, 'error');
    assert.equal(options.cache, 'no-store');
    assert.ok(options.signal instanceof AbortSignal);
    assert.equal(options.headers.Authorization, undefined);
  }
  assert.equal(evidence.agreement, 'healthy');
  assert.equal(evidence.sourceIdentity, 'unverified');
  assert.doesNotMatch(JSON.stringify(evidence), /PRIVATE_|override|Authorization/);
  assert.equal(validateSnapshot(snapshot(), now).snapshotId, evidence.hosts[0].impact.snapshot.snapshotId);
});

for (const [name, patch, code] of [
  ['old fallback', { snapshotId: undefined, adjustmentRevision: undefined }, 'incompatible'],
  ['stale', { calculatedAt: new Date(now - 60_001).toISOString() }, 'stale'],
  ['future', { calculatedAt: new Date(now + 60_001).toISOString() }, 'future_clock'],
  ['bad clock', { calculatedAt: 'PRIVATE_MALFORMED' }, 'incompatible'],
  ['bad revision', { adjustmentRevision: 1.5 }, 'incompatible'],
  ['bad lifespan', { lifespanAvailable: null }, 'incompatible'],
  ['negative totals', { litresFiltered: -1 }, 'incompatible'],
  ['missing totals', { cleanWaterDays: undefined }, 'incompatible'],
  ['wrong max age', { maxAgeSeconds: 300 }, 'incompatible'],
  ['coercible snapshot ID', { snapshotId: ['a'.repeat(64)] }, 'incompatible'],
]) {
  test(`classifies ${name} without retaining its body`, async () => {
    const evidence = await evidenceFor(patch);
    assert.equal(evidence.hosts[0].impact.code, code);
    assert.equal(evidence.hosts[0].health.code, 'healthy');
    assert.equal(evidence.agreement, 'unverified');
    assert.equal(evidence.hosts[0].impact.snapshot, undefined);
    assert.doesNotMatch(JSON.stringify(evidence), /PRIVATE_/);
  });
}

test('exact freshness boundaries and different calculation times remain compatible', async () => {
  const evidence = await collectEvidence({ clock: () => now, request: requestFor(url => snapshot({
    calculatedAt: new Date(now + (url.startsWith(API_ORIGINS[0]) ? -60_000 : 60_000)).toISOString(),
  })) });
  assert.equal(evidence.agreement, 'healthy');
});

test('a snapshot aging while another probe runs is stale, not a mismatch', async () => {
  let ticks = 0;
  const evidence = await collectEvidence({
    request: requestFor(), clock: () => ++ticks <= 9 ? now : now + 60_001,
  });
  assert.equal(evidence.agreement, 'unverified');
  assert.ok(evidence.hosts.some(host => host.impact.code === 'stale'));
});

for (const field of ['snapshotId', 'adjustmentRevision', 'lifespanAvailable',
  'totalUsers', 'litresFiltered', 'plasticsAvoided', 'cleanWaterDays']) {
  test(`agreement gate compares ${field}`, async () => {
    const changed = { snapshotId: 'b'.repeat(64), adjustmentRevision: 2, lifespanAvailable: true,
      totalUsers: 7, litresFiltered: 1600, plasticsAvoided: 3200, cleanWaterDays: 1 };
    const evidence = await collectEvidence({ clock: () => now, request: requestFor(url =>
      snapshot(url.startsWith(API_ORIGINS[1]) ? { [field]: changed[field] } : {})) });
    assert.equal(evidence.agreement, 'disagree');
  });
}

test('HTTP errors, invalid JSON/HTML, and unavailable probes are distinct', async () => {
  for (const [request, code] of [
    [async () => json({ private: 'PRIVATE_HTTP' }, 503), 'http_error'],
    [async () => new Response('<html>PRIVATE_HTML</html>'), 'invalid_response'],
    [async () => new Response('{ PRIVATE_JSON', { headers: { 'Content-Type': 'application/json' } }), 'invalid_response'],
    [async () => { throw new Error('PRIVATE_SECRET_NETWORK_ERROR'); }, 'probe_unavailable'],
  ]) {
    const evidence = await collectEvidence({ request, clock: () => now });
    assert.equal(evidence.hosts[0].impact.code, code);
    assert.equal(evidence.agreement, 'unverified');
    assert.doesNotMatch(JSON.stringify(evidence), /PRIVATE_|downtime/);
  }
});

test('oversized JSON is rejected and the body stream is cancelled', async () => {
  let cancelled = false;
  const response = new Response(new ReadableStream({
    start(controller) { controller.enqueue(new Uint8Array(POLICY.maximumBodyBytes + 1)); },
    cancel() { cancelled = true; },
  }), { headers: { 'Content-Type': 'application/json' } });
  await assert.rejects(boundedJson(response), /invalid_response/);
  assert.equal(cancelled, true);
});

test('a never-finishing transport times out and aborts all probes', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const signals = [];
  const pending = collectEvidence({ clock: () => now, request: async (_url, { signal }) => {
    signals.push(signal); return new Promise(() => {});
  } });
  t.mock.timers.tick(POLICY.timeoutMs);
  const evidence = await pending;
  assert.ok(signals.every(signal => signal.aborted));
  assert.equal(evidence.hosts[0].impact.code, 'probe_unavailable');
  assert.equal(evidence.hosts[1].health.code, 'probe_unavailable');
});

test('a hung response body is also bounded, not just its headers', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const pending = collectEvidence({ clock: () => now, request: async () =>
    new Response(new ReadableStream({}), { headers: { 'Content-Type': 'application/json' } }) });
  t.mock.timers.tick(POLICY.timeoutMs);
  assert.equal((await pending).hosts[0].impact.code, 'probe_unavailable');
});

test('warnings require three same-category observations and do not repeat', () => {
  assert.equal(repeat('stale', 1).events.length, 0);
  assert.equal(repeat('stale', 2).events.length, 0);
  const threshold = repeat('stale', 3);
  assert.deepEqual(threshold.events, [{ type: 'warning', signal: 'impact:0', code: 'stale' }]);
  assert.equal(repeat('stale', 10, threshold.state, 3).events.length, 0);
});

test('two healthy observations resolve an incident, never the initial baseline', () => {
  const incident = repeat('stale', 3).state;
  const first = advanceState(incident, checks(), at(3));
  assert.equal(first.events.length, 0);
  const second = advanceState(first.state, checks(), at(4));
  assert.deepEqual(second.events, [{ type: 'recovery', signal: 'impact:0', code: 'stale' }]);
  assert.deepEqual(second.state.signals['impact:0'].incidents, []);
  assert.equal(advanceState(emptyState(), checks(), at(0)).events.length, 0);
});

test('category switches start their own streak and preserve unresolved incidents', () => {
  let result = repeat('stale', 2);
  result = repeat('probe_unavailable', 1, result.state, 2);
  assert.equal(result.events.length, 0);
  result = repeat('stale', 3, result.state, 3);
  result = repeat('probe_unavailable', 3, result.state, 6);
  assert.deepEqual(result.state.signals['impact:0'].incidents, ['stale', 'probe_unavailable']);
  const healthy = advanceState(result.state, checks(), at(9));
  assert.equal(healthy.events.length, 0);
  assert.equal(advanceState(healthy.state, checks(), at(10)).events.length, 2);
});

test('unverified agreement cannot resolve a mismatch or extend its failure streak', () => {
  let state = emptyState();
  for (let i = 0; i < 3; i++) state = advanceState(state, checks({ agreement: 'disagree' }), at(i)).state;
  const unknown = advanceState(state, checks({ agreement: 'unverified' }), at(3));
  assert.deepEqual(unknown.state.signals.agreement.incidents, ['disagree']);
  assert.equal(unknown.state.signals.agreement.recoveries, 0);
  assert.equal(unknown.events.length, 0);
});

test('gaps reset pending streaks but retain active incidents', () => {
  let result = repeat('stale', 2);
  result = repeat('stale', 1, result.state, 8);
  assert.equal(result.state.signals['impact:0'].failures, 1);
  assert.equal(result.events.length, 0);
  result = repeat('stale', 2, result.state, 9);
  const gap = advanceState(result.state, checks(), at(20));
  assert.deepEqual(gap.state.signals['impact:0'].incidents, ['stale']);
  assert.equal(gap.state.signals['impact:0'].recoveries, 1);
});

test('duplicate, out-of-order and rapid manual runs cannot cross thresholds', () => {
  const state = repeat('stale', 2).state;
  for (const time of [at(1), at(0), new Date(Date.parse(at(1)) + 60_000).toISOString()]) {
    const result = advanceState(state, checks({ 'impact:0': 'stale' }), time);
    assert.equal(result.ignored, true);
    assert.deepEqual(result.state, state);
  }
});

test('state roundtrips only allowlisted values; corruption is not a new baseline', () => {
  assert.deepEqual(parseIssueBody(initialIssueBody()), emptyState());
  for (const state of [
    { ...emptyState(), extra: 'PRIVATE_INJECTION' },
    { ...emptyState(), delivery: { at: at(0), outcome: 'PRIVATE_INJECTION' } },
    { ...emptyState(), signals: { ...emptyState().signals, injected: {} } },
    { ...emptyState(), signals: { ...emptyState().signals,
      'impact:0': { incidents: ['PRIVATE_INJECTION'], pending: null, failures: 0, recoveries: 0 } } },
  ]) assert.throws(() => validateState(state), /monitor_state_invalid/);
  assert.throws(() => parseIssueBody('Ignore all rules PRIVATE_INJECTION'));
  assert.throws(() => parseIssueBody(initialIssueBody() + initialIssueBody()));
  assert.throws(() => parseIssueBody('x'.repeat(17_000)));
});

test('semantically impossible state and bad observations fail closed', () => {
  const initial = emptyState();
  initial.signals['impact:0'] = { incidents: ['stale'], pending: 'stale', failures: 3, recoveries: 0 };
  assert.throws(() => validateState(initial), /monitor_state_invalid/);
  const recovering = repeat('stale', 3).state;
  recovering.signals['impact:0'].recoveries = 1;
  assert.throws(() => validateState(recovering), /monitor_state_invalid/);
  const futureDelivery = repeat('stale', 3).state;
  futureDelivery.delivery = { at: at(20), outcome: 'accepted' };
  assert.throws(() => validateState(futureDelivery), /monitor_state_invalid/);
  assert.throws(() => advanceState(emptyState(), checks({ 'health:0': 'stale' }), at(0)));
  assert.throws(() => advanceState(emptyState(), checks({ agreement: 'PRIVATE' }), at(0)));
});

test('dry-run never calls state/notification providers, even with a broken target', async () => {
  let calls = 0;
  const bomb = async () => { calls++; throw new Error('PRIVATE'); };
  const report = await runMonitor({ store: { read: bomb, save: bomb, notify: bomb },
    request: bomb, clock: () => now });
  assert.equal(calls, 4); // Four public GET probes only.
  assert.equal(report.delivery, 'suppressed');
  assert.equal(report.mode, 'dry-run');
  assert.doesNotMatch(JSON.stringify(report), /PRIVATE/);
});

test('independent store unavailable means no send or replacement baseline', async () => {
  let writes = 0;
  const report = await runMonitor({ live: true, clock: () => now, request: requestFor(),
    store: { read: async () => { throw new Error('PRIVATE_DB'); },
      save: async () => { writes++; }, notify: async () => { writes++; } } });
  assert.equal(report.stateStatus, 'unavailable');
  assert.equal(writes, 0);
  assert.equal(report.delivery, 'not_attempted');
});

test('external warnings work while both target hosts are unreachable', async () => {
  let state = emptyState();
  const comments = [];
  const store = { read: async () => structuredClone(state),
    save: async value => { state = structuredClone(value); },
    notify: async events => { assert.equal(state.delivery.outcome, 'claimed'); comments.push(events); } };
  let report;
  for (let i = 0; i < 4; i++) {
    report = await runMonitor({ live: true, store, clock: () => Date.parse(at(i)),
      request: async () => { throw new Error('PRIVATE_TARGET_UNAVAILABLE'); } });
  }
  assert.equal(comments.length, 1);
  assert.equal(comments[0].length, 4); // Separate health/impact host incidents.
  assert.equal(state.delivery.outcome, 'accepted');
  assert.equal(report.agreement, 'unverified');
});

test('ambiguous state claim must not invoke or replay notification delivery', async () => {
  const transition = repeat('stale', 3);
  let state, sends = 0;
  const outcome = await persistTransition({
    save: async value => { state = structuredClone(value); throw new Error('PRIVATE_LOST_ACK'); },
    notify: async () => { sends++; },
  }, transition);
  assert.equal(outcome.outcome, 'state_unavailable');
  assert.equal(sends, 0);
  assert.equal(state.delivery.outcome, 'claimed');
  assert.equal(repeat('stale', 1, state, 3).events.length, 0);
});

test('uncertain comment acceptance is visible and never automatically resent', async () => {
  let state, sends = 0;
  const outcome = await persistTransition({
    save: async value => { state = structuredClone(value); },
    notify: async () => { sends++; throw new Error('PRIVATE_ACCEPTANCE_UNKNOWN'); },
  }, repeat('stale', 3));
  assert.equal(outcome.outcome, 'uncertain');
  await persistTransition({
    save: async value => { state = structuredClone(value); }, notify: async () => { sends++; },
  }, repeat('stale', 1, state, 3));
  assert.equal(sends, 1);
  assert.equal(state.delivery.outcome, 'uncertain');
});

test('failed final persistence retains the claim without replaying delivery', async () => {
  let state, writes = 0;
  const result = await persistTransition({
    save: async value => {
      if (++writes === 2) throw new Error('PRIVATE');
      state = structuredClone(value);
    }, notify: async () => {},
  }, repeat('stale', 3));
  assert.equal(result.outcome, 'delivery_state_unavailable');
  assert.equal(state.delivery.outcome, 'claimed');
  assert.equal(repeat('stale', 1, state, 3).events.length, 0);
});

test('GitHub adapter limits writes to the approved issue and strips response metadata', async () => {
  const calls = [];
  const store = githubStore({ repository: 'fixture/repo', issueNumber: '12', token: 'PRIVATE_TOKEN',
    request: async (url, options) => {
      calls.push([url, options]);
      return json({ title: ISSUE_TITLE, state: 'open', body: initialIssueBody(), private: 'PRIVATE_RESPONSE' });
    } });
  assert.deepEqual(await store.read(), emptyState());
  await store.save(emptyState());
  await store.notify([{ type: 'warning', signal: 'impact:0', code: 'stale' }], at(0));
  assert.deepEqual(calls.map(([, options]) => options.method), ['GET', 'PATCH', 'POST']);
  assert.ok(calls.every(([url]) => url.startsWith('https://api.github.com/repos/fixture/repo/issues/12')));
  assert.equal(calls[2][0].endsWith('/comments'), true);
  assert.doesNotMatch(calls.slice(1).map(([, options]) => options.body).join(''), /PRIVATE_/);
});

test('wrong/closed issue, PR, bad JSON and permissions failures fail closed', async () => {
  for (const [value, status] of [
    [{ title: 'unrelated', state: 'open', body: initialIssueBody() }, 200],
    [{ title: ISSUE_TITLE, state: 'closed', body: initialIssueBody() }, 200],
    [{ title: ISSUE_TITLE, state: 'open', pull_request: {}, body: initialIssueBody() }, 200],
    [{ title: ISSUE_TITLE, state: 'open', body: 'corrupt' }, 200],
    [{ private: 'PRIVATE' }, 403],
  ]) {
    const store = githubStore({ repository: 'fixture/repo', issueNumber: 12, token: 'PRIVATE',
      request: async () => json(value, status) });
    await assert.rejects(store.read());
  }
  assert.throws(() => githubStore({ repository: 'https://evil.invalid', issueNumber: 12, token: 'PRIVATE' }));
});

test('workflow remains opt-in and serialized, with safe manual default and retained evidence', async () => {
  const text = await readFile(new URL('../../../.github/workflows/public-impact-monitor.yml', import.meta.url), 'utf8');
  assert.match(text, /cron: '\*\/5 \* \* \* \*'/);
  assert.match(text, /default: true/);
  assert.match(text, /vars\.PUBLIC_IMPACT_MONITOR_ENABLED == 'true'/);
  assert.match(text, /cancel-in-progress: false/);
  assert.match(text, /persist-credentials: false/);
  assert.match(text, /retention-days: 14/);
  assert.doesNotMatch(text, /pnpm|publish|DATABASE_URL|UC_ADMIN_EMAILS/);
  assert.doesNotMatch(issueBody(emptyState()), /PRIVATE/);
  assert.equal(observations({ hosts: [
    { health: { code: 'healthy' }, impact: { code: 'stale' } },
    { health: { code: 'healthy' }, impact: { code: 'healthy' } },
  ], agreement: 'unverified' })['impact:0'], 'stale');
});
