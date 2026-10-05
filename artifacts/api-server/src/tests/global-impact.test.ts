import { test, after } from "node:test";
import assert from "node:assert/strict";
import { Pool } from "pg";
import { pool } from "@workspace/db";
import { importLegacyImpact, parseLegacyImpact, saveGlobalImpact, ImpactConflict, findLegacyImpactEvidence } from "../lib/global-impact-store.js";
import express from "express";
import impact from "../routes/uc-impact.js";
import { issueToken } from "../lib/jwt.js";

const second = new Pool({ connectionString: process.env.DATABASE_URL });
after(async () => { await second.end(); });
test("missing historical evidence is distinct from zero; malformed and inaccessible evidence fail without fallback", async () => {
  assert.equal(await findLegacyImpactEvidence(["missing"], async () => { throw Object.assign(new Error("missing"), { code: "ENOENT" }); }), null);
  await assert.rejects(findLegacyImpactEvidence(["bad", "valid"], async () => "{"), /JSON/);
  await assert.rejects(findLegacyImpactEvidence(["denied", "valid"], async () => { throw Object.assign(new Error("denied"), { code: "EACCES" }); }), /denied/);
});
test("shared adjustments survive independent pools; import is audited, idempotent and cannot replace newer edits", async () => {
  await pool.query("DELETE FROM uc_global_impact_audit");
  await pool.query("DELETE FROM uc_global_impact");
  const raw = JSON.stringify({ litresOffset: 125, usersOffset: 3, lastUpdatedBy: "historical", lastUpdatedAt: "" });
  assert.throws(() => parseLegacyImpact('{"litresOffset":"bad"}'));
  assert.throws(() => parseLegacyImpact('{'));
  assert.equal(await importLegacyImpact(raw), true);
  assert.equal((await pool.query("SELECT last_updated_at FROM uc_global_impact")).rows[0].last_updated_at, null);
  assert.equal(await importLegacyImpact(raw, second), false);
  const updated = await saveGlobalImpact({ litresOffset: 500 }, "test-staff", 1, second);
  assert.equal(updated.users_offset, 3);
  assert.equal(await importLegacyImpact(raw), false);
  assert.equal((await pool.query("SELECT litres_offset FROM uc_global_impact")).rows[0].litres_offset, 500);
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM uc_global_impact_audit")).rows[0].n, 2);
});
test("concurrent stale form edits conflict, while partial legacy edits cannot lose the other field", async () => {
  const current = (await pool.query("SELECT revision FROM uc_global_impact")).rows[0].revision;
  const writes = await Promise.allSettled([
    saveGlobalImpact({ litresOffset: 600 }, "editor-a", current),
    saveGlobalImpact({ usersOffset: 7 }, "editor-b", current, second),
  ]);
  assert.equal(writes.filter(x => x.status === "fulfilled").length, 1);
  const failed = writes.find(x => x.status === "rejected") as PromiseRejectedResult;
  assert.ok(failed.reason instanceof ImpactConflict);
  await Promise.all([saveGlobalImpact({ litresOffset: 777 }, "a"), saveGlobalImpact({ usersOffset: 9 }, "b", undefined, second)]);
  const final = (await pool.query("SELECT * FROM uc_global_impact")).rows[0];
  assert.equal(final.litres_offset, 777);
  assert.equal(final.users_offset, 9);
});
test("legacy import and explicit initialization serialize without losing a newer shared edit", async () => {
  await pool.query("DELETE FROM uc_global_impact");
  const raw = JSON.stringify({ litresOffset: 125, usersOffset: 3, lastUpdatedBy: "historical", lastUpdatedAt: "" });
  const results = await Promise.allSettled([
    importLegacyImpact(raw, second),
    saveGlobalImpact({ litresOffset: 900, usersOffset: 12 }, "initializer", 0),
  ]);
  const final = (await pool.query("SELECT * FROM uc_global_impact")).rows[0];
  assert.equal(final.revision, 1);
  if (results[1].status === "fulfilled") {
    assert.equal(final.litres_offset, 900);
    assert.equal(await importLegacyImpact(raw), false);
  } else {
    assert.ok(results[1].reason instanceof ImpactConflict);
    assert.equal(final.litres_offset, 125);
  }
});
test("signed-out and different customer tokens get one comparable snapshot; adjustment changes its identity", async () => {
  process.env.SESSION_SECRET ||= "isolated-global-impact-test";
  const app = express();
  app.use((req, _res, next) => { req.log = { error() {} } as never; next(); });
  app.use("/api", impact);
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/uc/impact`;
  try {
    const snapshots = [];
    for (const id of [null, 101, 202]) {
      const headers: Record<string, string> = id ? { Authorization: `Bearer ${issueToken({ id, email: "fixture@example.invalid", name: "Fixture", exp: Math.floor(Date.now()/1000)+60 })}` } : {};
      const response = await fetch(base, { headers });
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("cache-control"), "no-store");
      snapshots.push(await response.json());
    }
    assert.equal(new Set(snapshots.map(s => s.snapshotId)).size, 1);
    assert.equal(snapshots[0].plasticsAvoided, snapshots[0].litresFiltered * 2);
    assert.equal("personalImpact" in snapshots[0], false);
    await saveGlobalImpact({ usersOffset: 10 }, "next");
    const next = await (await fetch(base)).json();
    assert.notEqual(next.snapshotId, snapshots[0].snapshotId);
    await pool.query("DELETE FROM uc_global_impact");
    const unavailable = await fetch(base);
    assert.equal(unavailable.status, 503);
    assert.equal("litresFiltered" in await unavailable.json(), false);
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
});
