import React, { useState } from 'react';
import { ActivityIndicator, Modal, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useColors } from '@/hooks/useColors';
import { useApi, type PersonalImpact } from '@/hooks/useApi';
import { calculateImpact, getActiveMilestone } from '@/lib/calculateImpact';

interface Props {
  impact: PersonalImpact;
  onUpdated: (impact: PersonalImpact) => void;
}

export default function PersonalImpactSection({ impact, onUpdated }: Props) {
  const colors = useColors();
  const api = useApi();

  const [expanded, setExpanded] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [co2eOpen, setCo2eOpen] = useState(false);

  // State for Add Litres
  const [litres, setLitres] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  // Which filter to add to
  const refillableFilters = impact.filters.filter(f => f.remainingCapacityLitres > 0);
  const [selectedFilterId, setSelectedFilterId] = useState<number | null>(null);

  const currentFilterId = selectedFilterId && refillableFilters.some(f => f.id === selectedFilterId)
    ? selectedFilterId
    : (refillableFilters[0]?.id ?? null);
  const selectedFilter = refillableFilters.find(f => f.id === currentFilterId);

  const submissionKey = React.useRef<string | null>(null);
  const submitting = React.useRef(false);

  // Shower-only check
  const isShowerOnly = impact.filters.length > 0 && impact.filters.every(f => f.ratedCapacityLitres === 0);
  const showerDays = isShowerOnly
    ? Math.max(0, Math.floor((Date.now() - Math.min(...impact.filters.map(f => new Date(f.activatedAt).getTime()))) / 86400000))
    : 0;

  const stats = calculateImpact(impact.totalLitres);
  const milestone = getActiveMilestone(impact.totalLitres);

  async function submit() {
    if (submitting.current) return;
    const amount = Number(litres);
    if (!Number.isFinite(amount) || amount <= 0) {
      setError('Enter a positive whole number of litres.');
      return;
    }
    if (!selectedFilter) {
      setError('No eligible filter found to record litres.');
      return;
    }
    if (selectedFilter.remainingCapacityLitres <= 0) {
      setError('This filter has reached its rated capacity.');
      return;
    }
    if (amount > selectedFilter.remainingCapacityLitres) {
      setError(`Only ${selectedFilter.remainingCapacityLitres} L remain on this filter.`);
      return;
    }

    submitting.current = true;
    setSaving(true);
    setError('');
    setSuccessMsg('');

    try {
      const result = await api.addPersonalImpact({
        registeredFilterId: selectedFilter.id,
        litres: amount,
        reason: 'Customer refilled water',
        idempotencyKey: submissionKey.current ??= `impact-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`,
      });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      onUpdated(result.impact);

      // Success visual feedback
      setLitres('');
      setSuccessMsg(`${amount} litres added to your impact.`);
      submissionKey.current = null;

      // Hide success message after 3 seconds
      setTimeout(() => setSuccessMsg(''), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to record litres. Please try again.');
    } finally {
      submitting.current = false;
      setSaving(false);
    }
  }

  // Number formatting
  const formatNum = (num: number) => num.toLocaleString('en-US');

  return (
    <View style={styles.container}>
      <TouchableOpacity
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        accessibilityLabel={expanded ? "Collapse personal impact details" : "Expand personal impact details"}
        onPress={() => {
          Haptics.selectionAsync().catch(() => {});
          setExpanded(!expanded);
        }}
        activeOpacity={0.8}
        style={[
          styles.headerButton,
          {
            backgroundColor: colors.card,
            borderColor: colors.border,
            borderBottomWidth: expanded ? 0 : 1,
            borderBottomLeftRadius: expanded ? 0 : 16,
            borderBottomRightRadius: expanded ? 0 : 16,
          }
        ]}
      >
        <View style={styles.headerTextWrap}>
          <Text style={[styles.sectionTitle, { color: colors.mutedForeground, marginBottom: 4 }]}>YOUR ULTRA CLEAR IMPACT</Text>
          <View style={styles.headerLitresRow}>
            {isShowerOnly ? (
               <Text style={[styles.headerLitres, { color: colors.text }]}>{formatNum(showerDays)} <Text style={[styles.headerLitresLabel, { color: colors.mutedForeground }]}>days</Text></Text>
            ) : (
               <Text style={[styles.headerLitres, { color: colors.text }]}>{formatNum(impact.totalLitres)} <Text style={[styles.headerLitresLabel, { color: colors.mutedForeground }]}>litres</Text></Text>
            )}
          </View>
        </View>
        <View style={[styles.chevronWrap, { backgroundColor: colors.surface }]}>
           <Ionicons name={expanded ? "chevron-up" : "chevron-down"} size={20} color={colors.text} />
        </View>
      </TouchableOpacity>

      {expanded && (
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border, borderTopWidth: 0, borderTopLeftRadius: 0, borderTopRightRadius: 0 }]}>
          {/* ADD LITRES ROW */}
          {!isShowerOnly && (
            <View style={styles.addLitresSection}>
              <Text style={[styles.label, { color: colors.text }]}>Add litres consumed</Text>
              <View style={styles.inputRow}>
                <View style={[styles.inputWrapper, { borderColor: colors.border }]}>
                  <TextInput
                    testID="impact-litres-input"
                    value={litres}
                    onChangeText={v => { submissionKey.current = null; setLitres(v.replace(/[^0-9]/g, '')); setError(''); setSuccessMsg(''); }}
                    keyboardType="number-pad"
                    placeholder="20 litres"
                    placeholderTextColor={colors.mutedForeground}
                    style={[styles.input, { color: colors.text }]}
                    editable={!saving && refillableFilters.length > 0}
                  />
                </View>
                <TouchableOpacity
                  testID="impact-confirm"
                  onPress={submit}
                  disabled={saving || !litres || refillableFilters.length === 0}
                  style={[
                    styles.addButton,
                    { backgroundColor: (litres && refillableFilters.length > 0) ? colors.primary : colors.mutedForeground }
                  ]}
                >
                  {saving ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.addButtonText}>Add</Text>}
                </TouchableOpacity>
              </View>
              {refillableFilters.length > 1 && selectedFilter ? (
                <Text style={[styles.feedbackText, { color: colors.mutedForeground, marginTop: 2 }]}>
                  Adding to: {selectedFilter.productName} (Change in Details)
                </Text>
              ) : null}
              {error ? <Text style={[styles.feedbackText, { color: colors.destructive }]}>{error}</Text> : null}
              {successMsg ? <Text style={[styles.feedbackText, { color: colors.primary }]}>{successMsg}</Text> : null}

              {refillableFilters.length === 0 && impact.filters.length > 0 ? (
                <Text style={[styles.feedbackText, { color: colors.destructive, marginTop: 4 }]}>All registered filters have reached their rated capacity.</Text>
              ) : null}
              {impact.filters.length === 0 ? (
                <Text style={[styles.feedbackText, { color: colors.mutedForeground, marginTop: 4 }]}>Register a filter to record refilled litres.</Text>
              ) : null}
            </View>
          )}

          {/* CUMULATIVE LITRES OR SHOWER DAYS */}
          <View style={styles.bigStatContainer}>
            {isShowerOnly ? (
              <>
                <Text style={[styles.bigStat, { color: colors.text }]}>{formatNum(showerDays)}</Text>
                <Text style={[styles.bigStatSub, { color: colors.mutedForeground }]}>days used</Text>
                <Text style={[styles.bigStatSub, { color: colors.mutedForeground }]}>for a healthy skin</Text>
              </>
            ) : (
              <>
                <Text style={[styles.bigStat, { color: colors.text }]}>{formatNum(impact.totalLitres)}</Text>
                <Text style={[styles.bigStatSub, { color: colors.mutedForeground }]}>litres filtered</Text>
              </>
            )}
          </View>

          {/* EQUIVALENTS ROW */}
          {!isShowerOnly && (
            <View style={styles.twoColRow}>
              <View style={[styles.miniCard, { backgroundColor: colors.background, borderColor: colors.border }]}>
                <Text style={[styles.miniCardNumber, { color: colors.text }]}>{formatNum(stats.bottleEquivalent)}</Text>
                <Text style={[styles.miniCardText, { color: colors.mutedForeground }]}>500ml plastic{'\n'}bottles avoided</Text>
              </View>
              <TouchableOpacity
                activeOpacity={0.7}
                onPress={() => setCo2eOpen(true)}
                style={[styles.miniCard, { backgroundColor: colors.background, borderColor: colors.border }]}
              >
                <Text style={[styles.miniCardNumber, { color: colors.text }]}>≈{Math.round(stats.co2eAvoidedKg)} kg</Text>
                <Text style={[styles.miniCardText, { color: colors.mutedForeground }]}>CO₂e{'\n'}avoided*</Text>
              </TouchableOpacity>
            </View>
          )}

          {/* SAVINGS */}
          {!isShowerOnly && (
            <View style={styles.savingsContainer}>
              <Text style={[styles.label, { color: colors.text }]}>Estimated annual saving</Text>
              <Text style={[styles.savingsValue, { color: colors.text }]}>KSh {formatNum(stats.estimatedAnnualSavingKes)}</Text>
              <Text style={[styles.savingsSub, { color: colors.mutedForeground }]}>Based on KSh 150 per 20L refill</Text>
            </View>
          )}

          {/* TRUST & MILESTONE */}
          <View style={styles.trustContainer}>
            <Text style={[styles.trustText, { color: colors.text }]}>✓ I filter with Ultra Clear</Text>
          </View>

          {!isShowerOnly && (
            <View style={styles.milestoneContainer}>
              <View style={styles.milestoneHeader}>
                <Text style={[styles.milestoneLabel, { color: colors.text }]}>★ {milestone.label} Impact Level</Text>
                <Text style={[styles.milestonePercent, { color: colors.text }]}>{milestone.progressPercent}%</Text>
              </View>
              <View style={[styles.progressBarBg, { backgroundColor: colors.border }]}>
                <View style={[styles.progressBarFill, { backgroundColor: colors.primary, width: `${milestone.progressPercent}%` }]} />
              </View>
              <Text style={[styles.milestoneRemaining, { color: colors.mutedForeground }]}>{formatNum(milestone.remaining)} litres to the next milestone</Text>
            </View>
          )}

          {/* HYDRATE THE FUTURE */}
          <View style={styles.hydrateContainer}>
            <Text style={[styles.hydrateText, { color: colors.mutedForeground }]}>
              3% of Ultra Clear revenue supports clean-water access through Hydrate the Future™
            </Text>
          </View>

          {/* ACTIONS */}
          <View style={styles.cardActions}>
            <TouchableOpacity style={styles.actionBtn}>
              <Text style={[styles.actionBtnText, { color: colors.primary }]}>Share impact</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.actionBtn} onPress={() => setDetailsOpen(true)}>
              <Text style={[styles.actionBtnText, { color: colors.primary }]}>View details</Text>
            </TouchableOpacity>
          </View>

        </View>
      )}

      {/* CO2e Disclaimer Modal */}
      <Modal visible={co2eOpen} transparent animationType="fade" onRequestClose={() => setCo2eOpen(false)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: colors.text }]}>CO₂e Avoided</Text>
              <TouchableOpacity onPress={() => setCo2eOpen(false)}><Ionicons name="close" size={24} color={colors.text} /></TouchableOpacity>
            </View>
            <Text style={[styles.modalText, { color: colors.text }]}>
              Estimated bottle-related emissions avoided. Calculated using a documented 500ml PET-bottle emissions factor. This is an estimate, not a carbon credit or verified offset.
            </Text>
            <Text style={[styles.modalText, { color: colors.text, marginTop: 12 }]}>
              The estimate changes automatically with your cumulative filtered litres.
            </Text>
            <TouchableOpacity onPress={() => setCo2eOpen(false)} style={[styles.modalButton, { backgroundColor: colors.primary }]}>
              <Text style={styles.modalButtonText}>Understood</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Details Modal */}
      <Modal visible={detailsOpen} transparent animationType="slide" onRequestClose={() => setDetailsOpen(false)}>
        <View style={styles.sheetOverlay}>
          <View style={[styles.sheetContent, { backgroundColor: colors.background }]}>
            <View style={styles.sheetHeader}>
              <Text style={[styles.sheetTitle, { color: colors.text }]}>Impact Details</Text>
              <TouchableOpacity onPress={() => setDetailsOpen(false)}><Ionicons name="close" size={24} color={colors.text} /></TouchableOpacity>
            </View>
            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.sheetScroll}>
              <Text style={[styles.sheetSectionTitle, { color: colors.text }]}>Active Filters</Text>
              {impact.filters.length === 0 ? (
                <Text style={[styles.sheetEmptyText, { color: colors.mutedForeground }]}>No filters registered.</Text>
              ) : (
                <View style={styles.filtersList}>
                  {impact.filters.map(f => (
                    <TouchableOpacity
                      key={f.id}
                      activeOpacity={0.7}
                      onPress={() => f.remainingCapacityLitres > 0 ? setSelectedFilterId(f.id) : null}
                      style={[
                        styles.filterItem,
                        { borderColor: currentFilterId === f.id ? colors.primary : colors.border, backgroundColor: colors.card }
                      ]}
                    >
                      <View style={{ flex: 1 }}>
                        <Text style={[styles.filterItemName, { color: colors.text }]}>{f.productName}</Text>
                        <Text style={[styles.filterItemSub, { color: colors.mutedForeground }]}>
                          {f.ratedCapacityLitres === 0 ? 'Time-based lifespan' : `${f.remainingCapacityLitres} L left of ${f.ratedCapacityLitres} L`}
                        </Text>
                      </View>
                      {currentFilterId === f.id && <Ionicons name="checkmark-circle" size={20} color={colors.primary} />}
                    </TouchableOpacity>
                  ))}
                </View>
              )}

              <Text style={[styles.sheetSectionTitle, { color: colors.text, marginTop: 24 }]}>Refill History</Text>
              {impact.history.length === 0 ? (
                <Text style={[styles.sheetEmptyText, { color: colors.mutedForeground }]}>No history available.</Text>
              ) : (
                <View style={styles.historyList}>
                  {impact.history.map(entry => (
                    <View key={entry.id} style={[styles.historyItem, { borderBottomColor: colors.border }]}>
                      <View style={{ flex: 1 }}>
                        <Text style={[styles.historyFilterName, { color: colors.text }]}>{entry.productName}</Text>
                        <Text style={[styles.historyDate, { color: colors.mutedForeground }]}>{new Date(entry.createdAt).toLocaleDateString()}</Text>
                      </View>
                      <Text style={[styles.historyAmount, { color: colors.primary }]}>+{entry.litres} L</Text>
                    </View>
                  ))}
                </View>
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>

    </View>
  );
}

const styles = StyleSheet.create({
  container: { marginBottom: 24 },

  headerButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    borderWidth: 1,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
  },
  headerTextWrap: {
    flex: 1,
  },
  headerLitresRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 6,
  },
  headerLitres: {
    fontSize: 24,
    fontWeight: '800',
    letterSpacing: -0.5,
  },
  headerLitresLabel: {
    fontSize: 14,
    fontWeight: '500',
  },
  chevronWrap: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },

  sectionTitle: { fontSize: 11, fontWeight: '700', letterSpacing: 1 },

  card: {
    borderWidth: 1,
    borderBottomLeftRadius: 16,
    borderBottomRightRadius: 16,
    padding: 16,
    paddingTop: 8,
    gap: 12
  },

  addLitresSection: { gap: 8 },
  label: { fontSize: 13, fontWeight: '600' },
  inputRow: { flexDirection: 'row', gap: 12, alignItems: 'center' },
  inputWrapper: { flex: 1, borderWidth: 1, borderRadius: 8, height: 40, justifyContent: 'center' },
  input: { flex: 1, paddingHorizontal: 12, fontSize: 15 },
  addButton: { height: 40, paddingHorizontal: 20, borderRadius: 8, justifyContent: 'center', alignItems: 'center' },
  addButtonText: { color: '#fff', fontSize: 14, fontWeight: '700' },
  feedbackText: { fontSize: 12, marginTop: -4 },

  bigStatContainer: { marginTop: 2, marginBottom: 2 },
  bigStat: { fontSize: 36, fontWeight: '800', lineHeight: 40 },
  bigStatSub: { fontSize: 14, fontWeight: '500' },

  twoColRow: { flexDirection: 'row', gap: 10 },
  miniCard: { flex: 1, borderWidth: 1, borderRadius: 12, padding: 10, gap: 2 },
  miniCardNumber: { fontSize: 18, fontWeight: '700' },
  miniCardText: { fontSize: 11, lineHeight: 14 },

  savingsContainer: { gap: 2, marginTop: 2 },
  savingsValue: { fontSize: 18, fontWeight: '700' },
  savingsSub: { fontSize: 12 },

  trustContainer: { marginTop: 2 },
  trustText: { fontSize: 13, fontWeight: '700' },

  milestoneContainer: { gap: 6, marginTop: 2 },
  milestoneHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  milestoneLabel: { fontSize: 12, fontWeight: '700' },
  milestonePercent: { fontSize: 12, fontWeight: '700' },
  progressBarBg: { height: 6, borderRadius: 3, overflow: 'hidden' },
  progressBarFill: { height: '100%', borderRadius: 3 },
  milestoneRemaining: { fontSize: 11 },

  hydrateContainer: { marginTop: 2 },
  hydrateText: { fontSize: 11, lineHeight: 16, fontStyle: 'italic' },

  cardActions: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 4, paddingTop: 14, borderTopWidth: 1, borderTopColor: 'rgba(0,0,0,0.05)' },
  actionBtn: { paddingVertical: 4, paddingHorizontal: 8 },
  actionBtnText: { fontSize: 14, fontWeight: '600' },

  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', alignItems: 'center', padding: 24 },
  modalContent: { width: '100%', borderWidth: 1, borderRadius: 16, padding: 20, gap: 12 },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  modalTitle: { fontSize: 18, fontWeight: '700' },
  modalText: { fontSize: 14, lineHeight: 20 },
  modalButton: { height: 48, borderRadius: 8, justifyContent: 'center', alignItems: 'center', marginTop: 12 },
  modalButtonText: { color: '#fff', fontSize: 15, fontWeight: '700' },

  sheetOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  sheetContent: { width: '100%', height: '80%', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20 },
  sheetHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
  sheetTitle: { fontSize: 18, fontWeight: '700' },
  sheetScroll: { paddingBottom: 40 },
  sheetSectionTitle: { fontSize: 15, fontWeight: '700', marginBottom: 12 },
  sheetEmptyText: { fontSize: 14 },
  filtersList: { gap: 10 },
  filterItem: { borderWidth: 1, borderRadius: 12, padding: 16, flexDirection: 'row', alignItems: 'center', gap: 12 },
  filterItemName: { fontSize: 15, fontWeight: '600' },
  filterItemSub: { fontSize: 13, marginTop: 2 },
  historyList: {},
  historyItem: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 12, borderBottomWidth: 1 },
  historyFilterName: { fontSize: 14, fontWeight: '600' },
  historyDate: { fontSize: 12, marginTop: 2 },
  historyAmount: { fontSize: 16, fontWeight: '700' },
});
