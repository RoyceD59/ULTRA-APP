import React, { useState } from 'react';
import { View, Text, TouchableOpacity, Platform } from 'react-native';
import { useRouter } from 'expo-router';
import { useAuth } from '@/context/AuthContext';
import { useColors } from '@/hooks/useColors';
import { useMyFilters } from '@/hooks/useMyFilters';
import { ReadyUnitRow, SourceStatus, ActivationModal } from '@/components/MyFiltersSection';
import type { FilterActivation } from '@/hooks/useNotifications';

type Props = { activation: FilterActivation | null; onRegistered: (a: FilterActivation) => void; compact?: boolean };
type Sel = React.ComponentProps<typeof ActivationModal>['sel'];

export default function PurchaseActivationSection(p: Props) {
  const { user } = useAuth();
  if (!user) return null;
  return <Card key={user.id} userId={user.id} {...p} />;
}

function Card({ userId, activation, onRegistered }: Props & { userId: number }) {
  const colors = useColors(), router = useRouter(), f = useMyFilters(activation);
  const [all, setAll] = useState(false);
  const [sel, setSel] = useState<Sel>(null);
  const shown = all ? f.ready : f.ready.slice(0, 1);
  const loadingOrError = !!f.storeError || [f.online, f.offline].some(s => s.isError || (s.isPending && s.data == null));
  if (!f.ready.length && !loadingOrError) return null;
  return <View style={{ gap: 10, borderRadius: 16, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card, padding: 14 }}>
    {f.ready.length ? <Text style={{ color: colors.text, fontSize: 16, fontWeight: '700' }}>
      Ready to activate ({f.ready.length})</Text> : null}
    {shown.map(u => <ReadyUnitRow key={u.key} unit={u} colors={colors} onActivate={() => setSel({ online: u.purchaseSelection, offline: u.offlineSelection })} />)}
    {f.ready.length > 1 ? <TouchableOpacity accessibilityRole="button" accessibilityState={{ expanded: all }}
      {...(Platform.OS === 'web' ? ({ 'aria-expanded': all } as object) : {})}
      onPress={() => setAll(a => !a)} style={{ minHeight: 44, justifyContent: 'center' }}>
      <Text style={{ color: colors.primary, fontWeight: '600' }}>{all ? 'Show fewer' : `Show all ${f.ready.length} units`}</Text>
    </TouchableOpacity> : null}
    <SourceStatus name="App and store purchases" src={f.online as never} colors={colors} />
    {f.storeError ? <SourceStatus name="Store purchases" src={{ isLoading: false, isError: true, error: f.storeError, refetch: f.online.refetch }} colors={colors} /> : null}
    <SourceStatus name="Offline sales" src={f.offline as never} colors={colors} />
    {f.ready.length ? <TouchableOpacity accessibilityRole="button" onPress={() => router.push('/(tabs)/account?section=my-filters' as never)}
      style={{ minHeight: 44, justifyContent: 'center' }}>
      <Text style={{ color: colors.primary, fontWeight: '700' }}>View all filters</Text></TouchableOpacity> : null}
    <ActivationModal userId={userId} sel={sel} activation={activation} onClose={() => setSel(null)}
      onSaved={a => { onRegistered(a); setSel(null); f.invalidate(); }} />
  </View>;
}
