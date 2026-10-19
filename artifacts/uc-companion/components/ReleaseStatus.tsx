import React from 'react';
import { View, Text, TouchableOpacity, Platform, Linking } from 'react-native';
import Constants from 'expo-constants';
import { useQuery, onlineManager } from '@tanstack/react-query';
import { getApiBase } from '@/lib/apiBase';
import { compareRelease, type LoadedRelease, type ReleaseMetadata } from '@/lib/releasePolicy';
import { useColors } from '@/hooks/useColors';

export default function ReleaseStatus() {
  const colors = useColors();
  const [now, setNow] = React.useState(Date.now());
  const [online, setOnline] = React.useState(onlineManager.isOnline());
  React.useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 10_000);
    const stop = onlineManager.subscribe(setOnline);
    return () => { clearInterval(timer); stop(); };
  }, []);
  const loaded: LoadedRelease = {
    delivery: Platform.OS === 'web' ? 'web' : Constants.executionEnvironment === 'storeClient' ? 'expo-go' : 'standalone',
    buildId: process.env.EXPO_PUBLIC_COMPANION_BUILD_ID || Constants.expoConfig?.extra?.companionRelease || 'development',
    platform: Platform.OS,
    runtime: typeof Constants.expoConfig?.runtimeVersion === 'string' ? Constants.expoConfig.runtimeVersion : Constants.expoConfig?.version || 'unknown',
    version: Constants.expoConfig?.version || 'unknown',
  };
  const origin = Platform.OS === 'web'
    ? `${window.location.origin}${process.env.EXPO_PUBLIC_BASE_PATH || ''}`
    : `https://${process.env.EXPO_PUBLIC_DOMAIN || ''}`;
  const query = useQuery({
    queryKey: ['companion-supported-release', origin],
    queryFn: async ({ signal }) => {
      const controller = new AbortController();
      const abort = () => controller.abort();
      signal.addEventListener('abort', abort, { once: true });
      const timer = setTimeout(abort, 10_000);
      try {
        const response = await fetch(`${origin.replace(/\/$/, '')}/version.json`, { cache: 'no-store', signal: controller.signal });
        if (!response.ok) throw new Error('Release metadata unavailable');
        return await response.json() as ReleaseMetadata;
      } finally { clearTimeout(timer); signal.removeEventListener('abort', abort); }
    },
    staleTime: 60_000, refetchInterval: 300_000, retry: 1,
    refetchOnWindowFocus: 'always', refetchOnReconnect: 'always',
  });
  const comparison = compareRelease(loaded,
    query.isError || !online || now - query.dataUpdatedAt >= 300_000 ? undefined : query.data, getApiBase(),
    `https://${process.env.EXPO_PUBLIC_DOMAIN || ''}`);
  const [actionError, setActionError] = React.useState('');
  return <View testID="companion-release-status" style={{ gap: 6, padding: 12 }}>
    <Text selectable style={{ fontSize: 12, color: colors.mutedForeground }}>
      Loaded release: {loaded.buildId} · {loaded.delivery} · {loaded.platform} · {loaded.version} · runtime {loaded.runtime}
    </Text>
    {comparison.status === 'unknown' && <Text style={{ fontSize: 12, color: colors.mutedForeground }}>
      Supported release could not be verified. You can continue using the app; this does not confirm it is up to date.
    </Text>}
    {comparison.status === 'different' && <View style={{ gap: 6 }}>
      <Text style={{ color: colors.text }}>
        {loaded.delivery === 'web' ? 'A different supported browser release is available. Finish checkout and save any work before refreshing.'
          : loaded.delivery === 'expo-go' ? 'A different Expo Go release is available. Finish your work, then close and reopen this project from its approved launch link.'
            : 'An approved installed-app release is available. A website publish does not update your installed app. Finish your work before updating.'}
      </Text>
      {loaded.delivery === 'web' && <TouchableOpacity accessibilityRole="button" onPress={() => {
        if (window.confirm('Have you finished checkout and saved your work? Refreshing reloads this page.')) window.location.reload();
      }} style={{ minHeight: 44, justifyContent: 'center' }}>
        <Text style={{ color: colors.primary }}>Refresh when ready</Text>
      </TouchableOpacity>}
      {!!comparison.updateUrl && <TouchableOpacity accessibilityRole="button" onPress={() => {
        void Linking.openURL(comparison.updateUrl!).catch(() => setActionError('Could not open the approved store. Try again.'));
      }} style={{ minHeight: 44, justifyContent: 'center' }}>
        <Text style={{ color: colors.primary }}>Open approved app store</Text>
      </TouchableOpacity>}
      {!!comparison.reopenUrl && <TouchableOpacity accessibilityRole="button" onPress={() => {
        void Linking.openURL(comparison.reopenUrl!).catch(() => setActionError('Could not reopen the approved Expo Go project. Close and reopen it from your original launch link.'));
      }} style={{ minHeight: 44, justifyContent: 'center' }}>
        <Text style={{ color: colors.primary }}>Reopen Expo Go project when ready</Text>
      </TouchableOpacity>}
    </View>}
    {!!actionError && <Text accessibilityRole="alert" style={{ color: colors.text }}>{actionError}</Text>}
    {comparison.status === 'supported' && <Text style={{ fontSize: 12, color: colors.mutedForeground }}>Matches the selected supported release.</Text>}
    {comparison.status === 'unknown' && <TouchableOpacity accessibilityRole="button" disabled={query.isFetching} onPress={() => query.refetch()}
      style={{ minHeight: 44, justifyContent: 'center' }}>
      <Text style={{ color: colors.primary }}>{query.isFetching ? 'Checking release…' : 'Retry release check'}</Text>
    </TouchableOpacity>}
  </View>;
}
