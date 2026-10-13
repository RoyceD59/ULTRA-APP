'use strict';

const { Pool } = require('pg');
const { spawn } = require('node:child_process');
const { mkdtemp, chmod, readFile, writeFile, rm, stat, lstat, readlink, mkdir } = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const safety = require('./lib/guest-pay-fixture-safety.cjs');

const mode = process.argv[2];
if (!(mode === '--stop' && process.argv.length === 4) &&
    !(['--verify', '--serve'].includes(mode) && process.argv.length === 3)) {
  process.stderr.write('Usage: pnpm fixture:guest-pay --verify | --serve | --stop /tmp/guestpay-fixture-...\n');
  process.exit(1);
}
const root = path.resolve(__dirname, '../../..');
const name = `guestpay_fixture_${Date.now()}_${process.pid}`;
const port = 39761;
let admin, worker, schemaProcess, directory, databaseCreation, created = false, cleanupPromise, stopping = false;
let phase = 'configuration';
const event = (name, details = {}) => process.stdout.write(JSON.stringify({ event: name, ...details }) + '\n');
async function cleanup() {
  if (databaseCreation) await databaseCreation.catch(() => {});
  for (const child of [schemaProcess, worker]) {
    if (!child || child.exitCode !== null || child.signalCode !== null) continue;
    child.kill('SIGTERM');
    let timer;
    await Promise.race([new Promise(resolve => child.once('exit', resolve)),
      new Promise(resolve => { timer = setTimeout(resolve, 5000); })]);
    clearTimeout(timer);
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGKILL');
      await new Promise(resolve => child.once('exit', resolve));
    }
  }
  if (created) {
    safety.assertDatabase(name, databaseUrl);
    await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`);
    created = false;
    event('fixture_database_removed');
  }
  await admin?.end();
  if (directory) await rm(directory, { recursive: true, force: true });
}
const cleanupOnce = () => cleanupPromise ||= cleanup();
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => {
  stopping = true;
  void cleanupOnce().then(() => process.exit(0)).catch(() => process.exit(1));
});

let databaseUrl;
async function stopFixture(input) {
  safety.assertDevelopment(process.env);
  const dir = path.resolve(input);
  if (path.dirname(dir) !== os.tmpdir() || !/^guestpay-fixture-[A-Za-z0-9]+$/.test(path.basename(dir))) {
    throw new Error('Invalid control directory');
  }
  const info = await lstat(dir);
  const fileInfo = await lstat(path.join(dir, 'control.json'));
  if (!info.isDirectory() || info.isSymbolicLink() || (info.mode & 0o777) !== 0o700 ||
      !fileInfo.isFile() || fileInfo.isSymbolicLink() || (fileInfo.mode & 0o777) !== 0o600 ||
      info.uid !== process.getuid() || fileInfo.uid !== process.getuid()) throw new Error('Unsafe control file');
  const control = JSON.parse(await readFile(path.join(dir, 'control.json'), 'utf8'));
  if (!Number.isInteger(control.pid) || control.pid < 2 ||
      !/^guestpay_fixture_\d{13}_\d+$/.test(control.database) ||
      !control.database.endsWith('_' + control.pid)) throw new Error('Invalid control identity');
  const alive = () => {
    try { process.kill(control.pid, 0); return true; }
    catch (error) { if (error.code === 'ESRCH') return false; throw error; }
  };
  if (alive()) {
    const cwd = await readlink(`/proc/${control.pid}/cwd`);
    const command = (await readFile(`/proc/${control.pid}/cmdline`, 'utf8')).split('\0');
    if (!command.some(arg => path.resolve(cwd, arg) === __filename) ||
        !command.some(arg => ['--serve', '--verify'].includes(arg))) throw new Error('PID no longer belongs to fixture');
    process.kill(control.pid, 'SIGTERM');
    const deadline = Date.now() + 10000;
    while (alive() && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 100));
    if (alive()) throw new Error('Graceful stop timed out');
  }
  const url = new URL(process.env.DATABASE_URL);
  if (decodeURIComponent(url.pathname.slice(1)) === control.database) throw new Error('Parent database rejected');
  url.pathname = '/' + control.database;
  safety.assertDatabase(control.database, url.toString());
  const parent = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    // Only the validated owned database, never a broad prefix sweep.
    await parent.query(`DROP DATABASE IF EXISTS "${control.database}" WITH (FORCE)`);
    const result = await parent.query('SELECT 1 FROM pg_database WHERE datname=$1', [control.database]);
    assert.equal(result.rowCount, 0);
  } finally { await parent.end(); }
  await rm(dir, { recursive: true, force: true });
  event('fixture_stopped', { ownedDatabaseRemoved: true });
}
async function runSchema(env) {
  return new Promise((resolve, reject) => {
    const child = spawn('pnpm', ['run', 'push-force'], {
      cwd: path.join(root, 'lib/db'), env, stdio: ['pipe', 'pipe', 'pipe'],
    });
    schemaProcess = child;
    // Capture, never echo: tool output may contain connection strings/SQL.
    let output = '';
    child.stdout.on('data', data => { output = (output + data.toString()).slice(-100000); });
    child.stderr.on('data', data => { output = (output + data.toString()).slice(-100000); });
    child.stdin.end('y\n');
    child.once('error', reject);
    child.once('exit', code => {
      if (code !== 0 || /ExitPromptError|User force closed|not a TTY/i.test(output)) reject(new Error('Schema failed'));
      else resolve();
    });
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('Schema timed out')); }, 120000);
    timer.unref();
    child.once('exit', () => clearTimeout(timer));
  });
}
async function waitForState() {
  const deadline = Date.now() + 90000;
  while (Date.now() < deadline) {
    if (worker.exitCode !== null || worker.signalCode !== null) throw new Error('Fixture exited before ready');
    try { return JSON.parse(await readFile(path.join(directory, 'state.json'), 'utf8')); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    await new Promise(resolve => setTimeout(resolve, 300));
  }
  throw new Error('Fixture readiness timed out');
}
async function verify(state, logs) {
  const call = (route, payload) => fetch(state.origin + route, {
    method: payload ? 'POST' : 'GET', redirect: 'error',
    headers: payload ? { 'content-type': 'application/json' } : {},
    ...(payload ? { body: JSON.stringify(payload) } : {}),
  });
  const beforeResponse = await call('/_fixture/health');
  const before = await beforeResponse.json();
  assert.equal(beforeResponse.status, 200);
  for (const key of ['isolated', 'localOnly', 'syntheticData', 'originalBuyerRetained']) assert.equal(before[key], true);
  for (const key of ['providersEnabled', 'simulationsEnabled', 'notificationsEnabled', 'analyticsEnabled', 'paymentStarted']) assert.equal(before[key], false);
  assert.equal(before.orders, 1); assert.equal(before.buyers, 1);
  phase = 'verification_private_headers';
  const document = await call('/pay/' + state.token);
  assert.equal(document.status, 200);
  assert.match(document.headers.get('cache-control'), /private.*no-store/);
  assert.equal(document.headers.get('referrer-policy'), 'no-referrer');
  assert.match(document.headers.get('x-robots-tag'), /noindex.*nofollow.*noarchive/);
  assert.match(document.headers.get('content-security-policy'), /connect-src 'self'/);
  phase = 'verification_collector_flags';
  const html = await document.text();
  const config = html.match(/window\.__UC_PAY__=(\{.*?\});<\/script>/s);
  assert.ok(config);
  const settings = JSON.parse(config[1]);
  assert.equal(settings.analytics.enabled, false);
  assert.equal(settings.analytics.bootstrapApproved, false);
  // The shared inline script contains an inactive Google loader function.
  // Check the actual configuration and injected script tags, not that literal.
  assert.ok(!/<script[^>]+src=["']https:\/\/www\.googletagmanager\.com/i.test(html));
  phase = 'verification_summary_contract';
  const summaryResponse = await call('/guest-pay/summary', { token: state.token });
  const summary = await summaryResponse.json();
  assert.equal(summaryResponse.status, 200);
  assert.equal(summary.state, 'ready');
  assert.deepEqual(summary.methods, { paystack: false, mpesa: false, stripe: false });
  for (const key of ['email', 'phone', 'address', 'shippingAddress', 'shipping_address', 'user_id']) assert.equal(key in summary, false);
  for (const value of ['buyer@example.invalid', '+254712345678', 'Synthetic test address']) {
    assert.equal(JSON.stringify(summary).includes(value), false);
  }
  phase = 'verification_provider_unavailable';
  const initialize = await call('/guest-pay/initialize', {
    token: state.token, method: 'paystack', email: 'payer@example.invalid',
  });
  assert.equal(initialize.status, 503);
  phase = 'verification_route_isolation';
  const blocked = await call('/api/payments/paystack/initialize', {});
  assert.equal(blocked.status, 403);
  const foreign = await fetch(state.origin + '/_fixture/health', { headers: { origin: 'https://unapproved.example' } });
  assert.equal(foreign.status, 403);
  phase = 'verification_original_order';
  const after = await (await call('/_fixture/health')).json();
  assert.equal(after.orders, 1); assert.equal(after.originalBuyerRetained, true);
  assert.equal(after.orderState, 'payment_pending'); assert.equal(after.paymentStarted, false);
  assert.equal(after.blockedOutbound, 0);
  phase = 'verification_private_files_and_logs';
  assert.equal((await stat(directory)).mode & 0o777, 0o700);
  assert.equal((await stat(path.join(directory, 'state.json'))).mode & 0o777, 0o600);
  await new Promise(resolve => setTimeout(resolve, 100));
  assert.ok(!logs().includes(state.token));
  assert.ok(!logs().includes('payer@example.invalid'));
  return { category: 'local_preparation_only', isolatedDatabase: true,
    syntheticBuyerAndOrder: true, originalBuyerRetained: true,
    providerUnavailableNotSimulated: true, privateDocumentHeaders: true,
    minimalPayerSummary: true, fixtureLogTokenRedaction: true,
    privateTemporaryFiles: true, ordinaryPaymentRoutesBlocked: true,
    foreignBrowserOriginBlocked: true, actualProviderRequests: 0,
    actualSandboxRecovery: 'not_run', actualNotifications: 'not_run',
    physicalPhone: 'not_run', externalIngressPrivacy: 'not_verified', collectors: 'not_activated' };
}

(async () => {
  try {
    if (mode === '--stop') {
      phase = 'graceful_stop';
      await stopFixture(process.argv[3]);
      return;
    }
    safety.assertDevelopment(process.env);
    if (!process.env.DATABASE_URL) throw new Error('Development database required');
    const url = new URL(process.env.DATABASE_URL);
    if (!['postgres:', 'postgresql:'].includes(url.protocol) ||
        decodeURIComponent(url.pathname.slice(1)) === name) throw new Error('Invalid parent database');
    url.pathname = '/' + name;
    databaseUrl = url.toString();
    safety.assertDatabase(name, databaseUrl);
    directory = await mkdtemp(path.join(os.tmpdir(), 'guestpay-fixture-'));
    await chmod(directory, 0o700);
    if (stopping) throw new Error('Stopped');
    const env = safety.fixtureEnvironment(process.env, databaseUrl, name, port, directory);
    await writeFile(path.join(directory, 'control.json'),
      JSON.stringify({ pid: process.pid, database: name, port }), { mode: 0o600, flag: 'wx' });
    phase = 'database_create';
    admin = new Pool({ connectionString: process.env.DATABASE_URL });
    databaseCreation = admin.query(`CREATE DATABASE "${name}"`).then(() => { created = true; });
    await databaseCreation;
    if (stopping) throw new Error('Stopped');
    phase = 'schema';
    await runSchema(env);
    if (stopping) throw new Error('Stopped');
    phase = 'worker';
    worker = spawn(process.execPath, ['--import', 'tsx/esm', 'src/dev/guest-pay-fixture.ts'], {
      cwd: path.join(root, 'artifacts/api-server'), env, stdio: ['ignore', 'pipe', 'pipe'],
    });
    const workerExit = new Promise(resolve => worker.once('exit', resolve));
    let log = '';
    worker.stdout.on('data', data => {
      log = (log + data.toString()).slice(-100000);
      // Only forward structured fixture events, never arbitrary library output.
      for (const line of data.toString().split('\n')) {
        try {
          const item = JSON.parse(line);
          if (typeof item.event === 'string' && item.event.startsWith('fixture_')) event(item.event,
            Object.fromEntries(Object.entries(item).filter(([key]) =>
              ['family', 'status', 'code', 'column', 'phase', 'localOnly', 'providersEnabled', 'simulationsEnabled'].includes(key))));
        } catch {}
      }
    });
    worker.stderr.on('data', data => { log = (log + data.toString()).slice(-100000); });
    worker.once('error', () => event('fixture_worker_error'));
    const state = await waitForState();
    if (mode === '--verify') {
      phase = 'verification';
      const result = await verify(state, () => log);
      phase = 'cleanup';
      await cleanupOnce();
      const parent = new Pool({ connectionString: process.env.DATABASE_URL });
      try {
        const remaining = await parent.query('SELECT 1 FROM pg_database WHERE datname=$1', [name]);
        assert.equal(remaining.rowCount, 0);
      } finally { await parent.end(); }
      result.ownedDatabaseRemoved = true;
      const output = path.join(root, 'generated-artifacts/guest-payment-fixture');
      await mkdir(output, { recursive: true });
      await writeFile(path.join(output, 'local-verification.json'), JSON.stringify(result, null, 2));
      event('fixture_verified', result);
    } else {
      event('fixture_listening', { localOnly: true, port, providersEnabled: false, controlDirectory: directory });
      // A tracked process is required; stop it to discard this fixture.
      const ttl = setTimeout(() => {
        stopping = true;
        void cleanupOnce().then(() => process.exit(0)).catch(() => {
          event('fixture_cleanup_failed'); process.exit(1);
        });
      }, 4 * 60 * 60 * 1000);
      ttl.unref();
      await workerExit;
      clearTimeout(ttl);
      if (!stopping) throw new Error('Fixture worker exited unexpectedly');
      await cleanupOnce();
    }
  } catch {
    event('fixture_failed', { phase });
    try { await cleanupOnce(); } catch { event('fixture_cleanup_failed'); }
    process.exitCode = 1;
  }
})();
