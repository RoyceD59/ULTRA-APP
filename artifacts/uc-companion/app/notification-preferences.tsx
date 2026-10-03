import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
   View, Text, StyleSheet, ScrollView, Switch, Platform, TouchableOpacity, TextInput, Linking,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useColors } from '@/hooks/useColors';
import { useAuth } from '@/context/AuthContext';
import { useApi, type ServerNotifPrefs } from '@/hooks/useApi';
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
import { getHydrationReminderPrefs, saveHydrationReminderPrefs, reconcileHydrationReminder, type HydrationReminderPrefs } from '@/lib/hydrationReminder';
import { requestNotificationPermission, ensureAndroidChannel } from '@/hooks/useNotifications';
import { validReminderTime } from '@/lib/hydration';

export default function NotificationPreferencesScreen() {
  const colors = useColors();
  const router = useRouter();
  const { token, user } = useAuth();
  const api = useApi();

  const [prefs, setPrefs] = useState<NotifPrefs>({ orderUpdates: true, filterReminders: true });
  const [saving, setSaving] = useState(false);
  const [hydrationPrefs, setHydrationPrefs] = useState<HydrationReminderPrefs>({ enabled: false, time: '20:00' });
  const [hydrationTime, setHydrationTime] = useState('20:00');
  const [hydrationMessage, setHydrationMessage] = useState('');
  const activeUserRef = useRef(user?.id);
  activeUserRef.current = user?.id;
  useEffect(() => {
    setHydrationPrefs({ enabled: false, time: '20:00' }); setHydrationTime('20:00'); setHydrationMessage(''); setSaving(false);
    let active = true;
    if (user) void getHydrationReminderPrefs(user.id).then(value => {
      if (active) { setHydrationPrefs(value); setHydrationTime(value.time); }
    }).catch(() => { if (active) setHydrationMessage('Could not load reminder preferences.'); });
    return () => { active = false; };
  }, [user?.id]);
  const saveHydration = async (enabled: boolean, timeOnly = false) => {
    if (!user) return;
    if ((enabled || timeOnly) && !validReminderTime(hydrationTime)) { setHydrationMessage('Enter a local time in 24-hour HH:MM format, such as 20:00.'); return; }
    setSaving(true); setHydrationMessage('');
    const owner = user.id;
    try {
      if (Platform.OS !== 'web') await ensureAndroidChannel();
      if (enabled && Platform.OS !== 'web' && !await requestNotificationPermission()) {
        if (activeUserRef.current === owner) setHydrationMessage('Notification permission was denied. You can still log water; enable notifications in device Settings to use reminders.');
        return;
      }
      if (activeUserRef.current !== owner) return;
      const next = { enabled, time: validReminderTime(hydrationTime) ? hydrationTime : hydrationPrefs.time };
      await saveHydrationReminderPrefs(user.id, next);
      if (activeUserRef.current !== owner) return;
      setHydrationPrefs(next);
      const status = await reconcileHydrationReminder(user.id);
      if (activeUserRef.current !== owner) return;
      setHydrationMessage(status === 'denied' ? 'Reminders are blocked by device Settings. Logging remains available.' :
        status === 'web' ? 'Saved for in-app prompts. Background hydration reminders require the mobile app.' :
          enabled ? `One daily reminder scheduled at ${next.time}, local time.` : 'Daily hydration reminder disabled.');
    } catch {
      if (activeUserRef.current === owner) setHydrationMessage('Could not schedule the reminder. Please retry.');
    } finally { if (activeUserRef.current === owner) setSaving(false); }
  };
  // Server-side channel opt-ins (email / SMS / WhatsApp filter reminders).
  // null while loading or when signed out.
  const [channelPrefs, setChannelPrefs] = useState<ServerNotifPrefs | null>(null);

  useEffect(() => {
    getNotifPrefs().then(setPrefs);
  }, []);

  const [channelError, setChannelError] = useState(false);

  const loadChannelPrefs = useCallback(() => {
    setChannelError(false);
    api.getServerNotifPrefs()
      .then(p => setChannelPrefs(p))
      .catch(() => setChannelError(true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!token) {
      setChannelPrefs(null);
      setChannelError(false);
      return;
    }
    loadChannelPrefs();
    // Backfill: make sure the server knows about the current activation so
    // channel reminders can actually be delivered for filters registered
    // before this feature existed.
    if (user) getFilterActivation(user.id).then(a => { if (a) void syncReminderToServer(a); });
  }, [token, loadChannelPrefs]);

  const handleChannelToggle = useCallback(async (
    key: 'reminderEmail' | 'reminderSms' | 'reminderWhatsapp',
    value: boolean,
  ) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setChannelPrefs(p => (p ? { ...p, [key]: value } : p));
    setSaving(true);
    try {
      await api.updatePushPrefs({ [key]: value });
    } catch {
      // Revert on failure so the switch reflects what the server actually has.
      setChannelPrefs(p => (p ? { ...p, [key]: !value } : p));
    } finally {
      setSaving(false);
    }
  }, [api]);

  const handleToggle = useCallback(async (key: keyof NotifPrefs, value: boolean) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const updated: NotifPrefs = { ...prefs, [key]: value };
    setPrefs(updated);
    setSaving(true);

    try {
      // Persist client-side preference
      await saveNotifPrefs(updated);

      if (key === 'filterReminders' && user) {
        if (!value) {
          // Cancel all scheduled local filter notifications
          await cancelAllFilterNotifications(user.id);
        } else {
          // Reschedule if there's an active filter
          const activation = await getFilterActivation(user.id);
          if (activation) {
            await scheduleAllFilterNotifications(activation, user.id);
          }
        }
      }

      if (key === 'orderUpdates' && token) {
        // Sync opt-out to server so server-side pushes also respect the pref
        await api.updatePushPrefs({ optOutOrders: !value }).catch(() => {});
      }
    } finally {
      setSaving(false);
    }
  }, [prefs, token, api]);

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
          <PrefRow
            icon="bag-outline"
            iconColor={colors.primary}
            iconBg={colors.primaryLight}
            title="Order updates"
            description="Confirmation and status updates when you place an order"
            value={prefs.orderUpdates}
            onToggle={v => handleToggle('orderUpdates', v)}
            disabled={saving}
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
            disabled={saving || Platform.OS === 'web'}
            colors={colors}
            webNote={Platform.OS === 'web' ? 'Local notifications are only available in the mobile app' : undefined}
          />
        </View>

        {/* Filter reminders by message — strictly opt-in channels */}
        <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>DAILY HYDRATION</Text>
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <PrefRow icon="water-outline" iconColor={colors.primary} iconBg={colors.primaryLight}
            title="Daily filtered-water reminder"
            description={Platform.OS === 'web' ? 'Daily in-app prompt. Background hydration reminders require the mobile app.' : 'One daily local reminder to record your total. Off until you choose to enable it.'}
            value={hydrationPrefs.enabled} onToggle={saveHydration} disabled={saving || !user || Platform.OS === 'web'} colors={colors}
            webNote={Platform.OS === 'web' ? 'Daily in-app prompts appear on Home. Background hydration reminders require the mobile app.' : undefined} />
          <View style={{ padding: 16, gap: 10 }}>
            <Text style={{ color: colors.text }}>Local reminder time (24-hour HH:MM)</Text>
            <TextInput accessibilityLabel="Hydration reminder local time" value={hydrationTime} onChangeText={setHydrationTime}
              editable={Platform.OS !== 'web' && !!user}
              placeholder="20:00" placeholderTextColor={colors.mutedForeground} maxLength={5}
              style={{ borderWidth: 1, borderColor: colors.border, color: colors.text, padding: 12, borderRadius: 8 }} />
            <TouchableOpacity accessibilityRole="button" disabled={saving || !user || Platform.OS === 'web'} onPress={() => saveHydration(hydrationPrefs.enabled, true)}>
              <Text style={{ color: colors.primary }}>Save reminder time</Text>
            </TouchableOpacity>
            {!user && <Text style={{ color: colors.mutedForeground }}>Sign in to configure a hydration reminder.</Text>}
            {!!hydrationMessage && <Text accessibilityLiveRegion="polite" style={{ color: colors.text }}>{hydrationMessage}</Text>}
            {Platform.OS !== 'web' && <TouchableOpacity accessibilityRole="button" onPress={() => Linking.openSettings().catch(() => setHydrationMessage('Open your device’s notification settings manually.'))}>
              <Text style={{ color: colors.primary }}>Open device notification settings</Text>
            </TouchableOpacity>}
          </View>
        </View>
        <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>
          FILTER REMINDERS BY MESSAGE
        </Text>
        {token && channelPrefs ? (
          <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <PrefRow
              icon="mail-outline"
              iconColor="#2563eb"
              iconBg="#dbeafe"
              title="Email reminders"
              description="Filter check-ins and replacement offers to your account email"
              value={channelPrefs.reminderEmail}
              onToggle={v => handleChannelToggle('reminderEmail', v)}
              disabled={saving}
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
              disabled={saving}
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
              disabled={saving}
              colors={colors}
            />
          </View>
        ) : token && channelError ? (
          <TouchableOpacity
            style={[styles.infoBox, { backgroundColor: colors.surface, borderColor: colors.border }]}
            onPress={loadChannelPrefs}
            accessibilityRole="button"
          >
            <Ionicons name="refresh-outline" size={16} color={colors.mutedForeground} />
            <Text style={[styles.infoText, { color: colors.mutedForeground }]}>
              Couldn't load your message preferences. Tap to retry.
            </Text>
          </TouchableOpacity>
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
  headerTitle: { fontSize: 17, fontWeight: '700' as const },
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
