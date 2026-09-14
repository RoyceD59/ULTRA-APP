import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import http from "node:http";
import { after, before, test } from "node:test";
import { db, ucLocationsTable, ucUsersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { issueToken } from "../lib/jwt.js";

let server: http.Server;
let adminId: number;
const locationId = randomUUID();
const email = `location-coordinate-admin-${locationId}@uctest.internal`;

before(async () => {
  process.env["SESSION_SECRET"] ??= "test-secret-location-coordinate-validation";
  const [admin] = await db.insert(ucUsersTable).values({
    email,
    passwordHash: "test-hash-not-real",
    firstName: "Location",
    lastName: "Admin",
    isAdmin: true,
  }).returning({ id: ucUsersTable.id });
  if (!admin) throw new Error("Failed to create location admin");
  adminId = admin.id;

  await db.insert(ucLocationsTable).values({
    id: locationId,
    type: "vendor",
    name: "Coordinate Validation Vendor",
    vendorName: "Coordinate Validation Ltd",
    address: "Nairobi",
    latitude: "-1.286",
    longitude: "36.817",
    hours: "Mon–Sat 08:00–18:00",
    active: true,
    verified: true,
    verifiedBy: email,
    verifiedAt: new Date(),
    createdBy: email,
  });

  const { default: app } = await import("../app.js");
  await new Promise<void>((resolve, reject) => {
    server = app.listen(0, "127.0.0.1", (error?: Error) =>
      error ? reject(error) : resolve(),
    );
  });
});

after(async () => {
  await db.delete(ucLocationsTable).where(eq(ucLocationsTable.id, locationId));
  await db.delete(ucUsersTable).where(eq(ucUsersTable.id, adminId));
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
});

async function patchCoordinate(body: Record<string, unknown>) {
  const address = server.address() as { port: number };
  const token = issueToken({
    id: adminId,
    email,
    firstName: "Location",
    lastName: "Admin",
  });
  const response = await fetch(
    `http://localhost:${address.port}/api/uc/admin/locations/${locationId}`,
    {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    },
  );
  return response.status;
}

test("location PATCH rejects non-finite coordinates without persisting them", async () => {
  assert.equal(await patchCoordinate({ latitude: "Infinity" }), 400);
  assert.equal(await patchCoordinate({ longitude: "NaN" }), 400);

  const [location] = await db.select({
    latitude: ucLocationsTable.latitude,
    longitude: ucLocationsTable.longitude,
    verified: ucLocationsTable.verified,
  }).from(ucLocationsTable).where(eq(ucLocationsTable.id, locationId)).limit(1);

  assert.equal(Number(location?.latitude), -1.286);
  assert.equal(Number(location?.longitude), 36.817);
  assert.equal(location?.verified, true);
});

test("location PATCH accepts activation-only updates and rejects empty bodies", async () => {
  assert.equal(await patchCoordinate({ active: false }), 200);
  const [deactivated] = await db.select({
    active: ucLocationsTable.active,
    verified: ucLocationsTable.verified,
  }).from(ucLocationsTable).where(eq(ucLocationsTable.id, locationId)).limit(1);
  assert.equal(deactivated?.active, false);
  assert.equal(deactivated?.verified, true);
  assert.equal(await patchCoordinate({}), 400);
});