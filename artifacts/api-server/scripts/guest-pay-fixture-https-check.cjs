'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const safety = require('./lib/guest-pay-fixture-safety.cjs');
const { decodeState } = require('./lib/guest-pay-fixture-state.cjs');
const activate = process.argv[3] === '--activate';
let phase = 'configuration';
(async () => {
  safety.assertDevelopment(process.env);
  if (![3, 4].includes(process.argv.length) || (process.argv.length === 4 && !activate)) throw new Error('Arguments rejected');
  const directory = path.resolve(process.argv[2]);
  if (path.dirname(directory) !== os.tmpdir() || !/^guestpay-fixture-[A-Za-z0-9]+$/.test(path.basename(directory))) throw new Error('Unsafe directory');
  for (const [target, mode] of [[directory, 0o700], [path.join(directory, 'control.json'), 0o600],
    [path.join(directory, 'state.json'), 0o600]]) {
    const info = await fs.lstat(target);
    if (info.isSymbolicLink() || info.uid !== process.getuid() || (info.mode & 0o777) !== mode) throw new Error('Unsafe private file');
  }
  const control = JSON.parse(await fs.readFile(path.join(directory, 'control.json'), 'utf8'));
  const origin = safety.developmentOrigin(`https://${process.env.REPLIT_DEV_DOMAIN}`);
  assert.equal(control.publicOrigin, origin);
  assert.equal(control.basePath, safety.PUBLIC_PREFIX);
  assert.equal(control.port, 39761);
  process.kill(control.pid, 0);
  const state = decodeState(JSON.parse(await fs.readFile(path.join(directory, 'state.json'), 'utf8')),
    control.mode === 'mpesa-sandbox' ? process.env.MPESA_WEBHOOK_SECRET : undefined);
  assert.equal(state.origin, 'http://127.0.0.1:39761');
  assert.equal(state.publicUrl, origin + safety.PUBLIC_PREFIX + '/pay/' + state.token);
  const call = (route, body, headers = {}) => fetch(origin + safety.PUBLIC_PREFIX + route, {
    method: body ? 'POST' : 'GET', redirect: 'error', signal: AbortSignal.timeout(15000),
    headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...headers },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  phase = 'https_status';
  const status = await call('/status');
  assert.equal(status.status, 200);
  const ready = await status.json();
  assert.equal(ready.ready, true); assert.equal(ready.syntheticData, true); assert.equal(ready.sandboxOnly, true);
  assert.equal(ready.paymentsEnabled, false); // Initial preflight only: never initialize during a recheck.
  phase = 'https_document_privacy';
  const document = await call('/pay/' + state.token);
  assert.equal(document.status, 200);
  assert.match(document.headers.get('cache-control'), /private.*no-store/);
  assert.equal(document.headers.get('referrer-policy'), 'no-referrer');
  assert.match(document.headers.get('x-robots-tag'), /noindex.*nofollow.*noarchive/);
  assert.match(document.headers.get('content-security-policy'), /connect-src 'self'/);
  const html = await document.text();
  const config = JSON.parse(html.match(/window\.__UC_PAY__=(\{.*?\});<\/script>/s)[1]);
  assert.equal(config.apiBase, safety.PUBLIC_PREFIX); assert.equal(config.basePath, safety.PUBLIC_PREFIX);
  assert.equal(config.analytics.enabled, false); assert.equal(config.analytics.bootstrapApproved, false);
  phase = 'minimal_summary';
  const summary = await call('/guest-pay/summary', { token: state.token });
  assert.equal(summary.status, 200);
  const payer = await summary.json();
  assert.equal(payer.methods.mpesa, control.mode === 'mpesa-sandbox');
  assert.equal(payer.methods.paystack, false); assert.equal(payer.methods.stripe, false);
  for (const value of ['buyer@example.invalid', '+254712345678', 'Synthetic test address']) {
    assert.equal(JSON.stringify(payer).includes(value), false);
  }
  for (const field of ['email', 'phone', 'address', 'shippingAddress', 'shipping_address', 'user_id']) {
    assert.equal(field in payer, false);
  }
  phase = 'boundary_checks';
  assert.equal((await call('/guest-pay/summary', { token: state.token }, { origin: 'https://foreign.example' })).status, 403);
  assert.equal((await call('/api/uc/orders', {})).status, 404);
  assert.equal((await call('/_fixture/activate-mpesa', {})).status, 404);
  const locked = await call('/guest-pay/initialize', { token: state.token, method: 'mpesa' });
  if (!ready.paymentsEnabled) assert.equal(locked.status, 503);
  phase = 'callback_authentication';
  if (control.mode === 'mpesa-sandbox') {
    const callback = await call('/api/payments/mpesa/callback?token=deliberately-invalid', {
      Body: { stkCallback: { CheckoutRequestID: 'invalid-test-reference', ResultCode: 0 } },
    });
    assert.equal(callback.status, 401);
  }
  phase = 'original_order';
  const health = await (await fetch(state.origin + '/_fixture/health', { redirect: 'error' })).json();
  assert.equal(health.isolated, true); assert.equal(health.originalBuyerRetained, true);
  assert.equal(health.orders, 1); assert.equal(health.buyers, 1); assert.equal(health.paymentStarted, false);
  const result = { category: 'actual_https_preflight', reachable: true, privateHeaders: true,
    sameOriginPrivateProxy: true, minimalPayerSummary: true, collectorsDisabled: true,
    foreignOriginsRejected: true, normalCheckoutPathsRejected: true, controlPathsNotPublic: true,
    callbackReachableAndUnauthorizedRejected: control.mode === 'mpesa-sandbox',
    originalOrderAndBuyerRetained: true, actualPaymentRequests: 0, actualCallbacksCompleted: false,
    providerAuthenticationEvidence: 'separate_oauth_probe', physicalPhone: 'not_run',
    gatewayInternalLogs: 'not_independently_observable', activationRequested: activate };
  const output = path.resolve(__dirname, '../../../generated-artifacts/guest-payment-fixture');
  await fs.mkdir(output, { recursive: true });
  await fs.writeFile(path.join(output, 'https-verification.json'), JSON.stringify(result, null, 2));
  if (activate) {
    phase = 'sandbox_activation';
    assert.equal(control.mode, 'mpesa-sandbox');
    const response = await fetch(state.origin + '/_fixture/activate-mpesa', {
      method: 'POST', redirect: 'error', headers: { 'x-fixture-instance': control.instance },
      signal: AbortSignal.timeout(5000),
    });
    assert.equal(response.status, 200);
    result.sandboxPaymentInitiationUnlocked = true;
    await fs.writeFile(path.join(output, 'https-verification.json'), JSON.stringify(result, null, 2));
  }
  process.stdout.write(JSON.stringify(result) + '\n');
})().catch(() => { process.stdout.write(JSON.stringify({ event: 'fixture_https_check_failed', phase }) + '\n'); process.exitCode = 1; });
