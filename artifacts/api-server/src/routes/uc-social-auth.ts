/**
 * Social sign-in bridge (Google / Apple via Clerk) for the Ultra-Clear
 * Companion app.
 *
 * The mobile app completes the OAuth flow with Clerk on-device, then calls
 * this endpoint with the Clerk session token as a Bearer token. The global
 * `clerkMiddleware` in app.ts verifies that token; here we map the verified
 * Clerk identity onto our own uc_users account (find, link, or create) and
 * issue the app's normal JWT — so everything downstream (orders, reminders,
 * preferences) works identically for social and password accounts.
 *
 * Account linking rule: emails from Google/Apple are verified by the
 * provider, so a Clerk identity whose email matches an existing uc_users row
 * links to it (and sets clerk_user_id for future logins).
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { and, eq, isNull } from "drizzle-orm";
import { getAuth, clerkClient } from "@clerk/express";
import { db, ucUsersTable } from "@workspace/db";
import { issueToken } from "../lib/jwt";
import { authLimiter } from "../lib/rate-limiters";
import { logger } from "../lib/logger";
import { recordAccountRegistration } from "../lib/account-records";
import { sendViaResend } from "../lib/resend";
import { reconcileAssignmentsForAccount } from "../lib/customer-assignments.js";

const router: IRouter = Router();

/**
 * Sentinel stored in password_hash for accounts created via social sign-in.
 * It is not a valid bcrypt hash, so `bcrypt.compare()` can never return true
 * for it — password login on a social-only account always fails safely.
 */
const SOCIAL_PASSWORD_SENTINEL = "!social-login-no-password";

router.post(
  "/uc/auth/social",
  authLimiter,
  async (req: Request, res: Response): Promise<void> => {
    // ── Phase 1: verify Clerk identity — no DB involved ──────────────────────
    // Capture identity fields here so the DB-error handler below can write a
    // durable folder record even when the very first DB lookup fails.
    const auth = getAuth(req);
    const clerkUserId = auth?.userId;
    if (!clerkUserId) {
      res.status(401).json({ error: "Social sign-in not verified" });
      return;
    }

    const cu = await clerkClient.users.getUser(clerkUserId);
    type EmailAddr = (typeof cu.emailAddresses)[number];
    const verified = cu.emailAddresses.filter(
      (e: EmailAddr) => e.verification?.status === "verified",
    );
    const primaryEmail =
      verified.find((e: EmailAddr) => e.id === cu.primaryEmailAddressId) ?? verified[0];
    const email = primaryEmail?.emailAddress?.toLowerCase().trim();
    if (!email) {
      res.status(403).json({ error: "Your sign-in account has no verified email address" });
      return;
    }

    // These are captured before any DB operations so the outer catch can write
    // a durable folder record regardless of which DB call failed.
    const firstName = cu.firstName || email.split("@")[0] || "Customer";
    const lastName = cu.lastName || "";
    let createdSocialAccount = false;

    // ── Phase 2: DB operations ────────────────────────────────────────────────
    // Any unhandled error here (including the very first findFirst) is caught
    // below and triggers a durable folder record write before responding.
    try {
      // 1) Already linked?
      let dbUser = await db.query.ucUsersTable.findFirst({
        where: eq(ucUsersTable.clerkUserId, clerkUserId),
      });

      // 2) Same email as an existing account? Link it.
      if (!dbUser) {
        const byEmail = await db.query.ucUsersTable.findFirst({
          where: eq(ucUsersTable.email, email),
        });
        if (byEmail) {
          if (byEmail.deletedAt) {
            res.status(401).json({ error: "This account has been deleted" });
            return;
          }
          if (byEmail.clerkUserId && byEmail.clerkUserId !== clerkUserId) {
            // Account already linked to a DIFFERENT social identity — never
            // silently re-link (that would hand the account to whoever signs
            // in with a matching email later).
            res.status(409).json({ error: "This email is already linked to another sign-in. Use your original sign-in method." });
            return;
          }
          // Conditional link: only claims the row if it is still unlinked (or
          // already ours), so two concurrent exchanges can't cross-link.
          [dbUser] = await db
            .update(ucUsersTable)
            .set({ clerkUserId, emailVerified: true })
            .where(
              and(
                eq(ucUsersTable.id, byEmail.id),
                byEmail.clerkUserId === clerkUserId
                  ? eq(ucUsersTable.clerkUserId, clerkUserId)
                  : isNull(ucUsersTable.clerkUserId),
              ),
            )
            .returning();
          if (!dbUser) {
            // Lost the race — re-read and accept only if it ended up ours.
            dbUser = await db.query.ucUsersTable.findFirst({
              where: eq(ucUsersTable.clerkUserId, clerkUserId),
            });
            if (!dbUser) {
              res.status(409).json({ error: "This email is already linked to another sign-in. Use your original sign-in method." });
              return;
            }
          }
        }
      }

      // 3) First-time user — create the account.
      if (!dbUser) {
        const values = {
          email,
          passwordHash: SOCIAL_PASSWORD_SENTINEL,
          firstName,
          lastName,
          clerkUserId,
          authProvider: "social",
          emailVerified: true,
        };

        try {
          [dbUser] = await db.insert(ucUsersTable).values(values).returning();
          createdSocialAccount = Boolean(dbUser);
          if (dbUser) {
            recordAccountRegistration({
              id: dbUser.id,
              firstName: dbUser.firstName,
              lastName: dbUser.lastName,
              email: dbUser.email,
              phone: dbUser.phone,
              authProvider: "social",
              createdAt: dbUser.createdAt,
              source: "social-registration",
              dbPersisted: true,
            }).catch(() => {});
          }
        } catch (insertErr) {
          // A concurrent social exchange may have inserted this email first.
          // Reuse that row only when it is unlinked or belongs to this Clerk
          // identity; a different linked identity must never be claimed.
          let existingRow: Awaited<ReturnType<typeof db.query.ucUsersTable.findFirst>>;
          try {
            existingRow = await db.query.ucUsersTable.findFirst({
              where: eq(ucUsersTable.email, email),
            });
          } catch {
            // DB outage: the durable folder entry is now the only recovery
            // path, so failure to append it must be surfaced explicitly.
            try {
              await recordAccountRegistration({
                id: null,
                firstName: values.firstName,
                lastName: values.lastName,
                email: values.email,
                phone: "",
                authProvider: "social",
                createdAt: null,
                source: "social-registration",
                dbPersisted: false,
              }, { critical: true });
            } catch {
              logger.error({ email }, "[uc-social-auth] dual failure: DB insert and folder write both failed");
              res.status(503).json({
                error: "We could not complete your sign-up and your details were not recorded. Please contact us directly.",
              });
              return;
            }
            throw insertErr;
          }
          if (existingRow && (!existingRow.clerkUserId || existingRow.clerkUserId === clerkUserId)) {
            dbUser = existingRow;
          } else if (existingRow) {
            res.status(409).json({ error: "This email is already linked to another sign-in. Use your original sign-in method." });
            return;
          } else {
            throw insertErr; // DB genuinely down — outer catch writes folder record
          }
        }
      }

      if (!dbUser) {
        res.status(500).json({ error: "Could not create account" });
        return;
      }
      if (dbUser.deletedAt) {
        res.status(401).json({ error: "This account has been deleted" });
        return;
      }

      const user = {
        id: dbUser.id,
        email: dbUser.email,
        phone: dbUser.phone,
        firstName: dbUser.firstName,
        lastName: dbUser.lastName,
        credentialVersion: dbUser.credentialVersion,
        emailVerified: dbUser.emailVerified,
        phoneVerified: dbUser.phoneVerified,
      };
      void reconcileAssignmentsForAccount(dbUser.id);
      res.json({ token: issueToken(user), user });
      const subject = createdSocialAccount
        ? "Welcome to Ultra-Clear"
        : "New sign-in to your Ultra-Clear account";
      const message = createdSocialAccount
        ? `Hi ${firstName},\n\nWelcome to Ultra-Clear. Your account is ready and you can now manage your clean-water products, reminders, and support requests in the Companion app.\n\n— The Ultra-Clear team`
        : `Hi ${firstName},\n\nYour Ultra-Clear account was just used to sign in with Google or Apple. If this was not you, please secure your social account and contact support.\n\n— The Ultra-Clear team`;
      void sendViaResend({
        from: "Ultra Clear App <noreply@contacts.ucfilters.com>",
        to: email,
        subject,
        text: message,
        html: message.replace(/\n/g, "<br>"),
        meta: { template: createdSocialAccount ? "uc-social-welcome" : "uc-social-sign-in" },
      }).then((sent) => {
        if (!sent) logger.warn({ email, createdSocialAccount }, "Social sign-in email delivery failed");
      }).catch((err) => logger.warn({ err, email }, "Social sign-in email dispatch failed"));
    } catch (err) {
      logger.error({ err }, "[uc-social-auth] social sign-in failed");
      if (res.headersSent) return;

      // Any DB failure after Clerk identity is verified: write a durable folder
      // record so the admin can recover the registration via the unsynced panel.
      try {
        await recordAccountRegistration({
          id: null,
          firstName,
          lastName,
          email,
          phone: "",
          authProvider: "social",
          createdAt: null,
          source: "social-registration",
          dbPersisted: false,
        }, { critical: true });
        res.status(503).json({
          error: "Sign-in failed. Your details have been safely recorded. Please try again later.",
        });
      } catch {
        logger.error({ email }, "[uc-social-auth] dual failure: DB and folder write both failed");
        res.status(503).json({
          error: "We could not complete your sign-up and your details were not recorded. Please contact us directly.",
        });
      }
    }
  },
);

export default router;
