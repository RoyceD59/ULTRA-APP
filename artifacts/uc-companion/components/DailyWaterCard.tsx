import React from 'react';
import { Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import { useAuth } from '@/context/AuthContext';
import { useColors } from '@/hooks/useColors';
import { useHydration } from '@/hooks/useHydration';
import PageDataLoader from './PageDataLoader';
import PageDataError from './PageDataError';
import { pageDataState } from '@/lib/pageLoading';
import { dailyWaterSummary } from '@/lib/hydration';

/** Logging stays available independently of notification permission/preferences. */
export default function DailyWaterCard() {
  const colors = useColors();
  const router = useRouter();
  const { user } = useAuth();
  const hydration = useHydration();
  const state = pageDataState(hydration.data !== undefined, hydration.isLoading, hydration.isError);
  return (
    <View testID="daily-water-card">
      <TouchableOpacity accessibilityRole="button" accessibilityLabel="Daily filtered water. Open water logging"
        onPress={() => router.push('/hydration')} style={styles.row}>
        <Ionicons name="water-outline" size={24} color={colors.primary} />
        <View style={{ flex: 1, gap: 4 }}>
          <Text style={{ color: colors.text, fontSize: 15, fontWeight: '600' }}>Daily filtered water</Text>
          <Text style={{ color: colors.mutedForeground }}>
            {dailyWaterSummary(!!user, state, hydration.data?.litres)}
          </Text>
          {Platform.OS === 'web' && !!user && state === 'ready' && hydration.data?.litres == null && !hydration.isError ? (
            <Text style={{ color: colors.mutedForeground, fontSize: 12 }}>Daily prompt: record your filtered water. Background reminders require the mobile app.</Text>
          ) : null}
        </View>
        <Ionicons name="chevron-forward" size={18} color={colors.primary} />
      </TouchableOpacity>
      {!!user && state === 'loading' ? <PageDataLoader label="Loading today’s total…" /> : null}
      {!!user && hydration.isError ? <PageDataError title={hydration.data ? 'Today’s total could not refresh' : 'Today’s total unavailable'}
        error={hydration.error} onRetry={hydration.refetch} /> : null}
    </View>
  );
}
const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16, minHeight: 80 },
});