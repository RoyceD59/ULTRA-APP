/**
 * Tests for the notification log pruning job (runNotificationLogPruning).
 *
 * The pruning policy is unit tested against injected settings, clock, and
 * delete operations. This avoids racing the shared team_settings singleton
 * used by the separate admin-endpoint integration tests.
 */
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";

import {
  runNotificationLogPruning,
  type NotificationLogPruningDeps,
} from "../lib/scheduler.js";

interface DeleteCall {
  status: "sent" | "failed";
  cutoff: Date;
}

const NOW = new Date("2026-08-21T12:00:00.000Z");
let deleteCalls: DeleteCall[] = [];
let deleteShouldThrow = false;

function testDeps(
  environment: Readonly<Record<string, string | undefined>> = {},
): NotificationLogPruningDeps {
  return {
    environment,
    now: () => NOW,
    readRetentionSettings: async () => ({ successDays: null, failureDays: null }),
    deleteLogs: async (status, cutoff) => {
      if (deleteShouldThrow) throw new Error("DB unavailable (test)");
      deleteCalls.push({ status, cutoff });
      return { rowCount: 0 };
    },
  };
}

function daysBeforeNow(days: number): Date {
  return new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000);
}

describe("runNotificationLogPruning — notification log retention", () => {
  beforeEach(() => {
    deleteCalls = [];
    deleteShouldThrow = false;
  });

  it("issues exactly two DELETE operations — one for sent, one for failed", async () => {
    await runNotificationLogPruning(testDeps());

    assert.deepEqual(
      deleteCalls.map(call => call.status),
      ["sent", "failed"],
    );
  });

  it("uses the default 30-day successful-send cutoff", async () => {
    await runNotificationLogPruning(testDeps());

    assert.equal(deleteCalls[0]?.cutoff.getTime(), daysBeforeNow(30).getTime());
  });

  it("uses the default 90-day failed-send cutoff", async () => {
    await runNotificationLogPruning(testDeps());

    assert.equal(deleteCalls[1]?.cutoff.getTime(), daysBeforeNow(90).getTime());
  });

  it("honours UC_NOTIFICATION_LOG_SUCCESS_RETENTION_DAYS over the default", async () => {
    await runNotificationLogPruning(testDeps({
      UC_NOTIFICATION_LOG_SUCCESS_RETENTION_DAYS: "7",
    }));

    assert.equal(deleteCalls[0]?.cutoff.getTime(), daysBeforeNow(7).getTime());
    assert.equal(deleteCalls[1]?.cutoff.getTime(), daysBeforeNow(90).getTime());
  });

  it("honours UC_NOTIFICATION_LOG_FAILURE_RETENTION_DAYS over the default", async () => {
    await runNotificationLogPruning(testDeps({
      UC_NOTIFICATION_LOG_FAILURE_RETENTION_DAYS: "14",
    }));

    assert.equal(deleteCalls[0]?.cutoff.getTime(), daysBeforeNow(30).getTime());
    assert.equal(deleteCalls[1]?.cutoff.getTime(), daysBeforeNow(14).getTime());
  });

  it("rejects malformed, zero, and negative environment values", async () => {
    await runNotificationLogPruning(testDeps({
      UC_NOTIFICATION_LOG_SUCCESS_RETENTION_DAYS: "7days",
      UC_NOTIFICATION_LOG_FAILURE_RETENTION_DAYS: "-5",
    }));
    assert.equal(deleteCalls[0]?.cutoff.getTime(), daysBeforeNow(30).getTime());
    assert.equal(deleteCalls[1]?.cutoff.getTime(), daysBeforeNow(90).getTime());

    deleteCalls = [];
    await runNotificationLogPruning(testDeps({
      UC_NOTIFICATION_LOG_SUCCESS_RETENTION_DAYS: "0",
      UC_NOTIFICATION_LOG_FAILURE_RETENTION_DAYS: "1e3",
    }));
    assert.equal(deleteCalls[0]?.cutoff.getTime(), daysBeforeNow(30).getTime());
    assert.equal(deleteCalls[1]?.cutoff.getTime(), daysBeforeNow(90).getTime());
  });

  it("rejects when a delete operation fails instead of silently swallowing it", async () => {
    deleteShouldThrow = true;

    await assert.rejects(
      () => runNotificationLogPruning(testDeps()),
      /DB unavailable/,
    );
  });

  it("prefers admin-configured settings over environment values", async () => {
    const deps = testDeps({
      UC_NOTIFICATION_LOG_SUCCESS_RETENTION_DAYS: "7",
      UC_NOTIFICATION_LOG_FAILURE_RETENTION_DAYS: "14",
    });
    deps.readRetentionSettings = async () => ({ successDays: 5, failureDays: 10 });

    await runNotificationLogPruning(deps);

    assert.equal(deleteCalls[0]?.cutoff.getTime(), daysBeforeNow(5).getTime());
    assert.equal(deleteCalls[1]?.cutoff.getTime(), daysBeforeNow(10).getTime());
  });
});