import { Router, type Request, type Response } from "express";
import {
  db,
  pool,
  ucReferralCodesTable,
  ucReferralUsersTable,
} from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { requireAdmin } from "../lib/adminAuth.js";
import { verifyToken } from "../lib/jwt.js";
import { sendViaResend } from "../lib/resend.js";

const router = Router();
const DEFAULT_REFERRAL_FAILURE_ALERT_THRESHOLD = 3;

function configuredFailureThreshold(databaseValue: unknown): number {
  const value = Number(
    databaseValue ??
      process.env["REFERRAL_FAILURE_ALERT_THRESHOLD"] ??
      DEFAULT_REFERRAL_FAILURE_ALERT_THRESHOLD,
  );
  return Number.isInteger(value) && value >= 1 && value <= 100
    ? value
    : DEFAULT_REFERRAL_FAILURE_ALERT_THRESHOLD;
}

async function authenticatedTeamAdmin(
  req: Request,
  res: Response,
): Promise<{ id: string; name: string; email: string } | null> {
  if (!(await requireAdmin(req, res))) return null;
  const claims = verifyToken(req.headers["authorization"]);
  if (claims?.type !== "team-session" || typeof claims.id !== "string") {
    res.status(403).json({ error: "A ProjectHub team admin account is required" });
    return null;
  }
  const result = await pool.query<{
    id: string;
    name: string;
    email: string;
  }>(
    `SELECT id,name,email FROM team_users
     WHERE id=$1 AND role='admin' AND is_active=true LIMIT 1`,
    [claims.id],
  );
  if (!result.rows[0]) {
    res.status(401).json({ error: "Admin authentication required" });
    return null;
  }
  return result.rows[0];
}

// ─── Types ────────────────────────────────────────────────────────────────────
export interface UCPromotion {
  id: string;
  title: string;
  description: string;
  code: string;
  discountPercent: number;
  expiresAt: string; // ISO string
  active: boolean;
  createdAt: string;
}

// ─── In-memory promotions (not user data — no durability required) ────────────
// Seed a welcome promotion so the app shows something on first load
export const promotions: UCPromotion[] = [
  {
    id: "promo_launch",
    title: "Launch Special 🚀",
    description: "15% off your first order this season. Clean water starts today!",
    code: "LAUNCH15",
    discountPercent: 15,
    expiresAt: "2025-12-31T23:59:59.000Z",
    active: true,
    createdAt: new Date().toISOString(),
  },
  {
    id: "promo_summer",
    title: "Hydration Season 💧",
    description: "10% off all shower & tap filters — stay pure all season.",
    code: "HYDRATE10",
    discountPercent: 10,
    expiresAt: "2025-10-31T23:59:59.000Z",
    active: true,
    createdAt: new Date().toISOString(),
  },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────
function generateReferralCode(firstName: string, email: string): string {
  const name = firstName
    .toUpperCase()
    .replace(/[^A-Z]/g, "X")
    .slice(0, 5)
    .padEnd(4, "X");
  let hash = 5381;
  for (let i = 0; i < email.length; i++) {
    hash = ((hash << 5) + hash + email.charCodeAt(i)) | 0;
  }
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no confusing I/O/0/1
  const suffix = [
    chars[Math.abs(hash) % chars.length],
    chars[Math.abs(hash >> 5) % chars.length],
    chars[Math.abs(hash >> 10) % chars.length],
    chars[Math.abs(hash >> 15) % chars.length],
  ].join("");
  return `${name}-${suffix}`;
}

/**
 * Upsert a referral code record for the given owner.
 * Returns the existing record if one already exists for this email,
 * or creates a new one using the generated code.
 */
async function getOrCreateReferralCode(
  email: string,
  firstName: string,
  lastName: string
): Promise<typeof ucReferralCodesTable.$inferSelect> {
  const key = email.toLowerCase();
  // Fast path: existing record
  const [existing] = await db
    .select()
    .from(ucReferralCodesTable)
    .where(eq(ucReferralCodesTable.ownerEmail, key))
    .limit(1);
  if (existing) return existing;

  let code = generateReferralCode(firstName, email);
  // Collision guard: append a suffix derived from email length
  const [codeConflict] = await db
    .select({ id: ucReferralCodesTable.id })
    .from(ucReferralCodesTable)
    .where(eq(ucReferralCodesTable.code, code))
    .limit(1);
  if (codeConflict) {
    code = `${code}${Math.abs(email.length % 9) + 1}`;
  }

  const ownerName = `${firstName} ${lastName}`.trim();
  const [created] = await db
    .insert(ucReferralCodesTable)
    .values({ code, ownerEmail: key, ownerName })
    .onConflictDoUpdate({
      target: ucReferralCodesTable.ownerEmail,
      set: { ownerName },
    })
    .returning();
  return created!;
}

function decodeUserFromAuth(
  req: Request
): { email: string; firstName: string; lastName: string } | null {
  const auth = req.headers["authorization"];
  if (!auth?.startsWith("Bearer ")) return null;
  try {
    const parts = auth.slice(7).split(".");
    if (parts.length < 2) return null;
    const payload = JSON.parse(
      Buffer.from(parts[1] ?? "", "base64url").toString()
    ) as Record<string, string>;
    return {
      email: payload["email"] ?? "",
      firstName: payload["firstName"] ?? payload["name"]?.split(" ")[0] ?? "User",
      lastName: payload["lastName"] ?? payload["name"]?.split(" ").slice(1).join(" ") ?? "",
    };
  } catch {
    return null;
  }
}

// ─── Exported helpers (consumed by uc.ts for order creation) ─────────────────

/**
 * Validate a promo or referral code for a given user.
 * Returns discount info; does NOT record the conversion yet.
 */
export async function validateCodeForDiscount(
  code: string,
  userEmail: string
): Promise<{
  valid: boolean;
  type: "referral" | "promotion" | null;
  discountPercent: number;
  label: string;
}> {
  const upper = code.trim().toUpperCase();
  const email = userEmail.toLowerCase();

  // Promotions take precedence
  const now = new Date();
  const promo = promotions.find(
    (p) =>
      p.active &&
      p.code.toUpperCase() === upper &&
      new Date(p.expiresAt) > now
  );
  if (promo) {
    return {
      valid: true,
      type: "promotion",
      discountPercent: promo.discountPercent,
      label: promo.title,
    };
  }

  // Referral code — look up in DB
  const [ref] = await db
    .select()
    .from(ucReferralCodesTable)
    .where(eq(ucReferralCodesTable.code, upper))
    .limit(1);

  if (!ref) {
    return { valid: false, type: null, discountPercent: 0, label: "Invalid or expired code." };
  }
  if (ref.ownerEmail === email) {
    return { valid: false, type: null, discountPercent: 0, label: "You can't use your own referral code." };
  }

  // Check if this user has already done their first order
  const [userRow] = await db
    .select({ firstOrderDone: ucReferralUsersTable.firstOrderDone })
    .from(ucReferralUsersTable)
    .where(eq(ucReferralUsersTable.email, email))
    .limit(1);

  if (userRow?.firstOrderDone) {
    return { valid: false, type: null, discountPercent: 0, label: "Referral discount applies to first order only." };
  }

  return { valid: true, type: "referral", discountPercent: 10, label: `10% off – referred by ${ref.ownerName}` };
}

/**
 * Call after a successful order when a referral code was applied.
 * Marks the referred user's first order as done and credits the referrer.
 */
async function persistReferralConversion(
  code: string,
  userEmail: string,
  referrerCreditKes = 200,
): Promise<void> {
  const upper = code.trim().toUpperCase();
  const email = userEmail.toLowerCase();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO uc_referral_users(email,first_order_done,referred_by_code,updated_at)
       VALUES($1,true,$2,now())
       ON CONFLICT(email) DO UPDATE SET first_order_done=true,updated_at=now()`,
      [email, upper],
    );
    const result = await client.query(
      `SELECT referred_emails FROM uc_referral_codes WHERE code=$1 FOR UPDATE`,
      [upper],
    );
    if (result.rows[0]) {
      const emails: string[] = Array.isArray(result.rows[0].referred_emails)
        ? result.rows[0].referred_emails
        : [];
      if (!emails.includes(email)) {
        await client.query(
          `UPDATE uc_referral_codes SET referred_emails=$2::json,
           conversions=conversions+1,credits_earned_kes=credits_earned_kes+$3,updated_at=now()
           WHERE code=$1`,
          [upper, JSON.stringify([...emails, email]), referrerCreditKes],
        );
      }
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function recordReferralConversion(
  code: string,
  userEmail: string,
  referrerCreditKes = 200,
  orderId?: number,
): Promise<void> {
  try {
    await persistReferralConversion(code, userEmail, referrerCreditKes);
  } catch (error) {
    if (Number.isSafeInteger(orderId) && orderId! > 0) {
      await pool.query(
        `INSERT INTO uc_referral_settlements(
           order_id,referral_code,user_email,status,attempts,last_error,next_attempt_at,updated_at
         ) VALUES($1,$2,$3,'pending',1,$4,now(),now())
         ON CONFLICT(order_id) DO UPDATE SET
           referral_code=EXCLUDED.referral_code,
           user_email=EXCLUDED.user_email,
           status='pending',
           claim_token=NULL,
           claim_expires_at=NULL,
           attempts=uc_referral_settlements.attempts+1,
           last_error=EXCLUDED.last_error,
           next_attempt_at=now(),
           updated_at=now()`,
        [orderId, code.trim().toUpperCase(), userEmail.toLowerCase(), String(error).slice(0, 2000)],
      );
    }
    throw error;
  }
}

export async function retryReferralSettlements(deps: {
  afterClaim?: (rows: Array<{ id: number; claimToken: string }>) => Promise<void>;
} = {}): Promise<number> {
  const claimClient = await pool.connect();
  let due;
  try {
    await claimClient.query("BEGIN");
    due = await claimClient.query(
      `UPDATE uc_referral_settlements SET status='processing',
         claim_token=md5(random()::text||clock_timestamp()::text||id::text),
         claim_expires_at=now()+interval '5 minutes',updated_at=now()
       WHERE id IN (
         SELECT id FROM uc_referral_settlements
         WHERE (status='pending' AND next_attempt_at <= now())
            OR (status='processing' AND claim_expires_at < now())
         ORDER BY next_attempt_at FOR UPDATE SKIP LOCKED LIMIT 25
       )
       RETURNING id,referral_code,user_email,claim_token`,
    );
    await claimClient.query("COMMIT");
  } catch (error) {
    await claimClient.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    claimClient.release();
  }
  await deps.afterClaim?.(
    due.rows.map((row) => ({ id: Number(row.id), claimToken: String(row.claim_token) })),
  );
  let completed = 0;
  for (const row of due.rows) {
    try {
      await persistReferralConversion(String(row.referral_code), String(row.user_email));
      const result = await pool.query(
        `UPDATE uc_referral_settlements
         SET status='completed',claim_token=NULL,claim_expires_at=NULL,last_error=NULL,updated_at=now()
         WHERE id=$1 AND status='processing' AND claim_token=$2`,
        [row.id, row.claim_token],
      );
      if (result.rowCount === 1) completed += 1;
    } catch (error) {
      await pool.query(
        `UPDATE uc_referral_settlements SET status='pending',claim_expires_at=NULL,
         claim_token=NULL,attempts=attempts+1,last_error=$3,
         next_attempt_at=now()+LEAST(interval '1 hour',interval '15 seconds'*power(2,LEAST(attempts,8))),
         updated_at=now() WHERE id=$1 AND status='processing' AND claim_token=$2`,
        [row.id, row.claim_token, String(error).slice(0, 2000)],
      );
    }
  }
  return completed;
}

export async function processReferralSettlementAlerts(
  sendEmail: typeof sendViaResend = sendViaResend,
): Promise<number> {
  const settings = await pool.query(
    `SELECT referral_failure_alert_threshold,team_alert_email
     FROM team_settings WHERE id='singleton' LIMIT 1`,
  );
  const threshold = configuredFailureThreshold(
    settings.rows[0]?.referral_failure_alert_threshold,
  );
  const recipient = String(
    settings.rows[0]?.team_alert_email ??
      process.env["TEAM_ALERT_EMAIL"] ??
      "info@ucfilters.com",
  ).trim();
  const eligible = await pool.query(
    `UPDATE uc_referral_settlements SET alert_claimed_at=now(),updated_at=now()
     WHERE id IN (
       SELECT id FROM uc_referral_settlements
       WHERE status='pending' AND attempts >= $1 AND alerted_at IS NULL
         AND (alert_claimed_at IS NULL OR alert_claimed_at < now()-interval '5 minutes')
       ORDER BY attempts DESC,updated_at FOR UPDATE SKIP LOCKED LIMIT 25
     )
     RETURNING id,order_id,attempts,last_error`,
    [threshold],
  );
  let sent = 0;
  for (const row of eligible.rows) {
    const accepted = await sendEmail({
      from: "Ultra Clear <notifications@contacts.ucfilters.com>",
      to: recipient,
      subject: `Referral reward stuck for order #${row.order_id}`,
      text: `Referral reward settlement for order #${row.order_id} has failed ${row.attempts} times.\n\nLast error: ${row.last_error ?? "Unknown error"}`,
      idempotencyKey: `referral-settlement-alert-${row.order_id}`,
      meta: { template: "referral_settlement_failure", orderId: String(row.order_id) },
    });
    if (accepted) {
      await pool.query(
        "UPDATE uc_referral_settlements SET alerted_at=now(),alert_claimed_at=NULL,updated_at=now() WHERE id=$1 AND alerted_at IS NULL",
        [row.id],
      );
      sent += 1;
    } else {
      await pool.query(
        "UPDATE uc_referral_settlements SET alert_claimed_at=NULL,updated_at=now() WHERE id=$1 AND alerted_at IS NULL",
        [row.id],
      );
    }
  }
  return sent;
}

/**
 * Associate a new user with a referral code at registration time.
 */
export async function registerReferralAtSignup(
  userEmail: string,
  referralCode: string
): Promise<void> {
  const upper = referralCode.trim().toUpperCase();
  const email = userEmail.toLowerCase();

  // Validate the code exists before touching anything
  const [ref] = await db
    .select({ code: ucReferralCodesTable.code, referredEmails: ucReferralCodesTable.referredEmails })
    .from(ucReferralCodesTable)
    .where(eq(ucReferralCodesTable.code, upper))
    .limit(1);

  if (!ref) return;

  // Upsert user row with the referral code (do not overwrite an existing referredByCode)
  await db
    .insert(ucReferralUsersTable)
    .values({ email, referredByCode: upper })
    .onConflictDoUpdate({
      target: ucReferralUsersTable.email,
      set: {
        // Only set referredByCode if it was previously null
        referredByCode: sql`COALESCE(${ucReferralUsersTable.referredByCode}, EXCLUDED.referred_by_code)`,
        updatedAt: new Date(),
      },
    });

  // Add user to the owner's referred_emails if not already listed
  const emails: string[] = Array.isArray(ref.referredEmails) ? ref.referredEmails : [];
  if (!emails.includes(email)) {
    await db
      .update(ucReferralCodesTable)
      .set({
        referredEmails: [...emails, email],
        updatedAt:      new Date(),
      })
      .where(eq(ucReferralCodesTable.code, upper));
  }
}

/**
 * Read-only referral snapshot for the GDPR/PDPA data export (consumed by uc.ts).
 * Does NOT create a referral record if the user has none. Referred users'
 * emails are reported only as a count — they are other people's personal data.
 */
export async function getReferralExportData(userEmail: string): Promise<{
  code: string | null;
  referredCount: number;
  conversions: number;
  creditsEarnedKes: number;
  usedReferralCode: string | null;
}> {
  const email = userEmail.toLowerCase();

  const [codeRow, userRow] = await Promise.all([
    db
      .select()
      .from(ucReferralCodesTable)
      .where(eq(ucReferralCodesTable.ownerEmail, email))
      .limit(1)
      .then((rows) => rows[0] ?? null),
    db
      .select({ referredByCode: ucReferralUsersTable.referredByCode })
      .from(ucReferralUsersTable)
      .where(eq(ucReferralUsersTable.email, email))
      .limit(1)
      .then((rows) => rows[0] ?? null),
  ]);

  return {
    code:             codeRow?.code ?? null,
    referredCount:    Array.isArray(codeRow?.referredEmails) ? codeRow.referredEmails.length : 0,
    conversions:      codeRow?.conversions ?? 0,
    creditsEarnedKes: codeRow?.creditsEarnedKes ?? 0,
    usedReferralCode: userRow?.referredByCode ?? null,
  };
}

// ─── Routes ───────────────────────────────────────────────────────────────────

router.get("/uc/admin/referrals", async (req, res): Promise<void> => {
  const actor = await authenticatedTeamAdmin(req, res);
  if (!actor) return;

  const [settings, latestChange] = await Promise.all([
    pool.query(
      `SELECT referral_failure_alert_threshold
       FROM team_settings WHERE id='singleton' LIMIT 1`,
    ),
    pool.query(
      `SELECT actor_team_user_id,actor_name,actor_email,previous_value,new_value,changed_at
       FROM referral_alert_threshold_changes
       ORDER BY changed_at DESC,id DESC LIMIT 1`,
    ),
  ]);

  const referrals = await pool.query(
    `SELECT c.id,c.code,c.owner_email,c.owner_name,
       jsonb_array_length(c.referred_emails::jsonb)::int AS referred_count,
       c.conversions,c.credits_earned_kes,c.created_at,c.updated_at
     FROM uc_referral_codes c ORDER BY c.updated_at DESC LIMIT 200`,
  );
  const failures = await pool.query(
    `SELECT order_id,attempts,last_error,next_attempt_at,alerted_at,updated_at,
       count(*) OVER()::int AS total_count
     FROM uc_referral_settlements
     WHERE status='pending' AND attempts >= $1
     ORDER BY attempts DESC,updated_at DESC LIMIT 200`,
    [configuredFailureThreshold(settings.rows[0]?.referral_failure_alert_threshold)],
  );
  res.json({
    referrals: referrals.rows,
    settlementFailures: failures.rows,
    settlementFailureCount: Number(failures.rows[0]?.total_count ?? 0),
    settlementFailureThreshold: configuredFailureThreshold(
      settings.rows[0]?.referral_failure_alert_threshold,
    ),
    latestThresholdChange: latestChange.rows[0] ?? null,
  });
});

router.patch("/uc/admin/referrals/settings", async (req, res): Promise<void> => {
  const actor = await authenticatedTeamAdmin(req, res);
  if (!actor) return;

  const threshold = req.body?.failureAlertThreshold;
  if (
    typeof threshold !== "number" ||
    !Number.isInteger(threshold) ||
    threshold < 1 ||
    threshold > 100
  ) {
    res.status(400).json({
      error: "failureAlertThreshold must be a whole number from 1 to 100",
    });
    return;
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // The singleton row may not exist on the first update, so a row lock alone
    // cannot serialize writers. This transaction-scoped lock gives every audit
    // row a definitive predecessor, including concurrent first writes.
    await client.query("SELECT pg_advisory_xact_lock(617, 1)");
    const current = await client.query(
      `SELECT referral_failure_alert_threshold
       FROM team_settings WHERE id='singleton' FOR UPDATE`,
    );
    const previousValue = configuredFailureThreshold(
      current.rows[0]?.referral_failure_alert_threshold,
    );
    await client.query(
      `INSERT INTO team_settings(id,referral_failure_alert_threshold,updated_at)
       VALUES('singleton',$1,now())
       ON CONFLICT(id) DO UPDATE SET
         referral_failure_alert_threshold=EXCLUDED.referral_failure_alert_threshold,
         updated_at=now()`,
      [threshold],
    );
    const changed = await client.query(
      `INSERT INTO referral_alert_threshold_changes(
         actor_team_user_id,actor_name,actor_email,previous_value,new_value
       ) VALUES($1,$2,$3,$4,$5)
       RETURNING actor_team_user_id,actor_name,actor_email,previous_value,new_value,changed_at`,
      [actor.id, actor.name, actor.email, previousValue, threshold],
    );
    await client.query("COMMIT");
    res.json({
      failureAlertThreshold: threshold,
      latestThresholdChange: changed.rows[0],
    });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    console.error("[referrals] threshold update failed:", error);
    res.status(500).json({ error: "Could not save the referral alert threshold" });
  } finally {
    client.release();
  }
});

/** GET /api/uc/referrals/my-code — authenticated user's code + stats */
router.get("/uc/referrals/my-code", async (req: Request, res: Response): Promise<void> => {
  const u = decodeUserFromAuth(req);
  if (!u || !u.email) {
    res.status(401).json({ error: "Authenticated required" });
    return;
  }
  try {
    const [rec, userRow] = await Promise.all([
      getOrCreateReferralCode(u.email, u.firstName, u.lastName),
      db
        .select({ referredByCode: ucReferralUsersTable.referredByCode })
        .from(ucReferralUsersTable)
        .where(eq(ucReferralUsersTable.email, u.email.toLowerCase()))
        .limit(1)
        .then((rows) => rows[0] ?? null),
    ]);
    res.json({
      code:            rec.code,
      referredCount:   Array.isArray(rec.referredEmails) ? rec.referredEmails.length : 0,
      conversions:     rec.conversions,
      creditsEarnedKes: rec.creditsEarnedKes,
      usedReferralCode: userRow?.referredByCode ?? null,
      shareMessage: `Join me on Ultra Clear! Use my code ${rec.code} for 10% off your first water filter order. Download at ucfilters.com/app`,
    });
  } catch (err) {
    console.error("[referrals] my-code error:", err);
    res.status(500).json({ error: "Failed to load referral data" });
  }
});

/** POST /api/uc/referrals/validate — validate promo or referral code */
router.post("/uc/referrals/validate", async (req: Request, res: Response): Promise<void> => {
  const { code, userEmail } = req.body as { code?: string; userEmail?: string };
  if (!code) {
    res.status(400).json({ valid: false, label: "No code provided", discountPercent: 0, type: null });
    return;
  }
  try {
    res.json(await validateCodeForDiscount(code, userEmail ?? ""));
  } catch (err) {
    console.error("[referrals] validate error:", err);
    res.status(500).json({ valid: false, label: "Validation failed", discountPercent: 0, type: null });
  }
});

/** GET /api/uc/promotions — active promotions (public) */
router.get("/uc/promotions", (_req: Request, res: Response): void => {
  const now = new Date();
  res.json(promotions.filter((p) => p.active && new Date(p.expiresAt) > now));
});

/** POST /api/uc/promotions — admin: create promotion */
router.post("/uc/promotions", (req: Request, res: Response): void => {
  const adminKey = process.env["UC_ADMIN_KEY"] ?? "uc-admin-2025";
  if (req.headers["x-uc-admin-key"] !== adminKey) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  const body = req.body as {
    title?: string;
    description?: string;
    code?: string;
    discountPercent?: number;
    expiresAt?: string;
  };
  if (!body.title || !body.code || !body.discountPercent || !body.expiresAt) {
    res.status(400).json({ error: "title, code, discountPercent, and expiresAt are required" });
    return;
  }
  const promo: UCPromotion = {
    id: `promo_${Date.now()}`,
    title: body.title,
    description: body.description ?? "",
    code: body.code.toUpperCase(),
    discountPercent: Number(body.discountPercent),
    expiresAt: body.expiresAt,
    active: true,
    createdAt: new Date().toISOString(),
  };
  promotions.push(promo);
  res.status(201).json(promo);
});

/** PATCH /api/uc/promotions/:id — admin: update / toggle promotion */
router.patch("/uc/promotions/:id", (req: Request, res: Response): void => {
  const adminKey = process.env["UC_ADMIN_KEY"] ?? "uc-admin-2025";
  if (req.headers["x-uc-admin-key"] !== adminKey) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  const promo = promotions.find((p) => p.id === String(req.params["id"]));
  if (!promo) {
    res.status(404).json({ error: "Promotion not found" });
    return;
  }
  const body = req.body as Partial<UCPromotion>;
  if (typeof body.active === "boolean") promo.active = body.active;
  if (body.title) promo.title = body.title;
  if (body.description !== undefined) promo.description = body.description;
  if (body.discountPercent) promo.discountPercent = Number(body.discountPercent);
  if (body.expiresAt) promo.expiresAt = body.expiresAt;
  res.json(promo);
});

export default router;
