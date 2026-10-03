// Web fallback — react-native-maps only works on native.
// This screen shows a location list on web; map.native.tsx has the MapView.
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, Platform, Linking } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from 'expo-router';
import { useColors } from '@/hooks/useColors';
import PageDataLoader from '@/components/PageDataLoader';
import PageDataError from '@/components/PageDataError';
import { useQuery } from '@tanstack/react-query';
import { useApi, MapLocation } from '@/hooks/useApi';
import { useCartBarInset } from '@/hooks/useCartBarInset';
import { directionsUrls, filterMapLocations, type LocationMapFilter } from '@/lib/locationMap';
import { LOCATIONS_REFRESH_INTERVAL_MS, reconcileSelectedLocation, startFocusedLocationRefresh } from '@/lib/locationRefresh';

import LocationDetailModal from '@/components/LocationDetailModal';

const FILTER_TABS: readonly LocationMapFilter[] = ['All', 'Centres', 'ATMs', 'Vendors', 'Stations', 'Taps'];
const topPad = 0;

function LocationCard({ loc, colors, onPress }: { loc: MapLocation; colors: ReturnType<typeof useColors>; onPress: (location: MapLocation) => void }) {
  const isCentre = loc.type === 'experience_centre';
  const isVendor = loc.type === 'vendor';
  const isStation = loc.type === 'refill_station';
  const isTap = loc.type === 'city_tap';

  const accent = isCentre ? colors.primary : isVendor ? '#2E7D32' : isStation ? '#1976D2' : isTap ? '#0288D1' : '#00B4D8';
  const typeLabel = isCentre ? 'Centre' : isVendor ? 'Verified vendor' : isStation ? 'Station' : isTap ? 'City Tap' : 'ATM';
  const iconName = (isCentre || isVendor) ? 'business-outline' : isStation ? 'pint-outline' : 'water-outline';
  const bgColor = isCentre ? colors.primaryLight : isVendor ? '#E8F5E9' : isStation ? '#E3F2FD' : isTap ? '#E1F5FE' : '#E0F7FA';

  return (
    <TouchableOpacity
      activeOpacity={0.8}
      onPress={() => onPress(loc)}
      style={[styles.locCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <View style={[styles.locIcon, { backgroundColor: bgColor }]}>
        <Ionicons name={iconName} size={20} color={accent} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[styles.locName, { color: colors.text }]} numberOfLines={1}>{loc.name}</Text>
        <Text style={[styles.locAddr, { color: colors.mutedForeground }]} numberOfLines={1}>
          {loc.address}{loc.city && loc.countryIso ? ` · ${loc.city}, ${loc.countryIso}` : ''}
        </Text>
        <View style={styles.locMeta}>
          <Ionicons name="time-outline" size={12} color={colors.mutedForeground} />
          <Text style={[styles.locHours, { color: colors.mutedForeground }]}>{loc.hours}</Text>
        </View>
      </View>
      <View style={[styles.typeBadge, { backgroundColor: bgColor }]}>
        <Text style={[styles.typeText, { color: accent }]}>
          {typeLabel}
        </Text>
      </View>
    </TouchableOpacity>
  );
}

export default function MapScreen() {
  const colors = useColors();
  const api = useApi();
  const [filter, setFilter] = useState<LocationMapFilter>('All');
  const [directionsError, setDirectionsError] = useState('');
  const [selected, setSelected] = useState<MapLocation | null>(null);
  const cartBarInset = useCartBarInset();

  const { data: locationData, isLoading, isError, error, refetch, isRefetching } = useQuery({
    queryKey: ['locations'],
    queryFn: () => api.getLocations(),
    staleTime: LOCATIONS_REFRESH_INTERVAL_MS,
  });

  const locations = locationData ?? [];
  const visible = filterMapLocations(locations, filter);

  useFocusEffect(useCallback(() => {
    return startFocusedLocationRefresh(refetch);
  }, [refetch]));

  useEffect(() => {
    const reconciled = reconcileSelectedLocation(selected, locations);
    if (reconciled !== selected) setSelected(reconciled);
  }, [locations, selected]);

  async function openDirections(location: MapLocation) {
    setDirectionsError('');
    const urls = directionsUrls(location, 'web');
    try {
      if (await Linking.canOpenURL(urls.primary)) {
        await Linking.openURL(urls.primary);
        return;
      }
    } catch {
      // Fall through to the browser URL, which also works when canOpenURL rejects.
    }
    try {
      await Linking.openURL(urls.fallback);
    } catch {
      setDirectionsError('Google Maps could not be opened. Please try again.');
    }
  }

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
        <Ionicons name="information-circle-outline" size={18} color={colors.primary} />
        <Text style={[styles.mapHintText, { color: colors.primary }]}>Tap any location to view details and community ratings</Text>
      </View>

       {isLoading && locationData === undefined ? (
         <PageDataLoader label="Loading verified locations…" />
       ) : isError && locationData === undefined ? (
         <PageDataError title="Locations unavailable" error={error} onRetry={refetch} />
      ) : (
        <FlatList
          data={visible}
          keyExtractor={l => l.id}
          contentContainerStyle={[styles.list, { paddingBottom: cartBarInset || (Platform.OS === 'web' ? 34 : 80) }]}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>{locations.length ? 'No locations match this filter.' : 'No verified locations are available yet.'}</Text>
              <TouchableOpacity onPress={() => refetch()} disabled={isRefetching} style={[styles.retryBtn, { backgroundColor: colors.primary }]}><Text style={styles.retryText}>{isRefetching ? 'Refreshing…' : 'Refresh'}</Text></TouchableOpacity>
            </View>
          }
          ListHeaderComponent={<>
            {isError ? <PageDataError title="Locations could not refresh" message="Your saved locations are shown below." onRetry={refetch} /> : null}
            {directionsError ? <Text style={[styles.directionsError, { color: colors.mutedForeground }]}>{directionsError}</Text> : null}
          </>}
          renderItem={({ item }) => <LocationCard loc={item} colors={colors} onPress={setSelected} />}
        />
      )}

      <LocationDetailModal
        location={selected}
        visible={!!selected}
        onClose={() => setSelected(null)}
        onDirections={openDirections}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, width: '100%', maxWidth: 1200, alignSelf: 'center' },
  filterRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, padding: 16, paddingBottom: 8 },
  filterBtn: { paddingHorizontal: 16, paddingVertical: 10, minHeight: 44, borderRadius: 20, borderWidth: 1 },
  mapHint: { flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: 16, marginBottom: 8, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 10, borderWidth: 1 },
  mapHintText: { flex: 1, fontSize: 13, fontWeight: '500' as const },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, paddingHorizontal: 28 },
  stateTitle: { fontSize: 17, fontWeight: '700' as const },
  stateText: { fontSize: 14, textAlign: 'center' },
  retryBtn: { borderRadius: 10, paddingHorizontal: 18, paddingVertical: 11, marginTop: 4 },
  retryText: { color: '#fff', fontSize: 14, fontWeight: '600' as const },
  list: { padding: 16, gap: 12, paddingBottom: Platform.OS === 'web' ? 34 : 80 },
  locCard: { flexDirection: 'row', alignItems: 'flex-start', borderRadius: 12, borderWidth: 1, padding: 14, gap: 12 },
  locIcon: { width: 40, height: 40, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  locName: { fontSize: 14, fontWeight: '600' as const },
  locAddr: { fontSize: 12, marginTop: 2 },
  locMeta: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 },
  locHours: { fontSize: 11 },
  typeBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  typeText: { fontSize: 11, fontWeight: '600' as const },
  empty: { alignItems: 'center', paddingTop: 40, gap: 14 },
  emptyText: { fontSize: 14 },
  directionsError: { textAlign: 'center', fontSize: 13, marginBottom: 12 },
});
