import { Router, type Request, type Response } from "express";

const router = Router();

// ─── Types ────────────────────────────────────────────────────────────────────
interface ReferralRecord {
  code: string;
  ownerEmail: string;
  ownerName: string;
  referredEmails: string[];
  conversions: number;
  creditsEarnedKes: number;
}

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

// ─── In-memory stores ─────────────────────────────────────────────────────────
const referralByCode = new Map<string, ReferralRecord>();
const referralByEmail = new Map<string, string>(); // email → code
const userReferredBy = new Map<string, string>(); // email → referralCode used at signup
const userFirstOrderDone = new Map<string, boolean>(); // email → hasCompletedFirstOrder

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

function getOrCreateReferral(
  email: string,
  firstName: string,
  lastName: string
): ReferralRecord {
  const key = email.toLowerCase();
  const existingCode = referralByEmail.get(key);
  if (existingCode) {
    const rec = referralByCode.get(existingCode);
    if (rec) return rec;
  }
  let code = generateReferralCode(firstName, email);
  // Collision guard
  if (referralByCode.has(code)) code = `${code}${Math.abs(email.length % 9) + 1}`;
  const rec: ReferralRecord = {
    code,
    ownerEmail: key,
    ownerName: `${firstName} ${lastName}`.trim(),
    referredEmails: [],
    conversions: 0,
    creditsEarnedKes: 0,
  };
  referralByCode.set(code, rec);
  referralByEmail.set(key, code);
  return rec;
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
export function validateCodeForDiscount(
  code: string,
  userEmail: string
): {
  valid: boolean;
  type: "referral" | "promotion" | null;
  discountPercent: number;
  label: string;
} {
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

  // Referral code
  const ref = referralByCode.get(upper);
  if (!ref) {
    return { valid: false, type: null, discountPercent: 0, label: "Invalid or expired code." };
  }
  if (ref.ownerEmail === email) {
    return { valid: false, type: null, discountPercent: 0, label: "You can't use your own referral code." };
  }
  if (userFirstOrderDone.get(email)) {
    return { valid: false, type: null, discountPercent: 0, label: "Referral discount applies to first order only." };
  }
  return { valid: true, type: "referral", discountPercent: 10, label: `10% off – referred by ${ref.ownerName}` };
}

/**
 * Call after a successful order when a referral code was applied.
 * Marks the referred user's first order as done and credits the referrer.
 */
export function recordReferralConversion(
  code: string,
  userEmail: string,
  referrerCreditKes = 200
): void {
  const upper = code.trim().toUpperCase();
  const email = userEmail.toLowerCase();
  const ref = referralByCode.get(upper);
  if (ref) {
    if (!ref.referredEmails.includes(email)) ref.referredEmails.push(email);
    ref.conversions += 1;
    ref.creditsEarnedKes += referrerCreditKes;
  }
  userFirstOrderDone.set(email, true);
  if (!userReferredBy.has(email)) userReferredBy.set(email, upper);
}

/**
 * Associate a new user with a referral code at registration time.
 */
export function registerReferralAtSignup(userEmail: string, referralCode: string): void {
  const upper = referralCode.trim().toUpperCase();
  const ref = referralByCode.get(upper);
  const email = userEmail.toLowerCase();
  if (ref && !userReferredBy.has(email)) {
    userReferredBy.set(email, upper);
    if (!ref.referredEmails.includes(email)) {
      ref.referredEmails.push(email);
    }
  }
}

/**
 * Read-only referral snapshot for the GDPR/PDPA data export (consumed by uc.ts).
 * Does NOT create a referral record if the user has none. Referred users'
 * emails are reported only as a count — they are other people's personal data.
 */
export function getReferralExportData(userEmail: string): {
  code: string | null;
  referredCount: number;
  conversions: number;
  creditsEarnedKes: number;
  usedReferralCode: string | null;
} {
  const email = userEmail.toLowerCase();
  const code = referralByEmail.get(email);
  const rec = code ? referralByCode.get(code) : undefined;
  return {
    code: rec?.code ?? null,
    referredCount: rec?.referredEmails.length ?? 0,
    conversions: rec?.conversions ?? 0,
    creditsEarnedKes: rec?.creditsEarnedKes ?? 0,
    usedReferralCode: userReferredBy.get(email) ?? null,
  };
}

// ─── Routes ───────────────────────────────────────────────────────────────────

/** GET /api/uc/referrals/my-code — authenticated user's code + stats */
router.get("/uc/referrals/my-code", (req: Request, res: Response): void => {
  const u = decodeUserFromAuth(req);
  if (!u || !u.email) {
    res.status(401).json({ error: "Authenticated required" });
    return;
  }
  const rec = getOrCreateReferral(u.email, u.firstName, u.lastName);
  const usedCode = userReferredBy.get(u.email.toLowerCase());
  res.json({
    code: rec.code,
    referredCount: rec.referredEmails.length,
    conversions: rec.conversions,
    creditsEarnedKes: rec.creditsEarnedKes,
    usedReferralCode: usedCode ?? null,
    shareMessage: `Join me on Ultra Clear! Use my code ${rec.code} for 10% off your first water filter order. Download at ucfilters.com/app`,
  });
});

/** POST /api/uc/referrals/validate — validate promo or referral code */
router.post("/uc/referrals/validate", (req: Request, res: Response): void => {
  const { code, userEmail } = req.body as { code?: string; userEmail?: string };
  if (!code) {
    res.status(400).json({ valid: false, label: "No code provided", discountPercent: 0, type: null });
    return;
  }
  res.json(validateCodeForDiscount(code, userEmail ?? ""));
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
