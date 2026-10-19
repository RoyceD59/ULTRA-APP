import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useColors } from '@/hooks/useColors';

export type PaymentMethod = 'mpesa' | 'stripe' | 'paystack' | 'cod';

const METHODS: { id: PaymentMethod; label: string; sub: string; icon: keyof typeof Ionicons.glyphMap; color: string; recommended?: boolean }[] = [
  { id: 'paystack', label: 'Paystack', sub: 'Card, M-Pesa & mobile money', icon: 'wallet-outline', color: '#00C3F7', recommended: true },
  { id: 'mpesa', label: 'M-Pesa', sub: 'Instant STK push to your phone', icon: 'phone-portrait-outline', color: '#00A651' },
  { id: 'stripe', label: 'Card Payment', sub: 'Visa, Mastercard, Amex', icon: 'card-outline', color: '#635BFF' },
  { id: 'cod', label: 'Cash on Delivery', sub: 'Processing delays may apply', icon: 'cash-outline', color: '#9CA3AF' },
];

interface Props {
  selected: PaymentMethod;
  onChange: (m: PaymentMethod) => void;
  /**
   * Server-driven availability map from GET /api/payments/config.
   * Methods explicitly set to false are hidden (e.g. Stripe while the
   * team's card processing is deactivated). Absent = shown, so the picker
   * degrades gracefully if the config fetch fails.
   */
  enabled?: Partial<Record<PaymentMethod, boolean>>;
}

export default function PaymentMethodPicker({ selected, onChange, enabled }: Props) {
  const colors = useColors();
  const visible = METHODS.filter(m => enabled?.[m.id] !== false);
  return (
    <View style={styles.container}>
      {visible.map(m => {
        const active = selected === m.id;
        const isCod = m.id === 'cod';
        return (
          <TouchableOpacity
            key={m.id}
            onPress={() => onChange(m.id)}
            activeOpacity={0.75}
            style={[styles.row,
              { borderColor: active ? m.color : colors.border, backgroundColor: active ? m.color + '10' : colors.card },
              isCod && styles.codRow,
            ]}>
            <View style={[styles.iconWrap, { backgroundColor: m.color + '20' }]}>
              <Ionicons name={m.icon} size={22} color={m.color} />
            </View>
            <View style={styles.info}>
              <View style={styles.labelRow}>
                <Text style={[styles.label, { color: isCod ? colors.mutedForeground : colors.text }]}>{m.label}</Text>
                {m.recommended && (
                  <View style={[styles.badge, { backgroundColor: '#00A651' }]}>
                    <Text style={styles.badgeText}>RECOMMENDED</Text>
                  </View>
                )}
              </View>
              <Text style={[styles.sub, { color: colors.mutedForeground }]}>{m.sub}</Text>
            </View>
            <View style={[styles.radio, { borderColor: active ? m.color : colors.border }]}>
              {active && <View style={[styles.radioDot, { backgroundColor: m.color }]} />}
            </View>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: 8 },
  row: { flexDirection: 'row', alignItems: 'center', borderWidth: 2, borderRadius: 12, padding: 14, gap: 12 },
  codRow: { opacity: 0.6 },
  iconWrap: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  info: { flex: 1 },
  labelRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  label: { fontSize: 15, fontWeight: '600' as const },
  sub: { fontSize: 12, marginTop: 2 },
  badge: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
  badgeText: { color: '#fff', fontSize: 9, fontWeight: '700' as const, letterSpacing: 0.5 },
  radio: { width: 20, height: 20, borderRadius: 10, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  radioDot: { width: 10, height: 10, borderRadius: 5 },
});
