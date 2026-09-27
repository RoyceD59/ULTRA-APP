/**
 * ReminderOptInSheet
 *
 * A bottom sheet shown once after a customer successfully registers a filter,
 * inviting them to enable email / SMS / WhatsApp reminder channels.
 *
 * Behaviour:
 *   • Toggles are pre-filled from the server's current prefs; if the fetch
 *     fails all three default to OFF so the sheet is still usable.
 *   • Tapping "Enable Reminders" POSTs only the channels the user switched on.
 *   • "Skip for now" and the × dismiss without any network call.
 *   • The sheet is never shown again for the same registration
 *     (dismissal flag stored in AsyncStorage, keyed by productId+activatedAt).
 *   • Signed-out callers must not render this component.
 */
import React, { useState, useCallback, useEffect } from 'react';
import {
  Modal, View, Text, StyleSheet, TouchableOpacity,
  Switch, Platform, ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useColors } from '@/hooks/useColors';
import { useApi } from '@/hooks/useApi';
import {
  reminderOptInSeenKey,
  wasReminderOptInSeen,
  markReminderOptInSeen,
} from '@/hooks/reminderOptInStorage';
import { applyReminderPreFill, type ChannelState } from '@/hooks/reminderPreFill';

// Re-export so callers that imported these from this module continue to work.
export { reminderOptInSeenKey, wasReminderOptInSeen, markReminderOptInSeen };

// ── Component ─────────────────────────────────────────────────────────────────

interface Props {
  visible: boolean;
  /** Notification key — used to mark the prompt as seen after close. */
  productId: number;
  activatedAt: string;
  /** User account id — scopes the seen-flag so two accounts on the same device don't share state. */
  userId: number;
  onClose: () => void;
}

export default function ReminderOptInSheet({
  visible, productId, activatedAt, userId, onClose,
}: Props) {
  const colors = useColors();
  const api = useApi();

  const [channels, setChannels] = useState<ChannelState>({
    reminderEmail: false,
    reminderSms: false,
    reminderWhatsapp: false,
  });
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Pre-fill toggles with the customer's existing channel preferences each time
  // the sheet becomes visible. Falls back to all-OFF if the fetch fails.
  // The async logic lives in applyReminderPreFill (hooks/reminderPreFill.ts)
  // so it can be unit-tested without a React rendering harness.
  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    setError('');
    void applyReminderPreFill(
      () => api.getServerNotifPrefs(),
      setLoading,
      setChannels,
      () => cancelled,
    );
    return () => { cancelled = true; };
  }, [visible]); // eslint-disable-line react-hooks/exhaustive-deps

  const anyEnabled =
    channels.reminderEmail || channels.reminderSms || channels.reminderWhatsapp;

  const toggle = useCallback(
    (key: keyof ChannelState, value: boolean) => {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      setChannels(c => ({ ...c, [key]: value }));
    },
    [],
  );

  async function handleEnable() {
    setSaving(true);
    setError('');
    try {
      await api.updatePushPrefs({
        reminderEmail:     channels.reminderEmail,
        reminderSms:       channels.reminderSms,
        reminderWhatsapp:  channels.reminderWhatsapp,
      });
      await markReminderOptInSeen(productId, activatedAt, userId);
      onClose();
    } catch {
      setError('Could not save your preferences. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  async function handleSkip() {
    await markReminderOptInSeen(productId, activatedAt, userId);
    onClose();
  }

  // Reset toggles each time the sheet opens so repeat views start clean.
  const handleRequestClose = () => { void handleSkip(); };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={handleRequestClose}
    >
      <View style={styles.overlay}>
        <View style={[styles.sheet, { backgroundColor: colors.background }]}>
          {/* Handle */}
          <View style={[styles.handle, { backgroundColor: colors.border }]} />

          {/* Header */}
          <View style={styles.header}>
            <View style={[styles.iconWrap, { backgroundColor: colors.primaryLight }]}>
              <Ionicons name="notifications-outline" size={22} color={colors.primary} />
            </View>
            <TouchableOpacity
              onPress={handleSkip}
              style={styles.closeBtn}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              accessibilityLabel="Skip reminder opt-in"
            >
              <Ionicons name="close" size={22} color={colors.mutedForeground} />
            </TouchableOpacity>
          </View>

          {/* Title + description */}
          <View style={styles.body}>
            <Text style={[styles.title, { color: colors.text }]}>
              Get reminders by message too?
            </Text>
            <Text style={[styles.desc, { color: colors.mutedForeground }]}>
              App notifications are now scheduled. Would you also like filter replacement reminders by email, SMS, or WhatsApp?
            </Text>

            {/* Channel rows */}
            <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
              {loading ? (
                <View style={styles.loadingRow}>
                  <ActivityIndicator size="small" color={colors.primary} />
                </View>
              ) : (
                <>
                  <ChannelRow
                    icon="mail-outline"
                    iconColor="#2563eb"
                    iconBg="#dbeafe"
                    label="Email reminders"
                    value={channels.reminderEmail}
                    onToggle={v => toggle('reminderEmail', v)}
                    disabled={saving}
                    colors={colors}
                  />
                  <View style={[styles.divider, { backgroundColor: colors.border }]} />
                  <ChannelRow
                    icon="chatbubble-outline"
                    iconColor="#7c3aed"
                    iconBg="#ede9fe"
                    label="Text message (SMS)"
                    value={channels.reminderSms}
                    onToggle={v => toggle('reminderSms', v)}
                    disabled={saving}
                    colors={colors}
                  />
                  <View style={[styles.divider, { backgroundColor: colors.border }]} />
                  <ChannelRow
                    icon="logo-whatsapp"
                    iconColor="#16a34a"
                    iconBg="#dcfce7"
                    label="WhatsApp"
                    value={channels.reminderWhatsapp}
                    onToggle={v => toggle('reminderWhatsapp', v)}
                    disabled={saving}
                    colors={colors}
                  />
                </>
              )}
            </View>

            {!!error && (
              <Text style={styles.errorText}>{error}</Text>
            )}

            {/* Enable button — only active when prefs are loaded and something is toggled on */}
            <TouchableOpacity
              onPress={handleEnable}
              disabled={loading || !anyEnabled || saving}
              activeOpacity={0.85}
              style={[
                styles.enableBtn,
                {
                  backgroundColor: colors.primary,
                  opacity: loading || !anyEnabled || saving ? 0.5 : 1,
                },
              ]}
            >
              {saving
                ? <ActivityIndicator color="#fff" size="small" />
                : <Text style={styles.enableBtnTxt}>Enable Reminders</Text>}
            </TouchableOpacity>

            {/* Skip link */}
            <TouchableOpacity onPress={handleSkip} style={styles.skipLink} activeOpacity={0.7}>
              <Text style={[styles.skipTxt, { color: colors.mutedForeground }]}>
                Skip for now
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

// ── Channel row ───────────────────────────────────────────────────────────────

function ChannelRow({
  icon, iconColor, iconBg, label, value, onToggle, disabled, colors,
}: {
  icon: string;
  iconColor: string;
  iconBg: string;
  label: string;
  value: boolean;
  onToggle: (v: boolean) => void;
  disabled?: boolean;
  colors: ReturnType<typeof import('@/hooks/useColors').useColors>;
}) {
  return (
    <View style={styles.channelRow}>
      <View style={[styles.channelIcon, { backgroundColor: iconBg }]}>
        <Ionicons name={icon as never} size={18} color={iconColor} />
      </View>
      <Text style={[styles.channelLabel, { color: colors.text }]}>{label}</Text>
      <Switch
        value={value}
        onValueChange={onToggle}
        disabled={disabled}
        trackColor={{ false: colors.border, true: colors.primary }}
        thumbColor={Platform.OS === 'android' ? (value ? '#fff' : '#f4f3f4') : undefined}
        ios_backgroundColor={colors.border}
      />
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  overlay:      { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  sheet:        {
    borderTopLeftRadius: 24, borderTopRightRadius: 24,
    paddingBottom: Platform.OS === 'ios' ? 34 : 20,
  },
  handle:       { width: 40, height: 4, borderRadius: 2, alignSelf: 'center', marginTop: 10 },
  header:       { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingTop: 16, paddingBottom: 4 },
  iconWrap:     { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', flex: 1, alignSelf: 'flex-start', maxWidth: 44 },
  closeBtn:     { padding: 4 },
  body:         { paddingHorizontal: 20, paddingTop: 12, gap: 14 },
  title:        { fontSize: 18, fontWeight: '700' as const },
  desc:         { fontSize: 14, lineHeight: 20 },
  card:         { borderRadius: 14, borderWidth: 1, overflow: 'hidden' },
  channelRow:   { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 13 },
  channelIcon:  { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  channelLabel: { flex: 1, fontSize: 15, fontWeight: '500' as const },
  divider:      { height: 1, marginHorizontal: 14 },
  loadingRow:   { paddingVertical: 20, alignItems: 'center' },
  errorText:    { fontSize: 13, color: '#EF4444', lineHeight: 18 },
  enableBtn:    { borderRadius: 13, paddingVertical: 15, alignItems: 'center' },
  enableBtnTxt: { color: '#fff', fontSize: 15, fontWeight: '700' as const },
  skipLink:     { alignItems: 'center', paddingBottom: 4 },
  skipTxt:      { fontSize: 14 },
});
