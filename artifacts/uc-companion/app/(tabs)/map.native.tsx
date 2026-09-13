// Native map screen — loaded on iOS and Android by Expo Router's platform
// extension resolution.  map.tsx is the web fallback (list + Google Maps links).
import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  ActivityIndicator, Linking, Platform,
} from 'react-native';
import MapView, { Marker, Region } from 'react-native-maps';
import { Ionicons } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';
import { useQuery } from '@tanstack/react-query';
import { useApi, MapLocation } from '@/hooks/useApi';
import * as Location from 'expo-location';
import { useCartBarInset } from '@/hooks/useCartBarInset';
import { directionsUrls, mapCoordinates, regionForLocations } from '@/lib/locationMap';

// ── constants ────────────────────────────────────────────────────────────────

const NAIROBI: Region = {
  latitude: -1.2921,
  longitude: 36.8219,
  latitudeDelta: 0.14,
  longitudeDelta: 0.14,
};

const CENTRE_PIN = '#0054A6'; // UC brand blue
const ATM_PIN    = '#00B4D8'; // teal / accent
const VENDOR_PIN = '#2E7D32'; // verified retail vendor

const FILTER_TABS = ['All', 'Centres', 'ATMs', 'Vendors'] as const;
type Filter = typeof FILTER_TABS[number];

// ── screen ───────────────────────────────────────────────────────────────────

export default function MapScreen() {
  const colors   = useColors();
  const api      = useApi();
  const mapRef   = useRef<MapView>(null);
  const [filter,   setFilter]   = useState<Filter>('All');
  const [selected, setSelected] = useState<MapLocation | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const [directionsError, setDirectionsError] = useState('');
  // Full inset (tab bar + safe area + cart bar + gap) when the cart is
  // non-empty, so bottom-anchored overlays clear the GlobalCartBar.
  const cartBarInset = useCartBarInset();
  const bottomOffset = cartBarInset || 24;

  const { data: locations = [], isLoading, isError, refetch, isRefetching } = useQuery({
    queryKey: ['locations'],
    queryFn:  () => api.getLocations(),
    staleTime: 10 * 60 * 1000,
  });

  const visible = useMemo(() => locations.filter(l => {
    if (filter === 'All') return true;
    if (filter === 'Centres') return l.type === 'experience_centre';
    if (filter === 'ATMs') return l.type === 'refill_atm';
    return l.type === 'vendor';
  }), [filter, locations]);

  useEffect(() => {
    if (!mapReady || !visible.length) return;
    const coordinates = mapCoordinates(visible);
    if (coordinates.length > 1) {
      mapRef.current?.fitToCoordinates(coordinates, {
        animated: true,
        edgePadding: { top: 150, right: 48, bottom: 220, left: 48 },
      });
      return;
    }
    const region = regionForLocations(visible);
    if (region) mapRef.current?.animateToRegion(region, 400);
  }, [mapReady, visible]);

  // Select a pin and nudge the camera up slightly so the sheet doesn't cover it
  const handleMarkerPress = useCallback((loc: MapLocation) => {
    setSelected(loc);
    mapRef.current?.animateToRegion({
      latitude:      loc.lat - 0.008,
      longitude:     loc.lng,
      latitudeDelta: 0.04,
      longitudeDelta: 0.04,
    }, 500);
  }, []);

  async function goToMyLocation() {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') return;
    const pos = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.Balanced,
    });
    mapRef.current?.animateToRegion({
      latitude:       pos.coords.latitude,
      longitude:      pos.coords.longitude,
      latitudeDelta:  0.05,
      longitudeDelta: 0.05,
    }, 700);
  }

  async function openDirections(location: MapLocation) {
    setDirectionsError('');
    const platform = Platform.OS === 'ios' ? 'ios' : Platform.OS === 'android' ? 'android' : 'web';
    const urls = directionsUrls(location, platform);
    try {
      if (await Linking.canOpenURL(urls.primary)) {
        await Linking.openURL(urls.primary);
        return;
      }
    } catch {
      // A missing native map app is expected; use the browser destination below.
    }
    try {
      await Linking.openURL(urls.fallback);
    } catch {
      setDirectionsError('Directions could not be opened. Please try again.');
    }
  }

  // ── loading state ──────────────────────────────────────────────────────────

  if (isLoading) {
    return (
      <View style={[s.screen, s.centered, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={[s.loadingTxt, { color: colors.mutedForeground }]}>Loading map…</Text>
      </View>
    );
  }

  if (isError) {
    return (
      <View style={[s.screen, s.centered, { backgroundColor: colors.background }]}>
        <Ionicons name="alert-circle-outline" size={32} color={colors.primary} />
        <Text style={[s.stateTitle, { color: colors.text }]}>Locations are unavailable</Text>
        <Text style={[s.stateText, { color: colors.mutedForeground }]}>Please check your connection and try again.</Text>
        <TouchableOpacity onPress={() => refetch()} disabled={isRefetching} style={[s.retryBtn, { backgroundColor: colors.primary }]}>
          <Text style={s.retryBtnText}>{isRefetching ? 'Retrying…' : 'Try again'}</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (!locations.length) {
    return (
      <View style={[s.screen, s.centered, { backgroundColor: colors.background }]}>
        <Ionicons name="location-outline" size={32} color={colors.primary} />
        <Text style={[s.stateTitle, { color: colors.text }]}>No verified locations yet</Text>
        <Text style={[s.stateText, { color: colors.mutedForeground }]}>Please try again shortly.</Text>
        <TouchableOpacity onPress={() => refetch()} disabled={isRefetching} style={[s.retryBtn, { backgroundColor: colors.primary }]}>
          <Text style={s.retryBtnText}>{isRefetching ? 'Refreshing…' : 'Refresh'}</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // ── map ────────────────────────────────────────────────────────────────────

  return (
    <View style={s.screen}>
      <MapView
        ref={mapRef}
        style={StyleSheet.absoluteFillObject}
        initialRegion={NAIROBI}
        showsUserLocation
        showsMyLocationButton={false}
        showsCompass={false}
        onMapReady={() => setMapReady(true)}
        onPress={() => setSelected(null)}
      >
        {visible.map(loc => (
          <Marker
            key={loc.id}
            coordinate={{ latitude: loc.lat, longitude: loc.lng }}
            pinColor={loc.type === 'experience_centre' ? CENTRE_PIN : loc.type === 'vendor' ? VENDOR_PIN : ATM_PIN}
            onPress={() => handleMarkerPress(loc)}
          />
        ))}
      </MapView>

      {!visible.length && (
        <View style={[s.filterEmpty, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[s.filterEmptyText, { color: colors.mutedForeground }]}>No locations match this filter.</Text>
        </View>
      )}

      {/* ── Filter tabs ──────────────────────────────────────────────────── */}
      <View style={[s.filterRow, { backgroundColor: colors.background + 'ee' }]}>
        {FILTER_TABS.map(t => (
          <TouchableOpacity
            key={t}
            onPress={() => setFilter(t)}
            activeOpacity={0.8}
            style={[
              s.filterBtn,
              {
                backgroundColor: filter === t ? colors.primary : colors.surface,
                borderColor: colors.border,
              },
            ]}
          >
            <Text style={{ fontSize: 13, fontWeight: '600' as const, color: filter === t ? '#fff' : colors.mutedForeground }}>
              {t}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* ── My-location FAB ──────────────────────────────────────────────── */}
      <TouchableOpacity
        onPress={goToMyLocation}
        activeOpacity={0.85}
        style={[s.myLocBtn, {
          backgroundColor: colors.card,
          borderColor: colors.border,
          shadowColor: colors.text,
        }]}
      >
        <Ionicons name="navigate" size={20} color={colors.primary} />
      </TouchableOpacity>

      {/* ── Legend ───────────────────────────────────────────────────────── */}
      <View style={[s.legend, { backgroundColor: colors.card + 'f2', borderColor: colors.border, bottom: bottomOffset }]}>
        <View style={s.legendRow}>
          <View style={[s.legendDot, { backgroundColor: CENTRE_PIN }]} />
          <Text style={[s.legendTxt, { color: colors.mutedForeground }]}>Experience Centre</Text>
        </View>
        <View style={s.legendRow}>
          <View style={[s.legendDot, { backgroundColor: ATM_PIN }]} />
          <Text style={[s.legendTxt, { color: colors.mutedForeground }]}>Water ATM</Text>
        </View>
        <View style={s.legendRow}>
          <View style={[s.legendDot, { backgroundColor: VENDOR_PIN }]} />
          <Text style={[s.legendTxt, { color: colors.mutedForeground }]}>Verified vendor</Text>
        </View>
      </View>

      {/* ── Bottom detail sheet ──────────────────────────────────────────── */}
      {selected && (
        <View style={[s.sheet, {
          backgroundColor: colors.card,
          borderColor: colors.border,
          shadowColor: colors.text,
          bottom: bottomOffset,
        }]}>
          {/* Header row */}
          <View style={s.sheetTop}>
            <View style={[
              s.sheetIconWrap,
               { backgroundColor: selected.type === 'experience_centre' ? colors.primaryLight : selected.type === 'vendor' ? '#E8F5E9' : '#E0F7FA' },
            ]}>
              <Ionicons
                 name={selected.type === 'experience_centre' || selected.type === 'vendor' ? 'business' : 'water'}
                size={22}
                 color={selected.type === 'experience_centre' ? colors.primary : selected.type === 'vendor' ? VENDOR_PIN : ATM_PIN}
              />
            </View>

            <View style={{ flex: 1 }}>
              <Text style={[s.sheetName, { color: colors.text }]} numberOfLines={1}>
                {selected.name}
              </Text>
              <Text style={[s.sheetAddr, { color: colors.mutedForeground }]} numberOfLines={1}>
                {selected.address}
              </Text>
               {selected.type === 'vendor' && (
                 <View style={s.verifiedVendor}>
                   <Ionicons name="checkmark-circle" size={13} color={VENDOR_PIN} />
                   <Text style={[s.verifiedVendorText, { color: VENDOR_PIN }]}>Verified Ultra-Clear vendor</Text>
                 </View>
               )}
              <View style={s.sheetMeta}>
                <Ionicons name="time-outline" size={12} color={colors.mutedForeground} />
                <Text style={[s.sheetMetaTxt, { color: colors.mutedForeground }]}>{selected.hours}</Text>
              </View>
              {selected.phone && (
                <View style={s.sheetMeta}>
                  <Ionicons name="call-outline" size={12} color={colors.mutedForeground} />
                  <Text style={[s.sheetMetaTxt, { color: colors.mutedForeground }]}>{selected.phone}</Text>
                </View>
              )}
            </View>

            <TouchableOpacity
              onPress={() => setSelected(null)}
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            >
              <Ionicons name="close-circle" size={24} color={colors.border} />
            </TouchableOpacity>
          </View>

          {/* Action buttons */}
          <View style={s.sheetActions}>
            <TouchableOpacity
              onPress={() => openDirections(selected)}
              style={[s.sheetBtn, { backgroundColor: colors.primary }]}
            >
              <Ionicons name="navigate" size={15} color="#fff" />
              <Text style={s.sheetBtnTxt}>Get Directions</Text>
            </TouchableOpacity>
            {!!directionsError && <Text style={[s.directionsError, { color: colors.mutedForeground }]}>{directionsError}</Text>}

            {selected.phone && (
              <TouchableOpacity
                onPress={() => Linking.openURL(`tel:${selected.phone}`)}
                style={[s.sheetBtnOutline, { borderColor: colors.border, backgroundColor: colors.surface }]}
              >
                <Ionicons name="call" size={15} color={colors.primary} />
                <Text style={[s.sheetBtnTxt, { color: colors.primary }]}>Call</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      )}
    </View>
  );
}

// ── styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  screen:  { flex: 1 },
  centered: { alignItems: 'center', justifyContent: 'center', gap: 12 },
  loadingTxt: { fontSize: 14 },
  stateTitle: { fontSize: 17, fontWeight: '700' as const },
  stateText: { fontSize: 14, textAlign: 'center', paddingHorizontal: 32 },
  retryBtn: { borderRadius: 10, paddingHorizontal: 18, paddingVertical: 11 },
  retryBtnText: { color: '#fff', fontSize: 14, fontWeight: '600' as const },

  // Filter bar — floats near the top of the map
  filterRow: {
    position: 'absolute',
    top: 52,
    left: 16,
    right: 16,
    flexDirection: 'row',
    gap: 8,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 14,
  },
  filterBtn: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
  },

  // Navigate-to-me FAB
  myLocBtn: {
    position: 'absolute',
    top: 122,
    right: 16,
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.12,
    shadowRadius: 4,
    elevation: 4,
  },
  filterEmpty: {
    position: 'absolute',
    top: 122,
    left: 16,
    right: 68,
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
  },
  filterEmptyText: { fontSize: 13, textAlign: 'center' },

  // Colour legend — bottom-left
  legend: {
    position: 'absolute',
    bottom: 24,
    left: 16,
    borderRadius: 10,
    borderWidth: 1,
    paddingVertical: 8,
    paddingHorizontal: 10,
    gap: 5,
  },
  legendRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  legendDot: { width: 10, height: 10, borderRadius: 5 },
  legendTxt: { fontSize: 11, fontWeight: '500' as const },

  // Location detail card
  sheet: {
    position: 'absolute',
    bottom: 24,
    left: 16,
    right: 16,
    borderRadius: 18,
    borderWidth: 1,
    padding: 16,
    gap: 14,
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 8,
  },
  sheetTop:      { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  sheetIconWrap: { width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  sheetName:     { fontSize: 15, fontWeight: '700' as const },
  sheetAddr:     { fontSize: 12, marginTop: 2 },
  verifiedVendor: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 },
  verifiedVendorText: { fontSize: 11, fontWeight: '600' as const },
  sheetMeta:     { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 3 },
  sheetMetaTxt:  { fontSize: 12 },
  sheetActions:  { flexDirection: 'row', gap: 10 },
  sheetBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 11,
    borderRadius: 12,
  },
  sheetBtnOutline: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 11,
    borderRadius: 12,
    borderWidth: 1,
  },
  sheetBtnTxt: { color: '#fff', fontSize: 14, fontWeight: '600' as const },
  directionsError: { fontSize: 12, textAlign: 'center', marginTop: -6 },
});
