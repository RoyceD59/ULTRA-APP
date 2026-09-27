/**
 * Unit tests for the ReminderOptInSheet pre-fill logic
 * (hooks/reminderPreFill.ts — applyReminderPreFill).
 *
 * The function is extracted from ReminderOptInSheet's useEffect so it can be
 * exercised here without a React rendering harness or a real device.
 *
 * Covers:
 *   A. Loading spinner appears synchronously before the network call resolves.
 *   B. Happy path: email=true, sms=false, whatsapp=true → Email and WhatsApp
 *      rows render ON; SMS row remains OFF.
 *   C. Error path: rejected promise → all three rows render OFF (safe fallback).
 *   D. Cancelled call (component hidden/unmounted): state setters are never
 *      called after isCancelled() returns true.
 *
 * Run with: pnpm --filter @workspace/uc-companion test
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { applyReminderPreFill, ALL_OFF, type ChannelState } from '../reminderPreFill.js';
import type { ServerNotifPrefs } from '../useApi.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

/** A deferred promise whose resolve/reject are callable from outside. */
function deferred<T>(): {
  promise: Promise<T>;
  resolve: (v: T) => void;
  reject: (e: unknown) => void;
} {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

/** Build a ServerNotifPrefs fixture (optOutOrders is not used by the pre-fill). */
function makePrefs(overrides: Partial<ServerNotifPrefs> = {}): ServerNotifPrefs {
  return {
    optOutOrders:     false,
    reminderEmail:    false,
    reminderSms:      false,
    reminderWhatsapp: false,
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('applyReminderPreFill — loading spinner', () => {
  /**
   * A: setLoading(true) must be called synchronously before any awaited work.
   * The spinner must appear the instant the sheet becomes visible, not after
   * the network round-trip.
   */
  it('A: sets loading=true synchronously before the promise resolves', async () => {
    const { promise, resolve } = deferred<ServerNotifPrefs>();

    let loading = false;
    let channels: ChannelState = { ...ALL_OFF };

    // Start the pre-fill but do NOT await it yet.
    const run = applyReminderPreFill(
      () => promise,
      v  => { loading = v; },
      c  => { channels = c; },
      () => false,
    );

    // setLoading(true) is called synchronously before the first `await` inside
    // applyReminderPreFill, so it must already be true here.
    assert.equal(loading, true,
      'spinner must be ON immediately — before the network call resolves');

    // Settle the promise so the run doesn't leave a dangling rejection.
    resolve(makePrefs());
    await run;

    // Spinner must clear after completion.
    assert.equal(loading, false,
      'spinner must be OFF after the fetch completes');
  });
});

describe('applyReminderPreFill — happy path', () => {
  /**
   * B: When the server returns email=true, sms=false, whatsapp=true the
   * channels state must reflect those exact values so the Email and WhatsApp
   * toggle rows render ON and the SMS row renders OFF.
   */
  it('B: email=true, sms=false, whatsapp=true → Email and WhatsApp ON; SMS OFF', async () => {
    const serverPrefs = makePrefs({
      reminderEmail:    true,
      reminderSms:      false,
      reminderWhatsapp: true,
    });

    let loading = false;
    let channels: ChannelState = { ...ALL_OFF };

    await applyReminderPreFill(
      () => Promise.resolve(serverPrefs),
      v  => { loading = v; },
      c  => { channels = c; },
      () => false,
    );

    assert.equal(channels.reminderEmail,    true,
      'Email row must be ON when server returns reminderEmail=true');
    assert.equal(channels.reminderSms,      false,
      'SMS row must be OFF when server returns reminderSms=false');
    assert.equal(channels.reminderWhatsapp, true,
      'WhatsApp row must be ON when server returns reminderWhatsapp=true');

    // Spinner must have cleared.
    assert.equal(loading, false, 'loading must be false after a successful fetch');
  });
});

describe('applyReminderPreFill — error fallback', () => {
  /**
   * C: When getServerNotifPrefs rejects (network error, 401, etc.) the
   * function must fall back to ALL_OFF so the sheet is still usable and the
   * user can opt in manually.  No channels should silently remain from a
   * previous render.
   */
  it('C: rejected promise → all three channel toggles render OFF', async () => {
    let loading = false;
    let channels: ChannelState = {
      // Seed with non-zero state to confirm the fallback actively resets them.
      reminderEmail:    true,
      reminderSms:      true,
      reminderWhatsapp: true,
    };

    await applyReminderPreFill(
      () => Promise.reject(new Error('network error')),
      v  => { loading = v; },
      c  => { channels = c; },
      () => false,
    );

    assert.equal(channels.reminderEmail,    false,
      'Email row must be OFF after a fetch failure');
    assert.equal(channels.reminderSms,      false,
      'SMS row must be OFF after a fetch failure');
    assert.equal(channels.reminderWhatsapp, false,
      'WhatsApp row must be OFF after a fetch failure');

    // Spinner must have cleared even after an error.
    assert.equal(loading, false, 'loading must be false after a failed fetch');
  });
});

describe('applyReminderPreFill — cancellation', () => {
  /**
   * D: If the sheet is hidden (visible→false) while the fetch is in flight,
   * isCancelled() returns true and setChannels / setLoading must not be called
   * after that point.  This prevents a setState-on-unmounted-component warning
   * and avoids stale prefs leaking into a subsequent sheet open.
   */
  it('D: cancelled mid-flight — setChannels and final setLoading are skipped', async () => {
    let cancelled = false;
    const { promise, resolve } = deferred<ServerNotifPrefs>();

    let loadingCallCount = 0;
    let channelCallCount = 0;

    const run = applyReminderPreFill(
      () => promise,
      _v => { loadingCallCount++; },
      _c => { channelCallCount++; },
      ()  => cancelled,
    );

    // The first setLoading(true) call (synchronous) already happened.
    assert.equal(loadingCallCount, 1, 'setLoading(true) must fire once before cancel');

    // Component unmounts / sheet hides while the request is still in flight.
    cancelled = true;

    // Resolve the request — but the cancelled guard must swallow the result.
    resolve(makePrefs({ reminderEmail: true, reminderWhatsapp: true }));
    await run;

    // setChannels must never have been called.
    assert.equal(channelCallCount, 0,
      'setChannels must not be called after cancellation');

    // setLoading(false) in the finally block must also be suppressed.
    assert.equal(loadingCallCount, 1,
      'setLoading(false) must not be called after cancellation');
  });
});
