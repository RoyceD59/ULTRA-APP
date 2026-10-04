import React, { useState, useCallback } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { useFocusEffect } from 'expo-router';
import { useApi, type OfflinePurchaseItem } from '@/hooks/useApi';
import { useColors } from '@/hooks/useColors';
import { RegisterModal } from '@/components/FilterTrackerSection';
import type { FilterActivation } from '@/hooks/useNotifications';

export default function OfflinePurchasesSection({ userId, focused, onRegistered }: {
  userId: number; focused: boolean; onRegistered: (a: FilterActivation) => void;
}) {
  const api = useApi(), colors = useColors();
  const [selection, setSelection] = useState<{ saleId: number; saleDate: string; item: OfflinePurchaseItem; unitId: string; registeredInstallationDate?: string } | null>(null);
  const purchases = useQuery({
    queryKey: ['offline-purchases', userId],
    queryFn: ({ signal }) => api.getOfflinePurchases(signal),
    enabled: focused, staleTime: 0, refetchInterval: focused ? 30000 : false,
  });
  useFocusEffect(useCallback(() => { void purchases.refetch(); }, [userId]));
  return <View style={{ gap: 12 }}>
    <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
      <Text style={{ color: colors.text, fontSize: 17, fontWeight: '700' }}>Offline purchases</Text>
      <TouchableOpacity testID="offline-purchases-refresh" onPress={() => purchases.refetch()}>
        <Text style={{ color: colors.primary }}>Refresh</Text>
      </TouchableOpacity>
    </View>
    {purchases.isLoading ? <View accessibilityRole="progressbar" accessibilityLabel="Loading offline purchases">
      <ActivityIndicator color={colors.primary} /><Text style={{ color: colors.mutedForeground }}>Loading offline purchases…</Text>
    </View> : null}
    {purchases.isError ? <View accessibilityLiveRegion="polite">
      <Text style={{ color: colors.mutedForeground }}>Offline purchases unavailable. {purchases.error instanceof Error ? purchases.error.message : 'Check your connection and retry.'}</Text>
      <TouchableOpacity onPress={() => purchases.refetch()}><Text style={{ color: colors.primary }}>Retry</Text></TouchableOpacity>
    </View> : null}
    {!purchases.isLoading && !purchases.isError && !purchases.data?.purchases.length
      ? <Text style={{ color: colors.mutedForeground }}>No linked offline sales on this account.</Text> : null}
    {(purchases.data?.purchases ?? []).map(sale => <View key={`offline-sale:${sale.saleId}`}
      style={{ borderWidth: 1, borderColor: colors.border, borderRadius: 14, padding: 14, gap: 10 }}>
      <Text style={{ color: colors.mutedForeground }}>Offline Sale · {sale.saleDate}</Text>
      {sale.items.map(item => <View key={`offline-line:${item.lineId}`} style={{ gap: 6 }}>
        <Text style={{ color: colors.text, fontWeight: '600' }}>{item.name} · ×{item.quantity}</Text>
        {item.unavailableReason ? <Text style={{ color: colors.mutedForeground }}>{item.unavailableReason}</Text>
          : item.availableUnitIds.length ? <TouchableOpacity testID={`offline-register-${item.lineId}`}
            onPress={() => setSelection({ saleId: sale.saleId, saleDate: sale.saleDate, item, unitId: item.availableUnitIds[0] })}>
            <Text style={{ color: colors.primary }}>Register filter · {item.availableUnitIds.length} available</Text>
          </TouchableOpacity> : <Text style={{ color: colors.mutedForeground }}>All units registered. Filter history is preserved.</Text>}
        {(item.registeredUnits ?? []).filter(unit => unit.active).map(unit => <TouchableOpacity key={`restore:${unit.unitId}`}
          testID={`offline-restore-${unit.unitId}`}
          onPress={() => setSelection({ saleId: sale.saleId, saleDate: sale.saleDate, item, unitId: unit.unitId, registeredInstallationDate: unit.installationDate })}>
          <Text style={{ color: colors.primary }}>Restore registered filter on this device · installed {unit.installationDate}</Text>
        </TouchableOpacity>)}
      </View>)}
    </View>)}
    <RegisterModal key={`offline-modal:${userId}`} visible={!!selection} offlineSelection={selection}
      existingActivation={null} filterProducts={[]} productsLoading={false} userId={userId}
      onClose={() => setSelection(null)} onSave={activation => {
        onRegistered(activation); setSelection(null); void purchases.refetch();
      }} />
  </View>;
}