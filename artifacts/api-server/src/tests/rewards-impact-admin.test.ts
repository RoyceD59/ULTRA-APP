import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import bcrypt from "bcryptjs";
import app from "../app.js";
import { db, ucUsersTable, ucRegisteredFiltersTable, ucWaterImpactLedgerTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { issueToken } from "../lib/jwt.js";

let server: http.Server, base: string, adminId: number, zeroId: number, deletedId: number, filterId: number;
let email: string;
async function call(path: string, init: RequestInit) {
  const response = await fetch(`${base}${path}`, init);
  return { status: response.status, body: await response.json() as any };
}
const auth = () => ({ Authorization: `Bearer ${issueToken({ id: adminId, email, firstName: "Admin", lastName: "Impact" })}` });

describe("staff impact aggregation", () => {
  before(async () => {
    process.env.SESSION_SECRET ??= "impact-test-secret";
    const suffix = Date.now();
    const hash = await bcrypt.hash("Test1234!", 4);
    const [admin] = await db.insert(ucUsersTable).values({ email: `impact-admin-${suffix}@test.invalid`, passwordHash: hash, firstName: "Admin", lastName: "Impact", isAdmin: true }).returning();
    const [zero] = await db.insert(ucUsersTable).values({ email: `impact-zero-${suffix}@test.invalid`, passwordHash: hash, firstName: "Zero", lastName: "Impact" }).returning();
    const [deleted] = await db.insert(ucUsersTable).values({ email: `impact-deleted-${suffix}@test.invalid`, passwordHash: hash, firstName: "Deleted", lastName: "Impact", deletedAt: new Date() }).returning();
    adminId = admin!.id; zeroId = zero!.id; deletedId = deleted!.id; email = admin!.email;
    const [filter] = await db.insert(ucRegisteredFiltersTable).values({ userId: zeroId, productId: 99001, productName: "Impact filter", ratedCapacityLitres: 1000, activatedAt: new Date(), source: "legacy" }).returning();
    filterId = filter!.id;
    server = http.createServer(app); await new Promise<void>((resolve) => server.listen(0, resolve));
    const addr = server.address() as { port: number }; base = `http://127.0.0.1:${addr.port}/api`;
  });
  after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await db.delete(ucWaterImpactLedgerTable).where(eq(ucWaterImpactLedgerTable.registeredFilterId, filterId));
    await db.delete(ucRegisteredFiltersTable).where(eq(ucRegisteredFiltersTable.id, filterId));
    for (const id of [adminId, zeroId, deletedId]) await db.delete(ucUsersTable).where(eq(ucUsersTable.id, id));
  });
  it("includes zero-impact active users, excludes deleted users, and keeps staff entries idempotent", async () => {
    let result = await call("/uc/admin/rewards/impact?search=impact-zero", { headers: auth() });
    assert.equal(result.status, 200);
    assert.ok(result.body.customers.some((row: any) => row.id === zeroId && Number(row.total_litres) === 0));
    result = await call("/uc/admin/rewards/impact?search=impact-deleted", { headers: auth() });
    assert.equal(result.body.customers.some((row: any) => row.id === deletedId), false);
    const body = { lookup: `impact-zero-${email.match(/-(\d+)@/)![1]}@test.invalid`, registeredFilterId: filterId, litres: 100, reason: "staff refill", idempotencyKey: "impact-repeat-key" };
    const first = await call("/uc/admin/rewards/impact", { method: "POST", headers: { ...auth(), "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const repeat = await call("/uc/admin/rewards/impact", { method: "POST", headers: { ...auth(), "Content-Type": "application/json" }, body: JSON.stringify(body) });
    assert.equal(first.status, 201); assert.equal(repeat.status, 200);
    const detail = await call(`/uc/admin/rewards/impact/${zeroId}`, { headers: auth() });
    assert.equal(detail.body.impact.totalLitres, 100);
    const entries = await db.select().from(ucWaterImpactLedgerTable).where(eq(ucWaterImpactLedgerTable.idempotencyKey, "impact-repeat-key"));
    assert.equal(entries.length, 1);
  });
});