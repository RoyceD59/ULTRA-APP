/**
 * WhatsApp session manager using @whiskeysockets/baileys.
 *
 * Maintains a single long-lived WhatsApp Web socket connection.
 * On first boot (or after logout) it generates a QR code that the user
 * scans with their phone.  Credentials are stored in AUTH_DIR so the
 * session survives server restarts.
 *
 * Object Storage sync (production):
 *   Set WHATSAPP_SESSION_BUCKET_PATH to a GCS path such as
 *   /<bucket-id>/whatsapp-session to enable automatic credential sync.
 *   On startup the server downloads all files from that path into AUTH_DIR
 *   before Baileys initialises; on every creds.update the files are pushed
 *   back so the session survives container replacement.
 *
 * External API:
 *   getWhatsAppStatus()               → { state, qr?, error? }
 *   sendWhatsAppMessage(to, msg)      → Promise<string> (message key ID)
 *   initWhatsApp()                    → idempotent boot
 *   disconnectWhatsApp()              → logout + clear active state
 */

import { join, resolve, sep } from "path";
import { homedir } from "os";
import { existsSync } from "fs";
import { mkdir, readdir, readFile, writeFile, rename, copyFile, rm } from "fs/promises";
import { toDataURL } from "qrcode";
import pino from "pino";
import { eq, isNull, or, ne, and } from "drizzle-orm";
import { db, notificationLogsTable } from "@workspace/db";
import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  makeCacheableSignalKeyStore,
  type WASocket,
  WAMessageUpdate,
} from "@whiskeysockets/baileys";
import { objectStorageClient } from "./objectStorage";
import { sendEmail, buildWhatsAppAlertEmail } from "./email";
import { sendViaResend } from "./resend";
import { pushReceiptUpdate } from "./receiptStream";
import { WhatsAppOperations } from "./whatsapp-operations";

// Credentials are stored in AUTH_DIR so they survive hot-reloads and process
// restarts.  The path is controlled by the WHATSAPP_SESSION_DIR env var; the
// default lives OUTSIDE the repo working tree (~/.uc-whatsapp-session) so live
// WhatsApp credentials can never be committed to git by accident.  In
// production the files are additionally mirrored to Object Storage (below).
const LEGACY_AUTH_DIR = join(process.cwd(), ".whatsapp-session");
const AUTH_DIR =
  process.env.WHATSAPP_SESSION_DIR ?? join(homedir(), ".uc-whatsapp-session");

/**
 * Returns true when `child` is located inside `parent` (after path resolution).
 */
function isInsideDir(child: string, parent: string): boolean {
  const rel = resolve(child);
  const base = resolve(parent);
  return rel === base || rel.startsWith(base + sep);
}

/**
 * Walk upward from `start` looking for a `.git` directory — i.e. the repo root.
 * Returns null when not inside a git working tree.
 */
function findRepoRoot(start: string): string | null {
  let dir = resolve(start);
  for (;;) {
    if (existsSync(join(dir, ".git"))) return dir;
    const parent = resolve(dir, "..");
    if (parent === dir) return null;
    dir = parent;
  }
}

/**
 * One-time migration + safety check, run before Baileys reads AUTH_DIR.
 *
 * 1. If the legacy in-repo session directory still holds credential files and
 *    the new AUTH_DIR is empty, move the files across so the live WhatsApp
 *    session is preserved (no re-scan needed), then remove the legacy dir.
 * 2. Warn LOUDLY if session files are ever detected inside the repo working
 *    tree — that means credentials are one `git add` away from leaking.
 */
export async function migrateAndGuardSessionDir(): Promise<void> {
  const repoRoot = findRepoRoot(process.cwd());

  // 1. Migrate legacy in-repo session files → AUTH_DIR (only when AUTH_DIR
  //    itself is a different location and has no credentials yet).
  try {
    if (
      resolve(LEGACY_AUTH_DIR) !== resolve(AUTH_DIR) &&
      existsSync(LEGACY_AUTH_DIR)
    ) {
      const legacyFiles = (await readdir(LEGACY_AUTH_DIR)).filter(
        (f) => !f.startsWith(".")
      );
      const destHasCreds = existsSync(join(AUTH_DIR, "creds.json"));
      if (legacyFiles.length > 0 && !destHasCreds) {
        await mkdir(AUTH_DIR, { recursive: true });
        for (const name of legacyFiles) {
          const src = join(LEGACY_AUTH_DIR, name);
          const dest = join(AUTH_DIR, name);
          try {
            await rename(src, dest);
          } catch {
            // Cross-device fallback
            await copyFile(src, dest);
            await rm(src, { force: true });
          }
        }
        console.log(
          `[whatsapp] Migrated ${legacyFiles.length} session file(s) from ` +
          `the legacy in-repo directory to ${AUTH_DIR}`
        );
      }
      // Remove the legacy directory if it is now empty.
      try {
        const remaining = await readdir(LEGACY_AUTH_DIR);
        if (remaining.length === 0) {
          await rm(LEGACY_AUTH_DIR, { recursive: true, force: true });
        }
      } catch {
        // ignore
      }
    }
  } catch (err) {
    console.error("[whatsapp] Legacy session migration failed:", err);
  }

  // 2. Loud warning if session files live inside the repo working tree.
  if (repoRoot) {
    const inRepoDirs = [
      existsSync(LEGACY_AUTH_DIR) ? LEGACY_AUTH_DIR : null,
      isInsideDir(AUTH_DIR, repoRoot) && existsSync(AUTH_DIR) ? AUTH_DIR : null,
    ].filter((d): d is string => d !== null);
    for (const dir of inRepoDirs) {
      try {
        const files = await readdir(dir);
        if (files.length === 0) continue;
      } catch {
        continue;
      }
      console.error(
        "════════════════════════════════════════════════════════════════\n" +
        "[whatsapp] SECURITY WARNING: WhatsApp session credential files were\n" +
        `detected INSIDE the repo working tree at:\n  ${dir}\n` +
        "These are live login credentials and must never be committed.\n" +
        "Move them outside the repo (default: ~/.uc-whatsapp-session) or set\n" +
        "WHATSAPP_SESSION_DIR to a path outside the project.\n" +
        "════════════════════════════════════════════════════════════════"
      );
    }
  }
}

// When WHATSAPP_SESSION_BUCKET_PATH is set (e.g. /<bucket-id>/whatsapp-session),
// credentials are mirrored to/from Replit Object Storage so they survive
// container replacement in production deployments.
// In production, when the env var is absent, fall back to the default object
// storage bucket automatically so the session survives redeploys without any
// manual configuration. Development keeps the local-folder-only behaviour so
// a dev session can never clobber the production credentials in the bucket.
const DEFAULT_BUCKET_ID =
  process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID?.trim() || undefined;
const SESSION_BUCKET_PATH = (
  process.env.WHATSAPP_SESSION_BUCKET_PATH?.trim() ||
  (process.env.NODE_ENV === "production" && DEFAULT_BUCKET_ID
    ? `/${DEFAULT_BUCKET_ID}/whatsapp-session`
    : undefined)
)?.replace(/\/+$/, "");

/**
 * Parse a bucket path like /<bucket-id>/some/prefix into { bucketName, prefix }.
 */
function parseBucketPath(path: string): { bucketName: string; prefix: string } {
  const parts = path.replace(/^\//, "").split("/");
  const bucketName = parts[0];
  const prefix = parts.slice(1).join("/");
  return { bucketName, prefix };
}

/**
 * Download all credential files from Object Storage into AUTH_DIR.
 * Called once at startup before Baileys initialises.
 * No-op when SESSION_BUCKET_PATH is not set.
 */
async function syncFromObjectStorage(): Promise<void> {
  if (!SESSION_BUCKET_PATH) return;
  try {
    await mkdir(AUTH_DIR, { recursive: true });
    const { bucketName, prefix } = parseBucketPath(SESSION_BUCKET_PATH);
    if (!bucketName) {
      console.error("[whatsapp] Invalid session bucket path — sync disabled");
      return;
    }
    const bucket = objectStorageClient.bucket(bucketName);
    // Treat the prefix as a directory: list with a trailing "/" so a sibling
    // object like "whatsapp-sessioncreds.json" is never matched by the raw
    // prefix "whatsapp-session".
    const dirPrefix = prefix ? `${prefix}/` : "";
    const [files] = await bucket.getFiles({ prefix: dirPrefix || undefined });
    let restored = 0;
    await Promise.all(
      files.map(async (file) => {
        const relativeName = file.name.slice(dirPrefix.length);
        // Skip the directory placeholder and anything that is not a plain
        // file name directly under the prefix (no nested paths, no traversal).
        if (
          !relativeName ||
          relativeName === "." ||
          relativeName === ".." ||
          relativeName.includes("/") ||
          relativeName.includes("\\")
        ) {
          return;
        }
        const [contents] = await file.download();
        const destPath = join(AUTH_DIR, relativeName);
        await writeFile(destPath, contents);
        restored++;
      })
    );
    if (restored === 0) {
      console.log("[whatsapp] No session files found in Object Storage — fresh start");
      return;
    }
    console.log(`[whatsapp] Restored ${restored} session file(s) from Object Storage`);
  } catch (err) {
    // Non-fatal: if sync fails we start fresh and show a QR code
    console.error("[whatsapp] Failed to restore session from Object Storage:", err);
  }
}

/**
 * Upload all credential files from AUTH_DIR to Object Storage.
 * Called on every creds.update event so the bucket always has the latest tokens.
 * No-op when SESSION_BUCKET_PATH is not set.
 */
async function syncToObjectStorage(): Promise<void> {
  if (!SESSION_BUCKET_PATH) return;
  try {
    const { bucketName, prefix } = parseBucketPath(SESSION_BUCKET_PATH);
    const bucket = objectStorageClient.bucket(bucketName);
    let fileNames: string[];
    try {
      fileNames = await readdir(AUTH_DIR);
    } catch {
      return; // AUTH_DIR doesn't exist yet
    }
    await Promise.all(
      fileNames.map(async (name) => {
        const localPath = join(AUTH_DIR, name);
        const contents = await readFile(localPath);
        const objectName = prefix ? `${prefix}/${name}` : name;
        await bucket.file(objectName).save(contents, { resumable: false });
      })
    );
  } catch (err) {
    // Non-fatal: credential sync failure should never crash the main process
    console.error("[whatsapp] Failed to push session to Object Storage:", err);
  }
}

// Silent pino logger for Baileys internals — we don't want its verbose output
// flooding the server console.
const baileysLogger = pino({ level: "silent" });

// ─── Module-level state ───────────────────────────────────────────────────────

export type WaState = "disconnected" | "connecting" | "qr" | "connected" | "error";
export type WaErrorCode =
  | "QR_GENERATION_FAILED"
  | "QR_EXPIRED"
  | "WHATSAPP_INIT_FAILED"
  | "SESSION_CLEANUP_REQUIRED";
export interface WaError {
  code: WaErrorCode;
  message: string;
}

let sock: WASocket | null = null;
let currentQrDataUri: string | null = null;
let connectionState: WaState = "disconnected";
let currentError: WaError | null = null;
let isInitializing = false;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let qrExpiryTimer: ReturnType<typeof setTimeout> | null = null;
let sessionSyncQueue: Promise<void> = Promise.resolve();
// Invalidated by disconnect (and by a manual retry) so work belonging to an
// old socket cannot install a session or change the state of a newer socket.
let lifecycleGeneration = 0;

/**
 * A QR update can start an asynchronous conversion while Baileys emits a
 * newer QR update. Both the lifecycle generation and this per-lifecycle
 * sequence must still match before a conversion may publish its result.
 *
 * Exported as a small seam so the stale-result rule can be tested without
 * constructing a Baileys socket.
 */
export function isCurrentQrConversion(
  conversionGeneration: number,
  activeGeneration: number,
  conversionSequence: number,
  latestSequence: number,
): boolean {
  return (
    conversionGeneration === activeGeneration &&
    conversionSequence === latestSequence
  );
}

/** Stop an obsolete socket without logging out its persisted session. */
function closeSocketWithoutLogout(socket: WASocket | null): void {
  if (!socket) return;
  void socket.end(undefined).catch(() => {
    // The socket may already be closed while a retry is being started.
  });
}

/** Remove all locally persisted pairing material. Never return or log file contents. */
async function clearLocalSession(): Promise<void> {
  try {
    await rm(AUTH_DIR, { recursive: true, force: true });
  } catch (err) {
    console.error("[whatsapp] Failed to clear local session state:", err instanceof Error ? err.message : "unknown error");
    throw new Error("WhatsApp local session cleanup failed");
  }
}

/** Remove the server-side object-storage copy so a later connect cannot restore it. */
async function clearStoredSession(): Promise<void> {
  if (!SESSION_BUCKET_PATH) return;
  try {
    const { bucketName, prefix } = parseBucketPath(SESSION_BUCKET_PATH);
    // Refuse to wipe a bucket root: the session must have an isolated prefix
    // so disconnect can never delete unrelated application objects.
    if (!bucketName || !prefix) throw new Error("Session storage needs an isolated prefix");
    const dirPrefix = prefix ? `${prefix}/` : "";
    const [files] = await objectStorageClient.bucket(bucketName).getFiles({
      prefix: dirPrefix || undefined,
    });
    await Promise.all(
      files
        .filter((file) => {
          const name = file.name.slice(dirPrefix.length);
          return Boolean(name) && !name.includes("/") && !name.includes("\\");
        })
        .map((file) => file.delete()),
    );
  } catch (err) {
    // A failed remote cleanup must be visible to operators, but must not expose
    // bucket names, paths, or credential contents in the response.
    console.error("[whatsapp] Failed to clear stored session state:", err instanceof Error ? err.message : "unknown error");
    throw new Error("WhatsApp stored session cleanup failed");
  }
}

function clearQrExpiryTimer(): void {
  if (qrExpiryTimer) {
    clearTimeout(qrExpiryTimer);
    qrExpiryTimer = null;
  }
}

// Alert deduplication: track whether we have already fired an alert for the
// current disconnect/qr event so we don't spam the admin inbox.
let alertSentForCurrentSession = false;
// Timer that fires a "still disconnected" alert after DISCONNECT_ALERT_DELAY_MS.
let disconnectAlertTimer: ReturnType<typeof setTimeout> | null = null;
// How long (ms) to wait before alerting about a persistent disconnect.
const DISCONNECT_ALERT_DELAY_MS = 5 * 60 * 1_000; // 5 minutes

// ─── Alert helpers ────────────────────────────────────────────────────────────

/**
 * Returns the comma-separated list of admin email addresses from UC_ADMIN_EMAILS.
 * Falls back to an empty array when the env var is not set.
 */
export function alertRecipients(): string[] {
  return (process.env["UC_ADMIN_EMAILS"] ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * The URL of the ProjectHub page where admins can scan the QR code.
 * Controlled by PROJECTHUB_URL env var; defaults to the production system-status page.
 */
export function qrPageUrl(): string {
  const base = (process.env["PROJECTHUB_URL"] ?? "").replace(/\/+$/, "");
  return base ? `${base}/system` : "https://projecthub.ucfilters.co.ke/system";
}

/**
 * Returns true when the minimum alert configuration is present:
 * at least one recipient in UC_ADMIN_EMAILS.
 * Exposed so health checks and startup code can surface misconfiguration.
 */
export function isAlertConfigured(): boolean {
  return alertRecipients().length > 0;
}

/** Delivery options for sendSessionAlert — injected in tests to avoid real network calls. */
export interface AlertDeliveryOptions {
  resendSender?: (email: { from: string; to: string; subject: string; text: string }) => Promise<boolean>;
  emailSender?: (email: { to: string; subject: string; html: string; text: string }) => Promise<void>;
}

/**
 * Send a WhatsApp session alert email to all configured admin recipients.
 * Tries Resend first (Replit connector — no extra credentials needed in production),
 * then falls back to the SendGrid/SMTP chain in lib/email.
 * Fire-and-forget; errors are logged but never propagated.
 *
 * @param reason  "qr" for immediate re-auth needed; "disconnected" for a persistent drop.
 * @param opts    Optional delivery overrides (used in tests to avoid real network calls).
 */
export async function sendSessionAlert(
  reason: "qr" | "disconnected",
  opts: AlertDeliveryOptions = {},
): Promise<void> {
  const recipients = alertRecipients();
  if (recipients.length === 0) {
    console.warn(
      "[whatsapp] UC_ADMIN_EMAILS not configured — session alert not sent. " +
      "Set UC_ADMIN_EMAILS to a comma-separated list of admin addresses."
    );
    return;
  }
  const { subject, html, text } = buildWhatsAppAlertEmail({ reason, qrPageUrl: qrPageUrl() });
  const resendFn = opts.resendSender ?? sendViaResend;
  const emailFn  = opts.emailSender  ?? sendEmail;
  console.log(`[whatsapp] Sending session alert (${reason}) to ${recipients.join(", ")}`);
  for (const to of recipients) {
    // Try Resend first (pre-configured Replit connector, works without extra env vars).
    const sent = await resendFn({
      from: "Ultra Clear App <noreply@contacts.ucfilters.com>",
      to,
      subject,
      text,
    }).catch(() => false);
    if (sent) continue;
    // Fall back to SendGrid/SMTP if Resend is unavailable.
    console.warn(`[whatsapp] Resend unavailable for alert to ${to} — falling back to SendGrid/SMTP`);
    void emailFn({ to, subject, html, text });
  }
}

// ─── Public accessors ─────────────────────────────────────────────────────────

export function getWhatsAppStatus(): {
  state: WaState;
  qr: string | null;
  error: WaError | null;
} {
  return { state: connectionState, qr: currentQrDataUri, error: currentError };
}

/**
 * Send a WhatsApp message to the given phone number.
 * Returns the Baileys message key ID which can be stored to correlate
 * delivery/read receipts later.
 */
export async function sendWhatsAppMessage(
  to: string,
  text: string,
  signal?: AbortSignal,
): Promise<string> {
  if (signal?.aborted) throw new Error("WhatsApp delivery aborted");
  if (!sock || connectionState !== "connected") {
    throw new Error("WhatsApp session is not connected");
  }
  // Normalise number → JID: +254712345678 → 254712345678@s.whatsapp.net
  const digits = to.replace(/^\+/, "").replace(/\D/g, "");
  const jid = `${digits}@s.whatsapp.net`;
  const result = await Promise.race([
    sock.sendMessage(jid, { text }),
    new Promise<never>((_, reject) => {
      signal?.addEventListener("abort", () => reject(new Error("WhatsApp delivery aborted")), { once: true });
    }),
  ]);
  // result?.key?.id is the unique message ID Baileys assigns
  return result?.key?.id ?? "";
}

// ─── Receipt event handler ────────────────────────────────────────────────────

/**
 * Baileys WAMessageStatus enum values (from proto.WebMessageInfo.Status):
 *   PENDING      = 1
 *   SERVER_ACK   = 2
 *   DELIVERY_ACK = 3  → we map to "delivered"
 *   READ         = 4  → we map to "read"
 *   PLAYED       = 5  → we map to "read"
 */
async function handleMessageUpdates(updates: WAMessageUpdate[]): Promise<void> {
  for (const { key, update } of updates) {
    const msgId = key?.id;
    const status = update?.status;
    if (!msgId || status == null) continue;

    let deliveryStatus: "delivered" | "read" | null = null;
    if (status >= 4) {
      deliveryStatus = "read";
    } else if (status === 3) {
      deliveryStatus = "delivered";
    }
    if (!deliveryStatus) continue;

    try {
      // Only upgrade, never downgrade: delivered → read is allowed; read → delivered is not.
      const whereClause =
        deliveryStatus === "read"
          ? and(
              eq(notificationLogsTable.whatsappMessageId, msgId),
              or(
                isNull(notificationLogsTable.deliveryStatus),
                ne(notificationLogsTable.deliveryStatus, "read")
              )
            )
          : and(
              eq(notificationLogsTable.whatsappMessageId, msgId),
              isNull(notificationLogsTable.deliveryStatus)
            );

      const updated = await db
        .update(notificationLogsTable)
        .set({ deliveryStatus })
        .where(whereClause)
        .returning({ whatsappMsgId: notificationLogsTable.whatsappMessageId });

      // Push to any open SSE clients so the browser updates instantly
      // without needing to poll the logs endpoint.
      if (updated.length > 0) {
        pushReceiptUpdate({ whatsappMsgId: msgId, deliveryStatus });
      }
    } catch {
      // Non-fatal: receipt tracking should not crash the main flow
    }
  }
}

// ─── Session lifecycle ────────────────────────────────────────────────────────

const sessionOperations = new WhatsAppOperations(startWhatsApp, invalidateSession, clearWhatsAppSession);

export function initWhatsApp(): Promise<void> {
  return sessionOperations.connect();
}

async function startWhatsApp(): Promise<void> {
  if (isInitializing || connectionState === "connected") return;
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  // A manual retry starts a new lifecycle. Events from an older socket must
  // not be allowed to move the new connection back to a stale state.
  const generation = ++lifecycleGeneration;
  let latestQrSequence = 0;
  const previousSock = sock;
  sock = null;
  closeSocketWithoutLogout(previousSock);

  // Warn once at startup so misconfiguration is visible in server logs before
  // it silently swallows a real WhatsApp drop event.
  if (!isAlertConfigured()) {
    console.warn(
      "[whatsapp] DEPLOYMENT READINESS: UC_ADMIN_EMAILS is not set. " +
      "No one will be alerted if the WhatsApp session drops. " +
      "Set UC_ADMIN_EMAILS to a comma-separated list of admin email addresses."
    );
  }

  isInitializing = true;
  connectionState = "connecting";
  currentQrDataUri = null;
  currentError = null;

  try {
    // Migrate any legacy in-repo session files to AUTH_DIR and warn loudly if
    // credentials are ever detected inside the repo working tree.
    await migrateAndGuardSessionDir();

    // Restore credentials from Object Storage before Baileys reads AUTH_DIR.
    // This is what keeps the session alive across container replacements in
    // production.  In development (SESSION_BUCKET_PATH unset) it is a no-op.
    await syncFromObjectStorage();

    const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
    if (generation !== lifecycleGeneration) return;

    // Wrap saveCreds so every credential update is mirrored to Object Storage
    // immediately after the local files are written.
    const saveAndSyncCreds = async () => {
      if (generation !== lifecycleGeneration) return;
      sessionSyncQueue = sessionSyncQueue
        .then(async () => {
          if (generation !== lifecycleGeneration) return;
          await saveCreds();
          if (generation !== lifecycleGeneration) return;
          await syncToObjectStorage();
        })
        .catch((err) => {
          console.error(
            "[whatsapp] Session sync queue failed:",
            err instanceof Error ? err.message : "unknown error",
          );
        });
      await sessionSyncQueue;
    };

    const nextSock = makeWASocket({
      auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(state.keys, baileysLogger as never),
      },
      printQRInTerminal: false,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      logger: baileysLogger as any,
      // Prevent Baileys from loading the browser media cache — keeps memory low
      generateHighQualityLinkPreview: false,
    });
    if (generation !== lifecycleGeneration) {
      closeSocketWithoutLogout(nextSock);
      return;
    }
    sock = nextSock;

    let qrGenerationFailed = false;
    nextSock.ev.on("connection.update", async (update) => {
      if (generation !== lifecycleGeneration) return;
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        const qrSequence = ++latestQrSequence;
        clearQrExpiryTimer();
        try {
          const qrDataUri = await toDataURL(qr, { errorCorrectionLevel: "M", margin: 2 });
          if (
            !isCurrentQrConversion(
              generation,
              lifecycleGeneration,
              qrSequence,
              latestQrSequence,
            )
          ) {
            return;
          }
          currentQrDataUri = qrDataUri;
          currentError = null;
          connectionState = "qr";
          isInitializing = false;
          // Baileys rotates QR codes, but some versions do not emit an
          // explicit expiry event. Surface an actionable terminal state
          // rather than leaving ProjectHub with a stale QR forever.
          qrExpiryTimer = setTimeout(() => {
            if (
              generation !== lifecycleGeneration ||
              qrSequence !== latestQrSequence ||
              connectionState !== "qr"
            ) return;
            currentQrDataUri = null;
            currentError = {
              code: "QR_EXPIRED",
              message: "This WhatsApp QR code expired. Retry to generate a new code.",
            };
            connectionState = "error";
            isInitializing = false;
            qrExpiryTimer = null;
          }, 60_000);

          // Alert admins immediately: a QR state means the session has ended
          // and someone must physically scan the code to restore service.
          if (!alertSentForCurrentSession) {
            alertSentForCurrentSession = true;
            // Cancel any pending "disconnected" timer — the qr alert supersedes it.
            if (disconnectAlertTimer) {
              clearTimeout(disconnectAlertTimer);
              disconnectAlertTimer = null;
            }
            void sendSessionAlert("qr");
          }
        } catch {
          // A failed conversion is actionable and recoverable. Never leave
          // the card spinning in "connecting" after this failure.
          if (
            !isCurrentQrConversion(
              generation,
              lifecycleGeneration,
              qrSequence,
              latestQrSequence,
            )
          ) {
            return;
          }
          currentQrDataUri = null;
          currentError = {
            code: "QR_GENERATION_FAILED",
            message: "Could not generate a WhatsApp QR code. Retry to try again.",
          };
          connectionState = "error";
          isInitializing = false;
          qrGenerationFailed = true;
          if (disconnectAlertTimer) {
            clearTimeout(disconnectAlertTimer);
            disconnectAlertTimer = null;
          }
        }
      }

      if (connection === "close") {
        if (generation !== lifecycleGeneration) return;
        const statusCode =
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (lastDisconnect?.error as any)?.output?.statusCode;
        const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

        sock = null;
        clearQrExpiryTimer();
        currentQrDataUri = null;
        isInitializing = false;

        if (qrGenerationFailed) {
          // Keep the conversion failure visible until the operator retries.
          connectionState = "error";
        } else {
          currentError = null;
          connectionState = "disconnected";
        }

        if (shouldReconnect && !qrGenerationFailed) {
          // Back off 5 s before reconnecting so we don't hammer the WA servers
          if (!reconnectTimer) {
            reconnectTimer = setTimeout(() => { void initWhatsApp().catch(() => undefined); }, 5_000);
          }

          // Schedule a "still disconnected" alert if we haven't already alerted
          // for this disconnect cycle and no reconnect succeeds within the window.
          if (!alertSentForCurrentSession && !disconnectAlertTimer) {
            disconnectAlertTimer = setTimeout(() => {
              disconnectAlertTimer = null;
              if (connectionState !== "connected" && !alertSentForCurrentSession) {
                alertSentForCurrentSession = true;
                void sendSessionAlert("disconnected");
              }
            }, DISCONNECT_ALERT_DELAY_MS);
          }
        } else {
          // Logged out — alert immediately (no auto-reconnect will happen).
          // The qr-state handler above also fires shortly after, but guard here
          // in case Baileys doesn't emit a qr event on some logout paths.
          if (!alertSentForCurrentSession) {
            alertSentForCurrentSession = true;
            void sendSessionAlert("qr");
          }
        }
      }

      if (connection === "open") {
        if (generation !== lifecycleGeneration) return;
        if (reconnectTimer) {
          clearTimeout(reconnectTimer);
          reconnectTimer = null;
        }
        currentQrDataUri = null;
        clearQrExpiryTimer();
        currentError = null;
        connectionState = "connected";
        isInitializing = false;

        // Connection restored — reset alert state so the next disconnect cycle
        // can send a fresh alert.
        alertSentForCurrentSession = false;
        if (disconnectAlertTimer) {
          clearTimeout(disconnectAlertTimer);
          disconnectAlertTimer = null;
        }
      }
    });

    nextSock.ev.on("creds.update", saveAndSyncCreds);

    // ── Delivery & read receipts ─────────────────────────────────────────────
    // Baileys fires "messages.update" when the remote party receives or reads
    // a message we sent.  We match by the Baileys message key ID stored in the
    // notification_logs table and upgrade the delivery_status column.
    nextSock.ev.on("messages.update", (updates) => {
      // Fire-and-forget; errors are swallowed inside handleMessageUpdates
      void handleMessageUpdates(updates as WAMessageUpdate[]);
    });
  } catch (err) {
    if (generation !== lifecycleGeneration) return;
    console.error("[whatsapp] Init failed:", err);
    connectionState = "error";
    currentError = {
      code: "WHATSAPP_INIT_FAILED",
      message: "WhatsApp could not start. Check the server configuration and retry.",
    };
    isInitializing = false;
    // Retry after 10 s on unexpected init error. Disconnect clears this timer.
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      void initWhatsApp().catch(() => undefined);
    }, 10_000);
  }
}

export function disconnectWhatsApp(): Promise<void> {
  return sessionOperations.disconnect();
}

function invalidateSession(): void {
  // Invalidate all in-flight storage/auth work and event handlers before
  // awaiting logout. Baileys may emit a late "close" event after logout.
  lifecycleGeneration++;
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  clearQrExpiryTimer();
  if (disconnectAlertTimer) {
    clearTimeout(disconnectAlertTimer);
    disconnectAlertTimer = null;
  }
  // Reset alert state so the next session start gets a fresh alert if needed.
  alertSentForCurrentSession = false;
  currentError = {
    code: "SESSION_CLEANUP_REQUIRED",
    message: "Saved session cleanup is pending. Retry Disconnect before pairing again.",
  };
  currentQrDataUri = null;
  connectionState = "error";
}

async function clearWhatsAppSession(): Promise<void> {
  if (sock) {
    const activeSock = sock;
    sock = null;
    let logoutTimer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        activeSock.logout(),
        new Promise<void>((resolve) => { logoutTimer = setTimeout(resolve, 5_000); }),
      ]);
    } catch {
      // Ignore — socket may already be closed
    } finally {
      clearTimeout(logoutTimer);
      closeSocketWithoutLogout(activeSock);
    }
  }
  // Let any credential write that started before invalidation finish, then
  // delete both copies. This ordering prevents a late Object Storage upload
  // from restoring the old number after disconnect reports success.
  await sessionSyncQueue.catch(() => undefined);
  const cleanup = await Promise.allSettled([clearLocalSession(), clearStoredSession()]);
  currentQrDataUri = null;
  isInitializing = false;
  if (cleanup.some((result) => result.status === "rejected")) {
    throw new Error("WhatsApp session cleanup failed");
  }
  currentError = null;
  connectionState = "disconnected";
}
