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
 */
import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useQuery } from '@tanstack/react-query';
import { useColors } from '@/hooks/useColors';
import { useAuth } from '@/context/AuthContext';
import { useApi } from '@/hooks/useApi';
import { useFilterProducts } from '@/hooks/useFilterProducts';
import { type FilterActivation } from '@/hooks/useNotifications';
import { RegisterModal } from '@/components/FilterTrackerSection';
import {
  readNudgeState,
  markNudgeDismissed,
  readReplacementNudgeDismissed,
  markReplacementNudgeDismissed,
} from '@/hooks/filterNudge';

interface Props {
  /** Called after the user completes registration from the prompt. */
  onRegistered?: (a: FilterActivation) => void;
}

type NudgeMode = 'register' | 'replace';

interface CandidateResult {
  mode:              NudgeMode;
  product:           { id: number; name: string; lifespanDays: number };
  daysSincePurchase: number;
  orderId:           number;
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

  // Re-read local state on sign-in / account switch.
  useEffect(() => {
    if (!token || !user) return;
    let cancelled = false;
    setDismissed(null);
    setHasActivation(null);
    setActivation(null);
    setHandled(false);
    setReplacementDismissed(null);
    setReplacementDismissedOrderId(null);
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
    if (!orders || productsLoading || filterProducts.length === 0) return null;
    const byId = new Map(filterProducts.map(p => [p.id, p]));
    const sorted = [...orders].sort(
      (a, b) => new Date(b.dateCreated).getTime() - new Date(a.dateCreated).getTime(),
    );

    // ① Register mode: no activation — find any trackable order.
    if (eligibleForRegister) {
      for (const order of sorted) {
        for (const item of order.lineItems ?? []) {
          const product = byId.get(item.productId);
          if (product) {
            const daysSincePurchase = Math.max(
              0,
              Math.floor((Date.now() - new Date(order.dateCreated).getTime()) / 86_400_000),
            );
            return { mode: 'register', product, daysSincePurchase, orderId: order.id };
          }
        }
      }
    }

    // ② Replace mode: activation stored — find a trackable order that is
    //   newer than the activation date AND from a different order than the
    //   one that started the current cycle.
    if (eligibleForReplace && activation) {
      const activationTime = new Date(activation.activatedAt).getTime();
      for (const order of sorted) {
        const orderTime = new Date(order.dateCreated).getTime();
        // Orders are newest-first; once we're at or before the activation we
        // can stop — there's nothing newer to find.
        if (orderTime <= activationTime) break;
        // Skip the same purchase that registered the current cycle.
        if (order.id === activation.sourceOrderId) continue;
        for (const item of order.lineItems ?? []) {
          const product = byId.get(item.productId);
          if (product) {
            const daysSincePurchase = Math.max(
              0,
              Math.floor((Date.now() - orderTime) / 86_400_000),
            );
            return { mode: 'replace', product, daysSincePurchase, orderId: order.id };
          }
        }
      }
    }

    return null;
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

  // ── Visibility guard ──────────────────────────────────────────────────────
  if (!candidateResult) return null;
  if (candidateResult.mode === 'replace' && replacementDismissed !== false) {
    // Hide while loading (null) and when dismissed (true).
    return null;
  }

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

  // ── Content copy ──────────────────────────────────────────────────────────
  const isReplace = candidateResult.mode === 'replace';
  const title = isReplace
    ? `Restart reminders for your new ${candidateResult.product.name}`
    : `Start reminders for your ${candidateResult.product.name}`;
  const subtitle = isReplace
    ? `You've bought a new ${candidateResult.product.name} — restart your replacement reminders to track this filter.`
    : `You bought this filter but haven't registered it — register now so replacement reminders can start.`;
  const ctaLabel = isReplace ? 'Restart reminders →' : 'Register filter →';
  const accessLabel = isReplace ? 'Dismiss restart reminders prompt' : 'Dismiss filter registration prompt';

  // ── Render ────────────────────────────────────────────────────────────────
  return (
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
        initialProductId={candidateResult.product.id}
        initialDayOffset={candidateResult.daysSincePurchase}
        onClose={() => setShowModal(false)}
        onSave={a => {
          setShowModal(false);
          setHandled(true);
          setHasActivation(true);
          onRegistered?.(a);
        }}
      />
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
