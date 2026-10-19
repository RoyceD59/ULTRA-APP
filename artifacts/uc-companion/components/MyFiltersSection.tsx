import React, { useState } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator, Platform } from 'react-native';
import { useAuth } from '@/context/AuthContext';
import { useColors } from '@/hooks/useColors';
import { useMyFilters } from '@/hooks/useMyFilters';
import { RegisterModal } from '@/components/FilterTrackerSection';
import type { FilterActivation } from '@/hooks/useNotifications';
import type { ReadyFilterUnit, FilterDetail, OnlineSelection, OfflineSelection } from '@/lib/myFiltersPresentation';

type Sel = { online?: OnlineSelection; offline?: OfflineSelection };
type Colors = ReturnType<typeof useColors>;
type Src = { isLoading: boolean; isPending?: boolean; isError: boolean; data?: unknown; refetch: () => unknown; error?: unknown };

const webExpanded = (open: boolean) => (Platform.OS === 'web' ? ({ 'aria-expanded': open } as object) : {});
const btn = { minHeight: 44, minWidth: 44, justifyContent: 'center' as const };

export function ReadyUnitRow({ unit, onActivate, colors }: { unit: ReadyFilterUnit; onActivate: () => void; colors: Colors }) {
  return <View style={{ padding: 14, gap: 8, borderWidth: 1, borderColor: colors.border, borderRadius: 14, backgroundColor: colors.card }}>
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'flex-start' }}>
      <Text style={{ color: colors.text, fontWeight: '700', fontSize: 15, flexShrink: 1, flexGrow: 1, flexBasis: 160 }}>{unit.name}</Text>
      <View style={{ backgroundColor: colors.primaryLight, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 }}>
        <Text style={{ color: colors.primary, fontSize: 12, fontWeight: '600' }}>{unit.sourceBadge}</Text>
      </View>
    </View>
    <Text style={{ color: colors.mutedForeground, fontSize: 13 }}>{unit.label}</Text>
    <TouchableOpacity accessibilityRole="button" accessibilityLabel={`Activate ${unit.name}. ${unit.label}`} onPress={onActivate}
      style={{ ...btn, backgroundColor: colors.primary, borderRadius: 12, paddingHorizontal: 16, alignSelf: 'flex-start' }}>
      <Text style={{ color: colors.primaryForeground, fontWeight: '700' }}>Activate</Text>
    </TouchableOpacity>
  </View>;
}

export function SourceStatus({ name, src, colors }: { name: string; src: Src; colors: Colors }) {
  const saved = src.data != null;
  if ((src.isLoading || src.isPending) && !saved) return <View accessibilityRole="progressbar" accessibilityLabel={`Loading ${name}`} style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center', minHeight: 44 }}>
    <ActivityIndicator color={colors.primary} /><Text style={{ color: colors.mutedForeground }}>Loading {name}…</Text></View>;
  if (!src.isError) return null;
  return <View accessibilityLiveRegion="polite" style={{ gap: 2, borderWidth: 1, borderColor: colors.border, borderRadius: 12, padding: 10, backgroundColor: colors.surface }}>
    <Text style={{ color: colors.text }}>{saved ? `${name} could not refresh. Showing saved data.` : `${name} unavailable. No saved data yet.`}</Text>
    {src.error ? <Text style={{ color: colors.mutedForeground }}>{src.error instanceof Error ? src.error.message : String(src.error)}</Text> : null}
    <TouchableOpacity accessibilityRole="button" onPress={() => src.refetch()} style={btn}>
      <Text style={{ color: colors.primary, fontWeight: '600' }}>Retry {name}</Text></TouchableOpacity>
  </View>;
}

function Disclosure({ title, count, open, toggle, colors, children }: { title: string; count: number; open: boolean; toggle: () => void; colors: Colors; children: React.ReactNode }) {
  return <View style={{ gap: 8 }}>
    <TouchableOpacity accessibilityRole="button" accessibilityState={{ expanded: open }} {...webExpanded(open)}
      onPress={toggle} style={{ ...btn, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
      <Text style={{ color: colors.text, fontSize: 15, fontWeight: '700', flexShrink: 1 }}>{title} ({count})</Text>
      <Text style={{ color: colors.primary, fontWeight: '600' }}>{open ? 'Hide' : 'Show'}</Text>
    </TouchableOpacity>
    {open ? children : null}
  </View>;
}

function DetailRow({ d, colors, onRestore }: { d: FilterDetail; colors: Colors; onRestore?: () => void }) {
  return <View style={{ padding: 12, gap: 6, borderWidth: 1, borderColor: colors.border, borderRadius: 12 }}>
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
      <Text style={{ color: colors.text, fontWeight: '600', flexShrink: 1, flexGrow: 1, flexBasis: 160 }}>{d.name}</Text>
      <Text style={{ color: colors.primary, fontSize: 12, fontWeight: '600' }}>{d.sourceBadge}</Text>
    </View>
    <Text style={{ color: colors.mutedForeground, fontSize: 13 }}>{d.description}</Text>
    {onRestore ? <TouchableOpacity accessibilityRole="button" onPress={onRestore} style={btn}>
      <Text style={{ color: colors.primary, fontWeight: '600' }}>Restore on this device (not an activation)</Text></TouchableOpacity> : null}
  </View>;
}

export default function MyFiltersSection(props: { activation: FilterActivation | null; onRegistered: (a: FilterActivation) => void; children?: React.ReactNode }) {
  const { user } = useAuth();
  if (!user) return null;
  return <Owned key={user.id} userId={user.id} {...props} />;
}

function Owned({ userId, activation, onRegistered, children }: { userId: number; activation: FilterActivation | null; onRegistered: (a: FilterActivation) => void; children?: React.ReactNode }) {
  const colors = useColors();
  const f = useMyFilters(activation);
  const [sel, setSel] = useState<Sel | null>(null);
  const [otherOpen, setOtherOpen] = useState(false);
  const [histOpen, setHistOpen] = useState(false);
  return <View style={{ gap: 14 }}>
    <Text nativeID="my-filters" accessibilityRole="header" style={{ color: colors.text, fontSize: 20, fontWeight: '800' }}>My Filters</Text>
    {activation ? children : null}
    <View style={{ gap: 10 }}>
      <Text style={{ color: colors.text, fontSize: 16, fontWeight: '700' }}>Ready to activate ({f.ready.length})</Text>
      {f.ready.map(u => <ReadyUnitRow key={u.key} unit={u} colors={colors} onActivate={() => setSel({ online: u.purchaseSelection, offline: u.offlineSelection })} />)}
      {!f.ready.length && f.online.data && f.offline.data && !f.storeError && !f.online.isError && !f.offline.isError && !f.online.isFetching && !f.offline.isFetching ? <Text style={{ color: colors.mutedForeground }}>No filters are waiting to be activated.</Text> : null}
    </View>
    <SourceStatus name="App and store purchases" src={f.online as Src} colors={colors} />
    {f.storeError ? <SourceStatus name="Store purchases" src={{ isLoading: false, isError: true, error: f.storeError, refetch: f.online.refetch }} colors={colors} /> : null}
    <SourceStatus name="Offline sales" src={f.offline as Src} colors={colors} />
    <SourceStatus name="Staff-linked filters" src={f.assignments as Src} colors={colors} />
    <SourceStatus name="Registered filters" src={f.registrations as Src} colors={colors} />
    <TouchableOpacity accessibilityRole="button" onPress={f.refresh} style={{ ...btn, alignSelf: 'flex-start' }}>
      <Text style={{ color: colors.primary, fontWeight: '700' }}>Refresh filters</Text></TouchableOpacity>
    <Disclosure title="Other filters" count={f.other.length} open={otherOpen} toggle={() => setOtherOpen(o => !o)} colors={colors}>
      {f.other.length ? f.other.map(d => <DetailRow key={d.key} d={d} colors={colors}
        onRestore={d.offlineSelection ? () => setSel({ offline: d.offlineSelection }) : undefined} />)
        : <Text style={{ color: colors.mutedForeground }}>{f.assignments.isSuccess && f.offline.isSuccess && f.registrations.isSuccess ? 'No other filters.' : 'Other filter records are not yet confirmed.'}</Text>}
    </Disclosure>
    <Disclosure title="Purchase history" count={f.history.length} open={histOpen} toggle={() => setHistOpen(o => !o)} colors={colors}>
      {f.history.length ? f.history.map(d => <DetailRow key={d.key} d={d} colors={colors} />)
        : <Text style={{ color: colors.mutedForeground }}>{f.online.isSuccess && f.offline.isSuccess && !f.storeError ? 'No purchases yet.' : 'Purchase history is not yet confirmed.'}</Text>}
    </Disclosure>
    {!activation ? children : null}
    <ActivationModal userId={userId} sel={sel} activation={activation} onClose={() => setSel(null)}
      onSaved={a => { onRegistered(a); setSel(null); f.invalidate(); }} />
  </View>;
}

export function ActivationModal({ userId, sel, activation, onClose, onSaved }: { userId: number; sel: Sel | null; activation: FilterActivation | null; onClose: () => void; onSaved: (a: FilterActivation) => void }) {
  return <RegisterModal key={`my-filters-modal:${userId}`} visible={!!sel} purchaseSelection={sel?.online ?? null} offlineSelection={sel?.offline ?? null}
    existingActivation={activation} filterProducts={[]} productsLoading={false} userId={userId} onClose={onClose} onSave={onSaved} />;
}
