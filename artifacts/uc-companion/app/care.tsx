import React from 'react';
import { ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '@/context/AuthContext';
import { useColors } from '@/hooks/useColors';
import { useApi } from '@/hooks/useApi';
import { useCareOverview } from '@/hooks/useCareOverview';
import { customerQueryKeys } from '@/lib/customerQueryKeys';
import PageDataLoader from '@/components/PageDataLoader';
import PageDataError from '@/components/PageDataError';

export default function CareOverview() {
  const colors = useColors();
  const router = useRouter();
  const { user, isLoading: authLoading } = useAuth();
  const { available, isLoading: configLoading } = useCareOverview();
  const api = useApi();
  const insets = useSafeAreaInsets();
  const rewards = useQuery({
    queryKey: customerQueryKeys.rewards(user?.id), queryFn: () => api.getRewards(),
    enabled: !!user && available, staleTime: 0,
  });
  const actions = [
    { title: 'Filter care', detail: 'Check your registered filters and replacement reminders.', icon: 'shield-checkmark-outline', route: '/(tabs)/account' },
    { title: 'My rewards', detail: 'See earned points, history and your rewards QR.', icon: 'star-outline', route: '/rewards' },
    { title: 'Nearby water services', detail: 'Browse locations and their current service information.', icon: 'location-outline', route: '/(tabs)/map' },
    { title: 'Get support', detail: 'Ask for help with maintenance or your water system.', icon: 'help-circle-outline', route: '/(tabs)/support' },
  ] as const;
  const button = (label: string, action: () => void) => <TouchableOpacity accessibilityRole="button" onPress={action}
    style={{ minHeight: 48, padding: 14, backgroundColor: colors.primary, borderRadius: 12 }}>
    <Text style={{ color: colors.primaryForeground, fontWeight: '600' }}>{label}</Text>
  </TouchableOpacity>;
  if (authLoading || configLoading) return <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.background }}><PageDataLoader label="Loading your water care…" /></View>;
  if (!available) return <View style={{ flex: 1, gap: 20, padding: 24, backgroundColor: colors.background }}>
    <Text style={{ fontSize: 22, color: colors.text }}>Water care overview is unavailable</Text>
    {button('Go to my account', () => router.replace('/(tabs)/account'))}
  </View>;
  if (!user) return <View style={{ flex: 1, gap: 20, padding: 24, backgroundColor: colors.background }}>
    <Text style={{ fontSize: 22, color: colors.text }}>Your water care, in one place</Text>
    <Text style={{ color: colors.text }}>Sign in to see your rewards and filter-care history.</Text>
    {button('Sign in', () => router.push('/auth/login'))}
  </View>;
  return <ScrollView style={{ flex: 1, backgroundColor: colors.background }} contentContainerStyle={{ padding: 20, paddingBottom: 24 + insets.bottom }}>
    <View style={{ width: '100%', maxWidth: 1000, alignSelf: 'center', gap: 24 }}>
      <View style={{ gap: 10 }}>
        <Text accessibilityRole="header" style={{ fontSize: 28, fontWeight: '700', color: colors.text }}>Your water care</Text>
        <Text style={{ fontSize: 16, lineHeight: 24, color: colors.text }}>Keep your filtration working and make your next care step easy.</Text>
      </View>
      <View style={{ padding: 20, borderRadius: 16, backgroundColor: colors.primaryLight, gap: 10 }}>
        <Text style={{ color: colors.primary, fontWeight: '600' }}>Registered member</Text>
        <Text style={{ color: colors.text }}>Your existing account brings filter reminders, rewards and support together.</Text>
        {rewards.isError ? <PageDataError title="Points could not refresh" error={rewards.error} onRetry={rewards.refetch} /> : null}
        {rewards.isLoading && !rewards.data ? <PageDataLoader label="Loading your points…" /> :
          rewards.data ? <Text style={{ fontSize: 24, fontWeight: '600', color: colors.text }}>{rewards.data.balance.toLocaleString()} points</Text> : null}
        <Text style={{ color: colors.text }}>Points are rewards, not cash or prepaid refill litres.</Text>
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 16 }}>
        {actions.map(action => <TouchableOpacity key={action.title} accessibilityRole="button" accessibilityLabel={`${action.title}. ${action.detail}`}
          onPress={() => router.push(action.route as never)}
          style={{ flexGrow: 1, flexBasis: 260, minHeight: 140, padding: 20, borderWidth: 1, borderColor: colors.border, borderRadius: 16, gap: 12 }}>
          <Ionicons name={action.icon} size={25} color={colors.primary} />
          <Text style={{ fontSize: 18, fontWeight: '600', color: colors.text }}>{action.title}</Text>
          <Text style={{ color: colors.text, lineHeight: 22 }}>{action.detail}</Text>
        </TouchableOpacity>)}
      </View>
    </View>
  </ScrollView>;
}
