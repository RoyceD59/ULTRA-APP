/**
 * PerformanceCheckInModal
 *
 * 3-question survey → smart recommendation engine → actionable result screen.
 *
 * Questions:
 *   Step 1 — Flow rate (good / slow / very_slow / barely)
 *   Step 2 — Taste & smell (normal / slight / strong)
 *   Step 3 — Water source (mains / borehole / surface / mixed)
 *
 * Result:
 *   good    — All good, keep going
 *   clean   — Clean your filter, with "Mark as Cleaned" CTA
 *   replace — Replace now, with "Order Replacement" CTA
 */
import React, { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Modal,
  ScrollView, Platform, ActivityIndicator,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useColors } from '@/hooks/useColors';
import * as Haptics from 'expo-haptics';
import {
  type FlowRate,
  type Taste,
  type WaterSource,
  type PerfRecommendation,
  type PerformanceCheckIn,
  type FilterActivation,
  computeRecommendation,
  recordPerformanceCheckIn,
  recordFilterClean,
} from '@/hooks/useNotifications';

// ── Option data ───────────────────────────────────────────────────────────────

const FLOW_OPTIONS: Array<{ value: FlowRate; label: string; sub: string; icon: string }> = [
  { value: 'good',      label: 'Normal / Strong',         sub: 'Flows well — same as when installed', icon: 'checkmark-circle-outline' },
  { value: 'slow',      label: 'A bit slower',             sub: 'Noticeably less pressure than before', icon: 'trending-down-outline' },
  { value: 'very_slow', label: 'Much slower',              sub: 'Takes effort or waiting to fill',      icon: 'warning-outline'         },
  { value: 'barely',    label: 'Barely flowing / blocked', sub: 'Almost no water getting through',      icon: 'close-circle-outline'    },
];

const TASTE_OPTIONS: Array<{ value: Taste; label: string; sub: string; icon: string }> = [
  { value: 'normal', label: 'Fresh and clean',           sub: 'No complaints — tastes great',             icon: 'happy-outline'          },
  { value: 'slight', label: 'Slight taste or smell',     sub: 'Noticeable but not concerning',             icon: 'alert-circle-outline'   },
  { value: 'strong', label: 'Strong taste, smell or colour', sub: 'Clearly off — water looks or smells bad', icon: 'close-circle-outline' },
];

const SOURCE_OPTIONS: Array<{ value: WaterSource; label: string; sub: string; icon: string }> = [
  { value: 'mains',    label: 'Nairobi City mains',     sub: 'NW&SC / Nairobi Water Company supply', icon: 'business-outline'   },
  { value: 'borehole', label: 'Borehole or well',        sub: 'Ground water — mineral content varies',  icon: 'arrow-down-circle-outline' },
  { value: 'surface',  label: 'River, dam or rainwater', sub: 'High sediment and bacterial load',        icon: 'water-outline'      },
  { value: 'mixed',    label: "Mixed / I'm not sure",    sub: 'Multiple sources or supply changes',       icon: 'help-circle-outline'},
];

// ── Result content ────────────────────────────────────────────────────────────

interface ResultConfig {
  icon: string;
  iconColor: string;
  bgColor: (c: ReturnType<typeof useColors>) => string;
  title: string;
  body: (productName: string, cleanCount: number, source: WaterSource) => string;
  ctaLabel?: string;
  ctaIcon?: string;
}

const RESULTS: Record<PerfRecommendation, ResultConfig> = {
  good: {
    icon: 'checkmark-circle',
    iconColor: '#22C55E',
    bgColor: () => '#F0FDF4',
    title: 'Your filter is performing well',
    body: (name) => `Your ${name} is doing its job. No action needed right now — check in again in a few weeks or if you notice any changes.`,
  },
  clean: {
    icon: 'construct',
    iconColor: '#F59E0B',
    bgColor: () => '#FFFBEB',
    title: 'Your filter needs a clean',
    body: (name, cleans) =>
      `Slow flow or taste changes are usually caused by sediment buildup inside your ${name}.\n\n`
      + `Backflush the filter by running water backwards through the inlet for 30–60 seconds, or soak the cartridge in clean water for 15 minutes.\n\n`
      + (cleans >= 1
        ? `⚠️ This will be your ${cleans === 1 ? 'second' : 'third+'} clean. After cleaning, monitor closely — if flow doesn't improve, replace the filter.`
        : `After cleaning, run filtered water for 2–3 minutes before drinking.`),
    ctaLabel: 'Mark as Cleaned',
    ctaIcon:  'checkmark-done-outline',
  },
  replace: {
    icon: 'alert-circle',
    iconColor: '#EF4444',
    bgColor: () => '#FFF1F2',
    title: 'Replace your filter now',
    body: (name, cleans, source) => {
      const sourceText = source === 'surface'
        ? 'river / surface water has a high bacterial and sediment load'
        : source === 'borehole'
        ? 'borehole water contains elevated minerals that clog filters faster'
        : 'your water source quality';
      return `Based on ${sourceText}${cleans > 0 ? ` and ${cleans} previous clean${cleans > 1 ? 's' : ''}` : ''}, your ${name} has likely exceeded its safe effective lifespan.\n\nContinuing to use an exhausted filter can allow bacteria and contaminants to pass through. Order a genuine replacement to restore certified protection.`;
    },
    ctaLabel: 'Order Replacement',
    ctaIcon:  'bag-outline',
  },
};

// ── Props ─────────────────────────────────────────────────────────────────────

interface Props {
  visible:    boolean;
  activation: FilterActivation;
  userId:     number;
  onClose:    () => void;
  onUpdated:  (a: FilterActivation) => void;
  onOrderReplacement: () => void;
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function PerformanceCheckInModal({
  visible, activation, userId, onClose, onUpdated, onOrderReplacement,
}: Props) {
  const colors = useColors();

  type Step = 1 | 2 | 3 | 'result';
  const [step,       setStep]       = useState<Step>(1);
  const [flow,       setFlow]       = useState<FlowRate | null>(null);
  const [taste,      setTaste]      = useState<Taste | null>(null);
  const [source,     setSource]     = useState<WaterSource | null>(null);
  const [result,     setResult]     = useState<PerfRecommendation | null>(null);
  const [saving,     setSaving]     = useState(false);
  const [cleaned,    setCleaned]    = useState(false);

  const reset = useCallback(() => {
    setStep(1); setFlow(null); setTaste(null);
    setSource(null); setResult(null); setSaving(false); setCleaned(false);
  }, []);

  function handleClose() { reset(); onClose(); }

  // ── Step navigation ─────────────────────────────────────────────────────────

  async function handleFlowPick(v: FlowRate) {
    Haptics.selectionAsync();
    setFlow(v);
    setStep(2);
  }

  async function handleTastePick(v: Taste) {
    Haptics.selectionAsync();
    setTaste(v);
    setStep(3);
  }

  async function handleSourcePick(v: WaterSource) {
    Haptics.selectionAsync();
    setSource(v);
    setSaving(true);

    const elapsed   = Math.floor((Date.now() - new Date(activation.activatedAt).getTime()) / 86_400_000);
    const cleanCount = activation.cleanCount ?? 0;
    const rec = computeRecommendation(
      flow!,
      taste!,
      v,
      cleanCount,
      elapsed,
      activation.lifespanDays,
    );

    const checkIn: PerformanceCheckIn = {
      date:           new Date().toISOString(),
      flowRate:       flow!,
      taste:          taste!,
      waterSource:    v,
      recommendation: rec,
    };

    const updated = await recordPerformanceCheckIn(checkIn, userId);
    if (updated) onUpdated(updated);

    setResult(rec);
    setStep('result');
    setSaving(false);
  }

  async function handleMarkCleaned() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setSaving(true);
    const updated = await recordFilterClean(userId);
    if (updated) onUpdated(updated);
    setSaving(false);
    setCleaned(true);
  }

  // ── Render helpers ──────────────────────────────────────────────────────────

  const stepNum   = step === 'result' ? 3 : (step as number);
  const cleanCount = activation.cleanCount ?? 0;

  const resultCfg  = result ? RESULTS[result] : null;
  const bgColor    = resultCfg ? resultCfg.bgColor(colors) : colors.background;

  // ── Shared option row ───────────────────────────────────────────────────────
  function OptionRow<T extends string>({
    item, selected, onPress,
  }: {
    item: { value: T; label: string; sub: string; icon: string };
    selected: boolean;
    onPress: (v: T) => void;
  }) {
    return (
      <TouchableOpacity
        onPress={() => onPress(item.value)}
        activeOpacity={0.8}
        style={[
          styles.optionRow,
          {
            backgroundColor: selected ? colors.primary + '12' : colors.card,
            borderColor: selected ? colors.primary : colors.border,
          },
        ]}>
        <View style={[styles.optionIconWrap, { backgroundColor: selected ? colors.primary : colors.surface }]}>
          <Ionicons name={item.icon as never} size={18} color={selected ? '#fff' : colors.mutedForeground} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[styles.optionLabel, { color: colors.text }]}>{item.label}</Text>
          <Text style={[styles.optionSub, { color: colors.mutedForeground }]}>{item.sub}</Text>
        </View>
        {selected && <Ionicons name="checkmark-circle" size={20} color={colors.primary} />}
      </TouchableOpacity>
    );
  }

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={handleClose}>
      <View style={styles.overlay}>
        <View style={[styles.sheet, { backgroundColor: colors.background }]}>
          {/* Handle */}
          <View style={[styles.handle, { backgroundColor: colors.border }]} />

          {/* Header */}
          <View style={styles.sheetHeader}>
            {(step === 2 || step === 3) && (
              <TouchableOpacity
                onPress={() => setStep(step === 3 ? 2 : 1)}
                style={styles.backBtn}>
                <Ionicons name="chevron-back" size={22} color={colors.primary} />
              </TouchableOpacity>
            )}
            <View style={{ flex: 1 }}>
              <Text style={[styles.sheetTitle, { color: colors.text }]}>
                {step === 'result' ? 'Your Filter Report' : 'Performance Check'}
              </Text>
              {step !== 'result' && (
                <Text style={[styles.stepIndicator, { color: colors.mutedForeground }]}>
                  Step {stepNum} of 3
                </Text>
              )}
            </View>
            <TouchableOpacity onPress={handleClose} style={styles.closeBtn}>
              <Ionicons name="close" size={22} color={colors.mutedForeground} />
            </TouchableOpacity>
          </View>

          {/* Progress bar */}
          {step !== 'result' && (
            <View style={[styles.progressTrack, { backgroundColor: colors.surface }]}>
              <View style={[
                styles.progressFill,
                { width: `${(stepNum / 3) * 100}%` as unknown as number, backgroundColor: colors.primary },
              ]} />
            </View>
          )}

          {/* ── Content ─────────────────────────────────────────────────── */}
          <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>

            {step === 1 && (
              <>
                <Text style={[styles.question, { color: colors.text }]}>How's the water flow?</Text>
                <Text style={[styles.questionSub, { color: colors.mutedForeground }]}>
                  Compare to when you first installed the {activation.productName}
                </Text>
                <View style={styles.options}>
                  {FLOW_OPTIONS.map(o => (
                    <OptionRow key={o.value} item={o} selected={flow === o.value} onPress={handleFlowPick} />
                  ))}
                </View>
              </>
            )}

            {step === 2 && (
              <>
                <Text style={[styles.question, { color: colors.text }]}>How does the water taste?</Text>
                <Text style={[styles.questionSub, { color: colors.mutedForeground }]}>
                  Include any unusual smell or visible colour
                </Text>
                <View style={styles.options}>
                  {TASTE_OPTIONS.map(o => (
                    <OptionRow key={o.value} item={o} selected={taste === o.value} onPress={handleTastePick} />
                  ))}
                </View>
              </>
            )}

            {step === 3 && (
              <>
                <Text style={[styles.question, { color: colors.text }]}>What's your main water source?</Text>
                <Text style={[styles.questionSub, { color: colors.mutedForeground }]}>
                  This calibrates your filter's real effective lifespan
                </Text>
                <View style={styles.options}>
                  {saving
                    ? <ActivityIndicator color={colors.primary} style={{ marginTop: 40 }} />
                    : SOURCE_OPTIONS.map(o => (
                        <OptionRow key={o.value} item={o} selected={source === o.value} onPress={handleSourcePick} />
                      ))
                  }
                </View>
              </>
            )}

            {step === 'result' && resultCfg && source && (
              <>
                {/* Result card */}
                <View style={[styles.resultCard, { backgroundColor: bgColor }]}>
                  <Ionicons name={resultCfg.icon as never} size={44} color={resultCfg.iconColor} />
                  <Text style={[styles.resultTitle, { color: colors.text }]}>{resultCfg.title}</Text>
                  <Text style={[styles.resultBody, { color: colors.mutedForeground }]}>
                    {resultCfg.body(activation.productName, cleanCount, source)}
                  </Text>
                </View>

                {/* Summary chips */}
                <View style={styles.summaryRow}>
                  {[
                    { label: flow === 'good' ? 'Good flow' : flow === 'slow' ? 'Slow flow' : flow === 'very_slow' ? 'Very slow flow' : 'Blocked', color: flow === 'good' ? '#22C55E' : flow === 'barely' ? '#EF4444' : '#F59E0B' },
                    { label: taste === 'normal' ? 'Clean taste' : taste === 'slight' ? 'Slight taste' : 'Bad taste/smell', color: taste === 'normal' ? '#22C55E' : taste === 'strong' ? '#EF4444' : '#F59E0B' },
                    { label: source === 'mains' ? 'City mains' : source === 'borehole' ? 'Borehole' : source === 'surface' ? 'Surface water' : 'Mixed source', color: source === 'mains' ? '#22C55E' : source === 'surface' ? '#EF4444' : '#F59E0B' },
                  ].map(chip => (
                    <View key={chip.label} style={[styles.chip, { backgroundColor: chip.color + '18', borderColor: chip.color + '40' }]}>
                      <Text style={[styles.chipText, { color: chip.color }]}>{chip.label}</Text>
                    </View>
                  ))}
                </View>

                {/* CTA */}
                {result === 'clean' && (
                  cleaned ? (
                    <View style={[styles.cleanedConfirm, { backgroundColor: '#F0FDF4', borderColor: '#86EFAC' }]}>
                      <Ionicons name="checkmark-circle" size={20} color="#22C55E" />
                      <Text style={[styles.cleanedConfirmText, { color: '#166534' }]}>
                        Clean recorded - keep an eye on performance over the next few days.
                        {cleanCount >= 1
                          ? "\n\nYou've now cleaned this filter more than once. If performance does not improve, replace it."
                          : ''}
                      </Text>
                    </View>
                  ) : (
                    <TouchableOpacity
                      onPress={handleMarkCleaned}
                      disabled={saving}
                      activeOpacity={0.85}
                      style={[styles.ctaBtn, { backgroundColor: '#F59E0B', opacity: saving ? 0.7 : 1 }]}>
                      {saving
                        ? <ActivityIndicator color="#fff" size="small" />
                        : <>
                            <Ionicons name="checkmark-done-outline" size={18} color="#fff" />
                            <Text style={styles.ctaBtnText}>Mark as Cleaned</Text>
                          </>}
                    </TouchableOpacity>
                  )
                )}

                {result === 'replace' && (
                  <TouchableOpacity
                    onPress={() => { handleClose(); onOrderReplacement(); }}
                    activeOpacity={0.85}
                    style={[styles.ctaBtn, { backgroundColor: '#EF4444' }]}>
                    <Ionicons name="bag-outline" size={18} color="#fff" />
                    <Text style={styles.ctaBtnText}>Order Replacement</Text>
                  </TouchableOpacity>
                )}

                {result === 'good' && (
                  <TouchableOpacity
                    onPress={handleClose}
                    activeOpacity={0.85}
                    style={[styles.ctaBtn, { backgroundColor: '#22C55E' }]}>
                    <Ionicons name="checkmark-circle-outline" size={18} color="#fff" />
                    <Text style={styles.ctaBtnText}>Great — close</Text>
                  </TouchableOpacity>
                )}

                <Text style={[styles.disclaimer, { color: colors.mutedForeground }]}>
                  Ratings assume normal usage conditions. Your water source quality is the biggest variable — always trust your senses.
                </Text>
              </>
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  overlay:           { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  sheet:             { borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingBottom: Platform.OS === 'ios' ? 34 : 16, maxHeight: '90%', minHeight: 400 },
  handle:            { width: 40, height: 4, borderRadius: 2, alignSelf: 'center', marginTop: 10 },
  sheetHeader:       { flexDirection: 'row', alignItems: 'flex-start', paddingHorizontal: 16, paddingVertical: 14, gap: 8 },
  backBtn:           { padding: 4, marginTop: 2 },
  sheetTitle:        { fontSize: 17, fontWeight: '700' as const },
  stepIndicator:     { fontSize: 12, marginTop: 2 },
  closeBtn:          { padding: 4 },
  progressTrack:     { height: 3, marginHorizontal: 16, marginBottom: 8, borderRadius: 2, overflow: 'hidden' },
  progressFill:      { height: 3, borderRadius: 2 },
  body:              { paddingHorizontal: 16, paddingBottom: 24, gap: 12 },
  question:          { fontSize: 18, fontWeight: '700' as const, marginBottom: 2 },
  questionSub:       { fontSize: 13, lineHeight: 18, marginBottom: 4 },
  options:           { gap: 10 },
  optionRow:         { flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1, borderRadius: 12, padding: 12 },
  optionIconWrap:    { width: 38, height: 38, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  optionLabel:       { fontSize: 14, fontWeight: '600' as const },
  optionSub:         { fontSize: 12, marginTop: 2, lineHeight: 16 },
  resultCard:        { borderRadius: 16, padding: 20, alignItems: 'center', gap: 10, marginBottom: 4 },
  resultTitle:       { fontSize: 18, fontWeight: '700' as const, textAlign: 'center' },
  resultBody:        { fontSize: 13, lineHeight: 20, textAlign: 'left' },
  summaryRow:        { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip:              { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20, borderWidth: 1 },
  chipText:          { fontSize: 12, fontWeight: '600' as const },
  ctaBtn:            { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: 12, paddingVertical: 15, marginTop: 4 },
  ctaBtnText:        { color: '#fff', fontSize: 15, fontWeight: '700' as const },
  cleanedConfirm:    { flexDirection: 'row', alignItems: 'flex-start', gap: 10, borderRadius: 12, borderWidth: 1, padding: 14, marginTop: 4 },
  cleanedConfirmText:{ flex: 1, fontSize: 13, lineHeight: 18 },
  disclaimer:        { fontSize: 11, lineHeight: 16, textAlign: 'center', marginTop: 4 },
});
