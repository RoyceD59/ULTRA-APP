/** Independent state and at-most-once GitHub warnings. No application secrets. */
import { boundedJson, emptyState, validateState } from './public-impact-monitor.mjs';

export const ISSUE_TITLE = 'Public impact monitor — state and warnings';
const START = '<!-- public-impact-monitor-state-v1\n';
const END = '\n-->';

export function issueBody(state) {
  state = validateState(state);
  const active = Object.entries(state.signals)
    .flatMap(([key, value]) => value.incidents.map(code => `- ${key}: ${code}`));
  return `# Public impact monitor\n\nSanitized operational state; not API source attestation.
Do not edit the machine record. Subscribe to this issue for warning/recovery comments.
Probe unavailability is not confirmed downtime. Notification receipt is unverified.

Last check (UTC): ${state.lastCheckAt ?? 'not yet observed'}
Latest notification: ${state.delivery?.outcome ?? 'none'}

## Active incidents
${active.join('\n') || 'None recorded.'}

${START}${JSON.stringify(state)}${END}`;
}

export function parseIssueBody(body) {
  if (typeof body !== 'string' || Buffer.byteLength(body) > 16_384
      || body.split(START).length !== 2 || body.split(END).length !== 2) {
    throw new Error('monitor_state_invalid');
  }
  return validateState(JSON.parse(body.split(START)[1].split(END)[0]));
}

export function initialIssueBody() { return issueBody(emptyState()); }

export function warningComment(events, at) {
  // Events originate only from the validated finite signal/code state machine.
  return `Public impact monitor (${at}, UTC)\n\n${events.map(event =>
    `- ${event.type === 'warning' ? 'WARNING' : 'RECOVERY'}: ${event.signal} — ${event.code}`).join('\n')}

Probe unavailability is not confirmed downtime. Matching public totals do not
establish running API source identity. No customer data is included.
Investigate using docs/release-observability-and-test-guide.md, section 10.
No release, database or automatic recovery action was performed.`;
}

export function githubStore({ repository, issueNumber, token, request = fetch }) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository || '') || !/^[1-9]\d*$/.test(String(issueNumber || ''))
      || !token) throw new Error('monitor_configuration_invalid');
  const base = `https://api.github.com/repos/${repository}/issues/${issueNumber}`;
  async function api(method, suffix = '', body) {
    const response = await request(`${base}${suffix}`, {
      method, redirect: 'error', signal: AbortSignal.timeout(15_000),
      headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}`,
        'X-GitHub-Api-Version': '2022-11-28', 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!response.ok) { await response.body?.cancel(); throw new Error('monitor_store_unavailable'); }
    if (method !== 'GET') { await response.body?.cancel(); return {}; }
    // Issue envelopes contain platform user metadata; none of it enters reports
    // or persists locally. Bound it and project only the dedicated body/title.
    return boundedJson(response, 65_536);
  }
  return {
    async read() {
      const value = await api('GET');
      if (value.title !== ISSUE_TITLE || value.pull_request || value.state !== 'open') {
        throw new Error('monitor_issue_invalid');
      }
      return parseIssueBody(value.body);
    },
    async save(state) { await api('PATCH', '', { body: issueBody(state) }); },
    async notify(events, at) { await api('POST', '/comments', { body: warningComment(events, at) }); },
  };
}

export async function persistTransition(store, transition) {
  if (transition.ignored) return { outcome: 'ignored', state: transition.state };
  const state = validateState(transition.state);
  if (transition.events.length) state.delivery = { at: state.lastCheckAt, outcome: 'claimed' };
  // Persist the whole transition BEFORE attempting delivery. A lost/ambiguous
  // response must not be retried: later runs reconcile by re-reading the issue.
  try { await store.save(state); }
  catch { return { outcome: 'state_unavailable', state }; }
  if (!transition.events.length) return { outcome: 'no_transition', state };
  try {
    await store.notify(transition.events, state.lastCheckAt);
    state.delivery.outcome = 'accepted';
  } catch { state.delivery.outcome = 'uncertain'; }
  try { await store.save(state); }
  catch { return { outcome: 'delivery_state_unavailable', state }; }
  return { outcome: state.delivery.outcome, state };
}
