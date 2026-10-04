/**
 * Notification utilities for the Ultra-Clear Companion.
 *
 * Responsibilities:
 *   1. Notification permission + Expo push-token retrieval
 *   2. Scheduling the full 5-notification filter lifecycle sequence
 *   3. Filter activation state management (stored in AsyncStorage)
 *   4. Foreground notification handler
 *
 * All scheduling functions are no-ops on web.
 */
import { useEffect, useRef } from 'react';
import { AppState, Platform } from 'react-native';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import * as Notifications from 'expo-notifications';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { handleRejectedSessionResponse } from './deletedAccountResponse';
import { getApiBase } from '@/lib/apiBase';
import { loadPersistedSession } from '@/lib/sessionPersistence';
import { assignedPrimaryActivation } from '@/lib/assignedFilterHydration';
import type { CustomerFilterAssignment } from '@workspace/api-client-react/companion/models/customerFilterAssignment';

// ── Foreground handler ───────────────────────────────────────────────────────
if (Platform.OS !== 'web') {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowAlert:  true,
      shouldPlaySound:  false,
      shouldSetBadge:   true,
      shouldShowBanner: true,
      shouldShowList:   true,
    }),
  });
}

// ── Storage keys ─────────────────────────────────────────────────────────────
const PUSH_TOKEN_KEY        = 'uc_push_token';
// The token value most recently registered with the server — compared against
// the current Expo token on every app foreground so a rotated token (reinstall,
// OS update, permission change) is re-registered without a fresh login.
const REGISTERED_PUSH_TOKEN_KEY  = 'uc_push_token_registered';
// Legacy unscoped key — kept for one-time migration in getFilterActivation.
const FILTER_ACTIVATION_KEY_LEGACY      = 'uc_filter_activation';
const FILTER_LAST_CHANGED_KEY_LEGACY    = 'uc_filter_last_changed';
// Separate the maintenance count from an individual filter registration. A
// customer may re-register or replace a filter, but that must never silently
// erase their cleaning history. Only the team-admin reset flow may clear it.
const FILTER_CLEAN_COUNT_KEY_PREFIX     = 'uc_filter_clean_count_';
const NOTIF_PREFS_KEY            = 'uc_notif_prefs';
// Set to 'true' when a catalogue sync detects the registered product's
// filter_lifespan_days meta has been removed (lifespan <= 0). Cleared when
// the catalogue restores a valid lifespan, or when the user re-registers.
const ZERO_LIFESPAN_KEY          = 'uc_zero_lifespan_notice';

/**
 * Per-user AsyncStorage key for the filter activation record.
 * Scoped so two accounts on the same device never share activation state.
 */
export function filterActivationKey(userId: number): string {
  // Preserve the legacy guest/test key for callers that do not yet have an
  // authenticated account ID. Signed-in accounts always use an isolated key.
  return Number.isSafeInteger(userId) && userId > 0
    ? `uc_filter_activation_${userId}`
    : FILTER_ACTIVATION_KEY_LEGACY;
}

/**
 * Per-user AsyncStorage key for the "filter last changed" timestamp (ms).
 */
export function filterLastChangedKey(userId: number): string {
  return Number.isSafeInteger(userId) && userId > 0
    ? `uc_filter_last_changed_${userId}`
    : FILTER_LAST_CHANGED_KEY_LEGACY;
}

function filterCleanCountKey(userId: number): string {
  return Number.isSafeInteger(userId) && userId > 0
    ? `${FILTER_CLEAN_COUNT_KEY_PREFIX}${userId}`
    : `${FILTER_CLEAN_COUNT_KEY_PREFIX}guest`;
}

async function savedFilterCleanCount(userId: number): Promise<number> {
  try {
    const raw = await AsyncStorage.getItem(filterCleanCountKey(userId));
    const count = Number(raw);
    return Number.isSafeInteger(count) && count > 0 ? count : 0;
  } catch {
    return 0;
  }
}

async function saveFilterCleanCount(userId: number, count: number): Promise<void> {
  await AsyncStorage.setItem(filterCleanCountKey(userId), String(Math.max(0, Math.floor(count))));
}

// ── Notification preferences ─────────────────────────────────────────────────

export interface NotifPrefs {
  orderUpdates:    boolean;  // push notifications for order status (server-side)
  filterReminders: boolean;  // local scheduled filter lifecycle notifications
}

const DEFAULT_PREFS: NotifPrefs = { orderUpdates: true, filterReminders: true };

// ── Zero-lifespan notice helpers ──────────────────────────────────────────────

/**
 * Returns true when the last catalogue sync detected that the registered
 * product's lifespan meta was removed (lifespanDays <= 0). The UI uses this
 * to show a non-blocking notice on the filter status card.
 */
export async function getZeroLifespanNotice(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(ZERO_LIFESPAN_KEY)) === 'true';
  } catch { return false; }
}

/** Internal: write or clear the zero-lifespan notice flag. */
async function setZeroLifespanNotice(active: boolean): Promise<void> {
  try {
    if (active) {
      await AsyncStorage.setItem(ZERO_LIFESPAN_KEY, 'true');
    } else {
      await AsyncStorage.removeItem(ZERO_LIFESPAN_KEY);
    }
  } catch { /* non-critical */ }
}

export async function getNotifPrefs(strict = false): Promise<NotifPrefs> {
  try {
    const s = await AsyncStorage.getItem(NOTIF_PREFS_KEY);
    if (!s) return { ...DEFAULT_PREFS };
    const parsed = JSON.parse(s) as Partial<NotifPrefs>;
    if (strict && (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) ||
      (parsed.orderUpdates !== undefined && typeof parsed.orderUpdates !== 'boolean') ||
      (parsed.filterReminders !== undefined && typeof parsed.filterReminders !== 'boolean'))) {
      throw new Error('Invalid notification preferences');
    }
    return { ...DEFAULT_PREFS, ...parsed };
  } catch (error) { if (strict) throw error; return { ...DEFAULT_PREFS }; }
}

export async function saveNotifPrefs(prefs: NotifPrefs): Promise<void> {
  await AsyncStorage.setItem(NOTIF_PREFS_KEY, JSON.stringify(prefs));
}

// ── Types ─────────────────────────────────────────────────────────────────────

export type FlowRate    = 'good' | 'slow' | 'very_slow' | 'barely';
export type Taste       = 'normal' | 'slight' | 'strong';
export type WaterSource = 'mains' | 'borehole' | 'surface' | 'mixed';
export type PerfRecommendation = 'good' | 'clean' | 'replace';

export interface PerformanceCheckIn {
  date:           string;               // ISO timestamp
  flowRate:       FlowRate;
  taste:          Taste;
  waterSource:    WaterSource;
  recommendation: PerfRecommendation;
}

export interface FilterActivation {
  activatedAt:    string;               // ISO date — when the filter was installed / activated
  productId:      number;
  productName:    string;
  lifespanDays:   number;               // total rated lifespan for this product
  notifIds:       string[];             // IDs of all scheduled local notifications for this cycle
  // Performance tracking (all optional so old stored records still parse)
  cleanCount?:    number;               // account maintenance count; customer flows never decrease it
  lastCleanedAt?: string;               // ISO date of most recent clean
  lastWaterSource?: WaterSource;        // water source from most recent check-in
  lastCheckIn?:   PerformanceCheckIn;   // most recent performance check-in
  checkIns?:      PerformanceCheckIn[]; // full history (newest first)
  // Receipt registration link — the purchase record (order id) this activation
  // came from. Used to stop the same receipt line being registered twice for
  // the same product; a NEW purchase (different order id) restarts the cycle.
  sourceOrderId?: number;
  /** Exact capacity-ledger identity; gauge reads never change reminder state. */
  registeredFilterId?: number;
  /**
   * Day-offsets (from activatedAt) for the two replacement-reminder stages,
   * computed at check-in time when a performance check-in shortens the filter's
   * effective life. Null / absent = no adjustment; use the rated schedule.
   *
   * Persisting the offsets (rather than the effective lifespan alone) ensures
   * the server dispatches on the exact same dates as the rescheduled phone
   * notifications, even when the check-in happened after the originally
   * scheduled offset would have already passed.
   */
  adjustedOffsets?: { replace30: number; replace15: number };
}

/**
 * Compute the effective lifespan (in days) based on water quality and clean history.
 * The rated lifespan assumes reasonable mains water. Poor sources shorten real life.
 */
export function effectiveLifespanDays(activation: FilterActivation): number {
  const { lifespanDays, cleanCount = 0, lastWaterSource } = activation;
  let m = 1.0;
  if (lastWaterSource === 'surface')   m *= 0.55;
  else if (lastWaterSource === 'borehole') m *= 0.70;
  else if (lastWaterSource === 'mixed')    m *= 0.82;
  if (cleanCount >= 2) m *= 0.65;
  else if (cleanCount === 1) m *= 0.80;
  return Math.max(Math.ceil(lifespanDays * m), 21); // floor at 21 days
}

/**
 * Score-based recommendation engine.
 * Higher score = worse filter condition.
 */
export function computeRecommendation(
  flow: FlowRate,
  taste: Taste,
  source: WaterSource,
  cleanCount: number,
  elapsedDays: number,
  lifespanDays: number,
): PerfRecommendation {
  let score = 0;

  // Flow rate
  if (flow === 'barely')    score += 5;
  else if (flow === 'very_slow') score += 3;
  else if (flow === 'slow') score += 1;

  // Taste / smell
  if (taste === 'strong')  score += 3;
  else if (taste === 'slight') score += 1;

  // Water source harshness
  if (source === 'surface')   score += 3;
  else if (source === 'borehole') score += 1;
  else if (source === 'mixed')    score += 1;

  // Clean history — already cleaned means filter is on borrowed time
  if (cleanCount >= 2) score += 4;
  else if (cleanCount === 1) score += 2;

  // How far through rated lifespan
  const pct = elapsedDays / lifespanDays;
  if (pct > 0.85) score += 3;
  else if (pct > 0.65) score += 1;

  if (score >= 7) return 'replace';
  if (score >= 3) return 'clean';
  return 'good';
}

// ── Products with rated lifespans ────────────────────────────────────────────
// The trackable-product list (names + lifespanDays) now comes from the live
// catalogue via hooks/useFilterProducts.ts (API → AsyncStorage cache →
// static fallback), so it can no longer drift out of sync with the API.

// ── Permission helpers ────────────────────────────────────────────────────────
export type NotifPermStatus = 'granted' | 'denied' | 'undetermined';

// expo-notifications v57 types don't re-export PermissionResponse fields;
// we access them via a runtime cast.
type PermResult = { granted: boolean; canAskAgain: boolean };
function parsePermResult(raw: unknown): PermResult {
  const r = raw as Record<string, unknown>;
  return { granted: Boolean(r['granted']), canAskAgain: r['canAskAgain'] !== false };
}

export async function getNotificationPermissionStatus(): Promise<NotifPermStatus> {
  if (Platform.OS === 'web') return 'undetermined';
  try {
    const { granted, canAskAgain } = parsePermResult(await Notifications.getPermissionsAsync());
    if (granted) return 'granted';
    if (!canAskAgain) return 'denied';
    return 'undetermined';
  } catch { return 'undetermined'; }
}

export async function requestNotificationPermission(): Promise<boolean> {
  if (Platform.OS === 'web') return false;
  try {
    if (parsePermResult(await Notifications.getPermissionsAsync()).granted) return true;
    return parsePermResult(await Notifications.requestPermissionsAsync()).granted;
  } catch { return false; }
}

export async function ensureAndroidChannel(): Promise<void> {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync('uc-default', {
    name: 'Ultra-Clear',
    importance: Notifications.AndroidImportance.DEFAULT,
    vibrationPattern: [0, 200, 200, 200],
    lightColor: '#0054A6',
    showBadge: true,
  });
}

/**
 * Android Expo Go supports permissions and local notifications, but Expo
 * remote push-token registration is unavailable there. Keep this check scoped
 * to the remote-token paths so local reminders continue to work.
 */
export function isRemotePushTokenUnsupported(): boolean {
  return Platform.OS === 'android'
    && Constants.executionEnvironment === ExecutionEnvironment.StoreClient;
}

export async function getExpoPushToken(): Promise<string | null> {
  if (Platform.OS === 'web' || isRemotePushTokenUnsupported()) return null;
  try {
    const cached = await AsyncStorage.getItem(PUSH_TOKEN_KEY);
    if (cached) return cached;
    const granted = await requestNotificationPermission();
    if (!granted) return null;
    await ensureAndroidChannel();
    const { data } = await Notifications.getExpoPushTokenAsync();
    await AsyncStorage.setItem(PUSH_TOKEN_KEY, data);
    return data;
  } catch { return null; }
}

// ── Server push-token registration & foreground sync ─────────────────────────

// All server registrations run through a single promise chain so a login-time
// registration and a foreground sync can never interleave. Each queued step
// fetches the *current* OS token at its turn, so the last server write always
// carries the freshest token — no stale-request-finishes-last race.
let pushRegistrationChain: Promise<unknown> = Promise.resolve();
function enqueuePushRegistration<T>(fn: () => Promise<T>): Promise<T> {
  const next = pushRegistrationChain.then(fn, fn);
  pushRegistrationChain = next.then(() => undefined, () => undefined);
  return next;
}

export interface RegisterPushTokenOptions {
  /** Allow the OS permission prompt (login/registration flows). Default false. */
  allowPrompt?: boolean;
  /** POST even if the token matches the last-registered value (e.g. a different user just logged in). Default false. */
  force?: boolean;
}

/**
 * Fetch the current Expo push token from the OS and register it with the
 * server if it differs from the last-registered value (or when forced).
 * Serialized — concurrent callers are queued, never interleaved.
 */
export async function registerCurrentPushToken(
  authToken: string,
  { allowPrompt = false, force = false }: RegisterPushTokenOptions = {},
): Promise<boolean> {
  if (Platform.OS === 'web' || isRemotePushTokenUnsupported()) return false;
  return enqueuePushRegistration(async () => {
    try {
      const granted = allowPrompt
        ? await requestNotificationPermission()
        : (await getNotificationPermissionStatus()) === 'granted';
      if (!granted) return false;

      await ensureAndroidChannel();
      // Always fetch fresh from the OS — never trust the AsyncStorage cache
      // for server registration, since Expo may have rotated the token.
      const { data: current } = await Notifications.getExpoPushTokenAsync();
      if (!current) return false;
      await AsyncStorage.setItem(PUSH_TOKEN_KEY, current);

      if (!force) {
        const lastRegistered = await AsyncStorage.getItem(REGISTERED_PUSH_TOKEN_KEY);
        if (lastRegistered === current) return true; // up to date — no API call
      }

      const res = await fetch(`${getApiBase()}/api/uc/notify/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
        body: JSON.stringify({ pushToken: current }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as Record<string, unknown>;
        await handleRejectedSessionResponse(res.status, authToken);
        return false;
      }
      await AsyncStorage.setItem(REGISTERED_PUSH_TOKEN_KEY, current);
      return true;
    } catch { return false; }
  });
}

/**
 * Unregister the device's push token server-side (called on logout) and clear
 * the local last-registered marker so the next login re-registers cleanly.
 * Sends this device's own token so the server deletes the registration only
 * if it still belongs to this device — logging out on one device never stops
 * notifications for another device the user logged into more recently.
 * Serialized with registrations so an in-flight login/foreground registration
 * can never interleave with the delete. Best-effort — never throws.
 */
export async function unregisterPushToken(authToken: string): Promise<void> {
  if (Platform.OS === 'web' || isRemotePushTokenUnsupported()) return;
  await enqueuePushRegistration(async () => {
    try {
      // Identify this device's token before clearing local state.
      const localToken =
        (await AsyncStorage.getItem(REGISTERED_PUSH_TOKEN_KEY)) ??
        (await AsyncStorage.getItem(PUSH_TOKEN_KEY));
      await AsyncStorage.removeItem(REGISTERED_PUSH_TOKEN_KEY);
      const res = await fetch(`${getApiBase()}/api/uc/notify/register`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
        ...(localToken ? { body: JSON.stringify({ pushToken: localToken }) } : {}),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as Record<string, unknown>;
        await handleRejectedSessionResponse(res.status, authToken);
      }
    } catch { /* non-critical — silently ignore */ }
  });
}

/**
 * Foreground sync: re-register only if the current Expo token differs from
 * the last value sent to the server. Never prompts, never posts redundantly.
 */
export async function syncPushTokenWithServer(authToken: string): Promise<void> {
  await registerCurrentPushToken(authToken, { allowPrompt: false, force: false });
}

/**
 * Hook: keeps the server's push token fresh while the app is in use.
 * Runs a sync on mount (when logged in) and on every foreground transition,
 * so tokens rotated by Expo (reinstall, OS update, permission change) are
 * picked up without requiring a fresh login.
 */
export function usePushTokenSync(authToken: string | null): void {
  const syncing = useRef(false);

  useEffect(() => {
    if (Platform.OS === 'web' || !authToken) return;

    const sync = () => {
      if (syncing.current) return;
      syncing.current = true;
      syncPushTokenWithServer(authToken).finally(() => { syncing.current = false; });
    };

    sync(); // initial sync when the hook mounts / auth token becomes available

    const sub = AppState.addEventListener('change', state => {
      if (state === 'active') sync();
    });
    return () => sub.remove();
  }, [authToken]);
}

// ── Server reminder sync ─────────────────────────────────────────────────────
//
// Mirrors the local activation to the server (uc_filter_reminders) so the
// daily backend job can deliver the same lifecycle reminders via email / SMS /
// WhatsApp for users who opted in. Fire-and-forget: local scheduling never
// depends on it, guests (no auth token) are skipped silently.

export async function syncReminderToServer(
  activation: Pick<
    FilterActivation,
    | 'productId' | 'productName' | 'lifespanDays' | 'activatedAt' | 'sourceOrderId'
    // Performance-check fields — needed to derive the effective lifespan so
    // every sync path (register, prefs, catalogue correction, check-in)
    // consistently carries the adjusted schedule to the server.
    | 'cleanCount' | 'lastWaterSource'
    // Persisted adjusted day-offsets from the most recent rescheduling event.
    // Carrying these lets the server dispatch on exactly the same dates as the
    // rescheduled phone notifications, even for late check-ins where the
    // "tomorrow" guard pushed offset30 past the formula-derived date.
    | 'adjustedOffsets'
  > | null
): Promise<void> {
  try {
    const token = (await loadPersistedSession()).session?.token;
    if (!token) return;

    // Derive the performance-adjusted lifespan only when adjustedOffsets are also set.
    // When a good check-in clears adjustedOffsets, omitting effectiveLifespanDays
    // causes the server to store null and revert ALL stages to rated-lifespan
    // dispatch — matching the handset schedule that also reverts to rated dates.
    let effDaysPayload: number | undefined;
    if (activation && activation.adjustedOffsets != null) {
      const eff = effectiveLifespanDays(activation as FilterActivation);
      if (eff < activation.lifespanDays) effDaysPayload = eff;
    }

    const res = await fetch(`${getApiBase()}/api/uc/reminders/sync`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        activation: activation
          ? {
              productId:     activation.productId,
              productName:   activation.productName,
              lifespanDays:  activation.lifespanDays,
              activatedAt:   activation.activatedAt,
              sourceOrderId: activation.sourceOrderId,
              // Monotonic version: generated at call-time so the server can
              // detect and reject out-of-order completions (a slow earlier
              // request arriving after a faster later one).
              syncedAt:      new Date().toISOString(),
              ...(effDaysPayload !== undefined
                ? { effectiveLifespanDays: effDaysPayload }
                : {}),
              ...(activation.adjustedOffsets != null
                ? { adjustedReplaceOffsets: activation.adjustedOffsets }
                : {}),
            }
          : null,
      }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({})) as Record<string, unknown>;
      await handleRejectedSessionResponse(res.status, token);
    }
  } catch {
    /* non-critical — the next sync (register / clear / prefs visit) retries */
  }
}

let legacyFilterMigrationChain: Promise<unknown> = Promise.resolve();
/**
 * Load the filter activation for a specific user account.
 *
 * On the very first call for a given userId the function checks the legacy
 * unscoped key ('uc_filter_activation') and migrates any found record to the
 * user-scoped key, so existing single-account devices are unaffected.
 */
export async function getFilterActivation(userId: number): Promise<FilterActivation | null> {
  try {
    const key = filterActivationKey(userId);
    const s = await AsyncStorage.getItem(key);
    if (s) return JSON.parse(s) as FilterActivation;
    // Guests and legacy tests use the original shared key above; there is no
    // account-scoped migration to perform in that case.
    if (!Number.isSafeInteger(userId) || userId <= 0) return null;

    return await enqueueLegacyFilterMigration(async () => {
      // Another account load may have completed while this one was queued.
      const scoped = await AsyncStorage.getItem(key);
      if (scoped) return JSON.parse(scoped) as FilterActivation;

      // ── One-time migration from the legacy unscoped key ────────────────────
      const legacy = await AsyncStorage.getItem(FILTER_ACTIVATION_KEY_LEGACY);
      if (!legacy) return null;

      // Migrate activation record
      await AsyncStorage.setItem(key, legacy);
      await AsyncStorage.removeItem(FILTER_ACTIVATION_KEY_LEGACY);

      // Migrate companion timestamp key if present
      const lastChanged = await AsyncStorage.getItem(FILTER_LAST_CHANGED_KEY_LEGACY);
      if (lastChanged) {
        await AsyncStorage.setItem(filterLastChangedKey(userId), lastChanged);
        await AsyncStorage.removeItem(FILTER_LAST_CHANGED_KEY_LEGACY);
      }

      return JSON.parse(legacy) as FilterActivation;
    });
  } catch { return null; }
}

// ── Filter lifecycle notifications ───────────────────────────────────────────
const activationWrites = new Map<number, Promise<unknown>>();
function withActivationWrite<T>(userId: number, fn: () => Promise<T>): Promise<T> {
  const prior = activationWrites.get(userId) ?? Promise.resolve();
  const next = prior.catch(() => undefined).then(fn);
  activationWrites.set(userId, next);
  void next.finally(() => { if (activationWrites.get(userId) === next) activationWrites.delete(userId); }).catch(() => undefined);
  return next;
}

/** Fill-only hydration, with no registration or reminder side effects. */
export function hydrateAssignedFilter(userId: number, assignments: CustomerFilterAssignment[], isCurrent: () => boolean): Promise<FilterActivation | null> {
  return withActivationWrite(userId, async () => {
    if (!isCurrent()) return null;
    const existing = await getFilterActivation(userId);
    if (existing) return existing;
    const activation = assignedPrimaryActivation(null, assignments, await savedFilterCleanCount(userId));
    if (!activation || !isCurrent()) return null;
    await saveFilterCleanCount(userId, activation.cleanCount ?? 0);
    await AsyncStorage.setItem(filterActivationKey(userId), JSON.stringify(activation));
    await AsyncStorage.setItem(filterLastChangedKey(userId), String(new Date(activation.activatedAt).getTime()));
    return activation;
  });
}
//
// 5 notifications per filter cycle:
//   1. Day  0 (+2 h)         — Activate your filter
//   2. Day 30               — 30-day performance check
//   3. Day 60               — 60-day performance + water quality advisory
//   4. lifespan−30 days      — Replacement offer: 10% / 15% discount
//   5. lifespan−15 days      — Urgent offer: 10% off for 48 h
//
// Notifications whose target date has already passed are silently skipped.

/**
 * Schedules all 5 filter lifecycle notifications and persists the activation
 * under the user-scoped AsyncStorage key so two accounts on the same device
 * never share filter state.
 * Cancels any previously scheduled cycle first.
 */
export async function scheduleAllFilterNotifications(
  params: Omit<FilterActivation, 'notifIds'>,
  userId: number,
): Promise<FilterActivation> {
  return withActivationWrite(userId, () => scheduleAllFilterNotificationsUnlocked(params, userId));
}

async function scheduleAllFilterNotificationsUnlocked(
  params: Omit<FilterActivation, 'notifIds'>,
  userId: number,
): Promise<FilterActivation> {
  const activationKey    = filterActivationKey(userId);
  const lastChangedKey   = filterLastChangedKey(userId);
  // A fresh registration used to omit cleanCount, which reset it to zero when
  // the new activation replaced the stored one. Keep the largest known count
  // across every customer-side registration/reschedule. Admin-only maintenance
  // tools can use resetFilterCleanCount() before initiating a new cycle.
  const priorActivation = await getFilterActivation(userId);
  const retainedCleanCount = Math.max(
    params.cleanCount ?? 0,
    priorActivation?.cleanCount ?? 0,
    await savedFilterCleanCount(userId),
  );
  const normalizedParams: Omit<FilterActivation, 'notifIds'> = {
    ...params,
    cleanCount: retainedCleanCount,
    lastCleanedAt: params.lastCleanedAt ?? priorActivation?.lastCleanedAt,
  };
  await saveFilterCleanCount(userId, retainedCleanCount);

  if (Platform.OS === 'web') {
    const activation: FilterActivation = { ...normalizedParams, notifIds: [] };
    await AsyncStorage.setItem(activationKey, JSON.stringify(activation));
    await AsyncStorage.setItem(lastChangedKey, new Date(normalizedParams.activatedAt).getTime().toString());
    void syncReminderToServer(activation);
    return activation;
  }

  await cancelAllFilterNotifications(userId);

  // Guard: a non-positive lifespan means the product is not trackable —
  // persist the activation but never schedule offers at nonsensical dates.
  // Set the notice flag so the UI can inform the user.
  if (!(normalizedParams.lifespanDays > 0)) {
    await setZeroLifespanNotice(true);
    const activation: FilterActivation = { ...normalizedParams, notifIds: [] };
    await AsyncStorage.setItem(activationKey, JSON.stringify(activation));
    await AsyncStorage.setItem(lastChangedKey, new Date(normalizedParams.activatedAt).getTime().toString());
    void syncReminderToServer(activation);
    return activation;
  }
  // Positive lifespan — this is a trackable registration, clear any previous notice.
  await setZeroLifespanNotice(false);

  const [status, prefs] = await Promise.all([
    getNotificationPermissionStatus(),
    getNotifPrefs(),
  ]);
  // (activationKey and lastChangedKey are captured in the closure above)

  if (status !== 'granted' || !prefs.filterReminders) {
    const activation: FilterActivation = { ...normalizedParams, notifIds: [] };
    await AsyncStorage.setItem(activationKey, JSON.stringify(activation));
    await AsyncStorage.setItem(lastChangedKey, new Date(normalizedParams.activatedAt).getTime().toString());
    void syncReminderToServer(activation);
    return activation;
  }

  await ensureAndroidChannel();

  const { productName, lifespanDays } = normalizedParams;
  const activationDate = new Date(normalizedParams.activatedAt);
  const now             = Date.now();
  const ids: string[]   = [];

  /** Schedule a notification at `targetDate`; returns the ID or null if already past. */
  async function scheduleAt(
    targetDate: Date,
    content: { title: string; body: string; data?: Record<string, unknown> }
  ): Promise<void> {
    const secondsFromNow = Math.floor((targetDate.getTime() - now) / 1000);
    if (secondsFromNow < 30) return; // already past or imminent — skip
    try {
      const id = await Notifications.scheduleNotificationAsync({
        content: { ...content, sound: false },
        trigger: { seconds: secondsFromNow } as unknown as null,
      });
      ids.push(id);
    } catch { /* non-critical — silently ignore scheduling failures */ }
  }

  // ── 1. Activation reminder (+2 hours if activated today or yesterday)
  const daysSinceActivation = (now - activationDate.getTime()) / 86_400_000;
  if (daysSinceActivation < 2) {
    await scheduleAt(
      new Date(activationDate.getTime() + 2 * 3_600_000),
      {
        title: `🔧 Activate your ${productName}`,
        body:  `Follow the installation guide to get your filter running. Clean, purified water in minutes! Tap for step-by-step help.`,
        data:  { screen: 'support', type: 'activation' },
      }
    );
  }

  // ── 2. Day-30 performance check
  if (lifespanDays > 45) {
    await scheduleAt(
      new Date(activationDate.getTime() + 30 * 86_400_000),
      {
        title: `💧 30-day filter check-in`,
        body:  `Your ${productName} has been running for 30 days — ${lifespanDays - 30} days remaining. How's the water taste and flow?`,
        data:  { screen: 'support', type: 'performance_check', daysLeft: lifespanDays - 30 },
      }
    );
  }

  // ── 3. Day-60 performance + Nairobi water quality advisory
  if (lifespanDays > 75) {
    const daysLeft60 = lifespanDays - 60;
    await scheduleAt(
      new Date(activationDate.getTime() + 60 * 86_400_000),
      {
        title: `⚠️ Filter performance check`,
        body:  `Your filter is at 60 days (${daysLeft60} days left). Nairobi's water can be harsh on filters — slow flow or unusual taste? Try a flush, or let our AI assistant guide you.`,
        data:  { screen: 'support', type: 'performance_ai', daysLeft: daysLeft60 },
      }
    );
  }

  // ── 4. 30 days before replacement — discount offer
  // Math.floor ensures the clamp is stable when daysSinceActivation is a tiny
  // fraction above a whole number (e.g. 49.999 → floor=49 → offset4=50, today).
  // When stored adjusted offsets exist (from a check-in rescheduling), honour
  // them so a re-enabled local schedule fires on the same dates as the server
  // dispatch — avoids handset/server drift on disable→re-enable or catalogue correction.
  const offset4 = normalizedParams.adjustedOffsets?.replace30
    ?? Math.max(Math.min(lifespanDays - 30, lifespanDays - 1), Math.floor(daysSinceActivation) + 1);
  await scheduleAt(
    new Date(activationDate.getTime() + offset4 * 86_400_000),
    {
      title: `📅 Time to order your replacement filter`,
      body:  `Your ${productName} needs replacing in ~30 days. Order now and save: 10% off 1 filter (REPLACE10) or 15% off 2 (REPLACE15). Delivery takes 1–2 days.`,
      data:  { screen: 'products', type: 'discount_30', code1: 'REPLACE10', code2: 'REPLACE15' },
    }
  );

  // ── 5. 15 days before replacement — urgent 48-hour offer
  const offset5 = normalizedParams.adjustedOffsets?.replace15
    ?? Math.max(offset4 + 1, lifespanDays - 15);
  await scheduleAt(
    new Date(activationDate.getTime() + offset5 * 86_400_000),
    {
      title: `🚨 Filter expires in ~15 days — 10% off`,
      body:  `Order your ${productName} replacement today with code FRESH48 for 10% off (valid 48 hrs). Clean water protects your family and your appliances. Don't risk it!`,
      data:  { screen: 'products', type: 'discount_15', code: 'FRESH48' },
    }
  );

  const activation: FilterActivation = { ...normalizedParams, notifIds: ids };
  await AsyncStorage.setItem(activationKey, JSON.stringify(activation));
  await AsyncStorage.setItem(lastChangedKey, activationDate.getTime().toString());
  void syncReminderToServer(activation);
  return activation;
}

/** Cancel all scheduled notifications for the current filter cycle. */
export async function cancelAllFilterNotifications(userId: number): Promise<void> {
  if (Platform.OS === 'web') return;
  try {
    const s = await AsyncStorage.getItem(filterActivationKey(userId));
    if (!s) return;
    const a: FilterActivation = JSON.parse(s);
    await Promise.all((a.notifIds ?? []).map(id =>
      Notifications.cancelScheduledNotificationAsync(id).catch(() => {})
    ));
  } catch {}
}

/**
 * Syncs an existing activation's lifespanDays with the latest catalogue value.
 *
 * Called each time useFilterProducts returns a fresh (non-fallback) product list.
 * If the catalogue has corrected a product's lifespan since the user registered,
 * this reschedules all notifications using the new lifespan while preserving the
 * original activation date and all other stored fields (performance history, etc.).
 *
 * Returns the updated FilterActivation when a change was applied, or null when:
 *   – no activation is stored
 *   – the registered product is not found in the catalogue (offline / mismatch)
 *   – the lifespan matches — no update needed
 */
export async function syncActivationWithCatalogue(
  catalogueProducts: Array<{ id: number; lifespanDays: number; name: string }>,
  userId: number,
): Promise<FilterActivation | null> {
  if (catalogueProducts.length === 0) return null;

  const existing = await getFilterActivation(userId);
  if (!existing) return null;

  const catalogueProduct = catalogueProducts.find(p => p.id === existing.productId);
  if (!catalogueProduct) return null;

  // Guard: a catalogue lifespan of 0 (meta removed / bad store data) is not a
  // real correction — refuse the sync rather than reschedule with a bogus
  // lifespan and offers at nonsensical dates. Set the notice flag so the UI
  // can warn the user; the previous schedule is left intact.
  if (!(catalogueProduct.lifespanDays > 0)) {
    await setZeroLifespanNotice(true);
    return null;
  }

  // Catalogue has a valid lifespan — clear any previous zero-lifespan notice,
  // even if the lifespan hasn't changed (the store data is trustworthy again).
  await setZeroLifespanNotice(false);

  if (catalogueProduct.lifespanDays === existing.lifespanDays) return null;

  // Lifespan has changed in the catalogue — reschedule with the corrected value,
  // preserving the original activation date so elapsed-time calculations stay correct.
  const updated = await scheduleAllFilterNotifications({
    activatedAt:     existing.activatedAt,
    productId:       existing.productId,
    productName:     catalogueProduct.name,
    lifespanDays:    catalogueProduct.lifespanDays,
    cleanCount:      existing.cleanCount,
    lastCleanedAt:   existing.lastCleanedAt,
    lastWaterSource: existing.lastWaterSource,
    lastCheckIn:     existing.lastCheckIn,
    checkIns:        existing.checkIns,
    // Preserve the receipt linkage — losing it would let the same receipt
    // line be registered again after a catalogue lifespan correction.
    sourceOrderId:   existing.sourceOrderId,
    registeredFilterId: existing.registeredFilterId,
    // Preserve check-in-derived offsets so the rescheduled local notifications
    // fire on the same dates as the server dispatch.  A degradation result
    // takes precedence over a catalogue correction for replace30/replace15.
    adjustedOffsets: existing.adjustedOffsets,
  }, userId);

  return updated;
}

/** Remove the filter activation record (call when user resets / unregisters filter). */
export async function clearFilterActivation(userId: number): Promise<void> {
  // Upgrade safety: older app versions stored the count only on the activation
  // record. Copy it to the account-level key before removing that record.
  const existing = await getFilterActivation(userId);
  if (existing?.cleanCount != null) {
    await saveFilterCleanCount(
      userId,
      Math.max(existing.cleanCount, await savedFilterCleanCount(userId)),
    );
  }
  await cancelAllFilterNotifications(userId);
  await AsyncStorage.removeItem(filterActivationKey(userId));
  await AsyncStorage.removeItem(filterLastChangedKey(userId));
  await setZeroLifespanNotice(false);
  // Stop server-side email/SMS/WhatsApp reminders for the cleared filter too.
  void syncReminderToServer(null);
}

/**
 * Clears the account's maintenance count. This is intentionally not exposed
 * through customer screens; call it only from an authenticated team-admin
 * action after a verified replacement or correction.
 */
export async function resetFilterCleanCount(userId: number): Promise<FilterActivation | null> {
  await AsyncStorage.removeItem(filterCleanCountKey(userId));
  const existing = await getFilterActivation(userId);
  if (!existing) return null;

  const updated: FilterActivation = {
    ...existing,
    cleanCount: 0,
    lastCleanedAt: undefined,
  };
  await AsyncStorage.setItem(filterActivationKey(userId), JSON.stringify(updated));
  return updated;
}

// ── Performance check-in ──────────────────────────────────────────────────────

/**
 * Persist a completed performance check-in.
 * If the recommendation is 'replace', we reschedule the replacement
 * notifications to fire sooner based on the effective (adjusted) lifespan.
 */
export async function recordPerformanceCheckIn(
  checkIn: PerformanceCheckIn,
  userId: number,
): Promise<FilterActivation | null> {
  try {
    const existing = await getFilterActivation(userId);
    if (!existing) return null;

    const history = [checkIn, ...(existing.checkIns ?? [])].slice(0, 20); // keep last 20

    const updated: FilterActivation = {
      ...existing,
      lastWaterSource: checkIn.waterSource,
      lastCheckIn:     checkIn,
      checkIns:        history,
    };

    // Compute the adjusted effective lifespan — used both to gate rescheduling
    // and to sync the updated schedule to the server so email/SMS/WhatsApp
    // reminders fire on the same dates as the rescheduled phone notifications.
    const effDays = effectiveLifespanDays(updated);

    if (
      (checkIn.recommendation === 'replace' || checkIn.recommendation === 'clean') &&
      effDays < existing.lifespanDays
    ) {
      // ── Adjustment needed — compute and store offsets ───────────────────
      // Persisted regardless of push-notification permission or local prefs so
      // email/SMS/WhatsApp reminders (independent opt-in) fire on adjusted dates.
      const activationDate = new Date(updated.activatedAt);
      const elapsed = Math.floor((Date.now() - activationDate.getTime()) / 86_400_000);
      const offset30 = Math.max(elapsed + 1, effDays - 30);
      const offset15 = Math.max(offset30 + 1, effDays - 10);
      updated.adjustedOffsets = { replace30: offset30, replace15: offset15 };
    } else {
      // ── Good check-in / no adjustment ──────────────────────────────────
      // Clear any previous adjustment so the server reverts to rated-lifespan
      // dispatch for all stages (replace30/replace15).
      updated.adjustedOffsets = undefined;
    }

    // Reschedule local notifications, persist, and sync to server in one step.
    // scheduleAllFilterNotifications:
    //   1. Calls cancelAllFilterNotifications() to cancel any previously
    //      adjusted alerts (reads the OLD AsyncStorage state before this write).
    //   2. Schedules replacement alerts at adjusted offsets (if adjustedOffsets
    //      is set) or at rated-lifecycle formula dates (if cleared), skipping any
    //      dates already in the past.  Respects push permission and local prefs.
    //   3. Writes the final activation (with new notifIds) to AsyncStorage.
    //   4. Syncs adjustedOffsets + effectiveLifespanDays (or null) to the server
    //      so email/SMS/WhatsApp fire on the same dates as phone notifications.
    return await scheduleAllFilterNotifications(updated, userId);
  } catch {
    return null;
  }
}

/**
 * Record that the user cleaned their filter.
 * Increments cleanCount, stamps lastCleanedAt, persists, and returns the updated record.
 */
export async function recordFilterClean(userId: number): Promise<FilterActivation | null> {
  try {
    const existing = await getFilterActivation(userId);
    if (!existing) return null;

    const updated: FilterActivation = {
      ...existing,
      cleanCount:    (existing.cleanCount ?? 0) + 1,
      lastCleanedAt: new Date().toISOString(),
    };

    await AsyncStorage.setItem(filterActivationKey(userId), JSON.stringify(updated));
    await saveFilterCleanCount(userId, updated.cleanCount ?? 0);
    return updated;
  } catch {
    return null;
  }
}

function enqueueLegacyFilterMigration<T>(fn: () => Promise<T>): Promise<T> {
  const next = legacyFilterMigrationChain.then(fn, fn);
  legacyFilterMigrationChain = next.then(() => undefined, () => undefined);
  return next;
}
