/**
 * ProjectHub team authentication helpers.
 *
 * Stores the signed JWT in localStorage (projecthub:token) and the full user
 * object including page-level permissions in (projecthub:user).
 *
 * Admins bypass all page permissions — they can always view and edit everything.
 * Members have a per-page permission: "none" | "view" | "edit".
 */

import { apiUrl } from "./api-base";

const TOKEN_KEY = "projecthub:token";
const USER_KEY  = "projecthub:user";

// ─── Page permission types ────────────────────────────────────────────────────

export type PagePermission = "none" | "view" | "edit";

export const PAGES = [
  { slug: "dashboard",        label: "Dashboard" },
  { slug: "projects",         label: "Projects" },
  { slug: "tasks",            label: "Tasks" },
  { slug: "team",             label: "Team" },
  { slug: "ai-monitor",       label: "AI Monitor" },
  { slug: "impact",           label: "UC Impact" },
  { slug: "alison-feedback",  label: "Alison Feedback" },
  { slug: "contacts",         label: "Contacts" },
  { slug: "notifications",    label: "Notifications" },
  { slug: "system",           label: "System Status" },
  { slug: "monitoring",       label: "Monitoring" },
  { slug: "webhook",          label: "Webhook Tester" },
  { slug: "orders",           label: "Orders" },
  { slug: "tickets",          label: "Tickets" },
  { slug: "water-tests",      label: "Water Tests" },
  { slug: "uc-notifications", label: "Notification Failures" },
  { slug: "library",          label: "Library" },
] as const;

export type PageSlug = typeof PAGES[number]["slug"];

// ─── Token storage ────────────────────────────────────────────────────────────

export function getTeamToken(): string | null {
  try { return localStorage.getItem(TOKEN_KEY); } catch { return null; }
}
function setTeamToken(token: string): void {
  try { localStorage.setItem(TOKEN_KEY, token); } catch { /* no-op */ }
}
export function clearTeamToken(): void {
  try { localStorage.removeItem(TOKEN_KEY); } catch { /* no-op */ }
}

/** Returns Authorization header object for use in fetch calls, or null if not authenticated. */
export function getAuthHeaders(): Record<string, string> | null {
  const token = getTeamToken();
  return token ? { Authorization: `Bearer ${token}` } : null;
}

// ─── User info ────────────────────────────────────────────────────────────────

export interface TeamUser {
  id: string;
  email: string;
  name: string;
  role: "admin" | "member";
  permissions: Record<string, PagePermission>;
}

type TeamUserPayload = Omit<TeamUser, "permissions"> & {
  permissions?: Record<string, PagePermission> | null;
};

function normalizeTeamUser(user: TeamUserPayload): TeamUser {
  const permissions =
    user.permissions &&
    typeof user.permissions === "object" &&
    !Array.isArray(user.permissions)
      ? user.permissions
      : {};
  return { ...user, permissions };
}

function setStoredUser(user: TeamUserPayload): TeamUser {
  const normalized = normalizeTeamUser(user);
  try { localStorage.setItem(USER_KEY, JSON.stringify(normalized)); } catch { /* no-op */ }
  return normalized;
}

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const b64 = parts[1]!.replace(/-/g, "+").replace(/_/g, "/");
    const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
    return JSON.parse(atob(padded)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function tokenExp(token: string): number | null {
  const p = decodeJwtPayload(token);
  return typeof p?.exp === "number" ? p.exp : null;
}

export function getTeamUser(): TeamUser | null {
  // Prefer the stored user object (includes permissions)
  try {
    const stored = localStorage.getItem(USER_KEY);
    if (stored) {
      const u = JSON.parse(stored) as TeamUserPayload;
      if (u.id && u.email) return normalizeTeamUser(u);
    }
  } catch { /* fall through to JWT decode */ }
  // Fallback: decode JWT (no permissions available)
  const token = getTeamToken();
  if (!token) return null;
  const p = decodeJwtPayload(token);
  if (!p?.["id"] || !p?.["email"]) return null;
  return {
    id: String(p["id"]),
    email: String(p["email"]),
    name: typeof p["name"] === "string" ? p["name"] : String(p["email"]),
    role: p["role"] === "admin" ? "admin" : "member",
    permissions: {},
  };
}

export function isTeamAdmin(): boolean {
  return getTeamUser()?.role === "admin";
}

/** True when there is a stored token AND it has not expired (60-second grace). */
export function isTeamAuthenticated(): boolean {
  const token = getTeamToken();
  if (!token) return false;
  const exp = tokenExp(token);
  if (exp === null) return true;
  return exp > Math.floor(Date.now() / 1000) + 60;
}

// ─── Page permission helpers ──────────────────────────────────────────────────

/** Returns true if the current user may view (or edit) the given page. */
export function canView(page: PageSlug | string): boolean {
  const user = getTeamUser();
  if (!user) return false;
  if (user.role === "admin") return true;
  const level = (user.permissions?.[page] ?? "none") as PagePermission;
  return level === "view" || level === "edit";
}

/** Returns true if the current user may edit content on the given page. */
export function canEdit(page: PageSlug | string): boolean {
  const user = getTeamUser();
  if (!user) return false;
  if (user.role === "admin") return true;
  return (user.permissions?.[page] ?? "none") === "edit";
}

/** Refreshes the stored user profile and its live page permissions. */
export async function refreshTeamUser(): Promise<TeamUser> {
  const user = await apiFetch<TeamUserPayload>("/auth/me");
  return setStoredUser(user);
}

// ─── Auth state helpers ───────────────────────────────────────────────────────

export function clearTeamAuth(): void {
  clearTeamToken();
  try { localStorage.removeItem(USER_KEY); } catch { /* no-op */ }
}

export function handleUnauthorizedResponse(): void {
  clearTeamAuth();
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("projecthub:unauthorized"));
  }
}

// ─── Auth API helpers ─────────────────────────────────────────────────────────

export async function apiFetch<T = unknown>(
  path: string,
  opts: RequestInit = {},
): Promise<T> {
  const token = getTeamToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(opts.headers as Record<string, string>),
  };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const res = await fetch(apiUrl(path), { ...opts, headers });
  if (!res.ok) {
    if (res.status === 401) handleUnauthorizedResponse();
    const data = await res.json().catch(() => ({})) as { error?: string };
    throw new Error(data.error ?? `Request failed (${res.status})`);
  }
  return res.json() as Promise<T>;
}

// ─── Public auth flows ────────────────────────────────────────────────────────

export async function loginWithEmail(email: string, password: string): Promise<TeamUser> {
  const data = await apiFetch<{ token: string; user: TeamUserPayload }>("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
  setTeamToken(data.token);
  return setStoredUser(data.user);
}

/** Register via an invite link token */
export async function register(inviteToken: string, name: string, password: string): Promise<TeamUser> {
  const data = await apiFetch<{ token: string; user: TeamUserPayload }>("/auth/register", {
    method: "POST",
    body: JSON.stringify({ token: inviteToken, name, password }),
  });
  setTeamToken(data.token);
  return setStoredUser(data.user);
}

/** Sends a password reset email. Always resolves (server hides whether email exists). */
export async function forgotPassword(email: string): Promise<void> {
  await apiFetch("/auth/forgot-password", {
    method: "POST",
    body: JSON.stringify({ email }),
  });
}

/** Reset password using a token from the email link */
export async function resetPassword(token: string, newPassword: string): Promise<void> {
  await apiFetch("/auth/reset-password", {
    method: "POST",
    body: JSON.stringify({ token, newPassword }),
  });
}

// ─── Authenticated flows ──────────────────────────────────────────────────────

export async function changePassword(currentPassword: string, newPassword: string): Promise<void> {
  await apiFetch("/auth/change-password", {
    method: "POST",
    body: JSON.stringify({ currentPassword, newPassword }),
  });
}

// ─── Admin flows ──────────────────────────────────────────────────────────────

export interface TeamUserRecord {
  id: string;
  email: string;
  name: string;
  role: "admin" | "member";
  isActive: boolean;
  permissions: Record<string, PagePermission> | null;
  createdAt: string;
}

export async function listUsers(): Promise<TeamUserRecord[]> {
  return apiFetch<TeamUserRecord[]>("/auth/users");
}

export interface InviteResult {
  inviteUrl: string;
  email: string;
  expiresAt: string;
  emailSent: boolean;
}

export async function inviteUser(
  email: string,
  permissions?: Record<string, PagePermission>,
): Promise<InviteResult> {
  return apiFetch<InviteResult>("/auth/invitations", {
    method: "POST",
    body: JSON.stringify({ email, ...(permissions ? { permissions } : {}) }),
  });
}

export async function updateUserRole(userId: string, role: "admin" | "member"): Promise<TeamUserRecord> {
  return apiFetch<TeamUserRecord>(`/auth/users/${userId}/role`, {
    method: "PATCH",
    body: JSON.stringify({ role }),
  });
}

export async function updateUser(
  userId: string,
  updates: { name?: string; isActive?: boolean; permissions?: Record<string, PagePermission> },
): Promise<TeamUserRecord> {
  return apiFetch<TeamUserRecord>(`/auth/users/${userId}`, {
    method: "PATCH",
    body: JSON.stringify(updates),
  });
}

export interface AdminResetResult {
  resetUrl: string;
  email: string;
  expiresAt: string;
  emailSent: boolean;
}

export async function adminResetPassword(userId: string): Promise<AdminResetResult> {
  return apiFetch<AdminResetResult>(`/auth/users/${userId}/reset-password`, {
    method: "POST",
  });
}

export type RecoveryEmailType = "invitation" | "passwordReset";
export type RecoveryEmailDeliveryEvent =
  | "accepted"
  | "delivered"
  | "delayed"
  | "bounced"
  | "complained"
  | "failed";

/** Provider metadata only — never includes message contents or recovery links. */
export interface RecoveryEmailDelivery {
  id: number;
  recipient: string;
  type: RecoveryEmailType;
  sendStatus: "accepted" | "failed";
  deliveryEvent: RecoveryEmailDeliveryEvent;
  deliveryEventAt: string | null;
  sentAt: string;
  errorMessage: string | null;
}

export async function listRecoveryEmailDeliveries(): Promise<RecoveryEmailDelivery[]> {
  return apiFetch<RecoveryEmailDelivery[]>("/auth/recovery-emails?limit=20");
}

// ─── Legacy: passcode-based token (kept for WhatsApp external auth) ─────────

export async function loginWithPasscode(passcode: string): Promise<void> {
  const data = await apiFetch<{ token: string }>("/auth/token", {
    method: "POST",
    body: JSON.stringify({ passcode }),
  });
  setTeamToken(data.token);
}

/** @deprecated Use changePassword() instead */
export async function changePasscode(currentPasscode: string, newPasscode: string): Promise<void> {
  await apiFetch("/auth/change-passcode", {
    method: "POST",
    body: JSON.stringify({ currentPasscode, newPasscode }),
  });
}
