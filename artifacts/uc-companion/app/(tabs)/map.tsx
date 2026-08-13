// Web fallback — react-native-maps only works on native.
// This screen shows a location list on web; map.native.tsx has the MapView.
import React, { useState } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, Platform, ActivityIndicator, Linking } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';
import { useQuery } from '@tanstack/react-query';
import { useApi, MapLocation } from '@/hooks/useApi';
import { useCartBarInset } from '@/hooks/useCartBarInset';

const FILTER_TABS = ['All', 'Centres', 'ATMs'];
const topPad = Platform.OS === 'web' ? 67 : 0;

function LocationCard({ loc, colors }: { loc: MapLocation; colors: ReturnType<typeof useColors> }) {
  const isCentre = loc.type === 'experience_centre';
  return (
    <TouchableOpacity
      activeOpacity={0.8}
      onPress={() => Linking.openURL(`https://maps.google.com/?q=${loc.lat},${loc.lng}`)}
      style={[styles.locCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <View style={[styles.locIcon, { backgroundColor: isCentre ? colors.primaryLight : '#E0F7FA' }]}>
        <Ionicons name={isCentre ? 'business-outline' : 'water-outline'} size={20}
          color={isCentre ? colors.primary : '#00B4D8'} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[styles.locName, { color: colors.text }]} numberOfLines={1}>{loc.name}</Text>
        <Text style={[styles.locAddr, { color: colors.mutedForeground }]} numberOfLines={1}>{loc.address}</Text>
        <View style={styles.locMeta}>
          <Ionicons name="time-outline" size={12} color={colors.mutedForeground} />
          <Text style={[styles.locHours, { color: colors.mutedForeground }]}>{loc.hours}</Text>
        </View>
      </View>
      <View style={[styles.typeBadge, { backgroundColor: isCentre ? colors.primaryLight : '#E0F7FA' }]}>
        <Text style={[styles.typeText, { color: isCentre ? colors.primary : '#007B9E' }]}>
          {isCentre ? 'Centre' : 'ATM'}
        </Text>
      </View>
    </TouchableOpacity>
  );
}

export default function MapScreen() {
  const colors = useColors();
  const api = useApi();
  const [filter, setFilter] = useState('All');
  const cartBarInset = useCartBarInset();

  const { data: locations = [], isLoading, refetch, isRefetching } = useQuery({
    queryKey: ['locations'],
    queryFn: () => api.getLocations(),
    staleTime: 10 * 60 * 1000,
  });

  const visible = locations.filter(l =>
    filter === 'All' ? true : filter === 'Centres' ? l.type === 'experience_centre' : l.type === 'refill_atm'
  );

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      {/* Filter tabs */}
      <View style={[styles.filterRow, { marginTop: topPad }]}>
        {FILTER_TABS.map(t => (
          <TouchableOpacity key={t} onPress={() => setFilter(t)} activeOpacity={0.8}
            style={[styles.filterBtn, { backgroundColor: filter === t ? colors.primary : colors.surface, borderColor: colors.border }]}>
            <Text style={{ fontSize: 13, fontWeight: '600' as const, color: filter === t ? '#fff' : colors.mutedForeground }}>{t}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Map hint for web */}
      <View style={[styles.mapHint, { backgroundColor: colors.primaryLight, borderColor: colors.primary }]}>
        <Ionicons name="map-outline" size={18} color={colors.primary} />
        <Text style={[styles.mapHintText, { color: colors.primary }]}>Tap any location to open in Google Maps</Text>
      </View>

      {isLoading ? (
        <View style={styles.loading}><ActivityIndicator color={colors.primary} /></View>
      ) : (
        <FlatList
          data={visible}
          keyExtractor={l => l.id}
          contentContainerStyle={[styles.list, { paddingBottom: cartBarInset || (Platform.OS === 'web' ? 34 : 80) }]}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>No locations for this filter</Text>
            </View>
          }
          renderItem={({ item }) => <LocationCard loc={item} colors={colors} />}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  filterRow: { flexDirection: 'row', gap: 8, padding: 16, paddingBottom: 8 },
  filterBtn: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20, borderWidth: 1 },
  mapHint: { flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: 16, marginBottom: 8, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 10, borderWidth: 1 },
  mapHintText: { fontSize: 13, fontWeight: '500' as const },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  list: { padding: 16, gap: 12, paddingBottom: Platform.OS === 'web' ? 34 : 80 },
  locCard: { flexDirection: 'row', alignItems: 'flex-start', borderRadius: 12, borderWidth: 1, padding: 14, gap: 12 },
  locIcon: { width: 40, height: 40, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  locName: { fontSize: 14, fontWeight: '600' as const },
  locAddr: { fontSize: 12, marginTop: 2 },
  locMeta: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 },
  locHours: { fontSize: 11 },
  typeBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  typeText: { fontSize: 11, fontWeight: '600' as const },
  empty: { alignItems: 'center', paddingTop: 40 },
  emptyText: { fontSize: 14 },
});
