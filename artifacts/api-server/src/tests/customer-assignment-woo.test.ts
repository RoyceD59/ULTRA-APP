import { it, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { pool } from "@workspace/db";

process.env["WC_CONSUMER_KEY"] = "fixture-consumer-key";
process.env["WC_CONSUMER_SECRET"] = "fixture-consumer-secret";
const realFetch = globalThis.fetch;
const { assignmentOrderLines, createAssignment, linkAssignment, listAssignments } = await import("../lib/customer-assignments.js");
const remoteId = 90987341, productId = 908734;
const contact = { customerName: "Woo Assignment Fixture", email: `woo-assignment-${randomUUID()}@example.test`, phone: "+254798734321" };
let unavailable = false, userId: number, otherId: number, assignmentId: number, localId: number;
const remote: Record<string, unknown> = {
  id: remoteId, customer_id: 0, payment_method: "cod", status: "processing",
  total: "1000", currency: "KES", date_created_gmt: "2026-01-05T12:00:00",
  billing: { email: contact.email }, line_items: [{ id: 99881, product_id: productId, name: "Catalogue fixture", quantity: 1, total: "1000" }],
};
before(async () => {
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    const path = new URL(String(url)).pathname;
    if (unavailable) return new Response("down", { status:503 });
    if (path.endsWith("/orders")) return new Response(JSON.stringify([remote]), { headers:{ "Content-Type":"application/json" } });
    if (path.endsWith("/products")) return new Response(JSON.stringify([{
      id: productId,name:"Catalogue fixture",lifespanDays:90,filterCapacityLitres:500,
    }]),{ headers:{ "Content-Type":"application/json" } });
    return realFetch(url,init);
  }) as typeof fetch;
  userId = (await pool.query<{id:number}>(`INSERT INTO uc_users(email,phone,password_hash,first_name,email_verified,phone_verified)
    VALUES($1,$2,'unused','Fixture',true,true) RETURNING id`,[contact.email,contact.phone])).rows[0]!.id;
  otherId = (await pool.query<{id:number}>("INSERT INTO uc_users(email,phone,password_hash,first_name) VALUES($1,'+254798734322','unused','Fixture') RETURNING id",[`${randomUUID()}@example.test`])).rows[0]!.id;
});
after(async () => {
  globalThis.fetch = realFetch;
  const filters = (await pool.query<{filter_id:number}>("SELECT filter_id FROM uc_customer_assignments WHERE order_id=$1",[localId])).rows.map(a=>a.filter_id).filter(Boolean);
  await pool.query("DELETE FROM uc_customer_assignment_audit WHERE assignment_id IN (SELECT id FROM uc_customer_assignments WHERE order_id=$1)",[localId]);
  await pool.query("DELETE FROM uc_customer_assignments WHERE order_id=$1",[localId]);
  await pool.query("DELETE FROM uc_registered_filters WHERE id=ANY($1)",[filters]);
  await pool.query("DELETE FROM uc_orders WHERE id=$1",[localId]);
  await pool.query("DELETE FROM uc_users WHERE id=ANY($1)",[[userId,otherId]]);
});
it("mirrors one genuine existing Woo COD sale once without inferring cash collection",async () => {
  const [first,second] = await Promise.all([assignmentOrderLines(`woo:${remoteId}`),assignmentOrderLines(`woo:${remoteId}`)]);
  assert.equal(first.length,1); assert.equal(first[0].orderItemId,second[0].orderItemId);
  localId = first[0].orderId;
  assert.equal(first[0].cashCollectionState,null);
  assert.equal((await pool.query("SELECT id FROM uc_orders WHERE wc_order_id=$1",[remoteId])).rowCount,1);
  assignmentId = await createAssignment({ ...contact,idempotencyKey:randomUUID(),productId,installationDate:"2026-01-05",orderId:localId,orderItemId:first[0].orderItemId,targetAccountId:userId },"fixture-staff");
  assert.equal((await pool.query("SELECT woo_order_item_id FROM uc_customer_assignments WHERE id=$1",[assignmentId])).rows[0].woo_order_item_id,99881);
});
it("unavailable Woo source keeps assignment pending and can be retried",async () => {
  unavailable = true;
  await linkAssignment(assignmentId,userId,"fixture-staff",true);
  assert.equal((await listAssignments()).find(a=>a.id===assignmentId)!.reviewReason,"source_unavailable_retryable");
  unavailable = false;
});
it("rejects a changed Woo line identity and Woo account ownership instead of transferring",async () => {
  remote["line_items"] = [{ id:99882,product_id:productId,name:"Catalogue fixture",quantity:1,total:"1000" }];
  await linkAssignment(assignmentId,userId,"fixture-staff",true);
  assert.equal((await listAssignments()).find(a=>a.id===assignmentId)!.reviewReason,"source_order_line_changed");
  remote["line_items"] = [{ id:99881,product_id:productId,name:"Catalogue fixture",quantity:1,total:"1000" }];
  remote["customer_id"] = 343;
  remote["billing"] = { email: (await pool.query("SELECT email FROM uc_users WHERE id=$1",[otherId])).rows[0].email };
  await linkAssignment(assignmentId,userId,"fixture-staff",true);
  assert.equal((await listAssignments()).find(a=>a.id===assignmentId)!.reviewReason,"woo_purchase_owner_conflict");
  remote["customer_id"] = 0; remote["billing"] = {email:contact.email};
});
it("retries the same assignment to one durable filter without paid/impact writes",async () => {
  await linkAssignment(assignmentId,userId,"fixture-staff",true);
  await linkAssignment(assignmentId,userId,"fixture-staff",true);
  const assignment = (await listAssignments()).find(a=>a.id===assignmentId)!;
  assert.equal(assignment.status,"linked"); assert.equal(assignment.cashCollectionState,"unknown");
  assert.equal((await pool.query("SELECT id FROM uc_registered_filters WHERE user_id=$1",[userId])).rowCount,1);
  assert.equal((await pool.query("SELECT payment_confirmed_at,cod_collected_at FROM uc_orders WHERE id=$1",[localId])).rows[0].payment_confirmed_at,null);
});