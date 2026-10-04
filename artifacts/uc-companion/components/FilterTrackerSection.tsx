/**
 * FilterTrackerSection
 *
 * Renders the "My Filter" card inside the Account screen.
 *
 *  • Not registered → prompt card with "Register Filter" button
 *  • Registered      → product name, lifespan progress bar, days remaining,
 *                       performance check-in badge, "Check Performance" + "Replace" buttons
 *
 * Also owns the full registration modal:
 *   Step 1 — pick the product
 *   Step 2 — pick how many days ago it was installed
 *   Confirm → scheduleAllFilterNotifications
 */
import React, { useState, useCallback, useEffect, useRef } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Modal, ScrollView,
  Platform, ActivityIndicator, TextInput, KeyboardAvoidingView, AppState,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useColors } from '@/hooks/useColors';
import * as Haptics from 'expo-haptics';
import { useRouter, useFocusEffect } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { useFilterProducts } from '@/hooks/useFilterProducts';
import { KeyboardAwareScrollViewCompat } from '@/components/KeyboardAwareScrollViewCompat';
import { commitPurchaseBackedRegistration } from '@/lib/filterRegistrationCommit';
import { useApi, ApiError, type RegisterPurchaseResult, type RegisterPurchaseItem, type PersonalImpact } from '@/hooks/useApi';
import FilterLifeGauge from '@/components/FilterLifeGauge';
import { calculateRemainingLife, resolveCapacityCycle } from '@/lib/filterRemainingLife';
import { useAuth } from '@/context/AuthContext';
import { customerQueryKeys } from '@/lib/customerQueryKeys';
import ReminderOptInSheet, { wasReminderOptInSeen } from '@/components/ReminderOptInSheet';
import {
  FilterActivation,
  scheduleAllFilterNotifications,
  clearFilterActivation,
  getNotificationPermissionStatus,
  requestNotificationPermission,
  effectiveLifespanDays,
  syncActivationWithCatalogue,
  getZeroLifespanNotice,
  type PerfRecommendation,
} from '@/hooks/useNotifications';
import PerformanceCheckInModal from '@/components/PerformanceCheckInModal';
import SyncToast from '@/components/SyncToast';

// ── Day-offset options ────────────────────────────────────────────────────────
export { DAY_OFFSETS, closestDayOffset } from '@/hooks/filterNudge';
import { DAY_OFFSETS, closestDayOffset } from '@/hooks/filterNudge';

// ── Props ─────────────────────────────────────────────────────────────────────
interface Props {
  activation:    FilterActivation | null;
  onActivationChange: (a: FilterActivation | null) => void;
  /** Receipt registration also creates a server-side capacity-tracked filter. */
  onRegistrationCommitted?: () => void;
  impact?: PersonalImpact;
  usageLoading?: boolean;
  usageUnavailable?: boolean;
  onUsageRefresh?: () => void;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
const PERF_BADGE: Record<PerfRecommendation, { label: string; color: string; icon: string }> = {
  good:    { label: 'Performing well',    color: '#22C55E', icon: 'checkmark-circle' },
  clean:   { label: 'Clean recommended',  color: '#F59E0B', icon: 'construct'        },
  replace: { label: 'Replace now',        color: '#EF4444', icon: 'alert-circle'     },
};

// ── Component ─────────────────────────────────────────────────────────────────
export default function FilterTrackerSection({ activation, onActivationChange, onRegistrationCommitted,
  impact, usageLoading = false, usageUnavailable = false, onUsageRefresh }: Props) {
  const colors = useColors();
  const router = useRouter();
  const { token, user } = useAuth();
  const [now, setNow] = useState(Date.now);
  useFocusEffect(useCallback(() => {
    setNow(Date.now());
    onUsageRefresh?.();
  }, [onUsageRefresh]));
  useEffect(() => {
    // Only display time and GET refresh: never schedule, cancel or sync reminders.
    const refresh = () => { setNow(Date.now()); onUsageRefresh?.(); };
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    const sub = AppState.addEventListener('change', state => { if (state === 'active') refresh(); });
    const visible = () => { if (document.visibilityState === 'visible') refresh(); };
    if (Platform.OS === 'web') document.addEventListener('visibilitychange', visible);
    return () => {
      clearInterval(timer); sub.remove();
      if (Platform.OS === 'web') document.removeEventListener('visibilitychange', visible);
    };
  }, [onUsageRefresh]);
  const [showRegisterModal,   setShowRegisterModal]   = useState(false);
  const [showPerfModal,       setShowPerfModal]       = useState(false);
  const [toastMessage,        setToastMessage]        = useState('');
  const [toastVisible,        setToastVisible]        = useState(false);
  const [zeroLifespanNotice, setZeroLifespanNotice] = useState<{ userId: number; active: boolean } | null>(null);
  const userId = user?.id;
  // Pending reminder opt-in prompt, set after a successful registration for
  // signed-in users who haven't been shown the prompt for this activation yet.
  const [reminderOptIn, setReminderOptIn] = useState<{ productId: number; activatedAt: string } | null>(null);

  // Fetch the live catalogue here so the sync effect and the registration modal
  // share the same data without triggering two independent API calls.
  const { products: filterProducts, loading: productsLoading, source: productsSource } = useFilterProducts();

  // ── Zero-lifespan notice: reload when the account or activation changes ────────
  useEffect(() => {
    let cancelled = false;
    setZeroLifespanNotice(null);
    if (!activation || userId == null) {
      return;
    }
    getZeroLifespanNotice(userId).then(active => {
      if (!cancelled) setZeroLifespanNotice({ userId, active });
    });
    return () => { cancelled = true; };
  }, [activation, userId]);

  // ── Catalogue lifespan sync ──────────────────────────────────────────────────
  // Runs only when the product list came directly from the live API ('live').
  // Cache and fallback data must never overwrite a stored activation — they may
  // themselves be stale and would corrupt the reminder schedule offline.
  const lastSyncedProductsRef = useRef<{ products: typeof filterProducts; userId: number } | null>(null);
  const onActivationChangeRef = useRef(onActivationChange);
  onActivationChangeRef.current = onActivationChange;
  useEffect(() => {
    if (productsSource !== 'live') return;  // offline/cache/fallback — hard no-op
    if (!activation)               return;  // nothing registered — no sync needed
    if (userId == null) return;
    if (filterProducts === lastSyncedProductsRef.current?.products
      && userId === lastSyncedProductsRef.current.userId) return; // same account and reference, skip
    const syncIdentity = { products: filterProducts, userId };
    lastSyncedProductsRef.current = syncIdentity;
    let cancelled = false;

    const oldLifespan = activation.lifespanDays;
    const oldName     = activation.productName;
    syncActivationWithCatalogue(filterProducts, userId).then(updated => {
      if (cancelled) return;
      // Refresh the notice flag regardless of whether the lifespan changed —
      // the sync may have set or cleared it based on the catalogue data.
      getZeroLifespanNotice(userId).then(active => {
        if (!cancelled) setZeroLifespanNotice({ userId, active });
      });
      if (updated) {
        onActivationChangeRef.current(updated);
        // Notify the user that the schedule was silently updated.
        setToastMessage(
          `${oldName} reminders updated: ${oldLifespan} → ${updated.lifespanDays} days`
        );
        setToastVisible(true);
      }
    });
    return () => {
      cancelled = true;
      // An invalidated in-flight sync must not suppress its replacement.
      if (lastSyncedProductsRef.current === syncIdentity) {
        lastSyncedProductsRef.current = null;
      }
    };
  }, [filterProducts, productsSource, activation, userId]);

  function openRegisterModal() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setShowRegisterModal(true);
  }

  function openPerfModal() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setShowPerfModal(true);
  }

  async function handleReset() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    if (user) await clearFilterActivation(user.id);
    onActivationChange(null);
  }

  const capacity = activation && !usageUnavailable
    ? resolveCapacityCycle(activation, impact?.filters, user?.id) : null;
  const life = activation
    ? calculateRemainingLife(activation, effectiveLifespanDays(activation), capacity, now) : null;
  const effDaysLeft = life?.remainingDays === null || !life ? null : Math.ceil(life.remainingDays);
  const ratedDaysLeft = activation
    ? calculateRemainingLife(activation, activation.lifespanDays, null, now).remainingDays : null;
  const showEffWarning = activation &&
    effDaysLeft !== null && ratedDaysLeft !== null &&
    effDaysLeft < ratedDaysLeft - 5; // effective lifespan is meaningfully shorter

  const daysLeft = effDaysLeft; // progress bar and main status use effective
  const barColor = life?.status === 'green' ? '#22C55E' : life?.status === 'amber' ? '#F59E0B'
    : life?.status === 'red' ? '#EF4444' : colors.mutedForeground;

  const lastRec  = activation?.lastCheckIn?.recommendation as PerfRecommendation | undefined;
  const perfBadge = lastRec ? PERF_BADGE[lastRec] : null;

  return (
    <>
      {/* ── Catalogue-sync toast ──────────────────────────────────────────── */}
      <SyncToast
        message={toastMessage}
        visible={toastVisible}
        onHide={() => setToastVisible(false)}
      />

      {/* ── Card ─────────────────────────────────────────────────────────── */}
      <View style={styles.section}>
        <Text style={[styles.sectionTitle, { color: colors.text }]}>My Filter</Text>
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          {activation ? (
            <>
              {/* Product + status */}
              <View style={styles.row}>
                <View style={[styles.iconWrap, { backgroundColor: barColor + '18' }]}>
                  <Ionicons name="water" size={20} color={barColor} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.productName, { color: colors.text }]} numberOfLines={1}>
                    {activation.productName}
                  </Text>
                </View>
                <TouchableOpacity onPress={openRegisterModal} style={[styles.replaceBtn, { borderColor: colors.primary }]}>
                  <Text style={[styles.replaceBtnTxt, { color: colors.primary }]}>Replace</Text>
                </TouchableOpacity>
              </View>

              <View testID="filter-lifespan-gauge" style={[styles.row, { marginVertical: 12, alignItems: 'center' }]}>
                <FilterLifeGauge percent={life?.percent ?? null} color={barColor}
                  label={`${life?.percent === null ? 'Percentage unavailable' : `${Math.floor(life?.percent ?? 0)} percent remaining`}. ${life?.description}. ${life?.basis}`} />
                <View style={{ flex: 1, gap: 6 }}>
                  <Text style={{ color: colors.text, fontSize: 24, fontWeight: '700' }}>
                    {life?.percent === null ? '—' : `${Math.floor(life?.percent ?? 0)}%`} remaining
                  </Text>
                  <Text style={[styles.daysText, { color: colors.text }]}>{life?.description}</Text>
                  <Text style={[styles.progressLabel, { color: colors.mutedForeground }]}>{life?.basis}</Text>
                  <Text style={[styles.progressLabel, { color: colors.mutedForeground }]}>
                    {daysLeft === null ? 'Time unavailable' : `${daysLeft} days remaining · ${effectiveLifespanDays(activation)}d effective life`}
                  </Text>
                  <Text style={[styles.progressLabel, { color: colors.mutedForeground }]}>
                    {life?.remainingLitres != null
                      ? `${life.remainingLitres.toLocaleString()} L left of ${capacity!.ratedCapacityLitres.toLocaleString()} L · customer/staff recorded`
                      : usageLoading ? 'Refreshing capacity…' : usageUnavailable ? 'Capacity unavailable · could not refresh (possibly offline)' : 'Capacity unavailable · no verified cycle link or rating'}
                  </Text>
                  {usageLoading && life?.remainingLitres != null ? <Text style={[styles.progressLabel, { color: colors.mutedForeground }]}>Refreshing recorded usage…</Text> : null}
                  <TouchableOpacity accessibilityRole="button" accessibilityLabel="Refresh filter usage" onPress={onUsageRefresh}>
                    <Text style={[styles.progressLabel, { color: colors.primary }]}>Refresh usage</Text>
                  </TouchableOpacity>
                </View>
              </View>

              <View testID="filter-life-summary" style={[styles.lifeSummary, { backgroundColor: colors.surface }]}>
                <View style={styles.lifeSummaryItem}>
                  <Ionicons name="time-outline" size={15} color={barColor} />
                  <Text style={[styles.lifeSummaryValue, { color: colors.text }]}>
                    {daysLeft === null ? 'Unavailable' : daysLeft > 0 ? `${daysLeft} days` : 'Due now'}
                  </Text>
                  <Text style={[styles.lifeSummaryLabel, { color: colors.mutedForeground }]}>life remaining</Text>
                </View>
                <View style={[styles.lifeSummaryDivider, { backgroundColor: colors.border }]} />
                <View style={styles.lifeSummaryItem}>
                  <Ionicons name="construct-outline" size={15} color={colors.primary} />
                  <Text style={[styles.lifeSummaryValue, { color: colors.text }]}>
                    {activation.cleanCount ?? 0}
                  </Text>
                  <Text style={[styles.lifeSummaryLabel, { color: colors.mutedForeground }]}>
                    cleaning {(activation.cleanCount ?? 0) === 1 ? 'count' : 'counts'}
                  </Text>
                </View>
              </View>

              {/* Effective lifespan warning banner */}
              {showEffWarning && (
                <View style={[styles.effWarning, { backgroundColor: '#FFF7ED', borderColor: '#FED7AA' }]}>
                  <Ionicons name="information-circle-outline" size={14} color="#D97706" />
                  <Text style={[styles.effWarningText, { color: '#92400E' }]}>
                    {activation!.lastWaterSource === 'surface'
                      ? 'Surface water detected — rated lifespan may be up to 45% shorter'
                      : activation!.lastWaterSource === 'borehole'
                      ? 'Borehole water detected — rated lifespan may be up to 30% shorter'
                      : `After ${activation!.cleanCount} clean${(activation!.cleanCount ?? 0) > 1 ? 's' : ''}, effective lifespan is reduced`}
                  </Text>
                </View>
              )}

              {/* Zero-lifespan notice — shown when the catalogue no longer carries
                  a valid lifespan for this product (meta removed / bad store data).
                  Non-blocking: reminders are preserved from the last known lifespan. */}
              {zeroLifespanNotice?.userId === userId && zeroLifespanNotice?.active && (
                <View style={[styles.effWarning, { backgroundColor: '#FFF1F2', borderColor: '#FECDD3' }]}>
                  <Ionicons name="warning-outline" size={14} color="#E11D48" />
                  <Text style={[styles.effWarningText, { color: '#9F1239' }]}>
                    Reminder accuracy can't be confirmed — this product's lifespan data is temporarily unavailable from the catalogue. Your existing reminders are still active.
                  </Text>
                </View>
              )}

              {/* Last performance check-in badge */}
              {perfBadge && (
                <TouchableOpacity
                  onPress={openPerfModal}
                  activeOpacity={0.8}
                  style={[styles.perfBadge, { backgroundColor: perfBadge.color + '12', borderColor: perfBadge.color + '30' }]}>
                  <Ionicons name={perfBadge.icon as never} size={14} color={perfBadge.color} />
                  <Text style={[styles.perfBadgeText, { color: perfBadge.color }]}>
                    Last check: {perfBadge.label}
                  </Text>
                  <Text style={[styles.perfBadgeUpdate, { color: perfBadge.color + 'AA' }]}>Update →</Text>
                </TouchableOpacity>
              )}

              {/* Check performance button (when no check-in yet) */}
              {!perfBadge && (
                <TouchableOpacity
                  onPress={openPerfModal}
                  activeOpacity={0.8}
                  style={[styles.checkPerfBtn, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                  <Ionicons name="pulse-outline" size={15} color={colors.primary} />
                  <Text style={[styles.checkPerfBtnText, { color: colors.primary }]}>
                    Check filter performance
                  </Text>
                  <Ionicons name="chevron-forward" size={13} color={colors.primary} />
                </TouchableOpacity>
              )}

              {/* Ask AI link — shown whenever the filter is registered */}
              <TouchableOpacity
                onPress={() => {
                  router.push({
                    pathname: '/ai-chat',
                    params: {
                      productName:   activation.productName,
                      daysRemaining: String(effDaysLeft ?? 0),
                      waterSource:   activation.lastWaterSource ?? '',
                      lastCheckIn:   lastRec
                        ? { good: 'Performing well', clean: 'Clean recommended', replace: 'Replace now' }[lastRec]
                        : '',
                      cleanCount:    String(activation.cleanCount ?? 0),
                    },
                  } as never);
                }}
                activeOpacity={0.75}
                style={styles.askAiRow}>
                <Ionicons name="water-outline" size={13} color={colors.primary} />
                <Text style={[styles.askAiText, { color: colors.primary }]}>
                  Ask AI about my {activation.productName}
                </Text>
                <Ionicons name="chevron-forward" size={12} color={colors.primary} />
              </TouchableOpacity>

              {/* Divider + notification summary */}
              <View style={[styles.divider, { backgroundColor: colors.border }]} />
              <View style={styles.row}>
                <Ionicons name="notifications-outline" size={14} color={colors.mutedForeground} />
                <Text style={[styles.notifNote, { color: colors.mutedForeground }]}>
                  {(activation.notifIds?.length ?? 0) > 0
                    ? `${activation.notifIds.length} reminders scheduled`
                    : 'Enable notifications to get reminders'}
                </Text>
              </View>
            </>
          ) : (
            /* Not yet registered */
            <TouchableOpacity onPress={openRegisterModal} style={styles.registerRow} activeOpacity={0.8}>
              <View style={[styles.iconWrap, { backgroundColor: colors.primaryLight }]}>
                <Ionicons name="water-outline" size={20} color={colors.primary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.productName, { color: colors.text }]}>Register your filter</Text>
                <Text style={[styles.subText, { color: colors.mutedForeground }]}>
                  Get personalised maintenance reminders and discount offers
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={16} color={colors.mutedForeground} />
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* ── Registration / Replace Modal ─────────────────────────────────── */}
      <RegisterModal
        visible={showRegisterModal}
        existingActivation={activation}
        filterProducts={filterProducts}
        productsLoading={productsLoading}
        userId={user?.id ?? 0}
        onClose={() => setShowRegisterModal(false)}
        onSave={async a => {
          onActivationChange(a);
          onRegistrationCommitted?.();
          setShowRegisterModal(false);
          setToastMessage(`${a.productName} registered successfully. Your reminders are ready.`);
          setToastVisible(true);
          // Invite signed-in users to enable message reminder channels.
          // Only show the prompt once per registration (keyed by productId+activatedAt).
          if (token && user) {
            const alreadySeen = await wasReminderOptInSeen(a.productId, a.activatedAt, user.id);
            if (!alreadySeen) {
              setReminderOptIn({ productId: a.productId, activatedAt: a.activatedAt });
            }
          }
        }}
      />

      {/* ── Reminder opt-in sheet (shown once after registration) ────────── */}
      {reminderOptIn && user && (
        <ReminderOptInSheet
          visible={!!reminderOptIn}
          productId={reminderOptIn.productId}
          activatedAt={reminderOptIn.activatedAt}
          userId={user.id}
          onClose={() => setReminderOptIn(null)}
        />
      )}

      {/* ── Performance Check-In Modal ───────────────────────────────────── */}
      {activation && (
        <PerformanceCheckInModal
          visible={showPerfModal}
          activation={activation}
          userId={user?.id ?? 0}
          onClose={() => setShowPerfModal(false)}
          onUpdated={a => { onActivationChange(a); }}
          onOrderReplacement={() => router.push('/(tabs)/products' as never)}
        />
      )}
    </>
  );
}

// ── Registration modal ────────────────────────────────────────────────────────
interface ModalProps {
  visible: boolean;
  existingActivation: FilterActivation | null;
  filterProducts: ReturnType<typeof useFilterProducts>['products'];
  productsLoading: boolean;
  /** User id used to scope the AsyncStorage activation key. */
  userId: number;
  onClose: () => void;
  onSave: (a: FilterActivation) => void;
  /** Pre-select this product and jump straight to the date step (order-based nudge). */
  initialProductId?: number | null;
  /** Pre-select this day offset (snapped to a DAY_OFFSETS value). */
  initialDayOffset?: number;
}

export function RegisterModal({
  visible, existingActivation, filterProducts, productsLoading, userId, onClose, onSave,
  initialProductId = null, initialDayOffset = 0,
}: ModalProps) {
  const colors = useColors();
  const api = useApi();
  const queryClient = useQueryClient();
  const [saving, setSaving]     = useState(false);

  // ── Receipt-based registration state ──────────────────────────────────────
  // There is deliberately no catalogue mode: all registration side effects
  // happen only after /filters/register-purchase has committed ownership.
  const [receipt, setReceipt]           = useState('');
  const [phone, setPhone]               = useState('');
  const [lookupLoading, setLookupLoading] = useState(false);
  const [lookupError, setLookupError]   = useState('');
  const [purchase, setPurchase]         = useState<RegisterPurchaseResult | null>(null);
  // Invalidation token for in-flight lookups (bumped on back/close so a late
  // response can never surface stale purchase data) and a synchronous save
  // lock (state alone can't stop two rapid taps scheduling twice).
  const lookupSeq = useRef(0);
  const savingRef = useRef(false);

  const reset = useCallback(() => {
    lookupSeq.current++;
    setSaving(false); setReceipt(''); setPhone('');
    setLookupLoading(false); setLookupError(''); setPurchase(null);
  }, []);

  // Clear an old lookup each time the sheet opens. Catalogue nudge props are
  // intentionally ignored; they cannot establish ownership.
  const wasVisible = useRef(false);
  useEffect(() => {
    if (visible && !wasVisible.current) {
      setSaving(false);
      setPurchase(null); setLookupError('');
    }
    wasVisible.current = visible;
  }, [visible, initialProductId, initialDayOffset, filterProducts]);

  // ── Receipt flow handlers ──────────────────────────────────────────────────
  async function handleLookup() {
    const seq = ++lookupSeq.current;
    setLookupError('');
    setLookupLoading(true);
    try {
      const result = await api.registerFilterPurchase(receipt.trim(), phone.trim());
      if (seq !== lookupSeq.current) return; // superseded (back/close) — discard
      const trackable = result.items.filter(i => i.lifespanDays > 0);
      if (trackable.length === 0) {
        setLookupError(
          'This purchase has no filters with replacement reminders. Pick your filter from the list instead.',
        );
        return;
      }
      setPurchase(result);
    } catch (e) {
      if (seq !== lookupSeq.current) return; // superseded — discard stale error
      setLookupError(
        e instanceof ApiError
          ? e.message
          : 'Could not reach the server. Please check your connection and try again.',
      );
    } finally {
      if (seq === lookupSeq.current) setLookupLoading(false);
    }
  }

  async function handleSaveFromPurchase(item: RegisterPurchaseItem) {
    if (!purchase || savingRef.current) return;
    // Same receipt line already backing the current registration → block the
    // duplicate. A new purchase (different receipt) restarts the cycle.
    if (
      existingActivation?.sourceOrderId === purchase.orderId &&
      existingActivation.productId === item.productId
    ) {
      setLookupError('This receipt is already registered to your current filter.');
      return;
    }
    savingRef.current = true;
    setSaving(true);
    try {
      const status = await getNotificationPermissionStatus();
      if (status !== 'granted') {
        await requestNotificationPermission();
      }
      const activatedAt = purchase.dateCreated || new Date().toISOString();
      await commitPurchaseBackedRegistration(
        () => api.registerFilterPurchase(receipt.trim(), phone.trim(), {
          productId: item.productId,
          activatedAt,
        }),
        committed => scheduleAllFilterNotifications({
          activatedAt,
          productId:     item.productId,
          productName:   item.name,
          lifespanDays:  item.lifespanDays,
          sourceOrderId: purchase.orderId,
          registeredFilterId: committed.registration?.id,
        }, userId),
        onSave,
      );
      // Refresh only after durable registration so the capacity-backed impact
      // card reflects the newly registered filter.
      await queryClient.invalidateQueries({ queryKey: customerQueryKeys.rewards(userId) });
      reset();
    } catch (e) {
      // Keep the verified purchase selection visible so the customer can retry
      // rather than re-entering their receipt. The server's unique index makes
      // a second commit safe from duplicate registrations.
      setLookupError(
        e instanceof ApiError
          ? e.message
          : 'Registration could not be completed. Please try again.',
      );
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  function handleBack() {
    lookupSeq.current++; // cancel any in-flight lookup
    setLookupError('');
    setLookupLoading(false);
    if (purchase) setPurchase(null);
  }

  function handleClose() { reset(); onClose(); }

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={handleClose}>
      <KeyboardAvoidingView style={styles.overlay} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <View style={[styles.sheet, { backgroundColor: colors.background }]}>
          {/* Handle */}
          <View style={[styles.handle, { backgroundColor: colors.border }]} />

          {/* Header */}
          <View style={styles.sheetHeader}>
            {purchase && (
              <TouchableOpacity onPress={handleBack} style={styles.backBtn}>
                <Ionicons name="chevron-back" size={22} color={colors.primary} />
              </TouchableOpacity>
            )}
            <Text style={[styles.sheetTitle, { color: colors.text }]}>
              {purchase ? 'Select Your Filter' : 'Register with Receipt'}
            </Text>
            <TouchableOpacity onPress={handleClose} style={styles.closeBtn}>
              <Ionicons name="close" size={22} color={colors.mutedForeground} />
            </TouchableOpacity>
          </View>

          {purchase === null ? (
              /* Receipt step A: receipt number + phone */
              <KeyboardAwareScrollViewCompat
                style={{ flex: 1 }}
                contentContainerStyle={styles.sheetBody}
                keyboardShouldPersistTaps="handled"
                keyboardDismissMode="on-drag"
                showsVerticalScrollIndicator={false}>
                <Text style={[styles.stepHint, { color: colors.mutedForeground }]}>
                  Enter the receipt (order) number from your purchase and the
                  phone number you used at checkout — we'll find your filter
                  and start reminders from the purchase date.
                </Text>
                <TextInput
                  value={receipt}
                  onChangeText={setReceipt}
                  placeholder="Receipt number, e.g. 1024"
                  placeholderTextColor={colors.mutedForeground}
                  keyboardType="number-pad"
                  inputMode="numeric"
                  returnKeyType="next"
                  autoCorrect={false}
                  style={[styles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.card }]}
                />
                <TextInput
                  value={phone}
                  onChangeText={setPhone}
                  placeholder="Phone used at purchase, e.g. 07XX XXX XXX"
                  placeholderTextColor={colors.mutedForeground}
                  keyboardType="phone-pad"
                  autoComplete="tel"
                  returnKeyType="done"
                  onSubmitEditing={handleLookup}
                  autoCorrect={false}
                  style={[styles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.card }]}
                />
                {!!lookupError && (
                  <Text style={[styles.errorText, { color: '#EF4444' }]}>{lookupError}</Text>
                )}
                <TouchableOpacity
                  onPress={handleLookup}
                  disabled={lookupLoading || !receipt.trim() || !phone.trim()}
                  activeOpacity={0.85}
                  style={[
                    styles.saveBtn,
                    {
                      backgroundColor: colors.primary,
                      opacity: lookupLoading || !receipt.trim() || !phone.trim() ? 0.6 : 1,
                    },
                  ]}>
                  {lookupLoading
                    ? <ActivityIndicator color="#fff" size="small" />
                    : <Text style={styles.saveBtnTxt}>Find My Purchase</Text>}
                </TouchableOpacity>
              </KeyboardAwareScrollViewCompat>
            ) : (
              /* Receipt step B: pick the filter line from the purchase */
              <ScrollView
                style={{ flex: 1 }}
                contentContainerStyle={styles.sheetBody}
                showsVerticalScrollIndicator={false}>
                <Text style={[styles.stepHint, { color: colors.mutedForeground }]}>
                  Receipt #{purchase.orderId}
                  {purchase.dateCreated
                    ? ` — purchased ${new Date(purchase.dateCreated).toLocaleDateString()}`
                    : ''}
                </Text>
                <Text style={[styles.stepHint, { color: colors.mutedForeground, marginTop: 4, marginBottom: 8 }]}>
                  Tap the filter you installed:
                </Text>
                <View style={{ gap: 10 }}>
                  {purchase.items.filter(i => i.lifespanDays > 0).map((item, idx) => (
                    <TouchableOpacity
                      key={`${item.productId}-${idx}`}
                      onPress={() => handleSaveFromPurchase(item)}
                      disabled={saving}
                      activeOpacity={0.8}
                      style={[
                        styles.productRow,
                        { backgroundColor: colors.card, borderColor: colors.border, opacity: saving ? 0.6 : 1 },
                      ]}>
                      <View style={[styles.productIconWrap, { backgroundColor: colors.primaryLight }]}>
                        <Ionicons name="water" size={18} color={colors.primary} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={[styles.productRowName, { color: colors.text }]}>{item.name}</Text>
                        <Text style={[styles.productRowLife, { color: colors.mutedForeground }]}>
                          {item.lifespanDays}-day lifespan
                          {item.quantity > 1 ? ` · ×${item.quantity}` : ''}
                        </Text>
                      </View>
                      {saving
                        ? <ActivityIndicator size="small" color={colors.primary} />
                        : <Ionicons name="chevron-forward" size={16} color={colors.mutedForeground} />}
                    </TouchableOpacity>
                  ))}
                </View>
                {purchase.items.some(i => !(i.lifespanDays > 0)) && (
                  <Text style={[styles.receiptMeta, { color: colors.mutedForeground }]}>
                    Other items on this receipt don't have replacement reminders.
                  </Text>
                )}
                {!!lookupError && (
                  <Text style={[styles.errorText, { color: '#EF4444' }]}>{lookupError}</Text>
                )}
              </ScrollView>
          )}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  section:         { gap: 12 },
  sectionTitle:    { fontSize: 17, fontWeight: '700' as const },
  card:            { borderRadius: 14, borderWidth: 1, padding: 14, gap: 10 },
  row:             { flexDirection: 'row', alignItems: 'center', gap: 10 },
  iconWrap:        { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  productName:     { fontSize: 14, fontWeight: '600' as const },
  daysText:        { fontSize: 13, fontWeight: '500' as const, marginTop: 2 },
  subText:         { fontSize: 12, marginTop: 2, lineHeight: 16 },
  replaceBtn:      { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, borderWidth: 1 },
  replaceBtnTxt:   { fontSize: 13, fontWeight: '600' as const },
  progressTrack:   { height: 6, borderRadius: 3, overflow: 'hidden' },
  progressFill:    { height: 6, borderRadius: 3 },
  progressLabels:  { flexDirection: 'row', justifyContent: 'space-between' },
  progressLabel:   { fontSize: 11 },
  lifeSummary:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around', borderRadius: 9, paddingVertical: 9 },
  lifeSummaryItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  lifeSummaryValue:{ fontSize: 12, fontWeight: '700' as const },
  lifeSummaryLabel:{ fontSize: 11 },
  lifeSummaryDivider: { width: 1, height: 20 },
  divider:         { height: 1 },
  notifNote:       { fontSize: 12, marginLeft: 4 },
  registerRow:     { flexDirection: 'row', alignItems: 'center', gap: 12 },

  // Performance badge / check button
  perfBadge:       { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 6, borderWidth: 1, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 7 },
  perfBadgeText:   { flex: 1, fontSize: 12, fontWeight: '600' as const },
  perfBadgeUpdate: { fontSize: 11, fontWeight: '500' as const },
  checkPerfBtn:    { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 7, borderWidth: 1, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8 },
  checkPerfBtnText:{ flex: 1, fontSize: 12, fontWeight: '600' as const },
  effWarning:      { flexDirection: 'row' as const, alignItems: 'flex-start' as const, gap: 6, borderWidth: 1, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 7 },
  effWarningText:  { flex: 1, fontSize: 11, lineHeight: 16 },
  askAiRow:        { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 5, paddingVertical: 2 },
  askAiText:       { flex: 1, fontSize: 12, fontWeight: '500' as const },

  // Modal
  overlay:         { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  sheet:           { borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingBottom: Platform.OS === 'ios' ? 34 : 16, maxHeight: '85%' },
  handle:          { width: 40, height: 4, borderRadius: 2, alignSelf: 'center', marginTop: 10 },
  sheetHeader:     { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14, gap: 8 },
  backBtn:         { padding: 4 },
  sheetTitle:      { flex: 1, fontSize: 17, fontWeight: '700' as const },
  closeBtn:        { padding: 4 },
  sheetBody:       { paddingHorizontal: 16, paddingBottom: 16 },
  stepHint:        { fontSize: 13 },
  productRow:      { flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1, borderRadius: 12, padding: 12 },
  productIconWrap: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  productRowName:  { fontSize: 14, fontWeight: '600' as const },
  productRowLife:  { fontSize: 12, marginTop: 2 },
  offsetRow:       { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderWidth: 1, borderRadius: 10, paddingHorizontal: 16, paddingVertical: 13 },
  offsetLabel:     { fontSize: 15, fontWeight: '500' as const },
  input:           { borderWidth: 1, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, marginTop: 10 },
  errorText:       { fontSize: 12, marginTop: 10, lineHeight: 16 },
  receiptLink:     { flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 11, marginTop: 12 },
  receiptLinkText: { flex: 1, fontSize: 13, fontWeight: '600' as const },
  receiptMeta:     { fontSize: 11, marginTop: 10, lineHeight: 15 },
  saveBtn:         { borderRadius: 12, paddingVertical: 15, alignItems: 'center', marginTop: 16 },
  saveBtnTxt:      { color: '#fff', fontSize: 15, fontWeight: '700' as const },
});
