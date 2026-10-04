import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import { pool } from "@workspace/db";
import { issueToken } from "../lib/jwt.js";
import { createLibraryRouter } from "../routes/library.js";
import { loadAlisonKnowledge } from "../lib/alison-knowledge.js";
import type { ObjectStorageService } from "../lib/objectStorage.js";

const prefix = `knowledge-${randomUUID()}`;
const adminId = `${prefix}-admin`;
const memberId = `${prefix}-member`;
const docId = `${prefix}-doc`;
const privateId = `${prefix}-private`;
let bytes = Buffer.from("# Aquazetaprivate\nRinse cartridge before use.");
let missing = false;
let mime = "text/markdown";
const app = express();
app.use(express.json());
const storage = {
  async getObjectEntityFile() {
    if (missing) throw new Error("missing object");
    return {
      async getMetadata() { return [{ size: bytes.length, contentType: mime }]; },
      createReadStream() { return Readable.from([bytes]); },
      async delete() {},
    };
  },
  async getLibraryUploadURL() { throw new Error("not used"); },
  normalizeObjectEntityPath(p: string) { return p; },
  async copyLibraryFileWithGenerationCheck() { throw new Error("not used"); },
} as unknown as Pick<ObjectStorageService, "getObjectEntityFile" | "getLibraryUploadURL" | "normalizeObjectEntityPath" | "copyLibraryFileWithGenerationCheck">;
app.use("/api", createLibraryRouter(storage));
const endpoint = `/api/library/docs/${docId}/knowledge`;
const token = (id: string, role = "admin", type = "team-session") =>
  `Bearer ${issueToken({ id, email: "fixture@example.test", role, type })}`;
const auth = () => token(adminId);
const originalSecret = process.env.SESSION_SECRET;

before(async () => {
  process.env.SESSION_SECRET = "isolated-knowledge-test-secret";
  for (const [id, role] of [[adminId, "admin"], [memberId, "member"]]) {
    await pool.query(`INSERT INTO team_users (id,email,name,password_hash,role,is_active)
      VALUES ($1,$2,'Knowledge fixture','unused',$3,true)`, [id, `${id}@example.test`, role]);
  }
  for (const id of [docId, privateId]) {
    await pool.query(`INSERT INTO team_library_docs (id,title,file_name,file_size,file_type,object_path,uploaded_by)
      VALUES ($1,'INTERNAL_TITLE','private.md',$2,'text/markdown',$3,'PRIVATE_UPLOADER')`,
      [id, bytes.length, `/objects/library/${id}`]);
  }
  // Even a private row carrying text must never enter customer retrieval.
  await pool.query(`UPDATE team_library_docs SET knowledge_title='Aquazetaprivate cartridge',
    knowledge_text='UNAPPROVED_LIBRARY_RECORD' WHERE id=$1`, [privateId]);
});
after(async () => {
  await pool.query("DELETE FROM team_library_docs WHERE id=ANY($1::text[])", [[docId, privateId]]);
  await pool.query("DELETE FROM team_users WHERE id=ANY($1::text[])", [[adminId, memberId]]);
  if (originalSecret === undefined) delete process.env.SESSION_SECRET;
  else process.env.SESSION_SECRET = originalSecret;
});
async function context() {
  return loadAlisonKnowledge([{ role: "user", content: "Aquazetaprivate cartridge" }], {
    readLocal: async () => [],
    query: (sql, values) => pool.query(sql, values),
  });
}

test("only active database-backed admins can preview, approve or revoke (JWT role is not trusted)", async () => {
  await request(app).get(endpoint).expect(401);
  for (const denied of [token(memberId), token(`${prefix}-nonexistent`), token(adminId, "admin", "customer")]) {
    const status = denied === token(adminId, "admin", "customer") ? 401 : 403;
    await request(app).get(endpoint).set("Authorization", denied).expect(status);
    await request(app).post(endpoint).set("Authorization", denied).send({ action: "revoke", revision: 0 }).expect(status);
  }
  await pool.query("UPDATE team_users SET is_active=false WHERE id=$1", [adminId]);
  await request(app).get(endpoint).set("Authorization", auth()).expect(403);
  await pool.query("UPDATE team_users SET is_active=true WHERE id=$1", [adminId]);
});

test("preview alone is private; approval requires confirmation and exact bytes; revocation and deletion exclude sources", async () => {
  assert.doesNotMatch(await context(), /Rinse cartridge/);
  assert.doesNotMatch(await context(), /UNAPPROVED_LIBRARY_RECORD/);
  const preview = await request(app).get(endpoint).set("Authorization", auth()).expect(200);
  assert.equal(preview.body.status, "private");
  assert.doesNotMatch(JSON.stringify(preview.body), /objects\/|PRIVATE_UPLOADER|INTERNAL_TITLE/);
  const decision = { action: "approve", revision: 0, hash: preview.body.hash, title: "Aquazetaprivate cleaning", publicReferenceConfirmed: true };
  await request(app).post(endpoint).set("Authorization", auth()).send({ ...decision, publicReferenceConfirmed: false }).expect(400);
  await request(app).post(endpoint).set("Authorization", auth()).send({ ...decision, hash: "wrong" }).expect(409);
  const original = bytes;
  bytes = Buffer.from("Changed cartridge document.");
  await request(app).post(endpoint).set("Authorization", auth()).send(decision).expect(409);
  bytes = original;
  await request(app).post(endpoint).set("Authorization", auth()).send(decision).expect(200);
  assert.match(await context(), /Rinse cartridge before use/);
  assert.doesNotMatch(await context(), /PRIVATE_UPLOADER|INTERNAL_TITLE|objects\//);
  const listing = await request(app).get("/api/library/docs").set("Authorization", auth()).expect(200);
  assert.equal(listing.body.docs.find((d: { id: string }) => d.id === docId).knowledgeStatus, "approved");
  assert.doesNotMatch(JSON.stringify(listing.body), /knowledgeText|knowledgeHash/);
  missing = true;
  await request(app).get(endpoint).set("Authorization", auth()).expect(503);
  await request(app).post(endpoint).set("Authorization", auth()).send({ action: "revoke", revision: 1 }).expect(200);
  assert.doesNotMatch(await context(), /Rinse cartridge/);
  missing = false;
  await request(app).post(endpoint).set("Authorization", auth()).send(decision).expect(409);
  await request(app).post(endpoint).set("Authorization", auth()).send({ ...decision, revision: 2 }).expect(200);
  await request(app).delete(`/api/library/docs/${docId}`).set("Authorization", auth()).expect(200);
  assert.doesNotMatch(await context(), /Rinse cartridge/);
});

test("simultaneous approval and revocation cannot overwrite each other from the same review revision", async () => {
  const endpoint = `/api/library/docs/${privateId}/knowledge`;
  const preview = await request(app).get(endpoint).set("Authorization", auth()).expect(200);
  const results = await Promise.all([
    request(app).post(endpoint).set("Authorization", auth()).send({
      action: "approve", revision: 0, hash: preview.body.hash,
      title: "Aquazetaprivate cleaning reference", publicReferenceConfirmed: true,
    }),
    request(app).post(endpoint).set("Authorization", auth()).send({ action: "revoke", revision: 0 }),
  ]);
  assert.deepEqual(results.map(r => r.status).sort(), [200, 409]);
  const { rows: [row] } = await pool.query("SELECT knowledge_status,knowledge_revision FROM team_library_docs WHERE id=$1", [privateId]);
  assert.equal(row.knowledge_revision, 1);
  if (row.knowledge_status === "approved") {
    assert.match(await context(), /Rinse cartridge/);
    await request(app).post(endpoint).set("Authorization", auth()).send({ action: "revoke", revision: 1 }).expect(200);
  }
  assert.doesNotMatch(await context(), /Rinse cartridge/);
});

test("oversize, unsupported metadata and binary content cannot be reviewed", async () => {
  const endpoint = `/api/library/docs/${privateId}/knowledge`;
  mime = "application/pdf";
  await request(app).get(endpoint).set("Authorization", auth()).expect(422);
  mime = "text/markdown";
  bytes = Buffer.alloc(33000, "x");
  await request(app).get(endpoint).set("Authorization", auth()).expect(422);
  bytes = Buffer.from("binary\0data");
  await request(app).get(endpoint).set("Authorization", auth()).expect(422);
});