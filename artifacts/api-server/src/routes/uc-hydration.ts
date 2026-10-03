import { Router, type IRouter } from "express";
import { pool } from "@workspace/db";
import { SaveUcDailyHydrationBody } from "@workspace/api-zod";
import { verifyToken } from "../lib/jwt.js";

export function validHydrationDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  if (value.startsWith("0000-")) return false;
  const parsed = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

const router: IRouter = Router();
router.all("/uc/me/hydration/:localDate", async (req, res, next) => {
  if (req.method !== "GET" && req.method !== "PUT") { next(); return; }
  const claims = verifyToken(req.headers.authorization);
  const userId = Number(claims?.id);
  if (!claims || claims.type === "team-session" || claims.mustChangePassword === true || !Number.isSafeInteger(userId) || userId <= 0) {
    res.status(401).json({ error: "Sign in to log consumption" }); return;
  }
  const localDate = req.params.localDate;
  if (!validHydrationDate(localDate)) {
    res.status(400).json({ error: "Use a valid local calendar date" }); return;
  }
  const input = req.method === "PUT" ? SaveUcDailyHydrationBody.strict().safeParse(req.body) : null;
  if (input && (!input.success || !Number.isFinite(input.data.litres))) {
    res.status(400).json({ error: "Enter a finite, nonnegative total in litres" }); return;
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // Share the account lock with deletion: no hydration writes may slip in
    // after the deletion transaction anonymises the customer.
    const account = await client.query("SELECT id, credential_version FROM uc_users WHERE id = $1 AND deleted_at IS NULL FOR UPDATE", [userId]);
    if (!account.rowCount) {
      await client.query("ROLLBACK");
      res.status(401).json({ error: "Account unavailable" }); return;
    }
    if (account.rows[0].credential_version !== (claims.credentialVersion ?? 0)) {
      await client.query("ROLLBACK");
      res.status(401).json({ error: "Session expired. Please sign in again." }); return;
    }
    if (input?.success) {
      await client.query(`INSERT INTO uc_daily_hydration (user_id, local_date, litres)
        VALUES ($1, $2, $3) ON CONFLICT (user_id, local_date)
        DO UPDATE SET litres = EXCLUDED.litres, updated_at = now()`, [userId, localDate, input.data.litres]);
    }
    const result = await client.query("SELECT litres FROM uc_daily_hydration WHERE user_id=$1 AND local_date=$2", [userId, localDate]);
    await client.query("COMMIT");
    res.json({ localDate, litres: result.rows[0]?.litres ?? null });
  } catch {
    await client.query("ROLLBACK").catch(() => {});
    res.status(500).json({ error: "Could not load or save consumption" });
  } finally { client.release(); }
});
export default router;