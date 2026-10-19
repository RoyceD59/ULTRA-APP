import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useColors } from '@/hooks/useColors';

const CERTIFIED = [
  { label: 'Your Neighborhood\nRated', icon: 'people-circle-outline', color: '#1B3A6B' },
  { label: 'Dermatologist\nTested',  icon: 'medical-outline',          color: '#00857C' },
  { label: 'ISO 9001\nCertified',    icon: 'star-outline',             color: '#F4A100' },
  { label: 'BPA\nFree',              icon: 'water-outline',            color: '#0097A7' },
  { label: 'RoHS\nCertified',        icon: 'leaf-outline',             color: '#43A047' },
] as const;

const PATRONS = [
  { label: 'Volunteers\nNetwork',    icon: 'people-outline',  color: '#7B1FA2' },
  { label: 'Youth\nAlliance',        icon: 'heart-outline',   color: '#E53935' },
] as const;

type Tab = 'certified' | 'patrons';

interface Props {
  compact?: boolean;
}

export default function TrustBadges({ compact = false }: Props) {
  const colors = useColors();
  const [tab, setTab] = useState<Tab>('certified');

  const badges = tab === 'certified' ? CERTIFIED : PATRONS;

  return (
    <View style={styles.wrapper}>
      {/* Tab toggle */}
      {!compact && (
        <View style={[styles.tabRow, { backgroundColor: colors.border + '60' }]}>
          {(['certified', 'patrons'] as Tab[]).map(t => {
            const active = tab === t;
            return (
              <TouchableOpacity
                key={t}
                onPress={() => setTab(t)}
                style={[
                  styles.tab,
                  active && { backgroundColor: colors.card, shadowColor: '#000',
                    shadowOpacity: 0.08, shadowRadius: 3, elevation: 2 },
                ]}
                activeOpacity={0.7}
              >
                <Text style={[
                  styles.tabLabel,
                  { color: active ? colors.text : colors.mutedForeground },
                ]}>
                  {t === 'certified' ? 'Certified & Trusted' : 'Patrons'}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      )}

      {/* Badge row */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.row}
      >
        {(badges as readonly { label: string; icon: string; color: string }[]).map(b => (
          <View
            key={b.label}
            style={[
              styles.badge,
              compact
                ? styles.badgeCompact
                : { backgroundColor: tab === 'patrons' ? b.color + '12' : colors.card,
                    borderColor: tab === 'patrons' ? b.color + '40' : colors.border },
            ]}
          >
            <View style={[styles.iconWrap, { backgroundColor: b.color + (tab === 'patrons' ? '25' : '15') }]}>
              <Ionicons
                name={b.icon as React.ComponentProps<typeof Ionicons>['name']}
                size={compact ? 14 : 18}
                color={b.color}
              />
            </View>
            {!compact && (
              <Text style={[styles.label, { color: colors.text }]}>{b.label}</Text>
            )}
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper:      { gap: 8 },
  tabRow:       { flexDirection: 'row', borderRadius: 8, padding: 3, gap: 2 },
  tab:          { flex: 1, alignItems: 'center', paddingVertical: 5, borderRadius: 6 },
  tabLabel:     { fontSize: 11, fontWeight: '600' as const },
  row:          { flexDirection: 'row', gap: 8, paddingHorizontal: 2, paddingVertical: 2 },
  badge:        { alignItems: 'center', borderRadius: 10, borderWidth: 1, padding: 10, gap: 6, minWidth: 70 },
  badgeCompact: { padding: 6, minWidth: 40, backgroundColor: 'transparent', borderWidth: 0 },
  iconWrap:     { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  label:        { fontSize: 10, fontWeight: '600' as const, textAlign: 'center', lineHeight: 13 },
});
