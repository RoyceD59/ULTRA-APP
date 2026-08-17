/**
 * RegisterFilterPrompt
 *
 * Home-screen nudge for signed-in customers that shows in two modes:
 *
 * ① Register mode — no activation stored yet:
 *   A trackable-filter order exists but reminders were never scheduled.
 *   Shows a one-time dismissible card; tapping "Register" opens the modal.
 *
 * ② Replace mode — an activation is stored AND a newer trackable-filter
 *   order exists (different order than the one that triggered the current
 *   cycle). Offers to restart reminders for the replacement filter.
 *   Dismissal is scoped per order so a future purchase re-triggers the nudge.
 *
 * In both modes the RegisterModal handles the actual activation flow;
 * for Replace mode it receives `existingActivation` so it can warn the user
 * that the old cycle will be overwritten.
 *
 * After a successful registration in Register mode, ReminderOptInSheet is
 * shown once to invite the user to enable message reminder channels.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useQuery } from '@tanstack/react-query';
import { useColors } from '@/hooks/useColors';
import { useAuth } from '@/context/AuthContext';
import { useApi } from '@/hooks/useApi';
import { useFilterProducts } from '@/hooks/useFilterProducts';
import { type FilterActivation } from '@/hooks/useNotifications';
import {
  type CandidateResult,
  computeRegisterCandidate,
} from '@/hooks/filterCandidateUtils';
import { RegisterModal } from '@/components/FilterTrackerSection';
import {
  readNudgeState,
  markNudgeDismissed,
  readReplacementNudgeDismissed,
  markReplacementNudgeDismissed,
} from '@/hooks/filterNudge';
import ReminderOptInSheet, { wasReminderOptInSeen } from '@/components/ReminderOptInSheet';

interface Props {
  /** Called after the user completes registration from the prompt. */
  onRegistered?: (a: FilterActivation) => void;
}

export default function RegisterFilterPrompt({ onRegistered }: Props) {
  const colors = useColors();
  const { token, user } = useAuth();
  const api = useApi();
  const { products: filterProducts, loading: productsLoading } = useFilterProducts();

  // ── Per-user nudge state ──────────────────────────────────────────────────
  const [dismissed, setDismissed]       = useState<boolean | null>(null); // null = not loaded
  const [hasActivation, setHasActivation] = useState<boolean | null>(null);
  const [activation, setActivation]     = useState<FilterActivation | null>(null);
  const [handled, setHandled]           = useState(false); // registered this session

  // Replacement-nudge dismissal is per order; loaded lazily once a candidate
  // is identified. null = not yet loaded.
  const [replacementDismissed, setReplacementDismissed] = useState<boolean | null>(null);
  const [replacementDismissedOrderId, setReplacementDismissedOrderId] = useState<number | null>(null);

  const [showModal, setShowModal] = useState(false);

  // ReminderOptInSheet: shown once after a register-mode activation.
  // Must be tracked independently of candidateResult so the sheet stays mounted
  // even after registration sets handled=true and nulls out the candidate.
  const [pendingOptIn, setPendingOptIn] = useState<FilterActivation | null>(null);

  // A ref that always reflects the *current* user ID synchronously. Unlike the
  // closure-captured `user`, this ref is updated on every render, so async
  // callbacks that await before reading it see the post-switch value, not a
  // stale snapshot from when the callback was created.
  const currentUserIdRef = useRef<number | null>(user?.id ?? null);
  currentUserIdRef.current = user?.id ?? null;

  // Re-read local state on sign-in / account switch.
  // Also clears any pending opt-in sheet so Account A's sheet can never
  // appear for Account B when two accounts share the same device.
  useEffect(() => {
    if (!token || !user) {
      setPendingOptIn(null);
      return;
    }
    let cancelled = false;
    setDismissed(null);
    setHasActivation(null);
    setActivation(null);
    setHandled(false);
    setReplacementDismissed(null);
    setReplacementDismissedOrderId(null);
    setPendingOptIn(null);
    (async () => {
      const state = await readNudgeState(user.id);
      if (cancelled) return;
      setDismissed(state.dismissed);
      setHasActivation(state.hasActivation);
      setActivation(state.activation);
    })();
    return () => { cancelled = true; };
  }, [token, user?.id]);

  // ── Orders fetch ──────────────────────────────────────────────────────────
  // Fetch when either mode could show.
  //   Register: no activation, not dismissed.
  //   Replace:  activation stored (check for a newer purchase).
  const eligibleForRegister = !!token && !!user && dismissed === false && hasActivation === false && !handled;
  const eligibleForReplace  = !!token && !!user && hasActivation === true && !handled;
  const ordersEnabled = eligibleForRegister || eligibleForReplace;

  const { data: orders } = useQuery({
    queryKey: ['orders', 'register-prompt', user?.id],
    queryFn: () => api.getOrders(),
    enabled: ordersEnabled,
    staleTime: 5 * 60 * 1000,
  });

  // ── Candidate computation ─────────────────────────────────────────────────
  const candidateResult = useMemo<CandidateResult | null>(() => {
    if (!orders || productsLoading) return null;
    return computeRegisterCandidate({
      eligibleForRegister,
      eligibleForReplace,
      activation,
      orders,
      filterProducts,
    });
  }, [eligibleForRegister, eligibleForReplace, activation, orders, filterProducts, productsLoading]);

  // ── Replacement-nudge dismissal (lazy, per order) ─────────────────────────
  useEffect(() => {
    if (!candidateResult || candidateResult.mode !== 'replace' || !user) return;
    const { orderId } = candidateResult;
    if (replacementDismissedOrderId === orderId) return; // already loaded for this order
    let cancelled = false;
    (async () => {
      const isDismissed = await readReplacementNudgeDismissed(user.id, orderId);
      if (cancelled) return;
      setReplacementDismissed(isDismissed);
      setReplacementDismissedOrderId(orderId);
    })();
    return () => { cancelled = true; };
  }, [candidateResult?.mode, candidateResult?.orderId, user?.id]);

  // ── Handlers ──────────────────────────────────────────────────────────────
  async function handleDismiss() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (!user) return;
    if (candidateResult!.mode === 'register') {
      setDismissed(true);
      await markNudgeDismissed(user.id);
    } else {
      setReplacementDismissed(true);
      await markReplacementNudgeDismissed(user.id, candidateResult!.orderId);
    }
  }

  function handleOpen() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setShowModal(true);
  }

  // ── Visibility guard ──────────────────────────────────────────────────────
  // The nudge card is hidden when there is no candidate or the replace nudge
  // is dismissed/loading. The ReminderOptInSheet is rendered independently
  // so it survives the post-registration state change that nulls candidateResult.
  const showNudge =
    !!candidateResult &&
    !(candidateResult.mode === 'replace' && replacementDismissed !== false);

  if (!showNudge && !pendingOptIn) return null;

  // ── Content copy ──────────────────────────────────────────────────────────
  const isReplace = candidateResult?.mode === 'replace';
  const title = isReplace
    ? `Restart reminders for your new ${candidateResult!.product.name}`
    : `Start reminders for your ${candidateResult?.product.name}`;
  const subtitle = isReplace
    ? `You've bought a new ${candidateResult!.product.name} — restart your replacement reminders to track this filter.`
    : `You bought this filter but haven't registered it — register now so replacement reminders can start.`;
  const ctaLabel = isReplace ? 'Restart reminders →' : 'Register filter →';
  const accessLabel = isReplace ? 'Dismiss restart reminders prompt' : 'Dismiss filter registration prompt';

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <>
      {showNudge && candidateResult && (
        <>
          <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.primary }]}>
            <View style={[styles.iconWrap, { backgroundColor: colors.primaryLight }]}>
              <Ionicons
                name={isReplace ? 'refresh-outline' : 'notifications-outline'}
                size={20}
                color={colors.primary}
              />
            </View>
            <TouchableOpacity style={{ flex: 1 }} onPress={handleOpen} activeOpacity={0.8}>
              <Text style={[styles.title, { color: colors.text }]} numberOfLines={2}>
                {title}
              </Text>
              <Text style={[styles.sub, { color: colors.mutedForeground }]} numberOfLines={3}>
                {subtitle}
              </Text>
              <Text style={[styles.cta, { color: colors.primary }]}>{ctaLabel}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={handleDismiss}
              style={styles.closeBtn}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              accessibilityLabel={accessLabel}>
              <Ionicons name="close" size={18} color={colors.mutedForeground} />
            </TouchableOpacity>
          </View>

          <RegisterModal
            visible={showModal}
            existingActivation={isReplace ? activation : null}
            filterProducts={filterProducts}
            productsLoading={productsLoading}
            userId={user?.id ?? 0}
            initialProductId={candidateResult.product.id}
            initialDayOffset={candidateResult.daysSincePurchase}
            onClose={() => setShowModal(false)}
            onSave={async a => {
              setShowModal(false);
              setHandled(true);
              setHasActivation(true);
              onRegistered?.(a);
              // After register-mode activation, offer message reminder channels
              // once (keyed by productId+activatedAt+userId so it never repeats
              // and two accounts on the same device don't share state).
              // Capture userId before the await; after it resolves compare against
              // currentUserIdRef.current (updated synchronously on every render)
              // to detect a mid-flight account switch. This is effective because
              // unlike the closure-captured `user`, the ref always reflects the
              // currently rendered user — an account switch will have updated it
              // before the setState call runs.
              if (!isReplace && token && user) {
                const initiatingUserId = user.id;
                const alreadySeen = await wasReminderOptInSeen(a.productId, a.activatedAt, initiatingUserId);
                if (!alreadySeen && currentUserIdRef.current === initiatingUserId) {
                  setPendingOptIn(a);
                }
              }
            }}
          />
        </>
      )}

      {/* Rendered independently of the nudge card so it stays mounted after
          registration sets handled=true and candidateResult becomes null. */}
      {pendingOptIn && user && (
        <ReminderOptInSheet
          visible
          productId={pendingOptIn.productId}
          activatedAt={pendingOptIn.activatedAt}
          userId={user.id}
          onClose={() => setPendingOptIn(null)}
        />
      )}
    </>
  );
}

const styles = StyleSheet.create({
  card:     { flexDirection: 'row', alignItems: 'flex-start', gap: 12, borderWidth: 1, borderRadius: 14, padding: 14 },
  iconWrap: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  title:    { fontSize: 14, fontWeight: '600' as const },
  sub:      { fontSize: 12, marginTop: 2, lineHeight: 16 },
  cta:      { fontSize: 13, fontWeight: '600' as const, marginTop: 6 },
  closeBtn: { padding: 2 },
});
