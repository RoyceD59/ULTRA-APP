import React, { useState } from 'react';
import { ActivityIndicator, Modal, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useColors } from '@/hooks/useColors';
import { useApi, type PersonalImpact } from '@/hooks/useApi';

interface Props {
  impact: PersonalImpact;
  onUpdated: (impact: PersonalImpact) => void;
}

export default function PersonalImpactSection({ impact, onUpdated }: Props) {
  const colors = useColors();
  const api = useApi();
  const [open, setOpen] = useState(false);
  const [filterId, setFilterId] = useState<number | null>(impact.filters[0]?.id ?? null);
  const [litres, setLitres] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const selected = impact.filters.find(filter => filter.id === filterId);
  const enteredLitres = Number(litres) || 0;

  async function submit() {
    const amount = Number(litres);
    if (!selected || !Number.isInteger(amount) || amount <= 0) {
      setError('Enter a positive whole number of litres.');
      return;
    }
    setSaving(true); setError('');
    try {
      const result = await api.addPersonalImpact({
        registeredFilterId: selected.id,
        litres: amount,
        reason: 'Customer refilled water',
        idempotencyKey: `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`,
      });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      onUpdated(result.impact);
      setOpen(false); setLitres('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to record litres. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <View style={styles.section}>
      <View style={styles.header}>
        <View>
          <Text style={[styles.title, { color: colors.text }]}>My water impact</Text>
          <Text style={[styles.sub, { color: colors.mutedForeground }]}>Private to your Ultra-Clear account</Text>
        </View>
        <View style={[styles.star, { backgroundColor: colors.primaryLight }]}>
          <Text style={[styles.starText, { color: colors.primary }]}>{impact.starLevel} ★</Text>
        </View>
      </View>
      <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <View style={styles.metrics}>
          <View><Text style={[styles.metric, { color: colors.text }]}>{impact.totalLitres} L</Text><Text style={[styles.caption, { color: colors.mutedForeground }]}>Total refilled</Text></View>
          <View><Text style={[styles.metric, { color: colors.text }]}>{impact.remainingCapacityLitres} L</Text><Text style={[styles.caption, { color: colors.mutedForeground }]}>Rated capacity left</Text></View>
        </View>
        {impact.filters.length > 0 ? (
          <TouchableOpacity testID="impact-add-litres" onPress={() => { setFilterId(impact.filters[0]?.id ?? null); setError(''); setOpen(true); }} style={[styles.action, { backgroundColor: colors.primary }]}><Ionicons name="water-outline" size={16} color="#fff" /><Text style={styles.actionText}>I refilled</Text></TouchableOpacity>
        ) : <Text style={[styles.empty, { color: colors.mutedForeground }]}>Register a filter to record refilled litres.</Text>}
        {impact.filters.map(filter => <View key={filter.id} style={[styles.row, { borderTopColor: colors.border }]}><Text style={[styles.filterName, { color: colors.text }]} numberOfLines={1}>{filter.productName}</Text><Text style={[styles.caption, { color: colors.mutedForeground }]}>{filter.remainingCapacityLitres} L left</Text></View>)}
        {impact.history.slice(0, 3).map(entry => <View key={entry.id} style={[styles.row, { borderTopColor: colors.border }]}><View><Text style={[styles.filterName, { color: colors.text }]}>{entry.productName}</Text><Text style={[styles.caption, { color: colors.mutedForeground }]}>{new Date(entry.createdAt).toLocaleDateString()}</Text></View><Text style={[styles.historyLitres, { color: colors.primary }]}>+{entry.litres} L</Text></View>)}
      </View>
      <Modal visible={open} transparent animationType="slide" onRequestClose={() => !saving && setOpen(false)}>
        <View style={styles.overlay}><View style={[styles.sheet, { backgroundColor: colors.background }]}>
          <Text style={[styles.title, { color: colors.text }]}>Add my litres</Text>
          <Text style={[styles.sub, { color: colors.mutedForeground }]}>Choose a registered filter. The server confirms its remaining rated capacity.</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.choices}>
            {impact.filters.map(filter => <TouchableOpacity key={filter.id} onPress={() => setFilterId(filter.id)} style={[styles.choice, { borderColor: filter.id === filterId ? colors.primary : colors.border, backgroundColor: colors.card }]}><Text style={{ color: colors.text }}>{filter.productName}</Text><Text style={[styles.caption, { color: colors.mutedForeground }]}>{filter.remainingCapacityLitres} L left</Text></TouchableOpacity>)}
          </ScrollView>
          <TextInput testID="impact-litres-input" value={litres} onChangeText={value => { setLitres(value.replace(/[^0-9]/g, '')); setError(''); }} keyboardType="number-pad" placeholder="Whole litres" placeholderTextColor={colors.mutedForeground} style={[styles.input, { color: colors.text, borderColor: colors.border }]} editable={!saving} />
          {selected && enteredLitres > 0 ? <Text style={[styles.sub, { color: colors.mutedForeground }]}>After this entry: {impact.totalLitres + enteredLitres} L total · {Math.max(0, selected.remainingCapacityLitres - enteredLitres)} L left on this filter</Text> : null}
          {error ? <Text style={[styles.error, { color: colors.destructive }]}>{error}</Text> : null}
          <View style={styles.buttons}><TouchableOpacity onPress={() => setOpen(false)} disabled={saving}><Text style={{ color: colors.primary }}>Cancel</Text></TouchableOpacity><TouchableOpacity testID="impact-confirm" onPress={submit} disabled={saving} style={[styles.action, { backgroundColor: colors.primary }]}>{saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.actionText}>Record litres</Text>}</TouchableOpacity></View>
        </View></View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: 8, marginBottom: 20 }, header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }, title: { fontSize: 17, fontWeight: '700' }, sub: { fontSize: 12, marginTop: 2 }, star: { borderRadius: 14, paddingHorizontal: 10, paddingVertical: 5 }, starText: { fontWeight: '700' }, card: { borderWidth: 1, borderRadius: 16, padding: 14, gap: 12 }, metrics: { flexDirection: 'row', gap: 28 }, metric: { fontSize: 21, fontWeight: '700' }, caption: { fontSize: 11, marginTop: 2 }, action: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 7, borderRadius: 10, paddingHorizontal: 13, paddingVertical: 10 }, actionText: { color: '#fff', fontWeight: '700', fontSize: 13 }, empty: { fontSize: 13 }, row: { paddingTop: 10, borderTopWidth: 1, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }, filterName: { fontSize: 13, fontWeight: '600', maxWidth: 220 }, historyLitres: { fontSize: 14, fontWeight: '700' }, overlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.45)' }, sheet: { borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, gap: 14 }, choices: { gap: 8 }, choice: { borderWidth: 1, borderRadius: 10, padding: 10, maxWidth: 180 }, input: { borderWidth: 1, borderRadius: 10, padding: 13, fontSize: 16 }, error: { fontSize: 13 }, buttons: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
});