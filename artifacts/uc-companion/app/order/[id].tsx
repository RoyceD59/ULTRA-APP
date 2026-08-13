import React, { useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Platform, TouchableOpacity,
  Modal, TextInput, Alert, ActivityIndicator, Linking,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams } from 'expo-router';
import { useColors } from '@/hooks/useColors';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useApi } from '@/hooks/useApi';

const RETURN_WINDOW_DAYS = 30;
const CHANGED_MIND_WINDOW_DAYS = 7;

const RETURN_REASONS = [
  'Defective or faulty product',
  'Wrong item delivered',
  'Product not as described',
  'Changed my mind',
] as const;
type ReturnReason = (typeof RETURN_REASONS)[number];

const STATUS_CONFIG: Record<string, {
  label: string; icon: keyof typeof Ionicons.glyphMap; color: string; desc: string;
}> = {
  pending:    { label: 'Order Placed',  icon: 'time-outline',             color: '#F59E0B', desc: 'Your order has been received and is awaiting payment confirmation.' },
  processing: { label: 'Processing',    icon: 'sync-outline',             color: '#3B82F6', desc: 'Your payment is confirmed. We are preparing your order.' },
  completed:  { label: 'Delivered',     icon: 'checkmark-circle-outline', color: '#22C55E', desc: 'Your order has been delivered. Enjoy your UCFilter system!' },
  shipped:    { label: 'Shipped',       icon: 'car-outline',              color: '#06B6D4', desc: 'Your order is on its way to you.' },
  cancelled:  { label: 'Cancelled',     icon: 'close-circle-outline',     color: '#EF4444', desc: 'This order was cancelled.' },
};

const RETURN_STATUS: Record<string, { label: string; color: string }> = {
  pending:   { label: 'Under Review', color: '#F59E0B' },
  approved:  { label: 'Approved',     color: '#22C55E' },
  rejected:  { label: 'Not Approved', color: '#EF4444' },
  completed: { label: 'Completed',    color: '#22C55E' },
};

function daysSinceOrder(dateStr: string): number {
  return (Date.now() - new Date(dateStr).getTime()) / (1000 * 60 * 60 * 24);
}

export default function OrderDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const colors = useColors();
  const api = useApi();
  const queryClient = useQueryClient();

  const [modalVisible, setModalVisible] = useState(false);
  const [selectedReason, setSelectedReason] = useState<ReturnReason | ''>('');
  const [details, setDetails] = useState('');

  const { data: orders, isLoading } = useQuery({
    queryKey: ['orders'],
    queryFn: () => api.getOrders(),
  });

  const order = orders?.find(o => String(o.id) === id);
  const statusCfg = STATUS_CONFIG[order?.status ?? 'pending'] ?? STATUS_CONFIG['pending']!;

  const isReturnEligibleStatus = ['completed', 'shipped'].includes(order?.status ?? '');
  const age = order ? daysSinceOrder(order.dateCreated) : 999;

  const { data: returnData } = useQuery({
    queryKey: ['returnRequest', id],
    queryFn: () => api.getReturnRequest(Number(id)),
    enabled: !!order && isReturnEligibleStatus,
  });

  const existingRequest = returnData?.request ?? null;
  const canRequestReturn = isReturnEligibleStatus && age <= RETURN_WINDOW_DAYS && !existingRequest;
  const availableReasons = RETURN_REASONS.filter(
    r => r !== 'Changed my mind' || age <= CHANGED_MIND_WINDOW_DAYS,
  );

  const returnMutation = useMutation({
    mutationFn: () => api.requestReturn(Number(id), { reason: selectedReason, details }),
    onSuccess: data => {
      queryClient.invalidateQueries({ queryKey: ['returnRequest', id] });
      setModalVisible(false);
      setSelectedReason('');
      setDetails('');
      Alert.alert('Request Submitted', data.message);
    },
    onError: (err: Error) => {
      Alert.alert('Unable to Submit', err.message);
    },
  });

  if (isLoading || !order) {
    return (
      <View style={[styles.screen, { backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center' }]}>
        <Ionicons name="checkmark-circle" size={60} color={colors.success} />
        <Text style={[styles.successTitle, { color: colors.text }]}>Order Confirmed!</Text>
        <Text style={[styles.successSub, { color: colors.mutedForeground }]}>Order #{id}</Text>
        <Text style={[styles.successSub, { color: colors.mutedForeground }]}>
          You'll receive a confirmation message shortly.
        </Text>
      </View>
    );
  }

  const date = new Date(order.dateCreated).toLocaleDateString('en-KE', {
    day: 'numeric', month: 'long', year: 'numeric',
  });
  const returnStatusCfg = existingRequest
    ? (RETURN_STATUS[existingRequest.status] ?? { label: existingRequest.status, color: '#6B7280' })
    : null;

  return (
    <ScrollView
      style={[styles.screen, { backgroundColor: colors.background }]}
      contentContainerStyle={{ padding: 16, gap: 20, paddingBottom: Platform.OS === 'web' ? 34 : 40 }}>

      {/* ── Status card ─────────────────────────────────────── */}
      <View style={[styles.statusCard, { backgroundColor: statusCfg.color + '10', borderColor: statusCfg.color }]}>
        <Ionicons name={statusCfg.icon} size={36} color={statusCfg.color} />
        <View style={{ flex: 1 }}>
          <Text style={[styles.statusLabel, { color: statusCfg.color }]}>{statusCfg.label}</Text>
          <Text style={[styles.statusDesc, { color: colors.text }]}>{statusCfg.desc}</Text>
        </View>
      </View>

      {/* ── Order info ──────────────────────────────────────── */}
      <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <Text style={[styles.cardTitle, { color: colors.text }]}>Order Details</Text>
        <View style={styles.infoRow}>
          <Text style={[styles.infoLabel, { color: colors.mutedForeground }]}>Order #</Text>
          <Text style={[styles.infoValue, { color: colors.text }]}>{order.id}</Text>
        </View>
        <View style={styles.infoRow}>
          <Text style={[styles.infoLabel, { color: colors.mutedForeground }]}>Date</Text>
          <Text style={[styles.infoValue, { color: colors.text }]}>{date}</Text>
        </View>
        <View style={styles.infoRow}>
          <Text style={[styles.infoLabel, { color: colors.mutedForeground }]}>Payment</Text>
          <Text style={[styles.infoValue, { color: colors.text }]}>
            {order.paymentMethod === 'mpesa'    ? 'M-Pesa' :
             order.paymentMethod === 'stripe'   ? 'Credit Card' :
             order.paymentMethod === 'paystack' ? 'Paystack' : 'Cash on Delivery'}
          </Text>
        </View>
        <View style={styles.infoRow}>
          <Text style={[styles.infoLabel, { color: colors.mutedForeground }]}>Total</Text>
          <Text style={[styles.infoValue, { color: colors.primary, fontWeight: '700' as const }]}>
            {order.currency} {parseFloat(order.total).toLocaleString('en-KE')}
          </Text>
        </View>
      </View>

      {/* ── Items ───────────────────────────────────────────── */}
      <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <Text style={[styles.cardTitle, { color: colors.text }]}>Items Ordered</Text>
        {order.lineItems.map((item, i) => (
          <View key={i} style={styles.lineItem}>
            <View style={[styles.lineIcon, { backgroundColor: colors.primaryLight }]}>
              <Ionicons name="water-outline" size={16} color={colors.primary} />
            </View>
            <Text style={[styles.lineName, { color: colors.text }]} numberOfLines={2}>{item.name}</Text>
            <Text style={[styles.lineQty, { color: colors.mutedForeground }]}>×{item.quantity}</Text>
            <Text style={[styles.lineTotal, { color: colors.primary }]}>
              KES {parseFloat(item.total).toLocaleString()}
            </Text>
          </View>
        ))}
      </View>

      {/* ── Shipping ────────────────────────────────────────── */}
      {order.shippingAddress && (
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.cardTitle, { color: colors.text }]}>Delivery Address</Text>
          <Text style={[styles.addressText, { color: colors.text }]}>
            {order.shippingAddress.firstName} {order.shippingAddress.lastName}
          </Text>
          <Text style={[styles.addressText, { color: colors.mutedForeground }]}>{order.shippingAddress.address1}</Text>
          <Text style={[styles.addressText, { color: colors.mutedForeground }]}>{order.shippingAddress.city}</Text>
          {order.shippingAddress.phone && (
            <Text style={[styles.addressText, { color: colors.mutedForeground }]}>{order.shippingAddress.phone}</Text>
          )}
        </View>
      )}

      {/* ── Returns & Refunds ───────────────────────────────── */}
      {isReturnEligibleStatus && (
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.cardTitle, { color: colors.text }]}>Returns &amp; Refunds</Text>

          {existingRequest ? (
            /* Already submitted — show status */
            <View style={{ gap: 8 }}>
              <View style={[styles.returnBadge, {
                backgroundColor: returnStatusCfg!.color + '18',
                borderColor: returnStatusCfg!.color,
              }]}>
                <Ionicons name="refresh-circle-outline" size={16} color={returnStatusCfg!.color} />
                <Text style={[styles.returnBadgeText, { color: returnStatusCfg!.color }]}>
                  {returnStatusCfg!.label}
                </Text>
              </View>
              <Text style={[styles.returnMeta, { color: colors.text }]}>
                Reason: {existingRequest.reason}
              </Text>
              {existingRequest.details ? (
                <Text style={[styles.returnMeta, { color: colors.mutedForeground }]}>
                  "{existingRequest.details}"
                </Text>
              ) : null}
              <Text style={[styles.returnDate, { color: colors.mutedForeground }]}>
                Submitted {new Date(existingRequest.createdAt).toLocaleDateString('en-KE', {
                  day: 'numeric', month: 'long', year: 'numeric',
                })}
              </Text>
            </View>
          ) : canRequestReturn ? (
            /* Eligible — show request button */
            <View style={{ gap: 10 }}>
              <Text style={[styles.returnPolicy, { color: colors.mutedForeground }]}>
                Items may be returned within 30 days for defects, wrong deliveries, or other valid reasons. Opened cartridges and installed filters are not eligible.
              </Text>
              <TouchableOpacity
                onPress={() => setModalVisible(true)}
                style={[styles.returnBtn, { backgroundColor: colors.primaryLight, borderColor: colors.primary }]}>
                <Ionicons name="return-up-back-outline" size={18} color={colors.primary} />
                <Text style={[styles.returnBtnText, { color: colors.primary }]}>Request a Return</Text>
              </TouchableOpacity>
            </View>
          ) : (
            /* Outside window */
            <Text style={[styles.returnPolicy, { color: colors.mutedForeground }]}>
              This order is outside our 30-day return window. If you have a concern, our team reviews every case personally — please get in touch below.
            </Text>
          )}

          {/* Contact support — always visible on this card */}
          <View style={[styles.contactRow, { borderTopColor: colors.border }]}>
            <TouchableOpacity
              onPress={() => Linking.openURL('tel:0717774049')}
              style={styles.contactBtn}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Ionicons name="call-outline" size={15} color={colors.primary} />
              <Text style={[styles.contactText, { color: colors.primary }]}>0717774049</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => Linking.openURL('mailto:support@ucfilters.co.ke')}
              style={styles.contactBtn}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Ionicons name="mail-outline" size={15} color={colors.primary} />
              <Text style={[styles.contactText, { color: colors.primary }]}>support@ucfilters.co.ke</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* ── Return Request Modal ─────────────────────────────── */}
      <Modal
        visible={modalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setModalVisible(false)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalSheet, { backgroundColor: colors.background }]}>

            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: colors.text }]}>Request a Return</Text>
              <TouchableOpacity onPress={() => setModalVisible(false)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Ionicons name="close" size={22} color={colors.mutedForeground} />
              </TouchableOpacity>
            </View>

            <Text style={[styles.modalSub, { color: colors.mutedForeground }]}>
              Select the reason that best describes your situation. Our team will follow up within 2 business days.
            </Text>

            <View style={{ gap: 8 }}>
              {availableReasons.map(reason => {
                const active = selectedReason === reason;
                return (
                  <TouchableOpacity
                    key={reason}
                    onPress={() => setSelectedReason(reason)}
                    style={[styles.reasonOption, {
                      borderColor: active ? colors.primary : colors.border,
                      backgroundColor: active ? colors.primaryLight : colors.card,
                    }]}>
                    <View style={[styles.reasonRadio, {
                      borderColor: active ? colors.primary : colors.border,
                      backgroundColor: active ? colors.primary : 'transparent',
                    }]}>
                      {active && <View style={styles.reasonRadioInner} />}
                    </View>
                    <Text style={[styles.reasonText, { color: colors.text }]}>{reason}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            <TextInput
              value={details}
              onChangeText={setDetails}
              placeholder="Additional details (optional)"
              placeholderTextColor={colors.mutedForeground}
              multiline
              numberOfLines={3}
              style={[styles.detailsInput, {
                borderColor: colors.border,
                color: colors.text,
                backgroundColor: colors.card,
              }]}
            />

            <TouchableOpacity
              onPress={() => returnMutation.mutate()}
              disabled={!selectedReason || returnMutation.isPending}
              style={[styles.submitBtn, { backgroundColor: selectedReason ? colors.primary : colors.border }]}>
              {returnMutation.isPending
                ? <ActivityIndicator size="small" color="#fff" />
                : <Text style={styles.submitBtnText}>Submit Request</Text>}
            </TouchableOpacity>

            <Text style={[styles.modalNote, { color: colors.mutedForeground }]}>
              You can also reach us at support@ucfilters.co.ke or call 0717774049.
            </Text>

          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  // Status
  statusCard: { flexDirection: 'row', alignItems: 'flex-start', gap: 14, borderWidth: 1.5, borderRadius: 14, padding: 16 },
  statusLabel: { fontSize: 17, fontWeight: '700' as const },
  statusDesc: { fontSize: 13, lineHeight: 19, marginTop: 4 },
  // Cards
  card: { borderRadius: 14, borderWidth: 1, padding: 16, gap: 10 },
  cardTitle: { fontSize: 15, fontWeight: '700' as const },
  infoRow: { flexDirection: 'row', justifyContent: 'space-between' },
  infoLabel: { fontSize: 14 },
  infoValue: { fontSize: 14 },
  // Line items
  lineItem: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  lineIcon: { width: 32, height: 32, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  lineName: { flex: 1, fontSize: 13 },
  lineQty: { fontSize: 13 },
  lineTotal: { fontSize: 13, fontWeight: '600' as const },
  addressText: { fontSize: 14 },
  // Returns
  returnBadge: { flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, borderRadius: 8, paddingVertical: 6, paddingHorizontal: 10, alignSelf: 'flex-start' as const },
  returnBadgeText: { fontSize: 13, fontWeight: '600' as const },
  returnMeta: { fontSize: 13 },
  returnDate: { fontSize: 12 },
  returnPolicy: { fontSize: 13, lineHeight: 19 },
  returnBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1, borderRadius: 10, paddingVertical: 10, paddingHorizontal: 16, alignSelf: 'flex-start' as const },
  returnBtnText: { fontSize: 14, fontWeight: '600' as const },
  contactRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 14, paddingTop: 12, marginTop: 2, borderTopWidth: 1 },
  contactBtn: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  contactText: { fontSize: 13, fontWeight: '500' as const },
  // Modal
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modalSheet: { borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 24, gap: 16, paddingBottom: Platform.OS === 'web' ? 24 : 44 },
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  modalTitle: { fontSize: 18, fontWeight: '700' as const },
  modalSub: { fontSize: 13, lineHeight: 19 },
  reasonOption: { flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1.5, borderRadius: 10, padding: 12 },
  reasonRadio: { width: 20, height: 20, borderRadius: 10, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  reasonRadioInner: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#fff' },
  reasonText: { fontSize: 14, flex: 1 },
  detailsInput: { borderWidth: 1, borderRadius: 10, padding: 12, fontSize: 14, minHeight: 80, textAlignVertical: 'top' as const },
  submitBtn: { paddingVertical: 14, borderRadius: 12, alignItems: 'center' as const },
  submitBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' as const },
  modalNote: { fontSize: 12, textAlign: 'center' as const, lineHeight: 17 },
  // Confirmed state (before order loads)
  successTitle: { fontSize: 26, fontWeight: '700' as const, marginTop: 16 },
  successSub: { fontSize: 15, textAlign: 'center' as const, paddingHorizontal: 40, marginTop: 8 },
});
