import { before, after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { Server } from "node:http";
import { pool } from "@workspace/db";
import { listOfflinePurchases, registerOfflinePurchase, reconcileOfflineProducts } from "../lib/offline-purchases.js";
import { provisionOfflineSale } from "../lib/offline-provisioning.js";
import { issueToken } from "../lib/jwt.js";
import app from "../app.js";

const catalogue = { lifespans: new Map([[1, 90]]), capacities: new Map([[1, 150]]) };
const key = randomUUID();
let owner: number, other: number, saleId: number, server: Server, base: string;
const team = `offline-purchases-${key}`;
const product = { productName: "Hydra Flux", productId: 1, quantity: 2 };
async function update(products: any[]) {
  const response = await fetch(`${base}/api/uc/offline-clients/${saleId}`, {
    method: "PUT", headers: { "Content-Type": "application/json", Authorization: `Bearer ${issueToken({ id: team, type: "team-session", role: "admin", email: `${team}@test.invalid` })}` },
    body: JSON.stringify({ products, saleDate: "2026-01-01", email: `other-${key}@test.invalid`, notes: "private staff note" }),
  });
  assert.equal(response.status, 200);
  return (await response.json()).client;
}
async function purchase() { return (await listOfflinePurchases(owner, catalogue)).purchases.find(p => p.saleId === saleId)!; }
async function unchangedFinancials() {
  const counts = (await pool.query(`SELECT
    (SELECT count(*) FROM uc_orders WHERE user_id=$1)::int AS orders,
    (SELECT count(*) FROM uc_water_impact_ledger WHERE user_id=$2)::int AS impact,
    (SELECT count(*) FROM uc_rewards_ledger WHERE user_id=$2)::int AS rewards`, [String(owner), owner])).rows[0];
  assert.deepEqual(counts, { orders: 0, impact: 0, rewards: 0 });
}
before(async () => {
  for (const name of ["WC_CONSUMER_KEY", "WC_CONSUMER_SECRET", "WC_STORE_URL"]) delete process.env[name];
  owner = (await pool.query(`INSERT INTO uc_users(email,password_hash,first_name) VALUES($1,'unused','Owner') RETURNING id`, [`owner-${key}@test.invalid`])).rows[0].id;
  other = (await pool.query(`INSERT INTO uc_users(email,password_hash,first_name) VALUES($1,'unused','Other') RETURNING id`, [`other-${key}@test.invalid`])).rows[0].id;
  await pool.query("INSERT INTO team_users(id,email,name,password_hash,role) VALUES($1,$2,'Fixture','unused','admin')", [team, `${team}@test.invalid`]);
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  base = `http://127.0.0.1:${(server.address() as any).port}`;
});
after(async () => {
  await new Promise<void>(resolve => server.close(() => resolve()));
  await pool.query("DELETE FROM uc_registered_filters WHERE user_id=ANY($1)", [[owner, other]]);
  await pool.query("DELETE FROM uc_offline_clients WHERE companion_user_id=ANY($1) OR idempotency_key=$2", [[owner, other], key]);
  await pool.query("DELETE FROM uc_users WHERE id=ANY($1)", [[owner, other]]);
  await pool.query("DELETE FROM team_users WHERE id=$1", [team]);
});
describe("offline source registration", () => {
  it("links creation to the existing account without creating financial records, and safely projects historical rows", async () => {
    const result = await provisionOfflineSale({ idempotencyKey: key, clientRef: "private ref", phone: null,
      email: `owner-${key}@test.invalid`, products: [product], saleDate: "2026-01-01", notes: "private note" });
    saleId = result.row.id;
    assert.equal(result.row.companionUserId, owner);
    assert.equal(result.row.accountSetupStatus, "linked-existing");
    const replay = await provisionOfflineSale({ idempotencyKey: key, clientRef: "", phone: null,
      email: `owner-${key}@test.invalid`, products: [product], saleDate: "2026-01-01", notes: "" });
    assert.equal(replay.row.id, saleId);
    // Legacy linked rows have no line/unit identities. The authenticated read
    // adds them once, without touching the established ownership link.
    await pool.query("UPDATE uc_offline_clients SET products=$2 WHERE id=$1", [saleId, JSON.stringify([product])]);
    const first = await purchase(), second = await purchase();
    assert.deepEqual(first, second);
    assert.equal(first.label, "Offline Sale");
    assert.equal(first.items[0].quantity, 2);
    assert.equal(first.saleDate, "2026-01-01");
    assert.equal(first.items[0].availableUnitIds.length, 2);
    assert.doesNotMatch(JSON.stringify(first), /password|delivery|email|phone|notes|private ref|private note/i);
    const response = await fetch(`${base}/api/uc/purchases/offline`, { headers: {
      Authorization: `Bearer ${issueToken({ id: String(owner), email: `owner-${key}@test.invalid`, credentialVersion: 0 })}`,
    } });
    assert.equal(response.status, 200);
    assert.doesNotMatch(JSON.stringify(await response.json()), /password|deliveryMetadata|notes|private ref|private note/i);
    assert.equal((await fetch(`${base}/api/uc/purchases/offline`)).status, 401);
    await unchangedFinancials();
  });
  it("rejects cross-account, unlinked/conflicting sources, invalid dates and unknown/custom metadata", async () => {
    const current = await purchase();
    const unitId = current.items[0].availableUnitIds[0];
    await assert.rejects(registerOfflinePurchase(other, { saleId, unitId, installationDate: "2026-01-02" }, catalogue), /not found/);
    await assert.rejects(registerOfflinePurchase(owner, { saleId, unitId, installationDate: "2026-02-30" }, catalogue), /valid installation/);
    await pool.query("UPDATE uc_offline_clients SET account_setup_status='conflict' WHERE id=$1", [saleId]);
    assert.equal((await listOfflinePurchases(owner, catalogue)).purchases.length, 0);
    await assert.rejects(registerOfflinePurchase(owner, { saleId, unitId, installationDate: "2026-01-02" }, catalogue), /not found/);
    await pool.query("UPDATE uc_offline_clients SET account_setup_status='linked-existing' WHERE id=$1", [saleId]);
    await pool.query("UPDATE uc_offline_clients SET companion_user_id=NULL WHERE id=$1", [saleId]);
    await assert.rejects(registerOfflinePurchase(owner, { saleId, unitId, installationDate: "2026-01-02" }, catalogue), /not found/);
    await pool.query("UPDATE uc_offline_clients SET companion_user_id=$2 WHERE id=$1", [saleId, owner]);
    await pool.query("UPDATE uc_users SET deleted_at=now() WHERE id=$1", [owner]);
    await assert.rejects(listOfflinePurchases(owner, catalogue), /Authentication required/);
    await assert.rejects(registerOfflinePurchase(owner, { saleId, unitId, installationDate: "2026-01-02" }, catalogue), /Authentication required/);
    await pool.query("UPDATE uc_users SET deleted_at=NULL WHERE id=$1", [owner]);
    await update([{ ...product, lineId: current.items[0].lineId }, { productName: "Custom Hydra Flux", quantity: 1 }, { productName: "Unknown catalogue", productId: 999999, quantity: 1 }]);
    const items = (await purchase()).items;
    assert.match(items[1].unavailableReason!, /Custom product/);
    assert.match(items[2].unavailableReason!, /no confirmed/);
    await assert.rejects(registerOfflinePurchase(owner, { saleId, unitId: items[1].availableUnitIds[0], installationDate: "2026-01-02" }, catalogue), /Custom product/);
    await assert.rejects(registerOfflinePurchase(owner, { saleId, unitId, installationDate: "2026-01-02" }, { lifespans: null, capacities: null }), /unavailable/);
    assert.equal((await listOfflinePurchases(other, catalogue)).purchases.length, 0, "editing contacts must not transfer an established link");
  });
  it("serializes concurrent taps and heals retries without resetting installation, capacity or maintenance", async () => {
    const unitId = (await purchase()).items[0].availableUnitIds[0];
    const input = { saleId, unitId, installationDate: "2026-01-02" };
    const results = await Promise.all(Array.from({ length: 8 }, () => registerOfflinePurchase(owner, input, catalogue)));
    assert.equal(new Set(results.map(r => r.registration.id)).size, 1);
    const id = results[0].registration.id;
    assert.equal(results[0].registration.activatedAt.slice(0, 10), "2026-01-02", "sale date is never installation");
    assert.equal(results[0].registration.sourceOrderId, null);
    await pool.query("UPDATE uc_registered_filters SET maintenance_count=3 WHERE id=$1", [id]);
    const healed = await registerOfflinePurchase(owner, { ...input, installationDate: "2026-03-01" }, { lifespans: null, capacities: null });
    assert.equal(healed.registration.id, id);
    assert.equal(healed.registration.activatedAt, results[0].registration.activatedAt);
    assert.equal(healed.registration.lifespanDays, 90);
    assert.equal(healed.registration.maintenanceCount, 3);
    assert.deepEqual((await purchase()).items[0].registeredUnits, [{ unitId, installationDate: "2026-01-02", active: true }]);
    await unchangedFinancials();
  });
  it("preserves identities on reorder/add, enforces quantity reductions, and retains history on replacement/removal/delete", async () => {
    let current = await purchase();
    const filterLine = current.items[0], remainingUnit = filterLine.availableUnitIds[0];
    const oldProducts = (await pool.query("SELECT products FROM uc_offline_clients WHERE id=$1", [saleId])).rows[0].products;
    await update([oldProducts[2], oldProducts[0], oldProducts[1], { productName: "Added custom", quantity: 1 }]);
    current = await purchase();
    assert.equal(current.items[1].lineId, filterLine.lineId);
    assert.equal(current.items[1].availableUnitIds[0], remainingUnit);
    await update([{ ...oldProducts[0], quantity: 1 }]);
    assert.equal((await purchase()).items[0].availableUnitIds.length, 0);
    await assert.rejects(registerOfflinePurchase(owner, { saleId, unitId: remainingUnit, installationDate: "2026-01-02" }, catalogue), /units.*registered/);
    await update([{ ...oldProducts[0], quantity: 2 }]);
    await registerOfflinePurchase(owner, { saleId, unitId: remainingUnit, installationDate: "2026-01-03" }, catalogue);
    assert.equal((await purchase()).items[0].availableUnitIds.length, 0);
    await update([{ ...oldProducts[0], productId: 999999, productName: "Different product" }]);
    const changed = await purchase();
    assert.notEqual(changed.items[0].lineId, filterLine.lineId);
    assert.equal((await pool.query("SELECT id FROM uc_registered_filters WHERE offline_sale_id=$1", [saleId])).rowCount, 2);
    const response = await fetch(`${base}/api/uc/offline-clients/${saleId}`, { method: "DELETE",
      headers: { Authorization: `Bearer ${issueToken({ id: team, type: "team-session", role: "admin", email: `${team}@test.invalid` })}` } });
    assert.equal(response.status, 200);
    assert.equal((await listOfflinePurchases(owner, catalogue)).purchases.length, 0);
    const history = (await pool.query("SELECT maintenance_count FROM uc_registered_filters WHERE offline_sale_id=$1 ORDER BY id", [saleId])).rows;
    assert.deepEqual(history.map(r => r.maintenance_count), [3, 0]);
    await unchangedFinancials();
  });
  it("never uses positional identity or accepts supplied unit IDs for new/changed products", () => {
    const before = reconcileOfflineProducts([product, { productName: "Custom", quantity: 1 }]);
    const reordered = reconcileOfflineProducts([before[1], before[0]], before);
    assert.deepEqual(reordered.map(p => p.lineId), [before[1].lineId, before[0].lineId]);
    const changed = reconcileOfflineProducts([{ ...before[0], productId: 2, unitIds: ["forged"] }], before);
    assert.notEqual(changed[0].lineId, before[0].lineId);
    assert.ok(!changed[0].unitIds!.includes("forged"));
  });
});