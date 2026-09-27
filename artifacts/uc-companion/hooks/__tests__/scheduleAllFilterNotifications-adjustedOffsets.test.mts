/**
 * Regression tests: scheduleAllFilterNotifications honours stored adjustedOffsets.
 *
 * Covers:
 *   1. Local-reminder re-enable after a check-in: adjustedOffsets preserved in
 *      the stored activation and the replace30/replace15 notifications fire at the
 *      stored offsets, not at the rated-lifespan formula dates.
 *   2. Nominal scheduling (no adjustedOffsets) continues to use the formula dates.
 *
 * Why: when the user disables then re-enables local filter reminders, or when
 * syncActivationWithCatalogue reschedules after a catalogue lifespan change,
 * scheduleAllFilterNotifications is called with the stored activation as params.
 * If it ignores params.adjustedOffsets the replace30/replace15 notifications
 * revert to the rated-lifespan formula — diverging from both the check-in-
 * rescheduled phone schedule and the server dispatch.
 *
 * Run with: pnpm --filter @workspace/uc-companion test
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// @ts-ignore
import notifStub from 'expo-notifications';
// @ts-ignore
import AsyncStorageStub from '@react-native-async-storage/async-storage';

const _requests: Array<{ id: string; content: any; trigger: any }> =
  (notifStub as any)._requests;
const _resetNotifs: () => void = (notifStub as any)._reset;

const _storage: Map<string, string> = (AsyncStorageStub as any)._storage;
const _resetStorage: () => void     = (AsyncStorageStub as any)._reset;

import { scheduleAllFilterNotifications } from '../useNotifications.js';

const FILTER_ACTIVATION_KEY = 'uc_filter_activation';
const DAY = 86_400_000;

/**
 * Day offsets from activation for every scheduled notification, sorted ascending.
 * Uses the same approach as replacementReminderSchedule.test.mts.
 */
function scheduledOffsetsDays(activatedAt: string): number[] {
  const activationMs = new Date(activatedAt).getTime();
  const now = Date.now();
  return _requests
    .map(r => (now + r.trigger.seconds * 1000 - activationMs) / DAY)
    .sort((a, b) => a - b);
}

// Suppress syncReminderToServer network calls.
(globalThis as any).fetch = async () => ({ ok: true });

describe('scheduleAllFilterNotifications — adjustedOffsets', () => {
  beforeEach(() => {
    _resetNotifs();
    _resetStorage();
    (globalThis as any).fetch = async () => ({ ok: true });
  });

  it('stores adjustedOffsets in AsyncStorage after scheduling (re-enable path)', async () => {
    const offsets = { replace30: 55, replace15: 68 };
    const activatedAt = new Date(Date.now() - 20 * DAY).toISOString();

    const result = await scheduleAllFilterNotifications({
      productId:       1,
      productName:     'Hydra Flux',
      activatedAt,
      lifespanDays:    90,
      adjustedOffsets: offsets,
    });

    // The returned activation must carry the stored offsets so callers can
    // persist/sync them without re-reading AsyncStorage.
    assert.deepEqual(
      result.adjustedOffsets,
      offsets,
      'returned activation must include adjustedOffsets',
    );

    // AsyncStorage must also have them so a future re-enable reads them back.
    const stored = JSON.parse(_storage.get(FILTER_ACTIVATION_KEY) ?? 'null');
    assert.ok(stored !== null, 'activation must be written to AsyncStorage');
    assert.deepEqual(
      stored.adjustedOffsets,
      offsets,
      'AsyncStorage activation must include adjustedOffsets for the next re-enable cycle',
    );
  });

  it('fires replace30 at the stored offset, not the rated-formula date', async () => {
    // With lifespanDays=90 and 20 days elapsed the formula gives:
    //   offset4 = max(min(60, 89), ceil(20)+1) = 60
    // We store replace30=55 — the notification must fire at day 55, not 60.
    const activatedAt = new Date(Date.now() - 20 * DAY).toISOString();
    const offsets     = { replace30: 55, replace15: 68 };

    await scheduleAllFilterNotifications({
      productId:       1,
      productName:     'Hydra Flux',
      activatedAt,
      lifespanDays:    90,
      adjustedOffsets: offsets,
    });

    const offsets_days = scheduledOffsetsDays(activatedAt);
    const tol          = 0.02; // ~30-minute tolerance for test timing

    const foundReplace30 = offsets_days.some(d => Math.abs(d - offsets.replace30) < tol);
    assert.ok(
      foundReplace30,
      `replace30 must fire at stored offset ${offsets.replace30}, not the formula (60). ` +
      `Got day offsets: [${offsets_days.map(d => d.toFixed(2)).join(', ')}]`,
    );

    const foundReplace15 = offsets_days.some(d => Math.abs(d - offsets.replace15) < tol);
    assert.ok(
      foundReplace15,
      `replace15 must fire at stored offset ${offsets.replace15}, not the formula. ` +
      `Got day offsets: [${offsets_days.map(d => d.toFixed(2)).join(', ')}]`,
    );

    // The stored replace30 (55) must be present AND must differ from the formula (60).
    // Note: the day-60 performance check legitimately schedules at day 60, so we
    // cannot assert "no notification at day 60" — we assert "stored offset present" instead.
    assert.ok(
      offsets.replace30 !== 60,
      'test setup: stored replace30 must differ from the formula (60) to be meaningful',
    );
  });

  it('good check-in (borehole water, no adjustedOffsets) does NOT sync effectiveLifespanDays to server', async () => {
    // Regression: after a good check-in clears adjustedOffsets, syncReminderToServer
    // was still deriving and sending effectiveLifespanDays from water-source history.
    // For a borehole filter (factor 0.85) with 2 cleans on 90-day rated lifespan,
    // this caused the server to store eff≈63 days and dispatch replace30 at day 33
    // instead of the rated day 60 — diverging from the handset's rated schedule.
    const syncedBodies: string[] = [];
    (globalThis as any).fetch = async (_url: string, opts?: { body?: string }) => {
      if (opts?.body) syncedBodies.push(opts.body);
      return { ok: true };
    };

    // Seed the consolidated session so syncReminderToServer doesn't short-circuit.
    _storage.set('uc_auth_session', JSON.stringify({
      token: 'test-token',
      user: { id: 1, email: 'test@example.com', firstName: 'Test', lastName: 'User' },
    }));

    const activatedAt = new Date(Date.now() - 10 * DAY).toISOString();
    await scheduleAllFilterNotifications({
      productId:       1,
      productName:     'Hydra Flux',
      activatedAt,
      lifespanDays:    90,
      cleanCount:      2,
      lastWaterSource: 'borehole',
      // adjustedOffsets is intentionally absent — good check-in cleared it
    });
    // Server sync is deliberately fire-and-forget so local scheduling never
    // waits on the network. Allow the consolidated-session read to complete.
    await new Promise(resolve => setTimeout(resolve, 0));

    assert.ok(syncedBodies.length > 0, 'syncReminderToServer must fire at least one fetch');

    const syncPayload = JSON.parse(syncedBodies[syncedBodies.length - 1]!);
    const activationPayload = syncPayload?.activation ?? {};

    assert.ok(
      !('effectiveLifespanDays' in activationPayload),
      'effectiveLifespanDays must NOT be sent when adjustedOffsets is absent — ' +
      `got payload: ${JSON.stringify(activationPayload)}`,
    );
  });

  it('uses the rated-lifespan formula when no adjustedOffsets are stored', async () => {
    // With lifespanDays=90 and 20 days elapsed: offset4 = max(min(60, 89), ceil(20)+1) = 60
    const activatedAt = new Date(Date.now() - 20 * DAY).toISOString();

    await scheduleAllFilterNotifications({
      productId:    1,
      productName:  'Hydra Flux',
      activatedAt,
      lifespanDays: 90,
    });

    const offsets_days = scheduledOffsetsDays(activatedAt);
    const tol          = 0.02;

    const foundFormula = offsets_days.some(d => Math.abs(d - 60) < tol);
    assert.ok(
      foundFormula,
      `without adjustedOffsets, replace30 must use the formula offset (60). ` +
      `Got day offsets: [${offsets_days.map(d => d.toFixed(2)).join(', ')}]`,
    );
  });
});
