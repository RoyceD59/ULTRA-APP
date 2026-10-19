/** Read-only public probes and pure incident transitions. No database or providers. */
import { API_ORIGINS, validateSnapshot, verifyLiveApi } from './consistency-handoff.mjs';

export const POLICY = Object.freeze({
  intervalMs: 300_000, timeoutMs: 15_000, failures: 3, recoveries: 2,
  minimumSpacingMs: 240_000, maximumGapMs: 900_000, maximumBodyBytes: 32_768,
});
const CODES = ['healthy', 'http_error', 'probe_unavailable', 'invalid_response',
  'incompatible', 'stale', 'future_clock', 'disagree'];
export const SIGNALS = ['health:0', 'impact:0', 'health:1', 'impact:1', 'agreement'];
const iso = value => typeof value === 'string'
  && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).sort().join(',') === [...keys].sort().join(',');
const allowedCode = (key, value) => value === null || (key === 'agreement'
  ? value === 'disagree' : key.startsWith('health:')
    ? ['http_error', 'probe_unavailable', 'invalid_response', 'incompatible'].includes(value)
    : CODES.includes(value) && !['healthy', 'disagree'].includes(value));

export function emptyState() {
  return { version: 1, lastCheckAt: null, signals: Object.fromEntries(SIGNALS.map(key =>
    [key, { incidents: [], pending: null, failures: 0, recoveries: 0 }])), delivery: null };
}

/** Persisted issue content is untrusted: reject, rather than reset, invalid state. */
export function validateState(state) {
  if (!exact(state, ['version', 'lastCheckAt', 'signals', 'delivery']) || state.version !== 1
      || (state.lastCheckAt !== null && !iso(state.lastCheckAt))
      || !exact(state.signals, SIGNALS)) throw new Error('monitor_state_invalid');
  for (const [key, value] of Object.entries(state.signals)) {
    if (!exact(value, ['incidents', 'pending', 'failures', 'recoveries'])
        || !Array.isArray(value.incidents) || value.incidents.length > CODES.length
        || new Set(value.incidents).size !== value.incidents.length
        || value.incidents.some(code => code === null || !allowedCode(key, code))
        || !allowedCode(key, value.pending)
        || !Number.isInteger(value.failures) || value.failures < 0 || value.failures > POLICY.failures
        || !Number.isInteger(value.recoveries) || value.recoveries < 0 || value.recoveries > POLICY.recoveries
        || (value.pending === null && value.failures !== 0)
        || (value.pending !== null && value.failures === 0)
        || (value.incidents.length === 0 && value.recoveries !== 0)
        || (value.recoveries > 0 && value.pending !== null)
        || (state.lastCheckAt === null && (value.incidents.length || value.pending !== null))) {
      throw new Error('monitor_state_invalid');
    }
  }
  if (state.delivery !== null && (!exact(state.delivery, ['at', 'outcome'])
      || !iso(state.delivery.at) || !['claimed', 'accepted', 'uncertain'].includes(state.delivery.outcome))) {
    throw new Error('monitor_state_invalid');
  }
  if (state.delivery !== null && (state.lastCheckAt === null
      || Date.parse(state.delivery.at) > Date.parse(state.lastCheckAt))) throw new Error('monitor_state_invalid');
  return structuredClone(state);
}

export async function boundedJson(response, limit = POLICY.maximumBodyBytes) {
  if (!/\bapplication\/(?:[\w.-]+\+)?json\b/i.test(response.headers.get('content-type') || '')) {
    await response.body?.cancel();
    throw new Error('invalid_response');
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error('invalid_response');
  let bytes = 0;
  const chunks = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > limit) throw new Error('invalid_response');
      chunks.push(Buffer.from(value));
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally { reader.releaseLock(); }
}

function snapshotResult(value, now) {
  if (typeof value?.snapshotId !== 'string' || typeof value?.calculatedAt !== 'string') {
    return { code: 'incompatible' };
  }
  try {
    const snapshot = validateSnapshot(value, now);
    return { code: 'healthy', snapshot: {
      ...snapshot, calculatedAt: new Date(snapshot.calculatedAt).toISOString(),
    } };
  }
  catch {
    // Reuse the exact release contract with only the clock field substituted to
    // distinguish a valid-but-old snapshot from malformed/legacy responses.
    try { validateSnapshot({ ...value, calculatedAt: new Date(now).toISOString() }, now); }
    catch { return { code: 'incompatible' }; }
    const calculated = Date.parse(value?.calculatedAt);
    if (!Number.isFinite(calculated)) return { code: 'incompatible' };
    return { code: calculated > now + 60_000 ? 'future_clock' : 'stale' };
  }
}

async function probe(origin, kind, request, clock) {
  const start = clock();
  // Race bounds even an injected/noncompliant transport; abort also stops the
  // real fetch and body stream, not merely waiting for response headers.
  const controller = new AbortController();
  let timer;
  const unavailable = { code: 'probe_unavailable' };
  const operation = (async () => {
    try {
      const response = await request(`${origin}/api/${kind === 'health' ? 'healthz' : 'uc/impact'}`, {
        method: 'GET', redirect: 'error', cache: 'no-store',
        headers: { Accept: 'application/json', 'Cache-Control': 'no-cache' },
        signal: controller.signal,
      });
      if (!response.ok) {
        await response.body?.cancel();
        return { code: 'http_error', httpStatus: response.status };
      }
      let value;
      try { value = await boundedJson(response); }
      catch { return { code: controller.signal.aborted ? 'probe_unavailable' : 'invalid_response' }; }
      return kind === 'health'
        ? { code: value?.status === 'ok' ? 'healthy' : 'incompatible', httpStatus: response.status }
        : { ...snapshotResult(value, clock()), httpStatus: response.status };
    } catch { return unavailable; } // Never retain exception text, URLs or raw bodies.
  })();
  try {
    const result = await Promise.race([operation, new Promise(done => {
      timer = setTimeout(() => { controller.abort(); done(unavailable); }, POLICY.timeoutMs);
    })]);
    return { ...result, durationMs: Math.max(0, Math.round(clock() - start)) };
  } finally { clearTimeout(timer); }
}

export async function collectEvidence({ request = fetch, clock = Date.now } = {}) {
  const startedAt = new Date(clock()).toISOString();
  const hosts = await Promise.all(API_ORIGINS.map(async origin => {
    const [health, impact] = await Promise.all([
      probe(origin, 'health', request, clock), probe(origin, 'impact', request, clock),
    ]);
    return { origin, health, impact };
  }));
  // A fast host's snapshot can age while waiting for the other probe. Classify
  // at the shared comparison time, rather than mislabelling expiry as disagreement.
  for (const host of hosts) {
    if (host.impact.code === 'healthy') {
      host.impact = { durationMs: host.impact.durationMs, httpStatus: host.impact.httpStatus,
        ...snapshotResult({ ...host.impact.snapshot, maxAgeSeconds: 60 }, clock()) };
    }
  }
  let agreement = 'unverified';
  if (hosts.every(host => host.impact.code === 'healthy')) {
    // Run the existing agreement gate on the already collected, sanitized public
    // values; no extra network call, archive verification or release action.
    try {
      await verifyLiveApi(async url => ({
        ok: true, json: async () => ({
          ...hosts.find(host => url.startsWith(`${host.origin}/`)).impact.snapshot, maxAgeSeconds: 60,
        }),
      }), clock());
      agreement = 'healthy';
    } catch { agreement = 'disagree'; }
  }
  return { version: 1, startedAt, observedAt: new Date(clock()).toISOString(),
    hosts, agreement, sourceIdentity: 'unverified' };
}

export function observations(evidence) {
  const result = {};
  evidence.hosts.forEach((host, index) => {
    result[`health:${index}`] = host.health.code;
    result[`impact:${index}`] = host.impact.code;
  });
  result.agreement = evidence.agreement;
  return result;
}

export function advanceState(previous, checks, observedAt) {
  const state = validateState(previous);
  if (!iso(observedAt) || !exact(checks, SIGNALS)
      || Object.entries(checks).some(([key, code]) => !(code === 'healthy'
        || (key === 'agreement' && code === 'unverified') || allowedCode(key, code) && code !== null))) {
    throw new Error('monitor_observation_invalid');
  }
  const delta = state.lastCheckAt === null ? Infinity
    : Date.parse(observedAt) - Date.parse(state.lastCheckAt);
  if (delta < POLICY.minimumSpacingMs) return { state, events: [], ignored: true };
  if (delta > POLICY.maximumGapMs) {
    for (const entry of Object.values(state.signals)) {
      entry.pending = null; entry.failures = 0; entry.recoveries = 0;
    }
  }
  const events = [];
  for (const key of SIGNALS) {
    const code = checks[key];
    const entry = state.signals[key];
    if (code === 'unverified') {
      entry.pending = null; entry.failures = 0; entry.recoveries = 0;
    } else if (code === 'healthy') {
      entry.pending = null; entry.failures = 0;
      if (entry.incidents.length && ++entry.recoveries >= POLICY.recoveries) {
        events.push(...entry.incidents.map(incident => ({ type: 'recovery', signal: key, code: incident })));
        entry.incidents = []; entry.recoveries = 0;
      }
    } else {
      entry.recoveries = 0;
      entry.failures = entry.pending === code ? Math.min(POLICY.failures, entry.failures + 1) : 1;
      entry.pending = code;
      if (entry.failures >= POLICY.failures && !entry.incidents.includes(code)) {
        entry.incidents.push(code);
        events.push({ type: 'warning', signal: key, code });
      }
    }
  }
  state.lastCheckAt = observedAt;
  return { state: validateState(state), events, ignored: false };
}
