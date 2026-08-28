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
  Platform, ActivityIndicator, TextInput,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import { useFilterProducts } from '@/hooks/useFilterProducts';
import { useApi, ApiError, type RegisterPurchaseResult, type RegisterPurchaseItem } from '@/hooks/useApi';
import { useAuth } from '@/context/AuthContext';
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
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function daysRemainingRated(activation: FilterActivation): number {
  const elapsed = Math.floor((Date.now() - new Date(activation.activatedAt).getTime()) / 86_400_000);
  return activation.lifespanDays - elapsed;
}

function daysRemainingEffective(activation: FilterActivation): number {
  const elapsed  = Math.floor((Date.now() - new Date(activation.activatedAt).getTime()) / 86_400_000);
  return effectiveLifespanDays(activation) - elapsed;
}

function progressPercent(activation: FilterActivation): number {
  const elapsed   = Math.floor((Date.now() - new Date(activation.activatedAt).getTime()) / 86_400_000);
  const lifespan  = effectiveLifespanDays(activation);
  return Math.min(100, Math.max(0, Math.round((elapsed / lifespan) * 100)));
}

function statusColor(daysLeft: number, primary: string, warning: string, destructive: string): string {
  if (daysLeft <= 0)  return destructive;
  if (daysLeft <= 21) return destructive;
  if (daysLeft <= 45) return warning;
  return primary;
}

const PERF_BADGE: Record<PerfRecommendation, { label: string; color: string; icon: string }> = {
  good:    { label: 'Performing well',    color: '#22C55E', icon: 'checkmark-circle' },
  clean:   { label: 'Clean recommended',  color: '#F59E0B', icon: 'construct'        },
  replace: { label: 'Replace now',        color: '#EF4444', icon: 'alert-circle'     },
};

// ── Component ─────────────────────────────────────────────────────────────────
export default function FilterTrackerSection({ activation, onActivationChange, onRegistrationCommitted }: Props) {
  const colors = useColors();
  const router = useRouter();
  const { token, user } = useAuth();
  const [showRegisterModal,   setShowRegisterModal]   = useState(false);
  const [showPerfModal,       setShowPerfModal]       = useState(false);
  const [toastMessage,        setToastMessage]        = useState('');
  const [toastVisible,        setToastVisible]        = useState(false);
  const [zeroLifespanNotice,  setZeroLifespanNotice]  = useState(false);
  // Pending reminder opt-in prompt, set after a successful registration for
  // signed-in users who haven't been shown the prompt for this activation yet.
  const [reminderOptIn, setReminderOptIn] = useState<{ productId: number; activatedAt: string } | null>(null);

  // Fetch the live catalogue here so the sync effect and the registration modal
  // share the same data without triggering two independent API calls.
  const { products: filterProducts, loading: productsLoading, source: productsSource } = useFilterProducts();

  // ── Zero-lifespan notice: load on mount and whenever activation changes ────────
  useEffect(() => {
    if (!activation) {
      setZeroLifespanNotice(false);
      return;
    }
    getZeroLifespanNotice().then(setZeroLifespanNotice);
  }, [activation]);

  // ── Catalogue lifespan sync ──────────────────────────────────────────────────
  // Runs only when the product list came directly from the live API ('live').
  // Cache and fallback data must never overwrite a stored activation — they may
  // themselves be stale and would corrupt the reminder schedule offline.
  const lastSyncedProductsRef = useRef<typeof filterProducts | null>(null);
  useEffect(() => {
    if (productsSource !== 'live') return;  // offline/cache/fallback — hard no-op
    if (!activation)               return;  // nothing registered — no sync needed
    if (filterProducts === lastSyncedProductsRef.current) return; // same reference, skip
    lastSyncedProductsRef.current = filterProducts;

    const oldLifespan = activation.lifespanDays;
    const oldName     = activation.productName;
    syncActivationWithCatalogue(filterProducts, user!.id).then(updated => {
      // Refresh the notice flag regardless of whether the lifespan changed —
      // the sync may have set or cleared it based on the catalogue data.
      getZeroLifespanNotice().then(setZeroLifespanNotice);
      if (updated) {
        onActivationChange(updated);
        // Notify the user that the schedule was silently updated.
        setToastMessage(
          `${oldName} reminders updated: ${oldLifespan} → ${updated.lifespanDays} days`
        );
        setToastVisible(true);
      }
    });
  }, [filterProducts, productsSource, activation, onActivationChange]);

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

  const effDaysLeft  = activation ? daysRemainingEffective(activation) : null;
  const ratedDaysLeft = activation ? daysRemainingRated(activation) : null;
  const showEffWarning = activation &&
    effDaysLeft !== null && ratedDaysLeft !== null &&
    effDaysLeft < ratedDaysLeft - 5; // effective lifespan is meaningfully shorter

  const pct      = activation ? progressPercent(activation) : 0;
  const daysLeft = effDaysLeft; // progress bar and main status use effective
  const barColor = daysLeft !== null
    ? statusColor(daysLeft, colors.primary, '#F59E0B', '#EF4444')
    : colors.primary;

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
                  <Text style={[styles.daysText, { color: barColor }]}>
                    {daysLeft !== null && daysLeft > 0
                      ? `${daysLeft} day${daysLeft === 1 ? '' : 's'} remaining`
                      : 'Filter replacement overdue'}
                  </Text>
                </View>
                <TouchableOpacity onPress={openRegisterModal} style={[styles.replaceBtn, { borderColor: colors.primary }]}>
                  <Text style={[styles.replaceBtnTxt, { color: colors.primary }]}>Replace</Text>
                </TouchableOpacity>
              </View>

              {/* Progress bar */}
              <View style={[styles.progressTrack, { backgroundColor: colors.surface }]}>
                <View style={[styles.progressFill, { width: `${pct}%` as unknown as number, backgroundColor: barColor }]} />
              </View>
              <View style={styles.progressLabels}>
                <Text style={[styles.progressLabel, { color: colors.mutedForeground }]}>Installed</Text>
                <Text style={[styles.progressLabel, { color: showEffWarning ? '#F59E0B' : colors.mutedForeground }]}>
                  {showEffWarning
                    ? `~${effDaysLeft! + (daysLeft! < 0 ? 0 : 0)}d eff. / ${activation!.lifespanDays}d rated`
                    : `${activation!.lifespanDays}d rated life`}
                </Text>
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
              {zeroLifespanNotice && (
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
  const [step, setStep]         = useState<1 | 2>(1);
  const [productId, setProductId]     = useState<number | null>(null);
  const [dayOffset, setDayOffset]     = useState(0);
  const [saving, setSaving]     = useState(false);

  // ── Receipt-based registration state ──────────────────────────────────────
  const [mode, setMode]                 = useState<'catalogue' | 'receipt'>('catalogue');
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
    setStep(1); setProductId(null); setDayOffset(0); setSaving(false);
    setMode('catalogue'); setReceipt(''); setPhone('');
    setLookupLoading(false); setLookupError(''); setPurchase(null);
  }, []);

  // Apply pre-selection each time the modal opens. When a product is supplied
  // (and exists in the catalogue) the picker step is skipped — the user lands
  // on the date step with the purchase-date-based offset already selected.
  const wasVisible = useRef(false);
  useEffect(() => {
    if (visible && !wasVisible.current) {
      const preselected = initialProductId != null &&
        filterProducts.some(p => p.id === initialProductId);
      setProductId(preselected ? initialProductId : null);
      setDayOffset(preselected ? closestDayOffset(initialDayOffset) : 0);
      setStep(preselected ? 2 : 1);
      setSaving(false);
      setMode('catalogue'); setPurchase(null); setLookupError('');
    }
    wasVisible.current = visible;
  }, [visible, initialProductId, initialDayOffset, filterProducts]);

  const selectedProduct = filterProducts.find(p => p.id === productId);

  async function handleSave() {
    if (!selectedProduct || savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    try {
      // Ensure permission is granted before scheduling
      const status = await getNotificationPermissionStatus();
      if (status !== 'granted') {
        await requestNotificationPermission();
      }

      const activatedAt = new Date(Date.now() - dayOffset * 86_400_000).toISOString();
      const activation = await scheduleAllFilterNotifications({
        activatedAt,
        productId:    selectedProduct.id,
        productName:  selectedProduct.name,
        lifespanDays: selectedProduct.lifespanDays,
      }, userId);
      onSave(activation);
      reset();
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

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
      // Commit the selected receipt item before storing local reminder state.
      // This is what makes the filter available to the capacity-enforced impact
      // ledger; a failed commit deliberately schedules no local reminders.
      await api.registerFilterPurchase(receipt.trim(), phone.trim(), {
        productId: item.productId,
        activatedAt,
      });
      const activation = await scheduleAllFilterNotifications({
        activatedAt,
        productId:     item.productId,
        productName:   item.name,
        lifespanDays:  item.lifespanDays,
        sourceOrderId: purchase.orderId,
      }, userId);
      onSave(activation);
      reset();
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  function handleBack() {
    lookupSeq.current++; // cancel any in-flight lookup
    setLookupError('');
    setLookupLoading(false);
    if (mode === 'receipt') {
      if (purchase) setPurchase(null);
      else setMode('catalogue');
    } else {
      setStep(1);
    }
  }

  function handleClose() { reset(); onClose(); }

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={handleClose}>
      <View style={styles.overlay}>
        <View style={[styles.sheet, { backgroundColor: colors.background }]}>
          {/* Handle */}
          <View style={[styles.handle, { backgroundColor: colors.border }]} />

          {/* Header */}
          <View style={styles.sheetHeader}>
            {(step === 2 || mode === 'receipt') && (
              <TouchableOpacity onPress={handleBack} style={styles.backBtn}>
                <Ionicons name="chevron-back" size={22} color={colors.primary} />
              </TouchableOpacity>
            )}
            <Text style={[styles.sheetTitle, { color: colors.text }]}>
              {mode === 'receipt'
                ? purchase ? 'Select Your Filter' : 'Register with Receipt'
                : step === 1
                ? existingActivation ? 'New Filter Installed' : 'Register Your Filter'
                : 'When was it installed?'}
            </Text>
            <TouchableOpacity onPress={handleClose} style={styles.closeBtn}>
              <Ionicons name="close" size={22} color={colors.mutedForeground} />
            </TouchableOpacity>
          </View>

          {mode === 'receipt' ? (
            purchase === null ? (
              /* Receipt step A: receipt number + phone */
              <ScrollView
                style={{ flex: 1 }}
                contentContainerStyle={styles.sheetBody}
                keyboardShouldPersistTaps="handled"
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
                  autoCorrect={false}
                  style={[styles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.card }]}
                />
                <TextInput
                  value={phone}
                  onChangeText={setPhone}
                  placeholder="Phone used at purchase, e.g. 07XX XXX XXX"
                  placeholderTextColor={colors.mutedForeground}
                  keyboardType="phone-pad"
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
              </ScrollView>
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
            )
          ) : step === 1 ? (
            /* Step 1: Product picker */
            <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.sheetBody} showsVerticalScrollIndicator={false}>
              <Text style={[styles.stepHint, { color: colors.mutedForeground }]}>
                Select the filter you installed:
              </Text>
              {productsLoading && filterProducts.length === 0 && (
                <ActivityIndicator style={{ marginVertical: 20 }} color={colors.primary} />
              )}
              {filterProducts.map(p => (
                <TouchableOpacity
                  key={p.id}
                  onPress={() => { setProductId(p.id); setStep(2); }}
                  activeOpacity={0.8}
                  style={[
                    styles.productRow,
                    { backgroundColor: colors.card, borderColor: productId === p.id ? colors.primary : colors.border },
                  ]}>
                  <View style={[styles.productIconWrap, { backgroundColor: colors.primaryLight }]}>
                    <Ionicons name={p.icon as never} size={18} color={colors.primary} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.productRowName, { color: colors.text }]}>{p.name}</Text>
                    <Text style={[styles.productRowLife, { color: colors.mutedForeground }]}>
                      {p.lifespanDays < 90
                        ? `${p.lifespanDays}-day lifespan`
                        : p.lifespanDays < 365
                        ? `${Math.round(p.lifespanDays / 30)}-month lifespan`
                        : `${Math.round(p.lifespanDays / 365)}-year lifespan`}
                    </Text>
                  </View>
                  <Ionicons name="chevron-forward" size={16} color={colors.mutedForeground} />
                </TouchableOpacity>
              ))}

              {/* Receipt-based entry point */}
              <TouchableOpacity
                onPress={() => { setLookupError(''); setMode('receipt'); }}
                activeOpacity={0.8}
                style={[styles.receiptLink, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                <Ionicons name="receipt-outline" size={16} color={colors.primary} />
                <Text style={[styles.receiptLinkText, { color: colors.primary }]}>
                  Bought from us? Register with your receipt number
                </Text>
                <Ionicons name="chevron-forward" size={14} color={colors.primary} />
              </TouchableOpacity>
            </ScrollView>
          ) : (
            /* Step 2: Date picker */
            <View style={[styles.sheetBody, { flex: 1 }]}>
              <Text style={[styles.stepHint, { color: colors.mutedForeground }]}>
                {selectedProduct?.name} — {selectedProduct?.lifespanDays}-day lifespan
              </Text>
              <Text style={[styles.stepHint, { color: colors.mutedForeground, marginTop: 4, marginBottom: 8 }]}>
                How long ago did you install it?
              </Text>
              <View style={{ gap: 10 }}>
                {DAY_OFFSETS.map(o => (
                  <TouchableOpacity
                    key={o.days}
                    onPress={() => setDayOffset(o.days)}
                    activeOpacity={0.8}
                    style={[
                      styles.offsetRow,
                      {
                        backgroundColor: dayOffset === o.days ? colors.primary : colors.card,
                        borderColor: dayOffset === o.days ? colors.primary : colors.border,
                      },
                    ]}>
                    <Text style={[
                      styles.offsetLabel,
                      { color: dayOffset === o.days ? '#fff' : colors.text },
                    ]}>
                      {o.label}
                    </Text>
                    {dayOffset === o.days && <Ionicons name="checkmark" size={18} color="#fff" />}
                  </TouchableOpacity>
                ))}
              </View>

              <TouchableOpacity
                onPress={handleSave}
                disabled={saving}
                activeOpacity={0.85}
                style={[styles.saveBtn, { backgroundColor: colors.primary, opacity: saving ? 0.7 : 1 }]}>
                {saving
                  ? <ActivityIndicator color="#fff" size="small" />
                  : <Text style={styles.saveBtnTxt}>
                      {existingActivation ? 'Record Replacement' : 'Register & Schedule Reminders'}
                    </Text>}
              </TouchableOpacity>
            </View>
          )}
        </View>
      </View>
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
