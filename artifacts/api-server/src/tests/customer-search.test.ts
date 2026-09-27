/**
 * Regression coverage for GET /uc/admin/customers name and email search.
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
  ] as const;

  for (const [key, email, firstName, lastName] of rows) {
    const inserted = await pool.query<{ id: number }>(
      `INSERT INTO uc_users (email, password_hash, first_name, last_name, phone)
       VALUES ($1, 'x', $2, $3, '')
       RETURNING id`,
      [email, firstName, lastName],
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
});