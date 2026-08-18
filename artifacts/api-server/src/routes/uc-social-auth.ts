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
    try {
      const auth = getAuth(req);
      const clerkUserId = auth?.userId;
      if (!clerkUserId) {
        res.status(401).json({ error: "Social sign-in not verified" });
        return;
      }

      // Fetch the identity from Clerk (email, name). Only a VERIFIED email may
      // be used — linking by an unverified address would let an attacker
      // claim someone else's app account by adding their email to a Clerk
      // profile without proving ownership.
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
            .set({ clerkUserId })
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
          firstName: cu.firstName || email.split("@")[0] || "Customer",
          lastName: cu.lastName || "",
          clerkUserId,
          authProvider: "social",
        };
        try {
          [dbUser] = await db.insert(ucUsersTable).values(values).returning();
          if (dbUser) {
            // Durable folder record of the new social account (sanitized —
            // never password material; the sentinel hash is NOT written).
            recordAccountRegistration({
              id: dbUser.id, firstName: dbUser.firstName, lastName: dbUser.lastName,
              email: dbUser.email, phone: dbUser.phone,
              authProvider: "social", createdAt: dbUser.createdAt,
              source: "social-registration", dbPersisted: true,
            }).catch(() => {});
          }
        } catch {
          // Unique-constraint race (two concurrent first sign-ins): the other
          // request won — reuse its row, but only if it belongs to this same
          // Clerk identity (or is still unlinked, which we then claim).
          const existing = await db.query.ucUsersTable.findFirst({
            where: eq(ucUsersTable.email, email),
          });
          if (existing && (!existing.clerkUserId || existing.clerkUserId === clerkUserId)) {
            dbUser = existing;
          } else {
            res.status(409).json({ error: "This email is already linked to another sign-in. Use your original sign-in method." });
            return;
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
        address: dbUser.address ?? "",
      };
      res.json({ token: issueToken(user), user });
    } catch (err) {
      logger.error({ err }, "[uc-social-auth] social sign-in failed");
      res.status(500).json({ error: "Sign-in failed. Please try again." });
    }
  },
);

export default router;
