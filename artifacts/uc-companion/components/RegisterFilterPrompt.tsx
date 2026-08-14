/**
 * RegisterFilterPrompt
 *
 * Gentle home-screen nudge for signed-in customers whose order history
 * contains a trackable filter (lifespanDays > 0) but who have no stored
 * filter activation — meaning replacement reminders were never scheduled.
 *
 * Behaviour:
 *   • Shows a one-time dismissible card naming the purchased filter
 *   • Tapping "Register" opens the registration modal pre-selected with the
 *     product and a purchase-date-based day offset (snapped to an option)
 *   • Never re-fires after registration (activation stored) or dismissal
 *     (AsyncStorage flag)
 */
import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Haptics from 'expo-haptics';
import { useQuery } from '@tanstack/react-query';
import { useColors } from '@/hooks/useColors';
import { useAuth } from '@/context/AuthContext';
import { useApi } from '@/hooks/useApi';
import { useFilterProducts } from '@/hooks/useFilterProducts';
import { getFilterActivation, type FilterActivation } from '@/hooks/useNotifications';
import { RegisterModal } from '@/components/FilterTrackerSection';

// Scoped per user so one account dismissing the prompt never suppresses it
// for a different account signing in later on the same device.
const dismissedKeyFor = (userId: number) => `uc_register_filter_prompt_dismissed_${userId}`;

interface Props {
  /** Called after the user completes registration from the prompt. */
  onRegistered?: (a: FilterActivation) => void;
}

export default function RegisterFilterPrompt({ onRegistered }: Props) {
  const colors = useColors();
  const { token, user } = useAuth();
  const api = useApi();
  const { products: filterProducts, loading: productsLoading } = useFilterProducts();

  const [dismissed, setDismissed]   = useState<boolean | null>(null); // null = not loaded yet
  const [hasActivation, setHasActivation] = useState<boolean | null>(null);
  const [showModal, setShowModal]   = useState(false);
  const [handled, setHandled]       = useState(false); // registered this session

  // Load local state (dismissal flag + stored activation) once signed in.
  // Re-runs on account switch (user.id change) so per-user state is re-read.
  useEffect(() => {
    if (!token || !user) return;
    let cancelled = false;
    setDismissed(null);
    setHasActivation(null);
    setHandled(false);
    (async () => {
      const [flag, activation] = await Promise.all([
        AsyncStorage.getItem(dismissedKeyFor(user.id)),
        getFilterActivation(),
      ]);
      if (cancelled) return;
      setDismissed(flag === '1');
      setHasActivation(activation != null);
    })();
    return () => { cancelled = true; };
  }, [token, user?.id]);

  // Only fetch orders when the prompt could actually show.
  const eligible = !!token && !!user && dismissed === false && hasActivation === false && !handled;

  const { data: orders } = useQuery({
    // Keyed by user id so a cached result can never leak across an account
    // switch on the same device.
    queryKey: ['orders', 'register-prompt', user?.id],
    queryFn: () => api.getOrders(),
    enabled: eligible,
    staleTime: 5 * 60 * 1000,
  });

  // Most recent order containing a trackable filter product.
  const candidate = useMemo(() => {
    if (!eligible || !orders || productsLoading || filterProducts.length === 0) return null;
    const byId = new Map(filterProducts.map(p => [p.id, p]));
    const sorted = [...orders].sort(
      (a, b) => new Date(b.dateCreated).getTime() - new Date(a.dateCreated).getTime(),
    );
    for (const order of sorted) {
      for (const item of order.lineItems ?? []) {
        const product = byId.get(item.productId);
        if (product) {
          const daysSincePurchase = Math.max(
            0,
            Math.floor((Date.now() - new Date(order.dateCreated).getTime()) / 86_400_000),
          );
          return { product, daysSincePurchase };
        }
      }
    }
    return null;
  }, [eligible, orders, filterProducts, productsLoading]);

  if (!candidate) return null;

  async function handleDismiss() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setDismissed(true);
    if (!user) return;
    try { await AsyncStorage.setItem(dismissedKeyFor(user.id), '1'); } catch { /* best-effort */ }
  }

  function handleOpen() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setShowModal(true);
  }

  return (
    <>
      <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.primary }]}>
        <View style={[styles.iconWrap, { backgroundColor: colors.primaryLight }]}>
          <Ionicons name="notifications-outline" size={20} color={colors.primary} />
        </View>
        <TouchableOpacity style={{ flex: 1 }} onPress={handleOpen} activeOpacity={0.8}>
          <Text style={[styles.title, { color: colors.text }]} numberOfLines={2}>
            Start reminders for your {candidate.product.name}
          </Text>
          <Text style={[styles.sub, { color: colors.mutedForeground }]} numberOfLines={2}>
            You bought this filter but haven't registered it — register now so
            replacement reminders can start.
          </Text>
          <Text style={[styles.cta, { color: colors.primary }]}>Register filter →</Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={handleDismiss}
          style={styles.closeBtn}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          accessibilityLabel="Dismiss filter registration prompt">
          <Ionicons name="close" size={18} color={colors.mutedForeground} />
        </TouchableOpacity>
      </View>

      <RegisterModal
        visible={showModal}
        existingActivation={null}
        filterProducts={filterProducts}
        productsLoading={productsLoading}
        initialProductId={candidate.product.id}
        initialDayOffset={candidate.daysSincePurchase}
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
