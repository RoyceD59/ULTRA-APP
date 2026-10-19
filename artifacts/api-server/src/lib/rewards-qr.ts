import { createHash, createHmac, randomBytes } from "node:crypto";
import { pool } from "@workspace/db";

type QrRow = { id: number; rewards_qr_hash: string | null; rewards_qr_nonce: string | null; rewards_qr_revoked_at: Date | null };
export const hashQrToken = (token: string) => createHash("sha256").update(token, "utf8").digest("hex");
function deriveToken(row: QrRow): string | null {
  if (!row.rewards_qr_nonce) return null;
  const key = process.env.SESSION_SECRET;
  if (!key) throw new Error("QR signing configuration unavailable");
  return createHmac("sha256", key).update(`uc-rewards:v2:${row.id}:${row.rewards_qr_nonce}`).digest("base64url");
}
function snapshot(row: QrRow, candidate?: string) {
  const status = row.rewards_qr_revoked_at ? "revoked" : row.rewards_qr_hash ? "active" : "missing";
  const derived = status === "active" ? deriveToken(row) : null;
  const token = derived && hashQrToken(derived) === row.rewards_qr_hash ? derived : null;
  const valid = status === "active" && !!candidate && hashQrToken(candidate) === row.rewards_qr_hash;
  // A revision is not a credential and never reveals the stored credential hash.
  const version = row.rewards_qr_hash
    ? createHash("sha256").update(`qr-version:${row.rewards_qr_hash}:${row.rewards_qr_revoked_at?.toISOString() ?? ""}`).digest("hex")
    : null;
  return { userId: row.id, status, version, valid, qrToken: token };
}

export async function inspectRewardsQr(userId: number, candidate?: string) {
  const result = await pool.query<QrRow>(
    `SELECT id,rewards_qr_hash,rewards_qr_nonce,rewards_qr_revoked_at
     FROM uc_users WHERE id=$1 AND deleted_at IS NULL`, [userId]);
  return result.rows[0] ? snapshot(result.rows[0], candidate) : null;
}

/** Explicit recovery only. Row locking makes concurrent first/recovery requests
 * converge on the already-created generation instead of invalidating each other. */
export async function recoverRewardsQr(userId: number, expectedVersion: string | null) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query<QrRow>(
      `SELECT id,rewards_qr_hash,rewards_qr_nonce,rewards_qr_revoked_at
       FROM uc_users WHERE id=$1 AND deleted_at IS NULL FOR UPDATE`, [userId]);
    const row = result.rows[0];
    if (!row) { await client.query("ROLLBACK"); return null; }
    const current = snapshot(row);
    if (current.version !== expectedVersion) {
      // Another device won recovery. Return its active code, never rotate it again.
      await client.query("COMMIT");
      return current.qrToken ? current : { ...current, conflict: true };
    }
    row.rewards_qr_nonce = randomBytes(32).toString("base64url");
    const token = deriveToken(row)!;
    row.rewards_qr_hash = hashQrToken(token);
    row.rewards_qr_revoked_at = null;
    await client.query(
      `UPDATE uc_users SET rewards_qr_hash=$2,rewards_qr_nonce=$3,rewards_qr_revoked_at=NULL
       WHERE id=$1`, [userId, row.rewards_qr_hash, row.rewards_qr_nonce]);
    await client.query("COMMIT");
    return snapshot(row);
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally { client.release(); }
}