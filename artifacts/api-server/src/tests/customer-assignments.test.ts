import { describe, it, before, after, mock } from "node:test";
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import http from "node:http";
import { pool } from "@workspace/db";
import { issueToken } from "../lib/jwt.js";
import { ensureCustomerAssignmentTables } from "../lib/customer-assignment-rollout.js";
import { assignedPrimaryActivation } from "../../../uc-companion/lib/assignedFilterHydration.js";
import { appCatalogueFixture } from "./helpers/app-catalogue.js";

delete process.env["WC_CONSUMER_KEY"];
delete process.env["WC_CONSUMER_SECRET"];
delete process.env["MPESA_CONSUMER_KEY"];
delete process.env["MPESA_CONSUMER_SECRET"];
process.env["SESSION_SECRET"] ??= "assignment-test-session";
const recordsDir = await mkdtemp(join(tmpdir(), "assignment-records-"));
process.env["UC_ACCOUNTS_DATA_DIR"] = recordsDir;
const { createAssignment, linkAssignment, listAssignments, assignmentAudit, reconcileAssignmentsForAccount, previewAssignment, normalizedAssignment } =
  await import("../lib/customer-assignments.js");
const { clearResolvedRegistrations } = await import("../lib/account-records.js");
const { default: app } = await import("../app.js");
const ids = { users: [] as number[], orders: [] as number[] };
const teamId = `assignment-admin-${randomUUID()}`;
let server: http.Server, base: string;
let productId: number;
let phoneSequence = 10000000;
function contacts() { return { customerName: "Assignment Test", email: `assignment-${randomUUID()}@example.test`, phone: `+2547${phoneSequence++}` }; }
async function fixture(owner = "") {
  const order = (await pool.query<{ id: number }>(`INSERT INTO uc_orders(user_id,status,total,payment_method,cod_collection_status)
    VALUES($1,'processing','3499','cod','awaiting_collection') RETURNING id`, [owner])).rows[0]!.id;
  ids.orders.push(order);
  const item = (await pool.query<{ id: number }>(
    "INSERT INTO uc_order_items(order_id,product_id,name,quantity,total) VALUES($1,$2,'Hydra Flux',1,'3499') RETURNING id", [order, productId])).rows[0]!.id;
  return { ...contacts(), idempotencyKey: randomUUID(), productId, installationDate: "2026-01-05", orderId: order, orderItemId: item };
}
async function account(contact: { email: string; phone: string }, verified = false) {
  const id = (await pool.query<{ id: number }>(`INSERT INTO uc_users(email,phone,password_hash,first_name,email_verified,phone_verified)
    VALUES($1,$2,'unused-test-hash','Assignment',$3,$3) RETURNING id`, [contact.email,contact.phone,verified])).rows[0]!.id;
  ids.users.push(id); return id;
}
async function getAssignment(id: number) { return (await listAssignments()).find(a => a.id === id)!; }
const hash = (v: string) => createHash("sha256").update(v).digest("hex");
function staffToken() { return issueToken({ id: teamId, email: `${teamId}@example.test`, type: "team-session", role: "admin" }); }
async function api(path: string, body?: unknown, token?: string) {
  const response = await fetch(`${base}/api${path}`, { method: body === undefined ? "GET" : "POST",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  return { status: response.status, body: await response.json().catch(() => null) };
}
before(async () => {
  await ensureCustomerAssignmentTables();
  productId = (await appCatalogueFixture()).id;
  await pool.query("INSERT INTO team_users(id,email,name,password_hash,role) VALUES($1,$2,'Assignment admin','unused','admin')", [teamId,`${teamId}@example.test`]);
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
after(async () => {
  await new Promise<void>((resolve, reject) => server.close(e => e ? reject(e) : resolve()));
  await pool.query("DELETE FROM uc_customer_assignment_audit WHERE assignment_id IN (SELECT id FROM uc_customer_assignments WHERE order_id=ANY($1))", [ids.orders]);
  const filterIds = (await pool.query<{ filter_id: number }>("DELETE FROM uc_customer_assignments WHERE order_id=ANY($1) RETURNING filter_id", [ids.orders])).rows.map(a => a.filter_id).filter(Boolean);
  await pool.query("DELETE FROM uc_registered_filters WHERE id=ANY($1)", [filterIds]);
  await pool.query("DELETE FROM uc_orders WHERE id=ANY($1)", [ids.orders]);
  await pool.query("DELETE FROM uc_contact_verification_tokens WHERE user_id=ANY($1)", [ids.users.map(String)]);
  await pool.query("DELETE FROM uc_users WHERE id=ANY($1)", [ids.users]);
  await pool.query("DELETE FROM team_users WHERE id=$1", [teamId]);
  await rm(recordsDir, { recursive: true, force: true });
});

describe("durable customer assignments", () => {
  it("pages and filters the admin queue without embedding audit history", async () => {
    const marker = `page-${randomUUID()}`;
    const created: number[] = [];
    for (let i = 0; i < 5; i++) {
      const input = await fixture();
      created.push(await createAssignment({ ...input, customerName: `${marker} ${i}` }, teamId));
    }
    await pool.query("UPDATE uc_customer_assignments SET status='review',review_reason='contact_conflict' WHERE id=$1", [created[0]]);
    const first = await api(`/admin/customer-assignments?q=${marker}&page=1&limit=2`, undefined, staffToken());
    const second = await api(`/admin/customer-assignments?q=${marker}&page=2&limit=2`, undefined, staffToken());
    const third = await api(`/admin/customer-assignments?q=${marker}&page=3&limit=2`, undefined, staffToken());
    assert.equal(first.status,200); assert.equal(first.body.total,5);
    assert.equal(first.body.page,1); assert.equal(first.body.limit,2);
    assert.deepEqual([...first.body.items, ...second.body.items, ...third.body.items].map(a => a.id), created.toReversed());
    assert.ok(first.body.items.every((a: Record<string, unknown>) => !("audit" in a)));
    const review = await api(`/admin/customer-assignments?q=${marker}&status=review`, undefined, staffToken());
    assert.equal(review.body.total,1); assert.equal(review.body.items[0].reviewReason,"contact_conflict");
    const pending = await api(`/admin/customer-assignments?q=${marker}&status=pending`, undefined, staffToken());
    assert.equal(pending.body.total,4); assert.equal(pending.body.items[0].cashCollectionState,"awaiting_collection");
    const row = await getAssignment(created[1]!);
    for (const q of [row.email.toUpperCase(), row.phone, `${marker} 1`]) {
      const match = await api(`/admin/customer-assignments?q=${encodeURIComponent(q)}`, undefined, staffToken());
      assert.equal(match.body.items[0].id, row.id);
    }
    const literal = await api("/admin/customer-assignments?q=%25", undefined, staffToken());
    assert.equal(literal.body.total,0);
    const empty = await api(`/admin/customer-assignments?q=${marker}&page=100`, undefined, staffToken());
    assert.equal(empty.body.total,5); assert.deepEqual(empty.body.items,[]);
    const defaults = await api("/admin/customer-assignments", undefined, staffToken());
    assert.equal(defaults.body.limit,25); assert.ok(defaults.body.items.length <= 25);
    for (const query of ["page=0","page=-1","page=1.5","page=1000001","limit=0","limit=101","status=invalid", `q=${"x".repeat(201)}`]) {
      assert.equal((await api(`/admin/customer-assignments?${query}`, undefined, staffToken())).status,400);
    }
  });
  it("reads only one customer's linked assignments with independent pagination", async () => {
    const input = await fixture(), userId = await account(input,true);
    const first = await createAssignment(input,teamId);
    const secondInput = { ...await fixture(), email:input.email, phone:input.phone };
    const second = await createAssignment(secondInput,teamId);
    await linkAssignment(first,userId,teamId,true);
    await linkAssignment(second,userId,teamId,true);
    const pending = await createAssignment({ ...await fixture(), email:input.email, phone:input.phone },teamId);
    const other = await account(contacts(),true);
    for (const [page, expected] of [[1,second],[2,first]] as const) {
      const read = await api(`/admin/customer-assignments/customer/${userId}?page=${page}&limit=1`,undefined,staffToken());
      assert.equal(read.status,200); assert.equal(read.body.total,2);
      assert.equal(read.body.items[0].id,expected); assert.equal(read.body.items[0].status,"linked");
      assert.equal(read.body.items[0].linkedAccountId,userId); assert.equal("audit" in read.body.items[0],false);
      assert.notEqual(read.body.items[0].id,pending);
    }
    const empty = await api(`/admin/customer-assignments/customer/${other}`,undefined,staffToken());
    assert.equal(empty.body.total,0); assert.deepEqual(empty.body.items,[]);
    assert.equal((await api("/admin/customer-assignments/customer/0",undefined,staffToken())).status,400);
    assert.equal((await api(`/admin/customer-assignments/customer/${userId}?limit=101`,undefined,staffToken())).status,400);
  });
  it("retains and pages every audit event with deterministic ordering and full details", async () => {
    const input = await fixture(), id = await createAssignment(input,teamId);
    await pool.query(`INSERT INTO uc_customer_assignment_audit(assignment_id,actor,action,details,created_at)
      SELECT $1,$2,'retained_event',jsonb_build_object('sequence',n),'2026-01-01'::timestamptz FROM generate_series(1,63) n`, [id,teamId]);
    const stored = (await pool.query("SELECT id FROM uc_customer_assignment_audit WHERE assignment_id=$1 ORDER BY id DESC",[id])).rows.map(a => a.id);
    const readIds: number[] = [];
    for (let page = 1; page <= 3; page++) {
      const read = await api(`/admin/customer-assignments/${id}/audit?page=${page}&limit=25`,undefined,staffToken());
      assert.equal(read.status,200); assert.equal(read.body.total,stored.length);
      assert.ok(read.body.items.length <= 25);
      readIds.push(...read.body.items.map((a: { id: number }) => a.id));
      assert.equal(read.body.items[0].actor,teamId);
    }
    assert.deepEqual(readIds,stored);
    const first = await api(`/admin/customer-assignments/${id}/audit?limit=1`,undefined,staffToken());
    assert.equal(first.body.items[0].details.sequence,63);
    await clearResolvedRegistrations();
    assert.equal((await assignmentAudit(id,1,100)).total,stored.length);
    assert.equal((await api(`/admin/customer-assignments/${id}/audit?page=0`,undefined,staffToken())).status,400);
    assert.equal((await api(`/admin/customer-assignments/${id}/audit?limit=101`,undefined,staffToken())).status,400);
    assert.equal((await api("/admin/customer-assignments/2147483647/audit",undefined,staffToken())).status,404);
  });
  it("saves before signup without a placeholder account or filter", async () => {
    const input = await fixture(), id = await createAssignment(input,teamId);
    const assignment = await getAssignment(id);
    assert.equal(assignment.status,"pending"); assert.equal(assignment.reviewReason,"awaiting_account");
    assert.equal(assignment.filterId,null); assert.equal(assignment.customerName,input.customerName);
    assert.equal((await pool.query("SELECT id FROM uc_users WHERE email=$1", [input.email])).rowCount,0);
    assert.equal(assignment.cashCollectionState,"awaiting_collection");
  });
  it("normalizes email and international phone; name is not ownership", () => {
    const parsed = normalizedAssignment({ ...contacts(), idempotencyKey: "test", email: " TEST@Example.TEST ", phone: "+254 712 345 678",
      productId: 1, orderId: 1, orderItemId: 1, installationDate: "2026-01-05" });
    assert.equal(parsed.email,"test@example.test"); assert.equal(parsed.phone,"+254712345678");
    assert.throws(() => normalizedAssignment({ ...parsed, installationDate: "2026-02-30" }));
    assert.throws(() => normalizedAssignment({ ...parsed, phone: "invalid" }));
  });
  it("signup succeeds once; unverified contacts remain pending; both verification hooks link exactly once", async () => {
    const input = await fixture(), id = await createAssignment(input,teamId);
    const registration = await api("/uc/auth/register", { email: input.email, phone: input.phone, address: "Fixture contact, Nairobi", firstName: "Assignment", password: "assignment-test-strong-password" });
    assert.equal(registration.status,200);
    const userId = Number(registration.body.user.id); ids.users.push(userId);
    await reconcileAssignmentsForAccount(userId);
    assert.equal((await getAssignment(id)).reviewReason,"awaiting_verified_contacts");
    const duplicate = await api("/uc/auth/register", { email: input.email, phone: input.phone, address: "Another address is not ownership proof", firstName: "Not Owner", password: "different-password" });
    assert.equal(duplicate.status,409);
    for (const channel of ["email","whatsapp"]) {
      const token = randomUUID();
      await pool.query(`INSERT INTO uc_contact_verification_tokens(id,user_id,channel,contact_hash,token_hash,expires_at)
        VALUES($1,$2,$3,$4,$5,now()+interval '30 minutes')`, [randomUUID(),String(userId),channel,hash(channel === "email" ? input.email : input.phone),hash(token)]);
      const response = await fetch(`${base}/api/uc/auth/verify-contact?token=${token}`);
      assert.equal(response.status,200);
    }
    assert.equal((await getAssignment(id)).status,"linked");
    const ownerRead = await api("/uc/customer/assignments",undefined,registration.body.token);
    assert.equal(ownerRead.status,200); assert.equal(ownerRead.body.some((a: { id: number }) => a.id === id),true);
    await Promise.all([reconcileAssignmentsForAccount(userId),reconcileAssignmentsForAccount(userId)]);
    assert.equal((await pool.query("SELECT id FROM uc_registered_filters WHERE user_id=$1 AND source_order_id=$2", [userId,input.orderId])).rowCount,1);
  });
  it("explicit staff confirmation links an existing unverified account, but retry alone does not", async () => {
    const input = await fixture(), userId = await account(input), id = await createAssignment({ ...input,targetAccountId:userId },teamId);
    await linkAssignment(id,userId,teamId);
    assert.equal((await getAssignment(id)).status,"pending");
    await linkAssignment(id,userId,teamId,true);
    assert.equal((await getAssignment(id)).linkedAccountId,userId);
    assert.equal((await assignmentAudit(id,1,25)).items[0].action,"staff_linked");
  });
  it("guest email COD principals associate only after trusted proof", async () => {
    const input = await fixture();
    await pool.query("UPDATE uc_orders SET user_id=$1 WHERE id=$2", [input.email,input.orderId]);
    const id = await createAssignment(input,teamId), userId = await account(input,true);
    await reconcileAssignmentsForAccount(userId);
    assert.equal((await getAssignment(id)).status,"linked");
  });
  it("does not silently transfer active-owned purchases", async () => {
    const input = await fixture(), other = await account(contacts(),true);
    await pool.query("UPDATE uc_orders SET user_id=$1 WHERE id=$2", [String(other),input.orderId]);
    await assert.rejects(() => createAssignment(input,teamId), /another account/);
    assert.equal((await pool.query("SELECT user_id FROM uc_orders WHERE id=$1",[input.orderId])).rows[0].user_id,String(other));
  });
  it("routes an ownership change after saving to review instead of transferring", async () => {
    const input = await fixture(), id = await createAssignment(input,teamId), owner = await account(contacts(),true), candidate = await account(input,true);
    await pool.query("UPDATE uc_orders SET user_id=$1 WHERE id=$2",[String(owner),input.orderId]);
    await linkAssignment(id,candidate,teamId,true);
    assert.equal((await getAssignment(id)).status,"review");
    assert.equal((await getAssignment(id)).reviewReason,"purchase_owned_by_another_account");
  });
  it("requires both matching contacts and does not claim using name or one verified contact", async () => {
    const input = await fixture(), id = await createAssignment(input,teamId), userId = await account({ email: input.email, phone: contacts().phone },true);
    await reconcileAssignmentsForAccount(userId);
    assert.equal((await getAssignment(id)).status,"review"); assert.equal((await getAssignment(id)).reviewReason,"contact_conflict");
    const otherInput = await fixture(), otherId = await createAssignment(otherInput,teamId), otherUser = await account(otherInput);
    await pool.query("UPDATE uc_users SET email_verified=true WHERE id=$1", [otherUser]);
    await linkAssignment(otherId,otherUser,teamId);
    assert.equal((await getAssignment(otherId)).reviewReason,"awaiting_verified_contacts");
  });
  it("email/phone conflicts, deleted-account ambiguity and duplicate phones require review", async () => {
    for (const kind of ["email_phone_conflict","deleted_only","ambiguous"]) {
      const input = await fixture(), id = await createAssignment(input,teamId);
      const first = await account(input,true);
      if (kind === "deleted_only") await pool.query("UPDATE uc_users SET deleted_at=now() WHERE id=$1",[first]);
      if (kind === "email_phone_conflict") {
        await pool.query("UPDATE uc_users SET phone=$1 WHERE id=$2",[contacts().phone,first]);
        await account({email:contacts().email,phone:input.phone},true);
      }
      if (kind === "ambiguous") await account({email:contacts().email,phone:input.phone},true);
      await linkAssignment(id,first,teamId);
      assert.equal((await getAssignment(id)).reviewReason,kind);
    }
  });
  it("retains deletion ambiguity after the deletion endpoint erases the former contacts", async () => {
    const input = await fixture(), oldAccount = await account(input), id = await createAssignment(input,teamId);
    const realFetch = globalThis.fetch;
    const outbound = mock.method(globalThis,"fetch",async (...args: Parameters<typeof fetch>) => {
      if (String(args[0]).startsWith(base)) return realFetch(...args);
      return new Response(JSON.stringify({id:"test-notification"}),{headers:{"Content-Type":"application/json"}});
    });
    let response: Response;
    try {
      response = await realFetch(`${base}/api/uc/customer`, { method:"DELETE", headers:{ Authorization:`Bearer ${issueToken({id:oldAccount,email:input.email,credentialVersion:0})}` } });
      await new Promise(resolve => setTimeout(resolve,100));
    } finally { outbound.mock.restore(); }
    assert.equal(response.status,200);
    const replacement = await account(input,true);
    await linkAssignment(id,replacement,teamId,true);
    assert.equal((await getAssignment(id)).reviewReason,"deleted_account_ambiguity");
    assert.equal((await getAssignment(id)).filterId,null);
  });
  it("absorbs concurrent duplicate saves and claims, and exact replay after linking", async () => {
    const input = await fixture();
    const results = await Promise.all([createAssignment(input,teamId),createAssignment(input,teamId)]);
    assert.equal(results[0],results[1]);
    const userId = await account(input,true);
    await Promise.all([linkAssignment(results[0]!,userId,teamId),linkAssignment(results[0]!,userId,teamId)]);
    assert.equal(await createAssignment(input,teamId),results[0]);
    assert.equal((await pool.query("SELECT id FROM uc_registered_filters WHERE user_id=$1", [userId])).rowCount,1);
    await assert.rejects(() => createAssignment({ ...input,customerName:"Changed customer" },teamId), /different assignment/);
  });
  it("rejects mismatched products and non-COD/refunded purchases", async () => {
    const input = await fixture();
    await assert.rejects(() => previewAssignment({ ...input,productId: 2 }), /trackable catalogue/);
    await pool.query("UPDATE uc_orders SET payment_method='paystack' WHERE id=$1",[input.orderId]);
    await assert.rejects(() => previewAssignment(input), /cash-on-delivery/);
    await pool.query("UPDATE uc_orders SET payment_method='cod',status='refunded' WHERE id=$1",[input.orderId]);
    await assert.rejects(() => previewAssignment(input), /cash-on-delivery/);
  });
  it("reuses an owned durable filter without resetting activation or maintenance history", async () => {
    const input = await fixture(), userId = await account(input,true);
    await pool.query("UPDATE uc_orders SET user_id=$1 WHERE id=$2", [String(userId),input.orderId]);
    const filterId = (await pool.query<{ id: number }>(`INSERT INTO uc_registered_filters
      (user_id,product_id,product_name,rated_capacity_litres,activated_at,source_order_id,source,maintenance_count)
      VALUES($1,$3,'Hydra Flux',150,'2025-12-01',$2,'app',8) RETURNING id`, [userId,input.orderId,productId])).rows[0]!.id;
    const id = await createAssignment({ ...input,targetAccountId:userId },teamId);
    await linkAssignment(id,userId,teamId,true);
    const row = await getAssignment(id);
    assert.equal(row.filterId,filterId); assert.equal(row.maintenanceCount,8);
    assert.equal(row.activatedAt.toISOString().slice(0,10),"2025-12-01");
  });
  it("linking leaves COD collection, rewards and impact uncredited", async () => {
    const input = await fixture(), id = await createAssignment(input,teamId), userId = await account(input,true);
    const before = (await pool.query("SELECT status,cod_collection_status,cod_collected_at,cod_collected_by,payment_confirmed_at FROM uc_orders WHERE id=$1",[input.orderId])).rows[0];
    await linkAssignment(id,userId,teamId);
    assert.deepEqual((await pool.query("SELECT status,cod_collection_status,cod_collected_at,cod_collected_by,payment_confirmed_at FROM uc_orders WHERE id=$1",[input.orderId])).rows[0],before);
    assert.equal((await pool.query("SELECT id FROM uc_water_impact_ledger WHERE registered_filter_id=$1",[(await getAssignment(id)).filterId])).rowCount,0);
    assert.equal((await pool.query("SELECT order_id FROM uc_referral_settlements WHERE order_id=$1",[input.orderId])).rowCount,0);
  });
  it("retries a transient failure without duplicating records", async () => {
    const input = await fixture(), id = await createAssignment(input,teamId), userId = await account(input,true);
    const broken = mock.method(pool,"query",async () => { throw new Error("temporary unavailable"); });
    try { await reconcileAssignmentsForAccount(userId); } finally { broken.mock.restore(); }
    assert.equal((await getAssignment(id)).status,"pending");
    await reconcileAssignmentsForAccount(userId);
    assert.equal((await getAssignment(id)).status,"linked");
  });
  it("startup rollout and additive migration are repeatable; clearing recovery logs does not erase assignments", async () => {
    const input = await fixture(), id = await createAssignment(input,teamId);
    await ensureCustomerAssignmentTables(); await ensureCustomerAssignmentTables();
    const migration = await readFile(new URL("../../../../lib/db/migrations/0058_uc_customer_assignments.sql",import.meta.url),"utf8");
    await pool.query(migration);
    const before = await getAssignment(id); await clearResolvedRegistrations();
    assert.deepEqual(await getAssignment(id),before);
  });
  it("startup rollout works on fresh and interrupted upgrades without resetting saved data", async () => {
    const client = await pool.connect(), schema = `assignment_rollout_${randomUUID().replaceAll("-","")}`;
    try {
      await client.query(`CREATE SCHEMA ${schema}; SET search_path TO ${schema}`);
      await client.query("CREATE TABLE uc_users(id integer PRIMARY KEY); CREATE TABLE uc_orders(id integer PRIMARY KEY); CREATE TABLE uc_order_items(id integer PRIMARY KEY); CREATE TABLE uc_registered_filters(id integer PRIMARY KEY)");
      await ensureCustomerAssignmentTables(client);
      await client.query("DROP TABLE uc_customer_assignment_audit; DROP INDEX uc_customer_assignments_line_unique; ALTER TABLE uc_customer_assignments DROP COLUMN woo_order_item_id");
      await ensureCustomerAssignmentTables(client);
      assert.equal((await client.query("SELECT woo_order_item_id FROM uc_customer_assignments")).rowCount,0);
      assert.equal((await client.query("SELECT id FROM uc_customer_assignment_audit")).rowCount,0);
    } finally { await client.query(`SET search_path TO public; DROP SCHEMA ${schema} CASCADE`); client.release(); }
  });
  it("all admin operations deny anonymous/member/demoted sessions and a customer read cannot leak assignments", async () => {
    const input = await fixture(), id = await createAssignment(input,teamId);
    for (const token of [undefined,issueToken({ id: "unknown-admin",email:"unknown@example.test",type:"team-session",role:"admin" })]) {
      for (const [path,body] of [
        ["/admin/customer-assignments",undefined],
        ["/admin/customer-assignments",input],
        ["/admin/customer-assignments/preview",input],
        ["/admin/customer-assignments/order-lines?q=1",undefined],
        ["/admin/customer-assignments/customer/1",undefined],
        [`/admin/customer-assignments/${id}/audit`,undefined],
        [`/admin/customer-assignments/${id}/link`,{accountId:1,confirm:true}],
        [`/admin/customer-assignments/${id}/retry`,{}],
      ] as const) assert.ok([401,403].includes((await api(path,body,token)).status));
    }
    assert.equal((await api("/admin/customer-assignments",undefined,staffToken())).status,200);
    await pool.query("UPDATE team_users SET role='member' WHERE id=$1",[teamId]);
    for (const path of ["/admin/customer-assignments","/admin/customer-assignments/customer/1",`/admin/customer-assignments/${id}/audit`])
      assert.equal((await api(path,undefined,staffToken())).status,403);
    await pool.query("UPDATE team_users SET role='admin' WHERE id=$1",[teamId]);
    const stranger = await account(contacts(),true);
    for (const path of ["/admin/customer-assignments","/admin/customer-assignments/customer/1",`/admin/customer-assignments/${id}/audit`])
      assert.equal((await api(path,undefined,issueToken({id:stranger,email:"stranger@example.test",credentialVersion:0}))).status,401);
    const read = await api("/uc/customer/assignments",undefined,issueToken({ id:stranger,email:"stranger@example.test",credentialVersion:0 }));
    assert.equal(read.status,200); assert.equal(read.body.some((a: { id: number }) => a.id === id),false);
  });
  it("keeps local primary activation/history and selects one active assignment without duplicating reminders", () => {
    const row = { id:1,status:"linked",active:true,productId:1,productName:"Hydra",activatedAt:"2026-01-05",lifespanDays:90,orderReference:"10",maintenanceCount:4 } as unknown as import("@workspace/api-client-react").CustomerFilterAssignment;
    const hydrated = assignedPrimaryActivation(null,[row],9)!;
    assert.equal(hydrated.cleanCount,9); assert.deepEqual(hydrated.notifIds,[]);
    const existing = {...hydrated,activatedAt:"2026-02-01",checkIns:[],notifIds:["existing-reminder"]};
    assert.equal(assignedPrimaryActivation(existing,[row]),existing);
    assert.equal(assignedPrimaryActivation(null,[{...row,active:false}]),null);
  });
});