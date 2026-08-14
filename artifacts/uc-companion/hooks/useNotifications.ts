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
import * as Notifications from 'expo-notifications';
import AsyncStorage from '@react-native-async-storage/async-storage';

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
const REGISTERED_PUSH_TOKEN_KEY = 'uc_push_token_registered';
const FILTER_ACTIVATION_KEY = 'uc_filter_activation';
const NOTIF_PREFS_KEY       = 'uc_notif_prefs';

// ── Notification preferences ─────────────────────────────────────────────────

export interface NotifPrefs {
  orderUpdates:    boolean;  // push notifications for order status (server-side)
  filterReminders: boolean;  // local scheduled filter lifecycle notifications
}

const DEFAULT_PREFS: NotifPrefs = { orderUpdates: true, filterReminders: true };

export async function getNotifPrefs(): Promise<NotifPrefs> {
  try {
    const s = await AsyncStorage.getItem(NOTIF_PREFS_KEY);
    if (!s) return { ...DEFAULT_PREFS };
    return { ...DEFAULT_PREFS, ...(JSON.parse(s) as Partial<NotifPrefs>) };
  } catch { return { ...DEFAULT_PREFS }; }
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
  cleanCount?:    number;               // how many times user has cleaned this filter
  lastCleanedAt?: string;               // ISO date of most recent clean
  lastWaterSource?: WaterSource;        // water source from most recent check-in
  lastCheckIn?:   PerformanceCheckIn;   // most recent performance check-in
  checkIns?:      PerformanceCheckIn[]; // full history (newest first)
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

export async function getExpoPushToken(): Promise<string | null> {
  if (Platform.OS === 'web') return null;
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

const getApiBase = () =>
  process.env.EXPO_PUBLIC_DOMAIN
    ? `https://${process.env.EXPO_PUBLIC_DOMAIN}`
    : 'http://localhost:8080';

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
  if (Platform.OS === 'web') return false;
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
      if (!res.ok) return false;
      await AsyncStorage.setItem(REGISTERED_PUSH_TOKEN_KEY, current);
      return true;
    } catch { return false; }
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

// ── Filter activation state ───────────────────────────────────────────────────

export async function getFilterActivation(): Promise<FilterActivation | null> {
  try {
    const s = await AsyncStorage.getItem(FILTER_ACTIVATION_KEY);
    if (!s) return null;
    return JSON.parse(s) as FilterActivation;
  } catch { return null; }
}

// ── Filter lifecycle notifications ───────────────────────────────────────────
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
 * Schedules all 5 filter lifecycle notifications and persists the activation.
 * Cancels any previously scheduled cycle first.
 */
export async function scheduleAllFilterNotifications(
  params: Omit<FilterActivation, 'notifIds'>
): Promise<FilterActivation> {
  if (Platform.OS === 'web') {
    const activation: FilterActivation = { ...params, notifIds: [] };
    await AsyncStorage.setItem(FILTER_ACTIVATION_KEY, JSON.stringify(activation));
    await AsyncStorage.setItem('uc_filter_last_changed', new Date(params.activatedAt).getTime().toString());
    return activation;
  }

  await cancelAllFilterNotifications();

  const [status, prefs] = await Promise.all([
    getNotificationPermissionStatus(),
    getNotifPrefs(),
  ]);

  if (status !== 'granted' || !prefs.filterReminders) {
    const activation: FilterActivation = { ...params, notifIds: [] };
    await AsyncStorage.setItem(FILTER_ACTIVATION_KEY, JSON.stringify(activation));
    await AsyncStorage.setItem('uc_filter_last_changed', new Date(params.activatedAt).getTime().toString());
    return activation;
  }

  await ensureAndroidChannel();

  const { productName, lifespanDays } = params;
  const activationDate = new Date(params.activatedAt);
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
  const offset4 = Math.max(Math.min(lifespanDays - 30, lifespanDays - 1), Math.ceil(daysSinceActivation) + 1);
  await scheduleAt(
    new Date(activationDate.getTime() + offset4 * 86_400_000),
    {
      title: `📅 Time to order your replacement filter`,
      body:  `Your ${productName} needs replacing in ~30 days. Order now and save: 10% off 1 filter (REPLACE10) or 15% off 2 (REPLACE15). Delivery takes 1–2 days.`,
      data:  { screen: 'products', type: 'discount_30', code1: 'REPLACE10', code2: 'REPLACE15' },
    }
  );

  // ── 5. 15 days before replacement — urgent 48-hour offer
  const offset5 = Math.max(offset4 + 1, lifespanDays - 15);
  await scheduleAt(
    new Date(activationDate.getTime() + offset5 * 86_400_000),
    {
      title: `🚨 Filter expires in ~15 days — 10% off`,
      body:  `Order your ${productName} replacement today with code FRESH48 for 10% off (valid 48 hrs). Clean water protects your family and your appliances. Don't risk it!`,
      data:  { screen: 'products', type: 'discount_15', code: 'FRESH48' },
    }
  );

  const activation: FilterActivation = { ...params, notifIds: ids };
  await AsyncStorage.setItem(FILTER_ACTIVATION_KEY, JSON.stringify(activation));
  // Keep the legacy key in sync so the home screen filter card still works
  await AsyncStorage.setItem('uc_filter_last_changed', activationDate.getTime().toString());
  return activation;
}

/** Cancel all scheduled notifications for the current filter cycle. */
export async function cancelAllFilterNotifications(): Promise<void> {
  if (Platform.OS === 'web') return;
  try {
    const s = await AsyncStorage.getItem(FILTER_ACTIVATION_KEY);
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
  catalogueProducts: Array<{ id: number; lifespanDays: number; name: string }>
): Promise<FilterActivation | null> {
  if (catalogueProducts.length === 0) return null;

  const existing = await getFilterActivation();
  if (!existing) return null;

  const catalogueProduct = catalogueProducts.find(p => p.id === existing.productId);
  if (!catalogueProduct) return null;

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
  });

  return updated;
}

/** Remove the filter activation record (call when user resets / unregisters filter). */
export async function clearFilterActivation(): Promise<void> {
  await cancelAllFilterNotifications();
  await AsyncStorage.removeItem(FILTER_ACTIVATION_KEY);
  await AsyncStorage.removeItem('uc_filter_last_changed');
}

// ── Performance check-in ──────────────────────────────────────────────────────

/**
 * Persist a completed performance check-in.
 * If the recommendation is 'replace', we reschedule the replacement
 * notifications to fire sooner based on the effective (adjusted) lifespan.
 */
export async function recordPerformanceCheckIn(
  checkIn: PerformanceCheckIn
): Promise<FilterActivation | null> {
  try {
    const existing = await getFilterActivation();
    if (!existing) return null;

    const history = [checkIn, ...(existing.checkIns ?? [])].slice(0, 20); // keep last 20

    const updated: FilterActivation = {
      ...existing,
      lastWaterSource: checkIn.waterSource,
      lastCheckIn:     checkIn,
      checkIns:        history,
    };

    // If we need to replace sooner, cancel old notifs and reschedule with adjusted lifespan
    if (checkIn.recommendation === 'replace' || checkIn.recommendation === 'clean') {
      const effDays    = effectiveLifespanDays(updated);
      const activation = updated.activatedAt;
      const activationDate = new Date(activation);
      const now        = Date.now();
      const elapsed    = Math.floor((now - activationDate.getTime()) / 86_400_000);

      const filterPrefsOk = (await getNotifPrefs()).filterReminders;
      if (Platform.OS !== 'web' && effDays < existing.lifespanDays && filterPrefsOk) {
        // Cancel old scheduled notifications
        await Promise.all((existing.notifIds ?? []).map(id =>
          Notifications.cancelScheduledNotificationAsync(id).catch(() => {})
        ));

        const status = await getNotificationPermissionStatus();
        const newIds: string[] = [];

        if (status === 'granted') {
          await ensureAndroidChannel();

          async function scheduleAdjusted(
            targetDate: Date,
            content: { title: string; body: string; data?: Record<string, unknown> }
          ): Promise<void> {
            const secondsFromNow = Math.floor((targetDate.getTime() - now) / 1000);
            if (secondsFromNow < 30) return;
            try {
              const id = await Notifications.scheduleNotificationAsync({
                content: { ...content, sound: false },
                trigger: { seconds: secondsFromNow } as unknown as null,
              });
              newIds.push(id);
            } catch { /* non-critical */ }
          }

          const offset30 = Math.max(elapsed + 1, effDays - 30);
          if (offset30 > elapsed) {
            await scheduleAdjusted(
              new Date(activationDate.getTime() + offset30 * 86_400_000),
              {
                title: `📅 Time to order your replacement — water quality alert`,
                body:  `Your ${existing.productName} is working harder than usual due to your water source. Order a replacement now.`,
                data:  { screen: 'products', type: 'discount_30_adjusted' },
              }
            );
          }

          const offset15 = Math.max(offset30 + 1, effDays - 10);
          if (offset15 > elapsed) {
            await scheduleAdjusted(
              new Date(activationDate.getTime() + offset15 * 86_400_000),
              {
                title: `🚨 Replace your filter soon — performance alert`,
                body:  `Based on your water source and check-in, your ${existing.productName} needs replacing. Don't risk unfiltered water.`,
                data:  { screen: 'products', type: 'replace_urgent_adjusted' },
              }
            );
          }
        }

        updated.notifIds = newIds;
      }
    }

    await AsyncStorage.setItem(FILTER_ACTIVATION_KEY, JSON.stringify(updated));
    return updated;
  } catch {
    return null;
  }
}

/**
 * Record that the user cleaned their filter.
 * Increments cleanCount, stamps lastCleanedAt, persists, and returns the updated record.
 */
export async function recordFilterClean(): Promise<FilterActivation | null> {
  try {
    const existing = await getFilterActivation();
    if (!existing) return null;

    const updated: FilterActivation = {
      ...existing,
      cleanCount:    (existing.cleanCount ?? 0) + 1,
      lastCleanedAt: new Date().toISOString(),
    };

    await AsyncStorage.setItem(FILTER_ACTIVATION_KEY, JSON.stringify(updated));
    return updated;
  } catch {
    return null;
  }
}
