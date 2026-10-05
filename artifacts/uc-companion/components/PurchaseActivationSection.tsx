import React, { useState } from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { useActivationPurchases } from '@/hooks/useActivationPurchases';
import { useColors } from '@/hooks/useColors';
import { useAuth } from '@/context/AuthContext';
import { RegisterModal } from '@/components/FilterTrackerSection';
import OfflinePurchasesSection from '@/components/OfflinePurchasesSection';
import type { FilterActivation } from '@/hooks/useNotifications';

export default function PurchaseActivationSection({ activation, onRegistered, compact = false }: {
  activation: FilterActivation | null; onRegistered: (a: FilterActivation) => void; compact?: boolean;
}) {
  const { user } = useAuth();
  if (!user) return null;
  return <OwnedPurchases key={user.id} userId={user.id} activation={activation} onRegistered={onRegistered} compact={compact} />;
}
function OwnedPurchases({ userId, activation, onRegistered, compact }: {
  userId: number; activation: FilterActivation | null; onRegistered: (a: FilterActivation) => void; compact: boolean;
}) {
  const purchases = useActivationPurchases(), colors = useColors();
  const [selection, setSelection] = useState<{
    source: 'app' | 'store'; orderId: number; phone: string; unitId: string; productId: number; name: string; lifespanDays: number;
  } | null>(null);
  const lines = (purchases.data?.purchases ?? []).flatMap(p => p.items.map(item => ({ purchase: p, item })));
  const shown = compact ? lines.filter(({ item }) => item.availableUnitIds.length > 0).slice(0, 1) : lines;
  return <View style={{ gap: 12 }}>
    {!compact ? <Text style={{ color: colors.text, fontSize: 17, fontWeight: '700' }}>Purchased filters · activation</Text> : null}
    {purchases.isError ? <TouchableOpacity onPress={() => purchases.refetch()}>
      <Text style={{ color: colors.mutedForeground }}>Purchase eligibility unavailable. Tap to retry.</Text>
    </TouchableOpacity> : null}
    {shown.map(({ purchase, item }) => <View key={`${purchase.source}:${purchase.orderId}:${item.lineId}`}
      style={{ padding: 14, gap: 8, borderWidth: 1, borderColor: colors.border, borderRadius: 14 }}>
      <Text style={{ color: colors.text, fontWeight: '600' }}>{item.name} · ×{item.quantity}</Text>
      <Text style={{ color: colors.mutedForeground }}>Order #{purchase.orderId} · {purchase.status}</Text>
      {item.unavailableReason ? <Text style={{ color: colors.mutedForeground }}>{item.unavailableReason}</Text>
        : item.availableUnitIds.length ? item.availableUnitIds.map(unitId =>
          <TouchableOpacity key={unitId} accessibilityRole="button" onPress={() => setSelection({
            source: purchase.source, orderId: purchase.orderId, phone: purchase.phone, unitId,
            productId: item.productId, name: item.name, lifespanDays: item.lifespanDays,
          })}><Text style={{ color: colors.primary }}>Activate your filter · unit {unitId.split(':').at(-1)}</Text></TouchableOpacity>)
        : <Text style={{ color: colors.mutedForeground }}>All units activated. Filter history is preserved.</Text>}
    </View>)}
    <RegisterModal key={`purchase-modal:${userId}`} visible={!!selection} purchaseSelection={selection}
      existingActivation={activation} filterProducts={[]} productsLoading={false} userId={userId}
      onClose={() => setSelection(null)} onSave={a => {
        onRegistered(a); setSelection(null); void purchases.refetch();
      }} />
    <OfflinePurchasesSection userId={userId} focused existingActivation={activation} compact={compact} onRegistered={onRegistered} />
  </View>;
}