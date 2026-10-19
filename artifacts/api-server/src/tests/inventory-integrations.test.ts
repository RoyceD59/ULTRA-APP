import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import http from "node:http";
import { pool } from "@workspace/db";
import { issueToken } from "../lib/jwt.js";
import { isPrivateIpv4, isPrivateIpv6, getAllAddresses, validateWebhookDestination } from "../lib/ssrf-safe-fetch.js";
import { appCatalogueFixture } from "./helpers/app-catalogue.js";

// Retain the SSRF boundary even though the external stock writeback is retired.
for (const address of ["127.0.0.1", "127.255.255.255", "10.0.0.1", "10.255.255.255",
  "172.16.0.1", "172.31.255.255", "192.168.0.1", "192.168.255.255", "169.254.169.254",
  "169.254.0.1", "0.0.0.0", "0.255.255.255", "224.0.0.1", "255.255.255.255",
  "100.64.0.1", "198.18.0.1", "203.0.113.1"]) {
  test(`SSRF IPv4 rejects ${address}`, () => assert.equal(isPrivateIpv4(address), true));
}
for (const address of ["172.15.255.255", "172.32.0.1", "1.1.1.1", "8.8.8.8", "104.21.0.1"]) {
  test(`SSRF IPv4 accepts public ${address}`, () => assert.equal(isPrivateIpv4(address), false));
}
for (const address of ["::1", "fc00::1", "fd00::1", "fe80::1", "febf::1", "::ffff:127.0.0.1",
  "::", "ff02::1", "2001:db8::1", "2001:2::1", "2001:10::1"]) {
  test(`SSRF IPv6 rejects ${address}`, () => assert.equal(isPrivateIpv6(address), true));
}
for (const address of ["2606:4700:4700::1111", "2001:4860:4860::8888"]) {
  test(`SSRF public IPv6 accepts ${address}`, () => assert.equal(isPrivateIpv6(address), false));
}
for (const url of ["http://1.1.1.1/hook", "not a URL", "1.1.1.1/hook", "https://192.168.1.1/hook",
  "https://127.0.0.1/hook", "https://10.0.0.1/hook", "https://169.254.169.254/hook",
  "https://metadata.google.internal/hook", "https://localhost/hook", "https://[::1]/hook",
  "https://203.0.113.1/hook", "https://[2001:db8::1]/hook"]) {
  test(`SSRF save-time validation rejects ${url}`, async () => assert.ok(await validateWebhookDestination(url)));
}
test("SSRF public literals resolve without DNS; non-global literals never connect", async () => {
  assert.equal(await validateWebhookDestination("https://1.1.1.1/hook"), null);
  assert.equal(await validateWebhookDestination("https://[2606:4700:4700::1111]/hook"), null);
  assert.deepEqual(await getAllAddresses("1.1.1.1"), [{ address: "1.1.1.1", family: 4 }]);
  for (const address of ["127.0.0.1", "169.254.169.254", "::1", "::ffff:8.8.8.8", "fe80::1", "2001:db8::1"])
    await assert.rejects(() => getAllAddresses(address));
});

const realFetch = globalThis.fetch;
const adminId = `inventory-${randomUUID()}`, memberId = `inventory-${randomUUID()}`;
let server: http.Server, base: string, admin: string, member: string;
let product: Awaited<ReturnType<typeof appCatalogueFixture>>;
before(async () => {
  product = await appCatalogueFixture();
  for (const [id, role] of [[adminId, "admin"], [memberId, "member"]]) {
    await pool.query(`INSERT INTO team_users(id,email,name,password_hash,role,is_active)
      VALUES($1,$2,'Fixture','unused',$3,true)`, [id, `${id}@example.test`, role]);
  }
  admin = `Bearer ${issueToken({ id: adminId, type: "team-session", role: "admin" })}`;
  member = `Bearer ${issueToken({ id: memberId, type: "team-session", role: "member" })}`;
  const { default: app } = await import("../app.js");
  server = http.createServer(app);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api`;
});
after(async () => {
  await new Promise<void>(resolve => server.close(() => resolve()));
  await pool.query("DELETE FROM team_users WHERE id=ANY($1::text[])", [[adminId, memberId]]);
  await pool.query("UPDATE team_settings SET n8n_inventory_webhook_url_enc=null WHERE id='singleton'");
});
async function request(path: string, method = "GET", body?: unknown, auth?: string) {
  const response = await realFetch(`${base}${path}`, { method,
    headers: { "content-type": "application/json", ...(auth ? { authorization: auth } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  return { status: response.status, body: await response.json() as any };
}
test("app inventory requires live administration and returns actual app records", async () => {
  for (const auth of [undefined, member]) assert.equal((await request("/uc/admin/inventory", "GET", undefined, auth)).status, 403);
  const result = await request("/uc/admin/inventory", "GET", undefined, admin);
  assert.equal(result.status, 200);
  assert.ok(result.body.products.some((row: any) => row.id === product.id));
});
test("app stock edits validate quantities, persist local stock and never send retired manual alerts", async () => {
  const path = `/uc/admin/inventory/${product.id}`;
  assert.equal((await request(path, "PATCH", { stockQuantity: 5 })).status, 403);
  for (const body of [{ stockQuantity: -3 }, { stockQuantity: 1.5 }, {}]) {
    assert.equal((await request(path, "PATCH", body, admin)).status, 400);
  }
  const original = globalThis.fetch;
  let externalCalls = 0;
  globalThis.fetch = async (input) => {
    if (!String(input).includes("/.well-known/") && !String(input).includes("clerk")) externalCalls++;
    throw new Error("Outbound calls are absorbed by the fixture");
  };
  try {
    const result = await request(path, "PATCH", { stockQuantity: 0 }, admin);
    assert.equal(result.status, 200, JSON.stringify(result.body));
    const row = (await pool.query("SELECT stock_quantity,manage_stock,stock_status FROM uc_catalogue_inventory WHERE id=$1", [product.id])).rows[0];
    assert.equal(row.stock_quantity, 0); assert.equal(row.manage_stock, true);
    assert.equal(row.stock_status, "outofstock");
    assert.equal((await pool.query("SELECT * FROM uc_low_stock_alerts WHERE product_id=$1", [product.id])).rowCount, 0);
    assert.equal(externalCalls, 0);
  } finally { globalThis.fetch = original; }
});
test("external inventory sync stays retired, even for admins and with a saved webhook", async () => {
  assert.equal((await request("/uc/admin/inventory/sync", "POST", {})).status, 403);
  assert.equal((await request("/uc/admin/inventory/sync", "POST", {}, member)).status, 403);
  let externalCalls = 0;
  const original = globalThis.fetch;
  globalThis.fetch = async (input) => {
    if (!String(input).includes("/.well-known/") && !String(input).includes("clerk")) externalCalls++;
    throw new Error("Outbound calls are absorbed by the fixture");
  };
  try {
    for (const url of ["", "https://1.1.1.1/hook"]) {
      assert.equal((await request("/admin/integrations", "PATCH", { n8nInventoryWebhookUrl: url }, admin)).status, 200);
      const result = await request("/uc/admin/inventory/sync", "POST", {}, admin);
      assert.equal(result.status, 410);
      assert.match(result.body.error, /retired/i);
    }
    assert.equal(externalCalls, 0);
  } finally { globalThis.fetch = original; }
});
test("integration settings retain auth and SSRF checks without activating writeback", async () => {
  assert.equal((await request("/admin/integrations")).status, 401);
  assert.equal((await request("/admin/integrations", "GET", undefined, member)).status, 403);
  assert.equal((await request("/admin/integrations", "PATCH", { n8nInventoryWebhookUrl: "" }, member)).status, 403);
  assert.equal((await request("/admin/integrations", "GET", undefined, admin)).status, 200);
  for (const url of ["http://1.1.1.1/hook", "https://192.168.1.1/hook", "https://127.0.0.1/hook"]) {
    assert.equal((await request("/admin/integrations", "PATCH", { n8nInventoryWebhookUrl: url }, admin)).status, 400);
  }
});
