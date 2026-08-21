import { Router, type IRouter } from "express";
import healthRouter from "./health";
import membersRouter from "./members";
import projectsRouter from "./projects";
import tasksRouter from "./tasks";
import dashboardRouter from "./dashboard";
import anthropicRouter from "./anthropic/conversations";
import aiMonitorRouter from "./ai/monitor";
import aiAgentQueryRouter from "./ai/agent-query";
import ucRouter from "./uc";
import ucWaterChatRouter from "./uc-water-chat";
import ucImpactRouter from "./uc-impact";
import ucRemindersRouter from "./uc-reminders";
import ucSocialAuthRouter from "./uc-social-auth";
import ucOfflineClientsRouter from "./uc-offline-clients";
import storageRouter from "./storage";
import paymentsRouter from "./payments";
import referralsRouter from "./referrals";
// Team Horizon routers
import authRouter from "./auth";
import contactsRouter from "./contacts";
import contactsSyncRouter from "./contacts-sync";
import notificationsRouter from "./notifications";
import systemStatusRouter from "./system-status";
import monitoringRouter from "./monitoring";
import webhookRouter from "./webhook";
import whatsappRouter from "./whatsapp";
import adminPaymentSettingsRouter from "./admin-payment-settings.js";
import libraryRouter from "./library.js";
import { requireTeamAuth } from "./auth.js";
import adminNotificationSettingsRouter from "./admin-notification-settings.js";
import adminIntegrationsRouter from "./admin-integrations.js";
import adminInventorySettingsRouter from "./admin-inventory-settings.js";
import ucRewardsRouter from "./uc-rewards.js";
import adminUnsyncedRegistrationsRouter from "./admin-unsynced-registrations.js";

const router: IRouter = Router();

// ─── ProjectHub team auth guards ─────────────────────────────────────────────
// Path-scoped middleware: each entry runs ONLY for requests whose path starts
// with the given prefix, so UC, webhook, and payment endpoints are unaffected.
// Using router.use("/prefix", middleware) here (in the MAIN router, with an
// explicit path) is key — sub-router-level router.use(middleware) (no path)
// would intercept ALL requests flowing through that router, including paths
// it doesn't own.
router.use("/members",      requireTeamAuth);
router.use("/library",      requireTeamAuth);
router.use("/projects",     requireTeamAuth);
router.use("/tasks",        requireTeamAuth);
router.use("/dashboard",    requireTeamAuth);
router.use("/notifications", requireTeamAuth);
// /ai/report, /ai/push, and /ai/pushes are team-only; /ai/query is a public
// UC webhook and /ai/echo is the HMAC-signed orchestrator status callback.
router.use("/ai/report",     requireTeamAuth);
router.use("/ai/push",       requireTeamAuth);
router.use("/ai/pushes",     requireTeamAuth);
router.use("/ai/agent-query", requireTeamAuth);
router.use("/ai/agents",     requireTeamAuth);
router.use("/ai/push-task",  requireTeamAuth);
// Contacts CRUD is protected per-route in contacts.ts (preserves the public
// Google OAuth callback at /contacts/sync/google/callback in contacts-sync.ts)
// System status: GET /system/status and PATCH /system/status/:id are protected
// per-route in system-status.ts; POST routes remain public for the watchdog
// UC deleted-account guard: mounted app-level in app.ts (before the
// /api/uc/product-images mounts) so it covers EVERY /api/uc/* request.

router.use(healthRouter);
router.use(membersRouter);
router.use(projectsRouter);
router.use(tasksRouter);
router.use(dashboardRouter);
router.use(anthropicRouter);
router.use(aiMonitorRouter);
router.use(aiAgentQueryRouter);
router.use(ucRouter);
router.use(ucWaterChatRouter);
router.use(ucImpactRouter);
router.use(ucRemindersRouter);
router.use(ucSocialAuthRouter);
router.use(ucOfflineClientsRouter);
router.use(ucRewardsRouter);
router.use(storageRouter);
router.use(paymentsRouter);
router.use(referralsRouter);
// Team Horizon
router.use(libraryRouter);
router.use(adminPaymentSettingsRouter);
router.use(adminNotificationSettingsRouter);
router.use(adminIntegrationsRouter);
router.use(adminInventorySettingsRouter);
router.use(adminUnsyncedRegistrationsRouter);
router.use(authRouter);
router.use(contactsRouter);
router.use(contactsSyncRouter);
router.use(notificationsRouter);
router.use(systemStatusRouter);
router.use(monitoringRouter);
router.use(webhookRouter);
router.use(whatsappRouter);
export default router;
