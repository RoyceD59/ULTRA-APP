import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';
import { UCOrder } from '@/hooks/useApi';

const STATUS_MAP: Record<string, { label: string; color: string; icon: keyof typeof Ionicons.glyphMap }> = {
  pending: { label: 'Pending', color: '#F59E0B', icon: 'time-outline' },
  processing: { label: 'Processing', color: '#3B82F6', icon: 'sync-outline' },
  'on-hold': { label: 'On Hold', color: '#8B5CF6', icon: 'pause-circle-outline' },
  completed: { label: 'Completed', color: '#22C55E', icon: 'checkmark-circle-outline' },
  cancelled: { label: 'Cancelled', color: '#EF4444', icon: 'close-circle-outline' },
  shipped: { label: 'Shipped', color: '#06B6D4', icon: 'car-outline' },
};

const STAGE_MAP: Record<string, { label: string; icon: keyof typeof Ionicons.glyphMap }> = {
  accepted: { label: 'Order Accepted', icon: 'cube-outline' },
  shipped: { label: 'Shipped', icon: 'car-outline' },
  delivered: { label: 'Delivered', icon: 'home-outline' },
};

interface Props {
  order: UCOrder;
  onPress: () => void;
}

export default function OrderCard({ order, onPress }: Props) {
  const colors = useColors();
  const status = STATUS_MAP[order.status] ?? { label: order.status, color: colors.mutedForeground, icon: 'help-outline' as const };
  const date = new Date(order.dateCreated).toLocaleDateString('en-KE', { day: 'numeric', month: 'short', year: 'numeric' });
  const stage = order.customerStage ? STAGE_MAP[order.customerStage] : null;
  const stageDate = order.customerStageUpdatedAt ? new Date(order.customerStageUpdatedAt).toLocaleDateString('en-KE', { day: 'numeric', month: 'short' }) : null;

  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.8}
      style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <View style={styles.top}>
        <View>
          <Text style={[styles.orderId, { color: colors.text }]}>Order #{order.id}</Text>
          <Text style={[styles.date, { color: colors.mutedForeground }]}>{date}</Text>
        </View>
        <View style={[styles.statusBadge, { backgroundColor: status.color + '18' }]}>
          <Ionicons name={status.icon} size={13} color={status.color} />
          <Text style={[styles.statusText, { color: status.color }]}>{status.label}</Text>
        </View>
      </View>

      {stage && (
        <View style={[styles.stageRow, { backgroundColor: colors.primary + '10', borderColor: colors.primary + '30' }]}>
          <Ionicons name={stage.icon} size={14} color={colors.primary} />
          <Text style={[styles.stageText, { color: colors.primary }]}>{stage.label}</Text>
          {stageDate && <Text style={[styles.stageDate, { color: colors.primary }]}>(Updated {stageDate})</Text>}
        </View>
      )}

      <Text style={[styles.items, { color: colors.mutedForeground }]} numberOfLines={1}>
        {(order.lineItems ?? []).map(i => `${i.name} ×${i.quantity}`).join(', ')}
      </Text>
      <View style={styles.bottom}>
        <Text style={[styles.total, { color: colors.primary }]}>
          {order.currency} {parseFloat(order.total).toLocaleString('en-KE')}
        </Text>
        <Ionicons name="chevron-forward" size={16} color={colors.mutedForeground} />
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 12, borderWidth: 1, padding: 14, gap: 10 },
  top: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  orderId: { fontSize: 15, fontWeight: '700' as const },
  date: { fontSize: 12, marginTop: 2 },
  statusBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8 },
  statusText: { fontSize: 12, fontWeight: '600' as const },
  stageRow: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 8, paddingVertical: 6, borderRadius: 6, borderWidth: 1, alignSelf: 'flex-start' },
  stageText: { fontSize: 12, fontWeight: '600' as const },
  stageDate: { fontSize: 12, opacity: 0.8 },
  items: { fontSize: 13 },
  bottom: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  total: { fontSize: 16, fontWeight: '700' as const },
});
