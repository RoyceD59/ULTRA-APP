import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { collectEvidence, observations, advanceState, emptyState, POLICY } from './public-impact-monitor.mjs';
import { githubStore, initialIssueBody, persistTransition } from './public-impact-monitor-github.mjs';

export async function runMonitor({ live = false, store, request = fetch, clock = Date.now } = {}) {
  const evidence = await collectEvidence({ request, clock });
  const report = { ...evidence, policy: POLICY, mode: live ? 'live' : 'dry-run',
    stateStatus: 'unverified', delivery: 'not_attempted', events: [] };
  let previous = emptyState();
  if (live) {
    try { previous = await store.read(); report.stateStatus = 'read'; }
    catch { report.stateStatus = 'unavailable'; return report; }
  }
  const transition = advanceState(previous, observations(evidence), evidence.observedAt);
  report.events = transition.events;
  report.ignored = transition.ignored;
  if (live) {
    const result = await persistTransition(store, transition);
    report.delivery = result.outcome;
    report.stateStatus = result.outcome === 'state_unavailable' ? 'unavailable' : 'processed';
    report.latestNotification = result.state.delivery;
  } else {
    report.delivery = 'suppressed';
    report.stateStatus = 'dry_run_no_persistence';
  }
  return report;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length > 1 || args.some(arg => !['--live', '--dry-run', '--issue-template'].includes(arg))) {
    throw new Error('monitor_configuration_invalid');
  }
  if (args[0] === '--issue-template') { console.log(initialIssueBody()); return; }
  const live = args[0] === '--live';
  if (live && process.env.PUBLIC_IMPACT_MONITOR_ENABLED !== 'true') {
    throw new Error('monitor_activation_not_approved');
  }
  if (live && (process.env.GITHUB_ACTIONS !== 'true'
      || process.env.GITHUB_WORKFLOW !== 'Public impact snapshot monitor')) {
    throw new Error('monitor_serialized_workflow_required');
  }
  const store = live ? githubStore({
    repository: process.env.GITHUB_REPOSITORY,
    issueNumber: process.env.PUBLIC_IMPACT_MONITOR_ISSUE,
    token: process.env.MONITOR_GITHUB_TOKEN,
  }) : undefined;
  const report = await runMonitor({ live, store });
  const output = resolve('generated-artifacts/public-impact-monitor/evidence.json');
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  console.log(JSON.stringify(report));
  if (live && (report.stateStatus === 'unavailable'
      || ['uncertain', 'delivery_state_unavailable'].includes(report.delivery))) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(() => {
    // Configuration and unexpected errors must not expose credentials/exception text.
    console.error(JSON.stringify({ observedAt: new Date().toISOString(),
      category: 'monitor_execution_unavailable', sourceIdentity: 'unverified' }));
    process.exitCode = 1;
  });
}
