/**
 * ProjectHub auth routes — individual email/password accounts with roles.
 *
 * Public routes:
 *   POST /auth/login              — email + password → JWT
 *   POST /auth/register           — invite token + name + password → JWT
 *   POST /auth/forgot-password    — send reset links (always 200)
 *   POST /auth/reset-password     — token + new password
 *   POST /auth/token              — legacy passcode → JWT (kept for WhatsApp)
 *
 * Authenticated (any role):
 *   GET  /auth/me                 — current user profile
 *   POST /auth/change-password    — change own password
 *   POST /auth/change-passcode    — legacy (kept for WhatsApp)
 *
 * Admin-only:
 *   GET  /auth/users              — list all team users
 *   POST /auth/invitations        — invite a user by email
 *   PATCH /auth/users/:id/role    — promote / demote
 *   PATCH /auth/users/:id         — update name / active status / permissions
 *   POST /auth/users/:id/reset-password — generate + email reset link
 */

import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import { timingSafeEqual, randomUUID } from "crypto";
import bcrypt from "bcryptjs";
import { issueToken, verifyToken } from "../lib/jwt.js";
import { db, teamSettingsTable, teamUsersTable, teamInvitationsTable, passwordResetTokensTable, ucNotificationLogTable } from "@workspace/db";
import { eq, and, gt, isNull, desc, inArray } from "drizzle-orm";
import { sendViaResend, getResendDeliveryEvent, type ResendDeliveryEvent } from "../lib/resend.js";
import { sendWhatsAppMessage } from "../lib/whatsapp.js";
import { sendSlackTeamMessage } from "../lib/slack.js";
import { logger } from "../lib/logger.js";
import { authLimiter } from "../lib/rate-limiters.js";

const router: IRouter = Router();

// ─── Types ────────────────────────────────────────────────────────────────────

interface AuthRequest extends Request {
  teamUser?: { id: string; email: string; name: string; role: "admin" | "member" };
}

type UserPublic = {
  id: string;
  email: string;
  name: string;
  role: "admin" | "member";
  isActive: boolean;
  permissions: Record<string, string> | null;
  createdAt: Date;
};

const RECOVERY_EMAIL_TEMPLATES = {
  invitation: "projecthub_invitation",
  passwordReset: "projecthub_password_reset",
} as const;

type RecoveryEmailType = keyof typeof RECOVERY_EMAIL_TEMPLATES;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function projecthubBaseUrl(): string {
  if (process.env["PROJECTHUB_URL"]) return process.env["PROJECTHUB_URL"].replace(/\/$/, "");
  const domain = process.env["REPLIT_DEV_DOMAIN"];
  // ProjectHub is mounted at the root path ("/"), not at "/projecthub".
  return domain ? `https://${domain}` : "http://localhost:3000";
}

// Password reset links are also delivered to the team WhatsApp number for
// visibility. Overridable via TEAM_RESET_WHATSAPP.
const RESET_WHATSAPP_NUMBER =
  process.env["TEAM_RESET_WHATSAPP"] || "+13022448888";

/**
 * Send a password-reset link to the team WhatsApp channel.
 * Returns false (without throwing) when the WhatsApp session is not
 * connected — the token remains valid, and an admin can still generate a
 * link from the Team page.
 */
async function deliverResetLinkViaWhatsApp(
  resetUrl: string,
  accountEmail: string
): Promise<boolean> {
  try {
    await sendWhatsAppMessage(
      RESET_WHATSAPP_NUMBER,
      `🔐 ProjectHub password reset requested for ${accountEmail}.\n\n` +
        `Reset link (valid 24 hours):\n${resetUrl}\n\n` +
        `If nobody on the team requested this, ignore this message.`
    );
    return true;
  } catch (err) {
    logger.warn(
      { err, accountEmail },
      "Password reset WhatsApp delivery failed — token still valid"
    );
    return false;
  }
}

function issueTeamToken(user: { id: string; email: string; name: string; role: string }): string {
  const exp = Math.floor(Date.now() / 1000) + 8 * 60 * 60;
  return issueToken({ id: user.id, email: user.email, name: user.name, type: "team-session", role: user.role, exp });
}

function userPublic(u: {
  id: string; email: string; name: string; role: string;
  isActive: boolean; permissions?: Record<string, string> | null; createdAt: Date;
}): UserPublic {
  return {
    id: u.id, email: u.email, name: u.name,
    role: u.role as "admin" | "member", isActive: u.isActive,
    permissions: u.permissions ?? null, createdAt: u.createdAt,
  };
}

// ─── Middleware ───────────────────────────────────────────────────────────────

/**
 * Requires a valid "team-session" JWT.
 * Re-exported for use in other routers and routes/index.ts path guards.
 */
export function requireTeamAuth(req: Request, res: Response, next: NextFunction): void {
  const claims = verifyToken(req.headers["authorization"]);
  if (!claims || claims.type !== "team-session") {
    res.status(401).json({ error: "Authentication required. Sign in at /login." });
    return;
  }
  (req as AuthRequest).teamUser = {
    id: String(claims.id),
    email: claims.email,
    name: claims.name ?? claims.email,
    role: (claims.role ?? "member") as "admin" | "member",
  };
  next();
}

/**
 * Requires a valid team-session JWT AND role === "admin".
 */
export function requireTeamAdmin(req: Request, res: Response, next: NextFunction): void {
  requireTeamAuth(req, res, () => {
    const user = (req as AuthRequest).teamUser;
    if (user?.role !== "admin") {
      res.status(403).json({ error: "Admin access required." });
      return;
    }
    next();
  });
}

// ─── Legacy passcode helpers ──────────────────────────────────────────────────

async function verifyPasscode(submitted: string): Promise<boolean> {
  const [row] = await db.select().from(teamSettingsTable).where(eq(teamSettingsTable.id, "singleton")).limit(1);
  if (row?.passcodeHash) return bcrypt.compare(submitted, row.passcodeHash);
  const secret = process.env["SESSION_SECRET"];
  if (!secret) return false;
  try {
    const a = Buffer.from(secret);
    const b = Buffer.from(submitted);
    return a.length === b.length && timingSafeEqual(a, b);
  } catch { return false; }
}

// ─── Routes: public ──────────────────────────────────────────────────────────

/** POST /auth/login  — email + password */
router.post("/auth/login", authLimiter, async (req, res): Promise<void> => {
  const { email, password } = req.body ?? {};
  if (!email || typeof email !== "string" || !password || typeof password !== "string") {
    res.status(400).json({ error: "email and password are required." });
    return;
  }
  const normalised = email.toLowerCase().trim();
  const [user] = await db.select().from(teamUsersTable)
    .where(eq(teamUsersTable.email, normalised)).limit(1);
  if (!user || !user.isActive) {
    res.status(401).json({ error: "Invalid email or password." });
    return;
  }
  const ok = await bcrypt.compare(password, user.passwordHash ?? "");
  if (!ok) {
    res.status(401).json({ error: "Invalid email or password." });
    return;
  }
  res.json({ token: issueTeamToken(user), user: userPublic(user) });
});

/** POST /auth/register  — invite token + name + password */
router.post("/auth/register", authLimiter, async (req, res): Promise<void> => {
  const { token, name, password } = req.body ?? {};
  if (!token || !name?.trim() || !password) {
    res.status(400).json({ error: "token, name, and password are required." });
    return;
  }
  if (password.length < 8) {
    res.status(400).json({ error: "Password must be at least 8 characters." });
    return;
  }
  const [invite] = await db.select().from(teamInvitationsTable)
    .where(and(
      eq(teamInvitationsTable.token, token),
      isNull(teamInvitationsTable.acceptedAt),
      gt(teamInvitationsTable.expiresAt, new Date()),
    ))
    .limit(1);
  if (!invite) {
    res.status(400).json({ error: "Invalid or expired invitation link." });
    return;
  }
  const [existing] = await db.select().from(teamUsersTable)
    .where(eq(teamUsersTable.email, invite.email)).limit(1);
  if (existing) {
    res.status(409).json({ error: "An account with this email already exists. Sign in instead." });
    return;
  }
  const passwordHash = await bcrypt.hash(password, 12);
  const newUserId = randomUUID();
  await db.insert(teamUsersTable).values({
    id: newUserId,
    email: invite.email,  // always from the invite — never from the client
    name: name.trim().slice(0, 100),
    passwordHash,
    role: "member",
    isActive: true,
    permissions: invite.permissions ?? {},
  });
  await db.update(teamInvitationsTable)
    .set({ acceptedAt: new Date() })
    .where(eq(teamInvitationsTable.id, invite.id));
  const [user] = await db.select().from(teamUsersTable)
    .where(eq(teamUsersTable.id, newUserId)).limit(1);
  res.status(201).json({ token: issueTeamToken(user!), user: userPublic(user!) });
});

/** POST /auth/forgot-password  — always 200 to prevent enumeration */
router.post("/auth/forgot-password", authLimiter, async (req, res): Promise<void> => {
  const { email } = req.body ?? {};
  if (!email || typeof email !== "string") {
    res.status(400).json({ error: "email is required." });
    return;
  }
  const normalised = email.toLowerCase().trim();
  const [user] = await db.select().from(teamUsersTable)
    .where(eq(teamUsersTable.email, normalised)).limit(1);
  // Always 200 — do not reveal whether the email is registered.
  if (!user) { res.json({ ok: true }); return; }

  // Opaque random token — NOT a JWT — so this reset link cannot be used as a
  // Bearer session token before the password is actually reset.
  const token = randomUUID();
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
  await db.insert(passwordResetTokensTable).values({ userId: user.id, token, expiresAt });
  const resetUrl = `${projecthubBaseUrl()}/reset-password?token=${token}`;
  logger.info({ email: user.email }, "Password reset token generated");
  // Deliver directly to the requester as well as the team channels. Each
  // channel fails soft; the token stays valid either way and an admin can
  // still generate a link from the Team page.
  const resetMessage =
    `🔐 ProjectHub password reset requested for ${user.email}.\n\n` +
    `Reset link (valid 24 hours):\n${resetUrl}\n\n` +
    `If nobody on the team requested this, ignore this message.`;
  const [emailOk, whatsappOk, slackOk] = await Promise.all([
    sendViaResend({
      from: "ProjectHub <noreply@contacts.ucfilters.com>",
      to: user.email,
      subject: "Reset your ProjectHub password",
      text:
        `A password reset was requested for your ProjectHub account.\n\n` +
        `Reset link (valid 24 hours):\n${resetUrl}\n\n` +
        `If you did not request this, you can ignore this email.`,
      html:
        `<p>A password reset was requested for your ProjectHub account.</p>` +
        `<p><a href="${resetUrl}">Reset your password</a> (valid 24 hours)</p>` +
        `<p>If you did not request this, you can ignore this email.</p>`,
      meta: {
        template: RECOVERY_EMAIL_TEMPLATES.passwordReset,
        auditMode: "metadata-only",
      },
    }),
    deliverResetLinkViaWhatsApp(resetUrl, user.email),
    sendSlackTeamMessage(resetMessage, "PASSWORD_RESET"),
  ]);
  if (!emailOk && !whatsappOk && !slackOk) {
    logger.error(
      { email: user.email },
      "Password reset link could not be delivered on ANY channel (email + WhatsApp + Slack all failed)"
    );
  }
  res.json({ ok: true });
});

/** POST /auth/reset-password */
router.post("/auth/reset-password", authLimiter, async (req, res): Promise<void> => {
  const { token, newPassword } = req.body ?? {};
  if (!token || !newPassword) {
    res.status(400).json({ error: "token and newPassword are required." });
    return;
  }
  if (newPassword.length < 8) {
    res.status(400).json({ error: "Password must be at least 8 characters." });
    return;
  }
  const [resetToken] = await db.select().from(passwordResetTokensTable)
    .where(and(
      eq(passwordResetTokensTable.token, token),
      isNull(passwordResetTokensTable.usedAt),
      gt(passwordResetTokensTable.expiresAt, new Date()),
    ))
    .limit(1);
  if (!resetToken) {
    res.status(400).json({ error: "Invalid or expired reset link." });
    return;
  }
  const passwordHash = await bcrypt.hash(newPassword, 12);
  await db.update(teamUsersTable)
    .set({ passwordHash, updatedAt: new Date() })
    .where(eq(teamUsersTable.id, resetToken.userId));
  await db.update(passwordResetTokensTable)
    .set({ usedAt: new Date() })
    .where(eq(passwordResetTokensTable.id, resetToken.id));
  res.json({ ok: true });
});

// ─── Routes: authenticated ────────────────────────────────────────────────────

/** GET /auth/me */
router.get("/auth/me", requireTeamAuth, async (req, res): Promise<void> => {
  const { id } = (req as AuthRequest).teamUser!;
  const [user] = await db.select().from(teamUsersTable)
    .where(eq(teamUsersTable.id, id)).limit(1);
  if (!user) { res.status(404).json({ error: "User not found." }); return; }
  res.json(userPublic(user)); // never expose passwordHash
});

/** POST /auth/change-password */
router.post("/auth/change-password", requireTeamAuth, async (req, res): Promise<void> => {
  const { currentPassword, newPassword } = req.body ?? {};
  if (!currentPassword || !newPassword) {
    res.status(400).json({ error: "currentPassword and newPassword are required." });
    return;
  }
  if (newPassword.length < 8) {
    res.status(400).json({ error: "New password must be at least 8 characters." });
    return;
  }
  const { id } = (req as AuthRequest).teamUser!;
  const [user] = await db.select().from(teamUsersTable)
    .where(eq(teamUsersTable.id, id)).limit(1);
  if (!user) { res.status(404).json({ error: "User not found." }); return; }
  const ok = await bcrypt.compare(currentPassword, user.passwordHash ?? "");
  if (!ok) { res.status(401).json({ error: "Current password is incorrect." }); return; }
  const passwordHash = await bcrypt.hash(newPassword, 12);
  await db.update(teamUsersTable)
    .set({ passwordHash, updatedAt: new Date() })
    .where(eq(teamUsersTable.id, id));
  res.json({ ok: true });
});

// ─── Routes: admin-only ───────────────────────────────────────────────────────

/** GET /auth/users */
router.get("/auth/users", requireTeamAdmin, async (_req, res): Promise<void> => {
  const users = await db.select({
    id: teamUsersTable.id, email: teamUsersTable.email, name: teamUsersTable.name,
    role: teamUsersTable.role, isActive: teamUsersTable.isActive,
    permissions: teamUsersTable.permissions, createdAt: teamUsersTable.createdAt,
  }).from(teamUsersTable).orderBy(teamUsersTable.createdAt);
  res.json(users);
});

/**
 * GET /auth/recovery-emails — latest ProjectHub invitation/reset email state.
 * This deliberately projects only delivery metadata: it never returns message
 * bodies, reset links, Resend IDs, or any other email contents.
 */
router.get("/auth/recovery-emails", requireTeamAdmin, async (req, res): Promise<void> => {
  const parsedLimit = Number(req.query["limit"]);
  const limit = Number.isInteger(parsedLimit) ? Math.min(Math.max(parsedLimit, 1), 50) : 20;
  const templateToType = new Map<string, RecoveryEmailType>([
    [RECOVERY_EMAIL_TEMPLATES.invitation, "invitation"],
    [RECOVERY_EMAIL_TEMPLATES.passwordReset, "passwordReset"],
  ]);

  const logs = await db.select({
    id: ucNotificationLogTable.id,
    recipient: ucNotificationLogTable.recipient,
    template: ucNotificationLogTable.template,
    status: ucNotificationLogTable.status,
    errorMessage: ucNotificationLogTable.errorMessage,
    resendMessageId: ucNotificationLogTable.resendMessageId,
    deliveryEvent: ucNotificationLogTable.deliveryEvent,
    deliveryEventAt: ucNotificationLogTable.deliveryEventAt,
    sentAt: ucNotificationLogTable.sentAt,
  }).from(ucNotificationLogTable)
    .where(and(
      eq(ucNotificationLogTable.provider, "resend"),
      inArray(ucNotificationLogTable.template, Object.values(RECOVERY_EMAIL_TEMPLATES)),
    ))
    .orderBy(desc(ucNotificationLogTable.sentAt))
    .limit(limit);

  const refreshed = await Promise.all(logs.map(async (log) => {
    let deliveryEvent = log.deliveryEvent as ResendDeliveryEvent | null;
    let deliveryEventAt = log.deliveryEventAt;

    if (log.status === "sent" && log.resendMessageId) {
      const latest = await getResendDeliveryEvent(log.resendMessageId);
      if (latest && (latest.event !== deliveryEvent || !deliveryEventAt)) {
        deliveryEvent = latest.event;
        deliveryEventAt = latest.occurredAt ?? new Date();
        try {
          await db.update(ucNotificationLogTable)
            .set({ deliveryEvent, deliveryEventAt })
            .where(eq(ucNotificationLogTable.id, log.id));
        } catch (err) {
          req.log.warn({ err, notificationId: log.id }, "Could not persist Resend delivery event");
        }
      }
    }

    return {
      id: log.id,
      recipient: log.recipient,
      type: templateToType.get(log.template)!,
      sendStatus: log.status === "sent" ? "accepted" : "failed",
      deliveryEvent: deliveryEvent ?? (log.status === "sent" ? "accepted" : "failed"),
      deliveryEventAt,
      sentAt: log.sentAt,
      errorMessage: log.status === "failed" ? log.errorMessage : null,
    };
  }));

  res.json(refreshed);
});

/** POST /auth/invitations  — invite a user by email (7-day link) */
router.post("/auth/invitations", requireTeamAdmin, async (req, res): Promise<void> => {
  const { email, permissions } = req.body ?? {};
  if (!email || typeof email !== "string") {
    res.status(400).json({ error: "email is required." });
    return;
  }
  if (
    permissions !== undefined
    && (permissions === null || typeof permissions !== "object" || Array.isArray(permissions)
      || !Object.values(permissions).every((level) => typeof level === "string"))
  ) {
    res.status(400).json({ error: "permissions must be a map of page permission levels." });
    return;
  }
  const normalised = email.toLowerCase().trim();
  const [existing] = await db.select().from(teamUsersTable)
    .where(eq(teamUsersTable.email, normalised)).limit(1);
  if (existing) {
    res.status(409).json({ error: "A user with this email already exists." });
    return;
  }
  // Opaque random token — NOT a JWT — so the invite URL cannot double as a
  // Bearer session token and grant admin access before the holder registers.
  const token = randomUUID();
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  const invitedById = (req as AuthRequest).teamUser!.id;
  await db.insert(teamInvitationsTable).values({
    email: normalised,
    token,
    invitedById,
    expiresAt,
    permissions: permissions as Record<string, string> | undefined,
  });
  const inviteUrl = `${projecthubBaseUrl()}/register?token=${token}`;
  const sent = await sendViaResend({
    from: "ProjectHub <noreply@contacts.ucfilters.com>",
    to: normalised,
    subject: "You've been invited to ProjectHub",
    text: `You have been invited to join the Ultra-Clear ProjectHub team workspace.\n\nAccept your invitation here (valid 7 days):\n${inviteUrl}`,
    html: `<p>You have been invited to join the Ultra-Clear ProjectHub team workspace.</p><p><a href="${inviteUrl}">Accept invitation</a> (valid 7 days)</p><p>Or copy this link: ${inviteUrl}</p>`,
    meta: {
      template: RECOVERY_EMAIL_TEMPLATES.invitation,
      auditMode: "metadata-only",
    },
  });
  if (!sent) logger.warn({ email: normalised }, "Invite email not delivered — link still valid");
  res.status(201).json({ inviteUrl, email: normalised, expiresAt, emailSent: sent });
});

/** PATCH /auth/users/:id/role  — promote or demote */
router.patch("/auth/users/:id/role", requireTeamAdmin, async (req, res): Promise<void> => {
  const id = String(req.params["id"]);
  const { role } = req.body ?? {};
  if (!["admin", "member"].includes(role)) {
    res.status(400).json({ error: "role must be 'admin' or 'member'." });
    return;
  }
  const [user] = await db.select().from(teamUsersTable)
    .where(eq(teamUsersTable.id, id)).limit(1);
  if (!user) { res.status(404).json({ error: "User not found." }); return; }
  await db.update(teamUsersTable)
    .set({ role, updatedAt: new Date() })
    .where(eq(teamUsersTable.id, id));
  res.json(userPublic({ ...user, role }));
});

/** PATCH /auth/users/:id  — update name / active status / permissions */
router.patch("/auth/users/:id", requireTeamAdmin, async (req, res): Promise<void> => {
  const id = String(req.params["id"]);
  const { name, isActive, permissions } = req.body ?? {};
  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if (name !== undefined) updates["name"] = String(name).trim();
  if (isActive !== undefined) updates["isActive"] = Boolean(isActive);
  if (permissions !== undefined) updates["permissions"] = permissions as Record<string, string>;
  const [user] = await db.select().from(teamUsersTable)
    .where(eq(teamUsersTable.id, id)).limit(1);
  if (!user) { res.status(404).json({ error: "User not found." }); return; }
  await db.update(teamUsersTable).set(updates).where(eq(teamUsersTable.id, id));
  const [updated] = await db.select().from(teamUsersTable)
    .where(eq(teamUsersTable.id, id)).limit(1);
  res.json(userPublic(updated!));
});

/** POST /auth/users/:id/reset-password  — admin generates a reset link */
router.post("/auth/users/:id/reset-password", requireTeamAdmin, async (req, res): Promise<void> => {
  const id = String(req.params["id"]);
  const [user] = await db.select().from(teamUsersTable)
    .where(eq(teamUsersTable.id, id)).limit(1);
  if (!user) { res.status(404).json({ error: "User not found." }); return; }
  // Opaque random token — NOT a JWT — so this reset link cannot be used as a
  // Bearer session token before the password is actually reset.
  const token = randomUUID();
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
  await db.insert(passwordResetTokensTable).values({ userId: user.id, token, expiresAt });
  const resetUrl = `${projecthubBaseUrl()}/reset-password?token=${token}`;
  // Deliver via both direct email and the team WhatsApp channel. Failure is
  // non-fatal: the admin sees the link in the response and can share it.
  const [emailOk, whatsappOk] = await Promise.all([
    sendViaResend({
      from: "ProjectHub <noreply@contacts.ucfilters.com>",
      to: user.email,
      subject: "Reset your ProjectHub password",
      text:
        `A password reset was requested for your ProjectHub account.\n\n` +
        `Reset link (valid 24 hours):\n${resetUrl}\n\n` +
        `If you did not request this, you can ignore this email.`,
      html:
        `<p>A password reset was requested for your ProjectHub account.</p>` +
        `<p><a href="${resetUrl}">Reset your password</a> (valid 24 hours)</p>` +
        `<p>If you did not request this, you can ignore this email.</p>`,
      meta: {
        template: RECOVERY_EMAIL_TEMPLATES.passwordReset,
        auditMode: "metadata-only",
      },
    }),
    deliverResetLinkViaWhatsApp(resetUrl, user.email),
  ]);
  if (!emailOk && !whatsappOk) {
    logger.error(
      { email: user.email },
      "Admin password reset link could not be delivered on ANY channel (email + WhatsApp both failed)"
    );
  }
  res.json({ resetUrl, email: user.email, expiresAt, emailSent: emailOk });
});

// ─── Legacy: passcode-based token (WhatsApp + backward compat) ────────────────

router.post("/auth/token", async (req, res): Promise<void> => {
  const secret = process.env["SESSION_SECRET"];
  if (!secret) { res.status(503).json({ error: "Auth not configured." }); return; }
  const { passcode } = req.body ?? {};
  if (!passcode || typeof passcode !== "string" || !passcode.trim()) {
    res.status(400).json({ error: "passcode is required." });
    return;
  }
  const ok = await verifyPasscode(passcode.trim());
  if (!ok) { res.status(401).json({ error: "Invalid passcode." }); return; }
  const exp = Math.floor(Date.now() / 1000) + 8 * 60 * 60;
  const token = issueToken({ id: "team", email: "team@projecthub.internal", type: "team-session", role: "admin", exp });
  res.json({ token });
});

router.post("/auth/change-passcode", requireTeamAuth, async (req, res): Promise<void> => {
  const { currentPasscode, newPasscode } = req.body ?? {};
  if (!currentPasscode || !newPasscode || newPasscode.length < 8) {
    res.status(400).json({ error: "currentPasscode and newPasscode (min 8 chars) are required." });
    return;
  }
  const ok = await verifyPasscode(currentPasscode.trim());
  if (!ok) { res.status(401).json({ error: "Current passcode incorrect." }); return; }
  const passcodeHash = await bcrypt.hash(newPasscode.trim(), 12);
  await db.insert(teamSettingsTable).values({ id: "singleton", passcodeHash })
    .onConflictDoUpdate({ target: teamSettingsTable.id, set: { passcodeHash, updatedAt: new Date() } });
  res.json({ ok: true });
});

export default router;
