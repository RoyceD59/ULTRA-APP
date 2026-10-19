'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const https = require('node:https');
const net = require('node:net');
const { spawnSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const safety = require('../lib/guest-pay-fixture-safety.cjs');
const { encodeState, decodeState } = require('../lib/guest-pay-fixture-state.cjs');
const name = 'guestpay_fixture_1791847258000_123';
const db = `postgresql://fixture:unused@127.0.0.1:53999/${name}`;
const make = parent => safety.fixtureEnvironment(parent, db, name, 39761, '/tmp/disposable-fixture');

test('child environment excludes ambient live secrets, connectors and executable injection', () => {
  const env = make({ PATH: '/bin', HOME: '/not-inherited', PAYSTACK_SECRET_KEY: 'not-real',
    MPESA_PASSKEY: 'not-real', STRIPE_SECRET_KEY: 'not-real', WC_CONSUMER_SECRET: 'not-real',
    REPLIT_IDENTITY: 'not-real', NODE_OPTIONS: '--require /unsafe' });
  for (const key of ['PAYSTACK_SECRET_KEY', 'MPESA_PASSKEY', 'STRIPE_SECRET_KEY',
    'WC_CONSUMER_SECRET', 'REPLIT_IDENTITY', 'NODE_OPTIONS']) assert.equal(key in env, false);
  assert.equal(env.HOME, '/tmp/disposable-fixture');
  assert.equal(env.NODE_ENV, 'guestpay-fixture');
  safety.assertChildEnvironment(env);
});
test('production and non-owned database identities fail closed', () => {
  assert.throws(() => make({ NODE_ENV: 'production' }));
  assert.throws(() => make({ REPLIT_DEPLOYMENT: '1' }));
  assert.throws(() => safety.assertDatabase('public', db));
  assert.throws(() => safety.assertDatabase(name, 'postgresql://fixture@localhost/live'));
  assert.throws(() => safety.assertDatabase(name, 'https://example.invalid/' + name));
  assert.throws(() => safety.fixtureEnvironment({}, db, name, 80, '/tmp/fixture'));
});
test('changed configuration cannot enable providers, simulations, analytics or ambient identity', () => {
  for (const changes of [{ NODE_ENV: 'test' }, { NODE_ENV: 'development' }, { STRIPE_ENABLED: 'true' },
    { PAYSTACK_SECRET_KEY: 'not-real' }, { MPESA_WEBHOOK_SECRET: 'not-real' },
    { CLERK_SECRET_KEY: 'not-real' }, { REPLIT_CONNECTORS_HOSTNAME: 'example.invalid' },
    { UC_GUEST_PAY_ANALYTICS_BOOTSTRAP_APPROVED: 'true' },
    { EXPO_PUBLIC_PRODUCT_GA_ENABLED: 'true' }, { UC_GUEST_PAY_PUBLIC_ORIGIN: 'https://app.ucfilters.com' }]) {
    assert.throws(() => safety.assertChildEnvironment({ ...make({}), ...changes }));
  }
});
test('unrelated eager AI dependency fails explicitly and is fixture-only', () => {
  const moduleUrl = pathToFileURL(path.resolve(__dirname, '../lib/guest-pay-disabled-ai.mjs')).href;
  const outside = spawnSync(process.execPath, ['--input-type=module', '-e',
    `try { await import(${JSON.stringify(moduleUrl)}); process.exit(1); } catch { process.exit(0); }`],
    { env: { PATH: process.env.PATH }, stdio: 'ignore' });
  assert.equal(outside.status, 0);
  const inside = spawnSync(process.execPath, ['--input-type=module', '-e',
    `const module=await import(${JSON.stringify(moduleUrl)});for(const run of [module.anthropic.messages.create,module.batchProcess]) {try {run();process.exit(1);}catch(e){if(e.code!=='FIXTURE_AI_DISABLED')process.exit(1);}}`],
    { env: make({ PATH: process.env.PATH }), stdio: 'ignore' });
  assert.equal(inside.status, 0);
});
test('graceful-stop command rejects arbitrary paths, databases and reused unrelated PIDs before SQL or signals', () => {
  const script = path.resolve(__dirname, '../guest-pay-fixture.cjs');
  const env = { PATH: process.env.PATH, DATABASE_URL: db };
  const wrongPath = spawnSync(process.execPath, [script, '--stop', '/tmp/not-owned'], { env, stdio: 'ignore' });
  assert.equal(wrongPath.status, 1);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'guestpay-fixture-'));
  fs.chmodSync(dir, 0o700);
  try {
    for (const database of ['public', `guestpay_fixture_1791847258000_${process.pid}`]) {
      fs.writeFileSync(path.join(dir, 'control.json'), JSON.stringify({ database, pid: process.pid }), { mode: 0o600 });
      const stopped = spawnSync(process.execPath, [script, '--stop', dir], { env, stdio: 'ignore' });
      assert.equal(stopped.status, 1);
      assert.ok(fs.existsSync(dir));
      process.kill(process.pid, 0); // The test process was not mistaken for the supervisor.
    }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
test('all HTTP transports and raw sockets reject remote providers, notifications and unrelated local ports', async () => {
  const server = http.createServer((_req, res) => res.end('fixture'));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const guard = safety.installNetworkGuard(db, port);
  try {
    assert.equal(await (await fetch(`http://127.0.0.1:${port}`)).text(), 'fixture');
    await assert.rejects(fetch('https://api.paystack.co/transaction/initialize'), { code: 'FIXTURE_EGRESS_BLOCKED' });
    await assert.rejects(fetch('https://sandbox.safaricom.co.ke/oauth/v1/generate'), { code: 'FIXTURE_EGRESS_BLOCKED' });
    await assert.rejects(fetch('https://api.resend.com/emails'), { code: 'FIXTURE_EGRESS_BLOCKED' });
    await assert.rejects(fetch('http://127.0.0.1:8080/api/uc/orders'), { code: 'FIXTURE_EGRESS_BLOCKED' });
    assert.throws(() => https.request('https://api.stripe.com/v1/checkout/sessions'), { code: 'FIXTURE_EGRESS_BLOCKED' });
    assert.throws(() => http.get('http://example.invalid'), { code: 'FIXTURE_EGRESS_BLOCKED' });
    assert.throws(() => http.request(`http://127.0.0.1:${port}`, { hostname: 'example.invalid' }), { code: 'FIXTURE_EGRESS_BLOCKED' });
    assert.throws(() => net.connect(25, 'smtp.example.invalid'), { code: 'FIXTURE_EGRESS_BLOCKED' });
    assert.ok(guard.blocked() >= 8);
  } finally {
    guard.restore();
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
});
test('public sandbox mode copies only approved M-Pesa keys and rejects production origins or modes', () => {
  const parent = Object.fromEntries(safety.MPESA_KEYS.map(key => [key, 'not-real']));
  parent.PAYSTACK_SECRET_KEY = 'not-inherited';
  parent.AI_INTEGRATIONS_ANTHROPIC_API_KEY = 'not-inherited';
  const options = { publicOrigin: 'https://fixture-test.replit.dev',
    instance: '00000000-0000-4000-8000-000000000001', mpesa: true };
  const env = safety.fixtureEnvironment(parent, db, name, 39761, '/tmp/disposable-fixture', options);
  safety.assertChildEnvironment(env);
  assert.equal(env.PAYSTACK_SECRET_KEY, undefined);
  assert.equal(env.AI_INTEGRATIONS_ANTHROPIC_API_KEY, undefined);
  assert.equal(env.API_BASE_URL, options.publicOrigin + safety.PUBLIC_PREFIX);
  assert.throws(() => safety.assertChildEnvironment({ ...env, MPESA_ENV: 'production' }));
  assert.throws(() => safety.assertChildEnvironment({ ...env, API_BASE_URL: 'https://api.ucfilters.com' }));
  assert.throws(() => safety.fixtureEnvironment(parent, db, name, 39761, '/tmp/disposable-fixture',
    { ...options, publicOrigin: 'https://app.ucfilters.com' }));
  const preparation = safety.fixtureEnvironment(parent, db, name, 39761, '/tmp/disposable-fixture',
    { ...options, mpesa: false });
  assert.equal(preparation.MPESA_CONSUMER_KEY, undefined);
  safety.assertChildEnvironment(preparation);
});
test('M-Pesa fixture state encrypts capabilities/signing key and rejects the wrong key or tampering', () => {
  const input = { token: 'test-only-capability', sessionSecret: 'test-only-session-key', orderId: 'test-order' };
  const box = encodeState(input, 'not-real-test-key');
  assert.equal(JSON.stringify(box).includes(input.token), false);
  assert.equal(JSON.stringify(box).includes(input.sessionSecret), false);
  assert.deepEqual(decodeState(box, 'not-real-test-key'), input);
  assert.throws(() => decodeState(box, 'wrong-test-key'));
  assert.throws(() => decodeState({ ...box, tag: Buffer.alloc(16).toString('base64') }, 'not-real-test-key'));
});
test('sandbox egress permits only the fixed Daraja paths and rejects live M-Pesa, other providers and redirects', async () => {
  const realFetch = globalThis.fetch;
  let options;
  globalThis.fetch = async (_url, init) => { options = init; return new Response('{}'); };
  const guard = safety.installNetworkGuard(db, 39761, { mpesa: true });
  try {
    await fetch('https://sandbox.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials');
    assert.equal(options.redirect, 'error');
    await fetch('https://sandbox.safaricom.co.ke/mpesa/stkpush/v1/processrequest', { method: 'POST' });
    await fetch('https://sandbox.safaricom.co.ke/mpesa/stkpushquery/v1/query', { method: 'POST' });
    for (const url of ['https://api.safaricom.co.ke/oauth/v1/generate',
      'https://sandbox.safaricom.co.ke/unapproved', 'http://sandbox.safaricom.co.ke/oauth/v1/generate',
      'https://sandbox.safaricom.co.ke:8443/oauth/v1/generate',
      'https://api.paystack.co/transaction/initialize', 'https://api.resend.com/emails']) {
      await assert.rejects(fetch(url), { code: 'FIXTURE_EGRESS_BLOCKED' });
    }
  } finally { guard.restore(); globalThis.fetch = realFetch; }
});
