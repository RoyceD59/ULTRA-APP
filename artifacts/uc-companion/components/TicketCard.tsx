import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';
import { MaintenanceTicket } from '@/hooks/useApi';

const STATUS = {
  submitted: { label: 'Submitted', color: '#F59E0B', icon: 'time-outline' as const },
  in_progress: { label: 'In Progress', color: '#3B82F6', icon: 'construct-outline' as const },
  resolved: { label: 'Resolved', color: '#22C55E', icon: 'checkmark-circle-outline' as const },
};

interface Props {
  ticket: MaintenanceTicket;
}

export default function TicketCard({ ticket }: Props) {
  const colors = useColors();
  const s = STATUS[ticket.status];
  const date = new Date(ticket.createdAt).toLocaleDateString('en-KE', { day: 'numeric', month: 'short' });

  return (
    <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <View style={styles.header}>
        <View style={styles.titleRow}>
          <Ionicons name="construct-outline" size={16} color={colors.primary} />
          <Text style={[styles.model, { color: colors.text }]} numberOfLines={1}>{ticket.productModel}</Text>
        </View>
        <View style={[styles.badge, { backgroundColor: s.color + '18' }]}>
          <Ionicons name={s.icon} size={12} color={s.color} />
          <Text style={[styles.badgeText, { color: s.color }]}>{s.label}</Text>
        </View>
      </View>
      <Text style={[styles.desc, { color: colors.mutedForeground }]} numberOfLines={2}>{ticket.issueDescription}</Text>
      <Text style={[styles.date, { color: colors.mutedForeground }]}>{date} · {ticket.photos.length} photo{ticket.photos.length !== 1 ? 's' : ''}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 12, borderWidth: 1, padding: 14, gap: 8 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1 },
  model: { fontSize: 14, fontWeight: '600' as const, flex: 1 },
  badge: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8 },
  badgeText: { fontSize: 11, fontWeight: '600' as const },
  desc: { fontSize: 13, lineHeight: 18 },
  date: { fontSize: 11 },
});
