import { Router, type Request, type Response } from "express";
import {
  db,
  ucReferralCodesTable,
  ucReferralUsersTable,
} from "@workspace/db";
import { eq, sql } from "drizzle-orm";

const router = Router();

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
export async function recordReferralConversion(
  code: string,
  userEmail: string,
  referrerCreditKes = 200
): Promise<void> {
  const upper = code.trim().toUpperCase();
  const email = userEmail.toLowerCase();

  // Upsert user row — mark first order as done
  await db
    .insert(ucReferralUsersTable)
    .values({ email, firstOrderDone: true, referredByCode: upper })
    .onConflictDoUpdate({
      target: ucReferralUsersTable.email,
      set: {
        firstOrderDone: true,
        updatedAt: new Date(),
      },
    });

  // Credit the referrer and add the user to referred_emails if not already there
  const [ref] = await db
    .select()
    .from(ucReferralCodesTable)
    .where(eq(ucReferralCodesTable.code, upper))
    .limit(1);

  if (ref) {
    const emails: string[] = Array.isArray(ref.referredEmails) ? ref.referredEmails : [];
    const alreadyRecorded = emails.includes(email);
    const newEmails = alreadyRecorded ? emails : [...emails, email];
    await db
      .update(ucReferralCodesTable)
      .set({
        referredEmails:   newEmails,
        conversions:      sql`${ucReferralCodesTable.conversions} + 1`,
        creditsEarnedKes: sql`${ucReferralCodesTable.creditsEarnedKes} + ${referrerCreditKes}`,
        updatedAt:        new Date(),
      })
      .where(eq(ucReferralCodesTable.code, upper));
  }
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
