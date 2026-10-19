/**
 * Route-level coverage for customer SMS metadata.
 *
 * These tests exercise the real order and ticket routes, stub Africa's Talking,
 * and intercept only uc_notification_log inserts. This catches route wiring
 * regressions that direct sendSms tests cannot detect.
 */
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import bcryptjs from "bcryptjs";
import { eq, inArray } from "drizzle-orm";

import app from "../app.js";
import { issueToken } from "../lib/jwt.js";
import {
  db,
  ucNotificationLogTable,
  ucOrderItemsTable,
  ucOrdersTable,
  ucTicketsTable,
  ucUsersTable,
  ucWaterTestsTable,
} from "@workspace/db";

type NotificationRow = Record<string, unknown>;

let server: http.Server;
let baseUrl = "";
let realFetch: typeof globalThis.fetch;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let realInsert: any;
let capturedNotifications: NotificationRow[] = [];
const createdUserIds: number[] = [];
const createdOrderIds: number[] = [];
const createdTicketIds: string[] = [];
const createdWaterTestIds: string[] = [];

const savedEnv = {
  AT_API_KEY: process.env["AT_API_KEY"],
  AT_USERNAME: process.env["AT_USERNAME"],
  WC_CONSUMER_KEY: process.env["WC_CONSUMER_KEY"],
  WC_CONSUMER_SECRET: process.env["WC_CONSUMER_SECRET"],
  WC_BASE_URL: process.env["WC_BASE_URL"],
  PAYSTACK_SECRET_KEY: process.env["PAYSTACK_SECRET_KEY"],
};

function restoreEnv(name: keyof typeof savedEnv): void {
  const value = savedEnv[name];
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

function bearerFor(userId: number, email: string): string {
  return `Bearer ${issueToken({ id: userId, email, firstName: "Route", lastName: "Test" })}`;
}

async function createUser(suffix: string, phone: string): Promise<{ id: number; email: string }> {
  const email = `sms-route-${suffix}-${Date.now()}@uctest.internal`;
  const [user] = await realInsert(ucUsersTable)
    .values({
      email,
      passwordHash: await bcryptjs.hash("not-a-real-password", 1),
      firstName: "Route",
      lastName: "Test",
      phone,
      address: "Test building, Nairobi",
    })
    .returning({ id: ucUsersTable.id });
  assert.ok(user);
  createdUserIds.push(user.id);
  return { id: user.id, email };
}

async function post(
  path: string,
  body: unknown,
  authorization: string,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await realFetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: authorization },
    body: JSON.stringify(body),
  });
  return {
    status: response.status,
    body: await response.json() as Record<string, unknown>,
  };
}

async function waitForNotification(template: string, maxMs = 4_000): Promise<NotificationRow> {
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    const row = capturedNotifications.find(candidate =>
      candidate["channel"] === "sms" && candidate["template"] === template
    );
    if (row) return row;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  assert.fail(
    `Expected ${template} notification within ${maxMs}ms; captured ${JSON.stringify(capturedNotifications)}`,
  );
}

before(async () => {
  process.env["SESSION_SECRET"] ??= "test-secret-sms-route-metadata";
  process.env["AT_API_KEY"] = "test-at-key";
  process.env["AT_USERNAME"] = "sandbox";

  realFetch = globalThis.fetch;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  realInsert = (db as any).insert.bind(db);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (db as any).insert = (table: unknown) => {
    if (table === ucNotificationLogTable) {
      return {
        values: (row: NotificationRow) => {
          capturedNotifications.push(row);
          return { catch: () => undefined };
        },
      };
    }
    return realInsert(table);
  };

  await new Promise<void>((resolve, reject) => {
    server = app.listen(0, "127.0.0.1", (error?: Error) => {
      if (error) return reject(error);
      const address = server.address();
      if (!address || typeof address === "string") return reject(new Error("No server address"));
      baseUrl = `http://127.0.0.1:${address.port}/api`;
      resolve();
    });
  });
});

after(async () => {
  globalThis.fetch = realFetch;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (db as any).insert = realInsert;
  for (const name of Object.keys(savedEnv) as Array<keyof typeof savedEnv>) restoreEnv(name);

  if (createdTicketIds.length) {
    await db.delete(ucTicketsTable).where(inArray(ucTicketsTable.id, createdTicketIds)).catch(() => {});
  }
  if (createdWaterTestIds.length) {
    await db.delete(ucWaterTestsTable).where(inArray(ucWaterTestsTable.id, createdWaterTestIds)).catch(() => {});
  }
  if (createdOrderIds.length) {
    await db.delete(ucOrderItemsTable).where(inArray(ucOrderItemsTable.orderId, createdOrderIds)).catch(() => {});
    await db.delete(ucOrdersTable).where(inArray(ucOrdersTable.id, createdOrderIds)).catch(() => {});
  }
  if (createdUserIds.length) {
    await db.delete(ucUsersTable).where(inArray(ucUsersTable.id, createdUserIds)).catch(() => {});
  }
  await new Promise<void>(resolve => server.close(() => resolve()));
});

describe("route handlers pass customer SMS metadata end-to-end", () => {
  it("WooCommerce-created order logs its template, order ID, and E.164 recipient", async () => {
    capturedNotifications = [];
    const user = await createUser("order", "+254712345678");
    const wcOrderId = 987654;

    process.env["WC_CONSUMER_KEY"] = "test-wc-key";
    process.env["WC_CONSUMER_SECRET"] = "test-wc-secret";
    process.env["WC_BASE_URL"] = "https://wc.sms-route.test";
    delete process.env["PAYSTACK_SECRET_KEY"];

    globalThis.fetch = async (input, init) => {
      const url = String(input);
      if (url.includes("/products")) return new Response(JSON.stringify([{id:1,name:"Hydra Flux",price:"3499",stock_status:"instock",status:"publish"}]));
      if (url.includes("wc.sms-route.test") && url.includes("/orders") && init?.method === "POST") {
        return new Response(JSON.stringify({
          id: wcOrderId,
          status: "processing",
          date_created: new Date().toISOString(),
          total: "3499",
          currency: "KES",
          payment_method: "paystack",
          shipping: {},
          line_items: [{ product_id: 1, name: "Hydra Flux", quantity: 1, total: "3499" }],
          meta_data: [],
        }), { status: 201 });
      }
      if (url.includes("wc.sms-route.test") && url.includes("/orders")) {
        return new Response("[]", { status: 200 });
      }
      if (url.includes("africastalking.com")) {
        return new Response(JSON.stringify({ SMSMessageData: { Recipients: [] } }), { status: 200 });
      }
      return new Response(JSON.stringify({ id: "stubbed" }), { status: 200 });
    };

    const result = await post("/uc/orders", {
      lineItems: [{ productId: 1, quantity: 1 }],
      paymentMethod: "paystack",
       paymentReference: `SMS_ROUTE_${Date.now()}`,
       idempotencyKey: `sms-route-order-${Date.now()}`,
      shippingAddress: {
        firstName: "Route",
        lastName: "Test",
        address1: "1 Test Street",
        city: "Nairobi",
         phone: "+254712345678",
      },
    }, bearerFor(user.id, user.email));

    assert.equal(result.status, 200, JSON.stringify(result.body));

    const row = await waitForNotification("order_confirmation");
    assert.equal(row["template"], "order_confirmation");
    assert.equal(row["orderId"], wcOrderId);
    assert.equal(row["recipient"], "+254712345678");

    const anchors = await db.select({ id: ucOrdersTable.id })
      .from(ucOrdersTable)
      .where(eq(ucOrdersTable.userId, String(user.id)));
    createdOrderIds.push(...anchors.map(anchor => anchor.id));
  });

  it("ticket creation logs its template, response ticket ID, and E.164 recipient", async () => {
    capturedNotifications = [];
    const user = await createUser("ticket", "0722 000 111");

    globalThis.fetch = async (input) => {
      if (String(input).includes("africastalking.com")) {
        return new Response(JSON.stringify({ SMSMessageData: { Recipients: [] } }), { status: 200 });
      }
      return new Response(JSON.stringify({ id: "stubbed" }), { status: 200 });
    };

    const result = await post("/uc/tickets", {
      productModel: "Sweet Home",
      issueDescription: "Route metadata integration test",
      preferredContactTime: "Morning",
      photos: [],
      videos: [],
    }, bearerFor(user.id, user.email));

    assert.equal(result.status, 201, JSON.stringify(result.body));
    const ticketId = result.body["id"];
    assert.ok(typeof ticketId === "string" && ticketId.startsWith("TKT-"));
    createdTicketIds.push(ticketId);

    const row = await waitForNotification("ticket_confirmation");
    assert.equal(row["template"], "ticket_confirmation");
    assert.equal(row["ticketId"], ticketId);
    assert.equal(row["recipient"], "+254722000111");
  });

  it("water-test creation logs its template, response test ID, and E.164 recipient", async () => {
    capturedNotifications = [];
    const user = await createUser("water-test", "0733 000 222");

    globalThis.fetch = async (input) => {
      if (String(input).includes("africastalking.com")) {
        return new Response(JSON.stringify({ SMSMessageData: { Recipients: [] } }), { status: 200 });
      }
      return new Response(JSON.stringify({ id: "stubbed" }), { status: 200 });
    };

    const result = await post("/uc/water-tests", {
      name: "Water Route",
      address: "10 Clean Water Avenue, Nairobi",
       phone: "+254700123456",
      waterSource: "Borehole",
      concerns: "Taste",
      photos: [],
      videos: [],
    }, bearerFor(user.id, user.email));

    assert.equal(result.status, 201, JSON.stringify(result.body));
    const testId = result.body["id"];
    assert.ok(typeof testId === "string" && testId.startsWith("WT-"));
    createdWaterTestIds.push(testId);

    const row = await waitForNotification("water_test_confirmation");
    assert.equal(row["template"], "water_test_confirmation");
    assert.equal(row["testId"], testId);
    assert.equal(row["recipient"], "+254700123456");
  });
});