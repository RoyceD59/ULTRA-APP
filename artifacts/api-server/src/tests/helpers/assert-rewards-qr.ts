import assert from "node:assert/strict";
import type { Express } from "express";
import supertest from "supertest";

/** Exercise a real provider-issued Companion bearer through the QR API. */
export async function assertRewardsQrIdentity(app: Express, token: string, expectedId: number) {
  const candidate = await supertest(app).post("/api/uc/customer/rewards/qr/validate")
    .set("Authorization", `Bearer ${token}`).send({ qrToken: null });
  assert.equal(candidate.status, 200);
  assert.equal(candidate.body.userId, expectedId);
  const issued = await supertest(app).post("/api/uc/customer/rewards/qr/rotate")
    .set("Authorization", `Bearer ${token}`).send({ expectedVersion: candidate.body.version });
  assert.equal(issued.status, 200);
  assert.equal(issued.body.userId, expectedId);
  assert.match(issued.body.qrToken, /^[A-Za-z0-9_-]{43}$/);
  const validated = await supertest(app).post("/api/uc/customer/rewards/qr/validate")
    .set("Authorization", `Bearer ${token}`).send({ qrToken: issued.body.qrToken });
  assert.equal(validated.body.valid, true);
  assert.equal(validated.body.userId, expectedId);
}