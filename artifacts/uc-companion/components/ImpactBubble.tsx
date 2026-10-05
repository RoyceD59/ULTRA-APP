/**
 * ImpactBubble — Ultra-Clear environmental impact widget
 *
 * Shows three animated counting-up stats drawn live from /api/uc/impact:
 *   • Happy users (filter owners)
 *   • Litres of water filtered
 *   • 500 ml plastic bottles avoided
 *
 * Shared ProjectHub-managed totals refresh on return and once per minute.
 */
import React, { useEffect, useState, useRef } from 'react';
import { ActivityIndicator, View, Text, TouchableOpacity, StyleSheet, Animated, Easing } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useGlobalImpact } from '@/hooks/useGlobalImpact';
import ForestLink from '@/components/ForestLink';

// ── Count-up hook ─────────────────────────────────────────────────────────────

function useCountUp(target: number, duration = 1600): number {
  const [value, setValue] = useState(0);
  const prevTarget = useRef(0);

  useEffect(() => {
    if (target === 0) { prevTarget.current = 0; setValue(0); return; }
    const from  = prevTarget.current;
    prevTarget.current = target;

    const start = Date.now();
    const delta = target - from;

    const tick = () => {
      const elapsed  = Date.now() - start;
      const progress = Math.min(elapsed / duration, 1);
      // ease-out cubic
      const eased = 1 - Math.pow(1 - progress, 3);
      setValue(Math.round(from + delta * eased));
      if (progress < 1) frame = requestAnimationFrame(tick);
    };
    let frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target, duration]);

  return value;
}

// ── Number formatter ──────────────────────────────────────────────────────────

function fmt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000)     return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}

// ── Sub-component: one stat bubble ────────────────────────────────────────────

interface StatBubbleProps {
  icon:    keyof typeof Ionicons.glyphMap;
  color:   string;
  value:   number;
  label:   string;
  unit?:   string;
}

function StatBubble({ icon, color, value, label, unit }: StatBubbleProps) {
  const animated = useCountUp(value);

  return (
    <View style={styles.statBubble}>
      <View style={[styles.statIcon, { backgroundColor: color + '22' }]}>
        <Ionicons name={icon} size={22} color={color} />
      </View>
      <Text style={styles.statValue}>
        {fmt(animated)}
        {unit ? <Text style={styles.statUnit}>{unit}</Text> : null}
      </Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

// ── Pulse animation for the "live" dot ────────────────────────────────────────

function PulseDot() {
  const scale = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(scale, { toValue: 1.5, duration: 700, easing: Easing.out(Easing.ease), useNativeDriver: true }),
        Animated.timing(scale, { toValue: 1,   duration: 700, easing: Easing.in(Easing.ease),  useNativeDriver: true }),
      ])
    );
    pulse.start();
    return () => pulse.stop();
  }, [scale]);

  return (
    <Animated.View style={[styles.liveDot, { transform: [{ scale }] }]} />
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function ImpactBubble() {
  const { data: stats, isError, isPending, isFetching, refetch } = useGlobalImpact();

  return (
    <View testID="global-uc-impact" style={[styles.card, { backgroundColor: '#003F6E', borderColor: '#005d8f' }]}>
      {/* Header */}
      <View style={styles.header}>
        <Ionicons name="leaf" size={16} color="#4ade80" />
        <Text style={styles.headerText}>Ultra-Clear Impact</Text>
        <View style={styles.liveChip}>
          {!!stats && !isError && <PulseDot />}
          <Text style={styles.liveText}>{isError ? 'UNAVAILABLE' : stats ? 'LIVE' : 'LOADING'}</Text>
        </View>
      </View>

      <Text style={styles.subText}>
        Together, we're replacing single-use plastic with clean, filtered water.
      </Text>

      {isPending && <View style={{ gap: 8, alignItems: 'center' }}>
        <ActivityIndicator color="#B5E9FA" />
        <Text style={styles.subText}>Loading global impact…</Text>
      </View>}
      {isError && <View style={{ gap: 4, alignItems: 'center' }}>
        <Text accessibilityRole="alert" style={styles.subText}>
          {stats ? 'Showing last received figures. The latest refresh failed.' : 'Global impact is unavailable right now.'}
        </Text>
        <TouchableOpacity accessibilityRole="button" testID="global-impact-retry" disabled={isFetching}
          onPress={() => refetch()} style={{ minHeight: 44, justifyContent: 'center' }}>
          <Text style={{ color: '#B5E9FA', textDecorationLine: 'underline' }}>Try again</Text>
        </TouchableOpacity>
      </View>}

      {/* Stats row */}
      {!!stats && <View style={styles.statsRow}>
        <StatBubble
          icon="people"
          color="#60a5fa"
          value={stats.totalUsers}
          label="Happy users"
        />
        <View style={[styles.divider, { backgroundColor: 'rgba(255,255,255,0.12)' }]} />
        <StatBubble
          icon="water"
          color="#34d399"
          value={stats.litresFiltered}
          label="Litres filtered"
          unit="L"
        />
        <View style={[styles.divider, { backgroundColor: 'rgba(255,255,255,0.12)' }]} />
        <StatBubble
          icon="trash-bin-outline"
          color="#f97316"
          value={stats.plasticsAvoided}
          label="Bottles avoided"
        />
        <View style={[styles.divider, { backgroundColor: 'rgba(255,255,255,0.12)' }]} />
        <StatBubble
          icon="sunny-outline"
          color="#facc15"
          value={stats.cleanWaterDays}
          label="Days of clean water"
        />
      </View>}

      <Text style={styles.footnote}>
        Shared global totals managed through ProjectHub. One litre of filtered water replaces two 500 ml bottles.
      </Text>
      <View testID="global-impact-programme" style={styles.programme}>
        <Text style={styles.programmeHeading}>Programme policy</Text>
        <Text testID="global-impact-programme-brief" style={styles.programmeText}>
          Hydrate the Future™ receives 3% of eligible paid purchases, split equally between tree growing in our community and clean-water access. Logged refills do not add funding.
        </Text>
        <ForestLink light label="Explore the global forest" />
      </View>
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  card: {
    borderRadius: 18, borderWidth: 1,
    padding: 18, gap: 12,
  },

  header:     { flexDirection: 'row', alignItems: 'center', gap: 8 },
  headerText: { flex: 1, fontSize: 14, fontWeight: '700' as const, color: '#fff' },

  liveChip:  { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: 'rgba(74,222,128,0.18)', borderRadius: 10, paddingHorizontal: 8, paddingVertical: 3 },
  liveDot:   { width: 6, height: 6, borderRadius: 3, backgroundColor: '#4ade80' },
  liveText:  { fontSize: 10, fontWeight: '800' as const, color: '#4ade80', letterSpacing: 0.8 },

  subText: { fontSize: 12, color: 'rgba(255,255,255,0.65)', lineHeight: 18 },

  statsRow: { flexDirection: 'row', alignItems: 'stretch' },
  divider:  { width: 1, marginVertical: 4 },

  statBubble: { flex: 1, alignItems: 'center', gap: 6, paddingVertical: 6, paddingHorizontal: 4 },
  statIcon:   { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center' },
  statValue:  { fontSize: 18, fontWeight: '800' as const, color: '#fff', letterSpacing: -0.5 },
  statUnit:   { fontSize: 12, fontWeight: '600' as const },
  statLabel:  { fontSize: 10, color: 'rgba(255,255,255,0.6)', textAlign: 'center', fontWeight: '500' as const },

  footnote: { fontSize: 10, color: 'rgba(255,255,255,0.4)', textAlign: 'center', lineHeight: 14 },
  programme: { gap: 6, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.16)', paddingTop: 12 },
  programmeHeading: { fontSize: 12, fontWeight: '700', color: '#B5E9FA' },
  programmeText: { fontSize: 13, lineHeight: 20, color: 'rgba(255,255,255,0.9)' },
});
