'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { summarize, inspectResponse } = require('../lib/guest-pay-fixture-diagnostics.cjs');
const safety = require('../lib/guest-pay-fixture-safety.cjs');

test('provider diagnostics emit only bounded categories, not raw errors or references', () => {
  const marker = 'PRIVATE-CREDENTIAL-CONTACT-CALLBACK';
  const result = summarize(500, { errorCode: '500.001.1001',
    errorMessage: `Wrong credentials ${marker}`, CheckoutRequestID: marker,
    PhoneNumber: marker, CallBackURL: marker, access_token: marker });
  assert.deepEqual(result, { status: 500, code: '500.001.1001',
    issue: 'credential_mismatch', referenceReturned: true });
  assert.ok(!JSON.stringify(result).includes(marker));
  assert.equal(summarize(400, { errorCode: marker, errorMessage: marker }).code, 'unclassified');
  assert.equal(summarize(500, { errorMessage: 'Merchant does not exist' }).issue, 'merchant_not_found');
});

test('response inspection is bounded, handles non-JSON, and preserves original body', async () => {
  const response = new Response(JSON.stringify({ errorCode: '400.002.02' }), { status: 400 });
  assert.equal((await inspectResponse(response)).code, '400.002.02');
  assert.equal((await response.json()).errorCode, '400.002.02');
  assert.equal((await inspectResponse(new Response('not JSON', { status: 502 }))).status, 502);
  assert.equal((await inspectResponse(new Response('x'.repeat(9000), { status: 400 }))).code, 'unclassified');
});

test('diagnostic reading has a deadline even when a response body never finishes', async () => {
  const response = new Response(new ReadableStream({ start() {} }), { status: 502 });
  const start = Date.now();
  assert.equal((await inspectResponse(response)).status, 502);
  assert.ok(Date.now() - start < 3000);
  await response.body.cancel();
});

test('fixture fetch observes a mocked provider response once without retrying or exposing secrets', async () => {
  const original = globalThis.fetch;
  let calls = 0;
  const events = [];
  globalThis.fetch = async () => { calls++; return new Response(
    JSON.stringify({ errorCode: '500.001.1001', errorMessage: 'Wrong credentials PRIVATE-MARKER' }),
    { status: 500 }); };
  const guard = safety.installNetworkGuard('postgresql://fixture@localhost/guestpay_fixture_1791847258000_123', 39761,
    { mpesa: true, onProviderDiagnostic: details => events.push(details) });
  try {
    const response = await fetch('https://sandbox.safaricom.co.ke/mpesa/stkpush/v1/processrequest');
    assert.equal(response.status, 500);
    assert.equal(calls, 1);
    assert.equal(events[0].family, 'mpesa_initialize');
    assert.equal(events[0].issue, 'credential_mismatch');
    assert.ok(!JSON.stringify(events).includes('PRIVATE-MARKER'));
    await response.text();
  } finally { guard.restore(); globalThis.fetch = original; }
});

test('a failing diagnostic sink cannot cause a payment retry or alter its response', async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls++; return new Response('{}', { status: 400 }); };
  const guard = safety.installNetworkGuard('postgresql://fixture@localhost/guestpay_fixture_1791847258000_123', 39761,
    { mpesa: true, onProviderDiagnostic() { throw new Error('sink unavailable'); } });
  try {
    assert.equal((await fetch('https://sandbox.safaricom.co.ke/mpesa/stkpush/v1/processrequest')).status, 400);
    assert.equal(calls, 1);
  } finally { guard.restore(); globalThis.fetch = original; }
});
