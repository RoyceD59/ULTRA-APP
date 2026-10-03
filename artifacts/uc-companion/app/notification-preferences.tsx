import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
   View, Text, StyleSheet, ScrollView, Switch, Platform, TouchableOpacity, Linking,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useColors } from '@/hooks/useColors';
import { useAuth } from '@/context/AuthContext';
import { useApi } from '@/hooks/useApi';
import {
  getNotifPrefs,
  saveNotifPrefs,
  cancelAllFilterNotifications,
  scheduleAllFilterNotifications,
  getFilterActivation,
  syncReminderToServer,
  type NotifPrefs,
} from '@/hooks/useNotifications';
import * as Haptics from 'expo-haptics';
import { HYDRATION_INTERVALS, getHydrationReminderPrefs, saveHydrationReminderPrefs, reconcileHydrationReminder, type HydrationInterval } from '@/lib/hydrationReminder';
import { requestNotificationPermission, ensureAndroidChannel } from '@/hooks/useNotifications';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import PageDataLoader from '@/components/PageDataLoader';
import PageDataError from '@/components/PageDataError';
import DailyWaterCard from '@/components/DailyWaterCard';
import { notificationPreferenceKeys, preferenceReadBlocked } from '@/lib/notificationPreferenceState';

export default function NotificationPreferencesScreen() {
  const colors = useColors();
  const router = useRouter();
  const { token, user } = useAuth();
  const api = useApi();
  const client = useQueryClient();
  const prefsKey = notificationPreferenceKeys.device(user?.id);
  const hydrationPrefsKey = notificationPreferenceKeys.hydration(user?.id);
  const channelPrefsKey = notificationPreferenceKeys.channels(user?.id);
  const localRead = useQuery({ queryKey: prefsKey, queryFn: () => getNotifPrefs(true), retry: false, staleTime: 0 });
  const hydrationRead = useQuery({
    queryKey: hydrationPrefsKey, queryFn: () => getHydrationReminderPrefs(user!.id, true),
    enabled: !!user, retry: false, staleTime: 0,
  });
  const channelRead = useQuery({
    queryKey: channelPrefsKey, queryFn: () => api.getServerNotifPrefs(),
    enabled: !!token && !!user, retry: false, staleTime: 0,
  });
  const prefs = localRead.data;
  const hydrationPrefs = hydrationRead.data;
  const channelPrefs = channelRead.data;
  const localBlocked = preferenceReadBlocked(prefs, localRead.isError, localRead.isFetching);
  const hydrationBlocked = preferenceReadBlocked(hydrationPrefs, hydrationRead.isError, hydrationRead.isFetching);
  const channelBlocked = preferenceReadBlocked(channelPrefs, channelRead.isError, channelRead.isFetching);
  const [saving, setSaving] = useState(false);
  const [draftInterval, setDraftInterval] = useState<{ owner: number; interval: HydrationInterval } | null>(null);
  const hydrationInterval = draftInterval?.owner === user?.id ? draftInterval?.interval : hydrationPrefs?.intervalHours;
  const [hydrationMessage, setHydrationMessage] = useState('');
  const [saveMessage, setSaveMessage] = useState('');
  const activeUserRef = useRef(user?.id);
  activeUserRef.current = user?.id;
  const activeTokenRef = useRef(token);
  activeTokenRef.current = token;
  useEffect(() => {
    setDraftInterval(null); setHydrationMessage(''); setSaveMessage(''); setSaving(false);
  }, [user?.id, token]);
  const saveHydration = async (enabled: boolean) => {
    if (!user || !hydrationPrefs || !hydrationInterval || saving || hydrationBlocked) return;
    setSaving(true); setHydrationMessage('');
    const owner = user.id;
    const session = token;
    const current = () => activeUserRef.current === owner && activeTokenRef.current === session;
    try {
      if (Platform.OS !== 'web') await ensureAndroidChannel();
      if (enabled && Platform.OS !== 'web' && !await requestNotificationPermission()) {
        if (current()) setHydrationMessage('Notification permission was denied. You can still log water; enable notifications in device Settings to use reminders.');
        return;
      }
      if (!current()) return;
      const next = { enabled, intervalHours: hydrationInterval };
      await saveHydrationReminderPrefs(user.id, next);
      if (!current()) return;
      client.setQueryData(hydrationPrefsKey, next);
      const status = await reconcileHydrationReminder(user.id);
      if (!current()) return;
      setHydrationMessage(status === 'denied' ? 'Reminders are blocked by device Settings. Logging remains available.' :
        status === 'web' ? 'Saved for in-app prompts. Background hydration reminders require the mobile app.' :
          enabled ? `Reminders scheduled every ${next.intervalHours} hours, starting at 5 am with none after 8 pm local time.` : 'Hydration reminders disabled.');
    } catch {
      if (current()) setHydrationMessage('Could not schedule the reminder. Please retry.');
    } finally { if (current()) setSaving(false); }
  };
  useEffect(() => {
    if (!token || !user) return;
    // Backfill: make sure the server knows about the current activation so
    // channel reminders can actually be delivered for filters registered
    // before this feature existed.
    const owner = user.id;
    getFilterActivation(owner).then(a => {
      if (a && activeUserRef.current === owner) void syncReminderToServer(a).catch(() => {});
    }).catch(() => {});
  }, [token, user?.id]);

  const handleChannelToggle = useCallback(async (
    key: 'reminderEmail' | 'reminderSms' | 'reminderWhatsapp',
    value: boolean,
  ) => {
    if (!channelPrefs || saving || channelBlocked) return;
    const owner = user?.id;
    const session = token;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    client.setQueryData(channelPrefsKey, { ...channelPrefs, [key]: value });
    setSaving(true);
    setSaveMessage('');
    try {
      await api.updatePushPrefs({ [key]: value });
    } catch {
      // Revert on failure so the switch reflects what the server actually has.
      client.setQueryData(channelPrefsKey, channelPrefs);
      if (activeUserRef.current === owner && activeTokenRef.current === session) setSaveMessage('Your message preference was not saved. Please try the switch again.');
    } finally {
      if (activeUserRef.current === owner && activeTokenRef.current === session) setSaving(false);
    }
  }, [api, channelPrefs, saving, channelBlocked, token, user?.id, client, channelPrefsKey]);

  const handleToggle = useCallback(async (key: keyof NotifPrefs, value: boolean) => {
    if (!prefs || saving || localBlocked) return;
    const owner = user?.id;
    const session = token;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const updated: NotifPrefs = { ...prefs, [key]: value };
    setSaving(true);
    setSaveMessage('');
    try {
      // Persist client-side preference
      await saveNotifPrefs(updated);
      client.setQueryData(prefsKey, updated);
      if (activeUserRef.current !== owner || activeTokenRef.current !== session) return;
      if (key === 'filterReminders' && user) {
        if (!value) {
          // Cancel all scheduled local filter notifications
          await cancelAllFilterNotifications(user.id);
        } else {
          // Reschedule if there's an active filter
          const activation = await getFilterActivation(user.id);
          if (activation && activeUserRef.current === owner && activeTokenRef.current === session) {
            await scheduleAllFilterNotifications(activation, user.id);
          }
        }
      }

      if (key === 'orderUpdates' && token && activeUserRef.current === owner && activeTokenRef.current === session) {
        // Sync opt-out to server so server-side pushes also respect the pref
        await api.updatePushPrefs({ optOutOrders: !value }).catch(() => {});
      }
    } catch {
      if (activeUserRef.current === owner && activeTokenRef.current === session) setSaveMessage('The preference could not be fully saved. Please try again.');
    } finally {
      if (activeUserRef.current === owner && activeTokenRef.current === session) setSaving(false);
    }
  }, [prefs, token, api, user, saving, localBlocked, client, prefsKey]);

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      {/* Header */}
      <View style={[styles.header, { borderColor: colors.border, backgroundColor: colors.background }]}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Ionicons name="arrow-back" size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.text }]}>Notification Preferences</Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <Text style={[styles.intro, { color: colors.mutedForeground }]}>
          Choose which notifications you receive. You can change these at any time.
        </Text>

        {/* Toggle card */}
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          {!prefs ? localRead.isError ? (
            <PageDataError title="Notification preferences unavailable" error={localRead.error} onRetry={localRead.refetch} />
          ) : <PageDataLoader label="Loading notification preferences…" /> : <>
          {localRead.isError ? <PageDataError title="Notification preferences could not refresh" error={localRead.error} onRetry={localRead.refetch} /> : null}
          <PrefRow
            icon="bag-outline"
            iconColor={colors.primary}
            iconBg={colors.primaryLight}
            title="Order updates"
            description="Confirmation and status updates when you place an order"
            value={prefs.orderUpdates}
            onToggle={v => handleToggle('orderUpdates', v)}
            disabled={saving || localBlocked}
            colors={colors}
          />

          <View style={[styles.divider, { backgroundColor: colors.border }]} />

          <PrefRow
            icon="water-outline"
            iconColor="#00B4D8"
            iconBg="#E0F7FC"
            title="Filter replacement reminders"
            description="App notifications at 30 days, 60 days, and before your filter expires (email, SMS and WhatsApp are controlled below)"
            value={prefs.filterReminders}
            onToggle={v => handleToggle('filterReminders', v)}
            disabled={saving || localBlocked || Platform.OS === 'web'}
            colors={colors}
            webNote={Platform.OS === 'web' ? 'Local notifications are only available in the mobile app' : undefined}
          />
          </>}
          <View style={[styles.divider, { backgroundColor: colors.border }]} />
          <DailyWaterCard />
        </View>
        {!!saveMessage && <Text accessibilityLiveRegion="polite" style={{ color: colors.text }}>{saveMessage}</Text>}

        {/* Filter reminders by message — strictly opt-in channels */}
        <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>HYDRATION REMINDERS</Text>
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          {!user ? <TouchableOpacity accessibilityRole="button" onPress={() => router.push('/auth/login')}>
            <Text style={{ color: colors.primary, padding: 16 }}>Sign in to configure a hydration reminder.</Text>
          </TouchableOpacity> : !hydrationPrefs ? hydrationRead.isError ? (
            <PageDataError title="Hydration reminder preferences unavailable" error={hydrationRead.error} onRetry={hydrationRead.refetch} />
          ) : <PageDataLoader label="Loading hydration reminder preferences…" /> : <>
          {hydrationRead.isError ? <PageDataError title="Hydration reminder preferences could not refresh" error={hydrationRead.error} onRetry={hydrationRead.refetch} /> : null}
          <PrefRow icon="water-outline" iconColor={colors.primary} iconBg={colors.primaryLight}
            title="Filtered-water reminders"
            description={Platform.OS === 'web' ? 'Daily in-app prompt. Background hydration reminders require the mobile app.' : 'Every 2, 3, or 4 hours from 5 am to 8 pm, local time. Off until you enable them.'}
            value={hydrationPrefs.enabled} onToggle={saveHydration} disabled={saving || hydrationBlocked || Platform.OS === 'web'} colors={colors}
            webNote={Platform.OS === 'web' ? 'Daily in-app prompts appear above. Background hydration reminders require the mobile app.' : undefined} />
          <View style={{ padding: 16, gap: 10 }}>
            <Text style={{ color: colors.text }}>Reminder frequency</Text>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              {HYDRATION_INTERVALS.map(interval => (
                <TouchableOpacity key={interval} accessibilityRole="radio"
                  accessibilityState={{ checked: hydrationInterval === interval, disabled: saving || hydrationBlocked || Platform.OS === 'web' }}
                  disabled={saving || hydrationBlocked || Platform.OS === 'web'} onPress={() => setDraftInterval({ owner: user.id, interval })}
                  style={{ flex: 1, padding: 12, alignItems: 'center', borderRadius: 8, borderWidth: 1,
                    borderColor: hydrationInterval === interval ? colors.primary : colors.border,
                    backgroundColor: hydrationInterval === interval ? colors.primaryLight : colors.card }}>
                  <Text style={{ color: colors.text }}>Every {interval} hrs</Text>
                </TouchableOpacity>
              ))}
            </View>
            <Text style={{ color: colors.mutedForeground }}>Starts at 5 am, with no reminders after 8 pm local time.</Text>
            <TouchableOpacity accessibilityRole="button" disabled={saving || hydrationBlocked || Platform.OS === 'web'} onPress={() => saveHydration(hydrationPrefs.enabled)}>
              <Text style={{ color: colors.primary }}>Save reminder frequency</Text>
            </TouchableOpacity>
            {!user && <Text style={{ color: colors.mutedForeground }}>Sign in to configure a hydration reminder.</Text>}
            {!!hydrationMessage && <Text accessibilityLiveRegion="polite" style={{ color: colors.text }}>{hydrationMessage}</Text>}
            {Platform.OS !== 'web' && <TouchableOpacity accessibilityRole="button" onPress={() => Linking.openSettings().catch(() => setHydrationMessage('Open your device’s notification settings manually.'))}>
              <Text style={{ color: colors.primary }}>Open device notification settings</Text>
            </TouchableOpacity>}
          </View>
          </>}
        </View>
        <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>
          FILTER REMINDERS BY MESSAGE
        </Text>
        {token && channelPrefs ? (
          <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
            {channelRead.isError ? <PageDataError title="Message preferences could not refresh" error={channelRead.error} onRetry={channelRead.refetch} /> : null}
            <PrefRow
              icon="mail-outline"
              iconColor="#2563eb"
              iconBg="#dbeafe"
              title="Email reminders"
              description="Filter check-ins and replacement offers to your account email"
              value={channelPrefs.reminderEmail}
              onToggle={v => handleChannelToggle('reminderEmail', v)}
              disabled={saving || channelBlocked}
              colors={colors}
            />
            <View style={[styles.divider, { backgroundColor: colors.border }]} />
            <PrefRow
              icon="chatbubble-outline"
              iconColor="#7c3aed"
              iconBg="#ede9fe"
              title="Text message (SMS) reminders"
              description="Short reminders to your account phone number"
              value={channelPrefs.reminderSms}
              onToggle={v => handleChannelToggle('reminderSms', v)}
              disabled={saving || channelBlocked}
              colors={colors}
            />
            <View style={[styles.divider, { backgroundColor: colors.border }]} />
            <PrefRow
              icon="logo-whatsapp"
              iconColor="#16a34a"
              iconBg="#dcfce7"
              title="WhatsApp reminders"
              description="Reminders via WhatsApp to your account phone number"
              value={channelPrefs.reminderWhatsapp}
              onToggle={v => handleChannelToggle('reminderWhatsapp', v)}
              disabled={saving || channelBlocked}
              colors={colors}
            />
          </View>
        ) : token && channelRead.isError ? (
          <PageDataError title="Message preferences unavailable" error={channelRead.error} onRetry={channelRead.refetch} />
        ) : token ? (
          <PageDataLoader label="Loading message preferences…" />
        ) : (
          <View style={[styles.infoBox, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Ionicons name="lock-closed-outline" size={16} color={colors.mutedForeground} />
            <Text style={[styles.infoText, { color: colors.mutedForeground }]}>
              {token
                ? 'Loading your message preferences…'
                : 'Sign in to also receive filter reminders by email, text message or WhatsApp.'}
            </Text>
          </View>
        )}

        {/* Info box */}
        <View style={[styles.infoBox, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Ionicons name="information-circle-outline" size={16} color={colors.mutedForeground} />
          <Text style={[styles.infoText, { color: colors.mutedForeground }]}>
            Turning off a category stops future notifications of that type. You can re-enable at any time — filter reminders will be rescheduled automatically.
          </Text>
        </View>

        {/* System settings note */}
        <Text style={[styles.systemNote, { color: colors.mutedForeground }]}>
          To disable all notifications from Ultra Clear, use your device's Settings → Notifications.
        </Text>
      </ScrollView>
    </View>
  );
}

function PrefRow({
  icon, iconColor, iconBg, title, description, value, onToggle, disabled, colors, webNote,
}: {
  icon: string;
  iconColor: string;
  iconBg: string;
  title: string;
  description: string;
  value: boolean;
  onToggle: (v: boolean) => void;
  disabled?: boolean;
  colors: ReturnType<typeof import('@/hooks/useColors').useColors>;
  webNote?: string;
}) {
  return (
    <View style={styles.prefRow}>
      <View style={[styles.prefIcon, { backgroundColor: iconBg }]}>
        <Ionicons name={icon as never} size={20} color={iconColor} />
      </View>
      <View style={styles.prefText}>
        <Text style={[styles.prefTitle, { color: colors.text }]}>{title}</Text>
        <Text style={[styles.prefDesc, { color: colors.mutedForeground }]}>
          {webNote ?? description}
        </Text>
      </View>
      <Switch
        accessibilityLabel={title}
        value={disabled && webNote ? false : value}
        onValueChange={onToggle}
        disabled={disabled}
        trackColor={{ false: colors.border, true: colors.primary }}
        thumbColor={Platform.OS === 'android' ? (value ? '#fff' : '#f4f3f4') : undefined}
        ios_backgroundColor={colors.border}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingTop: Platform.OS === 'ios' ? 56 : 16, paddingBottom: 14,
    borderBottomWidth: 1,
  },
  headerTitle: { fontSize: 17, fontWeight: '700' as const, flex: 1, textAlign: 'center' },
  scroll: { padding: 20, gap: 16, paddingBottom: 48 },
  intro: { fontSize: 14, lineHeight: 20 },
  sectionLabel: { fontSize: 12, fontWeight: '600' as const, letterSpacing: 0.6, marginBottom: -6 },
  card: { borderRadius: 14, borderWidth: 1, overflow: 'hidden' },
  prefRow: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 16 },
  prefIcon: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  prefText: { flex: 1, gap: 2 },
  prefTitle: { fontSize: 15, fontWeight: '600' as const },
  prefDesc: { fontSize: 13, lineHeight: 18 },
  divider: { height: 1, marginHorizontal: 16 },
  infoBox: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 10,
    borderWidth: 1, borderRadius: 12, padding: 14,
  },
  infoText: { flex: 1, fontSize: 13, lineHeight: 18 },
  systemNote: { fontSize: 12, lineHeight: 17, textAlign: 'center', paddingHorizontal: 8 },
});
