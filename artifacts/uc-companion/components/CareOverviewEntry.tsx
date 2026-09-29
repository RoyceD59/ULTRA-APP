import React from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useColors } from '@/hooks/useColors';
import { useCareOverview } from '@/hooks/useCareOverview';

export default function CareOverviewEntry() {
  const { available } = useCareOverview();
  const colors = useColors();
  const router = useRouter();
  if (!available) return null;
  return <TouchableOpacity accessibilityRole="button" accessibilityLabel="Open your water care overview"
    onPress={() => router.push('/care' as never)}
    style={{ padding: 20, marginTop: 20, gap: 12, borderRadius: 16, backgroundColor: colors.primaryLight }}>
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
      <Ionicons name="water-outline" size={24} color={colors.primary} />
      <Text style={{ flex: 1, fontSize: 18, fontWeight: '600', color: colors.text }}>Your water care</Text>
      <Ionicons name="chevron-forward" size={22} color={colors.primary} />
    </View>
    <Text style={{ color: colors.text, lineHeight: 22 }}>Keep up with filter care, rewards and nearby water services.</Text>
  </TouchableOpacity>;
}
