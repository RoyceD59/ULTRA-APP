/**
 * Exercise the nightly job's real DELETE predicates against PostgreSQL.
 * Run through `pnpm test` so all connections use the isolated test database.
 */
import assert from "node:assert/strict";
import { after, it } from "node:test";
import { db, pool, ucNotificationLogTable } from "@workspace/db";
import { sql } from "drizzle-orm";
import { runNotificationLogPruning } from "../lib/scheduler.js";

after(async () => {
  await pool.end();
});

it("nightly notification pruning deletes only expired sent/failed rows, preserving exact boundaries and other statuses", async (t) => {
  const now = new Date("2026-10-04T03:00:00.000Z");
  const day = 24 * 60 * 60 * 1000;
  const successCutoff = now.getTime() - 30 * day;
  const failureCutoff = now.getTime() - 90 * day;
  const fixtures = [
    { template: "sent-old", status: "sent", sentAt: new Date(now.getTime() - 120 * day), keep: false },
    { template: "sent-before-cutoff", status: "sent", sentAt: new Date(successCutoff - 1), keep: false },
    { template: "sent-at-cutoff", status: "sent", sentAt: new Date(successCutoff), keep: true },
    { template: "sent-after-cutoff", status: "sent", sentAt: new Date(successCutoff + 1), keep: true },
    { template: "sent-recent", status: "sent", sentAt: new Date(now.getTime() - day), keep: true },
    { template: "failed-old", status: "failed", sentAt: new Date(now.getTime() - 120 * day), keep: false },
    { template: "failed-before-cutoff", status: "failed", sentAt: new Date(failureCutoff - 1), keep: false },
    { template: "failed-at-cutoff", status: "failed", sentAt: new Date(failureCutoff), keep: true },
    { template: "failed-after-cutoff", status: "failed", sentAt: new Date(failureCutoff + 1), keep: true },
    { template: "failed-between-windows", status: "failed", sentAt: new Date(now.getTime() - 60 * day), keep: true },
    { template: "failed-recent", status: "failed", sentAt: new Date(now.getTime() - day), keep: true },
    { template: "pending-old", status: "pending", sentAt: new Date(now.getTime() - 365 * day), keep: true },
    { template: "unknown-old", status: "unknown", sentAt: new Date(now.getTime() - 365 * day), keep: true },
    { template: "empty-status-old", status: "", sentAt: new Date(now.getTime() - 365 * day), keep: true },
  ];
  const rollback = new Error("Rollback notification pruning fixtures");

  await assert.rejects(db.transaction(async (tx) => {
    // Shadow only this table on this connection. Other suites in the same test
    // database cannot see these fixtures or lose rows to the global prune.
    await tx.execute(sql`
      CREATE TEMP TABLE uc_notification_log
      (LIKE public.uc_notification_log INCLUDING DEFAULTS) ON COMMIT DROP
    `);
    await tx.execute(sql`SET LOCAL search_path TO pg_temp, public`);
    await tx.insert(ucNotificationLogTable).values(fixtures.map(({ keep: _keep, ...row }) => ({
      ...row,
      channel: "email",
      recipient: "nightly-pruning@example.invalid",
    })));

    const readRows = () => tx
      .select({ id: ucNotificationLogTable.id, template: ucNotificationLogTable.template })
      .from(ucNotificationLogTable)
      .orderBy(ucNotificationLogTable.id);
    const seeded = await readRows();
    assert.equal(seeded.length, fixtures.length, "all fixtures must exist before pruning");

    // Keep the production DELETE implementation and predicates unchanged;
    // only route its queries onto the transaction's isolated connection.
    const deleteMock = t.mock.method(db, "delete", tx.delete.bind(tx));
    const deps = {
      now: () => now,
      environment: {},
      readRetentionSettings: async () => ({ successDays: null, failureDays: null }),
    };
    try {
      assert.deepEqual(await runNotificationLogPruning(deps), {
        deletedSuccess: 2,
        deletedFailure: 2,
      });

      const expected = seeded.filter((row) =>
        fixtures.find((fixture) => fixture.template === row.template)!.keep,
      );
      assert.deepEqual(await readRows(), expected,
        "only expired sent/failed IDs disappear; exact cutoffs and other statuses survive");

      assert.deepEqual(await runNotificationLogPruning(deps), {
        deletedSuccess: 0,
        deletedFailure: 0,
      }, "running again at the same time must not delete any retained rows");
      assert.deepEqual(await readRows(), expected);
    } finally {
      deleteMock.mock.restore();
    }
    throw rollback;
  }), (err: unknown) => err === rollback);
});