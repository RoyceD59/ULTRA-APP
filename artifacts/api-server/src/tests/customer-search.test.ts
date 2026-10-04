/**
 * Regression coverage for GET /uc/admin/customers name, email and phone search.
 *
 * Run with:
 *   TEST_GLOB='src/tests/customer-search.test.ts' pnpm test
 */
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { pool } from "@workspace/db";
import { issueToken } from "../lib/jwt.js";

type Customer = {
  id: number;
  email: string;
  firstName: string;
  lastName: string;
};

type CustomerSearchResponse = {
  customers: Customer[];
  total: number;
};

let server: http.Server;
let authorization: string;
const insertedIds: number[] = [];
const testCustomers = new Map<string, number>();

async function search(q: string): Promise<CustomerSearchResponse> {
  const address = server.address() as { port: number };
  const response = await fetch(
    `http://127.0.0.1:${address.port}/api/uc/admin/customers?q=${encodeURIComponent(q)}&limit=100`,
    { headers: { authorization } },
  );
  const body = await response.json() as CustomerSearchResponse | { error: string };
  assert.equal(response.status, 200, JSON.stringify(body));
  return body as CustomerSearchResponse;
}

function matchingTestCustomerKeys(response: CustomerSearchResponse): string[] {
  const ids = new Set(response.customers.map((customer) => customer.id));
  return [...testCustomers.entries()]
    .filter(([, id]) => ids.has(id))
    .map(([key]) => key)
    .sort();
}

before(async () => {
  process.env["SESSION_SECRET"] ??= "test-secret-for-customer-search";
  const suffix = `${Date.now()}-${process.pid}`;
  const teamId = `customer-search-admin-${suffix}`;
  const teamEmail = `customer-search-admin-${suffix}@test.internal`;

  await pool.query(
    `INSERT INTO team_users (id, email, name, password_hash, role, is_active)
     VALUES ($1, $2, 'Customer Search Admin', 'x', 'admin', true)`,
    [teamId, teamEmail],
  );

  authorization = `Bearer ${issueToken({
    id: teamId,
    email: teamEmail,
    type: "team-session",
    role: "admin",
  })}`;

  const rows = [
    ["first", `search-first-${suffix}@test.internal`, "Johnathan", "Smith"],
    ["last", `search-last-${suffix}@test.internal`, "Alice", "St John"],
    ["full", `search-full-${suffix}@test.internal`, "John", "Doe"],
    ["empty-last", `search-empty-${suffix}@test.internal`, "Johnny", ""],
    ["spaced", `search-spaced-${suffix}@test.internal`, "  John  ", "  Doe  "],
    ["email-only", `unique-email-${suffix}@test.internal`, "Unrelated", "Person"],
    ["percent-name", `percent-name-${suffix}@test.internal`, "Rate%Name", "Person"],
    ["percent-email", `literal%email-${suffix}@test.internal`, "Unrelated", "Person"],
    ["underscore-name", `underscore-name-${suffix}@test.internal`, "Under", "Score_Name"],
    ["underscore-email", `literal_email-${suffix}@test.internal`, "Unrelated", "Person"],
    ["backslash-name", `backslash-name-${suffix}@test.internal`, "Back\\Slash", "Person"],
    ["phone-only", `phone-only-${suffix}@test.internal`, "Unrelated", "Person", "+254712345678"],
    ["percent-phone", `percent-phone-${suffix}@test.internal`, "Unrelated", "Person", "phone%value"],
    ["underscore-phone", `underscore-phone-${suffix}@test.internal`, "Unrelated", "Person", "phone_value"],
  ] as const;

  for (const row of rows) {
    const [key, email, firstName, lastName] = row;
    const phone = row.length > 4 ? row[4] : "";
    const inserted = await pool.query<{ id: number }>(
      `INSERT INTO uc_users (email, password_hash, first_name, last_name, phone)
       VALUES ($1, 'x', $2, $3, $4)
       RETURNING id`,
      [email, firstName, lastName, phone],
    );
    const id = inserted.rows[0]!.id;
    insertedIds.push(id);
    testCustomers.set(key, id);
  }

  const { default: app } = await import("../app.js");
  await new Promise<void>((resolve, reject) => {
    server = app.listen(0, "127.0.0.1", (error?: Error) => error ? reject(error) : resolve());
  });
});

after(async () => {
  if (insertedIds.length > 0) {
    await pool.query("DELETE FROM uc_users WHERE id = ANY($1::int[])", [insertedIds]);
  }
  await pool.query("DELETE FROM team_users WHERE id LIKE 'customer-search-admin-%'");
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
});

describe("GET /uc/admin/customers — search", () => {
  it("matches a partial query in either first or last name", async () => {
    const response = await search("John");
    assert.deepEqual(
      matchingTestCustomerKeys(response),
      ["empty-last", "first", "full", "last", "spaced"],
    );
  });

  it("matches a full name and ignores extra whitespace", async () => {
    const ordinary = await search("John Doe");
    assert.deepEqual(matchingTestCustomerKeys(ordinary), ["full", "spaced"]);

    const irregularQuery = await search("  John    Doe  ");
    assert.deepEqual(matchingTestCustomerKeys(irregularQuery), ["full", "spaced"]);
  });

  it("finds a first-name-only customer whose last name is empty", async () => {
    const response = await search("Johnny");
    assert.deepEqual(matchingTestCustomerKeys(response), ["empty-last"]);
  });

  it("searches email independently of unrelated name fields", async () => {
    const response = await search("unique-email-");
    assert.deepEqual(matchingTestCustomerKeys(response), ["email-only"]);
  });

  it("still matches a partial phone number", async () => {
    const response = await search("712345");
    assert.deepEqual(matchingTestCustomerKeys(response), ["phone-only"]);
    assert.equal(response.total, 1);
  });

  for (const [character, keys] of [
    ["%", ["percent-email", "percent-name", "percent-phone"]],
    ["_", ["underscore-email", "underscore-name", "underscore-phone"]],
  ] as const) {
    it(`matches ${character} literally in names, emails and phones, not as a wildcard`, async () => {
      const response = await search(character);
      assert.deepEqual(matchingTestCustomerKeys(response), keys);
      assert.equal(response.total, keys.length);
    });
  }

  it("matches literal wildcard characters within partial queries", async () => {
    for (const [query, key] of [
      ["rate%na", "percent-name"],
      ["literal%email-", "percent-email"],
      ["score_na", "underscore-name"],
      ["literal_email-", "underscore-email"],
      ["phone%val", "percent-phone"],
      ["phone_val", "underscore-phone"],
    ]) {
      const response = await search(query!);
      assert.deepEqual(matchingTestCustomerKeys(response), [key], query);
      assert.equal(response.total, 1, query);
    }
  });

  it("treats backslash literally rather than as a pattern escape", async () => {
    const response = await search("Back\\Slash");
    assert.deepEqual(matchingTestCustomerKeys(response), ["backslash-name"]);
    assert.equal(response.total, 1);
  });
});