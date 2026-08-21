import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Platform,
  Modal, TextInput, ActivityIndicator, KeyboardAvoidingView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/context/AuthContext';
import { useApi } from '@/hooks/useApi';
import OrderCard from '@/components/OrderCard';
import FilterTrackerSection from '@/components/FilterTrackerSection';
import * as Haptics from 'expo-haptics';
import QRCode from 'react-native-qrcode-svg';
import {
  getNotificationPermissionStatus,
  requestNotificationPermission,
  getFilterActivation,
  type FilterActivation,
} from '@/hooks/useNotifications';
import { useCartBarInset } from '@/hooks/useCartBarInset';
import SwipeTabs from '@/components/SwipeTabs';
import * as Sharing from 'expo-sharing';
import { File, Paths } from 'expo-file-system';
import { buildRewardsQrPayload } from '@/lib/rewardsQr';

const topPad = Platform.OS === 'web' ? 67 : 0;

const MENU_ITEMS = [
  { label: 'My Orders',                icon: 'bag-outline'           as const, route: '/account' },
  { label: 'Refer & Earn',             icon: 'gift-outline'          as const, route: '/referral' },
  { label: 'Maintenance Tickets',      icon: 'construct-outline'     as const, route: '/ticket/new' },
  { label: 'Water Test History',       icon: 'flask-outline'         as const, route: '/water-test' },
  { label: 'Notification Preferences', icon: 'notifications-outline' as const, route: '/notification-preferences' },
  { label: 'Help & Support',           icon: 'help-circle-outline'   as const, route: '/(tabs)/support' },
];

// ── Edit Profile Modal ────────────────────────────────────────────────────────

interface EditProfileForm {
  firstName: string;
  lastName:  string;
  phone:     string;
  address:   string;
}

interface EditProfileModalProps {
  visible:    boolean;
  initial:    EditProfileForm;
  email:      string;
  onClose:    () => void;
  onSaved:    (updated: EditProfileForm) => void;
}

function EditProfileModal({ visible, initial, email, onClose, onSaved }: EditProfileModalProps) {
  const colors  = useColors();
  const api     = useApi();
  const { updateUser } = useAuth();

  const [form,    setForm]    = useState<EditProfileForm>(initial);
  const [saving,  setSaving]  = useState(false);
  const [error,   setError]   = useState('');

  // Reset form when modal opens with new initial values
  useEffect(() => {
    if (visible) { setForm(initial); setError(''); }
  }, [visible, initial]);

  function setField(field: keyof EditProfileForm, value: string) {
    setForm(prev => ({ ...prev, [field]: value }));
    if (error) setError('');
  }

  async function handleSave() {
    if (!form.firstName.trim()) {
      setError('First name is required');
      return;
    }
    if (form.phone.trim() && !/^\+\d{10,15}$/.test(form.phone.replace(/\s/g, ''))) {
      setError('Enter a valid phone number, e.g. +254712345678');
      return;
    }
    if (form.address.trim().length > 500) {
      setError('Address must be 500 characters or fewer');
      return;
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    setSaving(true);
    setError('');
    try {
      await api.updateProfile({
        firstName: form.firstName.trim(),
        lastName:  form.lastName.trim(),
        phone:     form.phone.replace(/\s/g, ''),
        address:   form.address.trim(),
      });
      await updateUser({
        firstName: form.firstName.trim(),
        lastName:  form.lastName.trim(),
        phone:     form.phone.replace(/\s/g, ''),
        address:   form.address.trim(),
      });
      onSaved({
        firstName: form.firstName.trim(),
        lastName:  form.lastName.trim(),
        phone:     form.phone.replace(/\s/g, ''),
        address:   form.address.trim(),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <View style={editStyles.overlay}>
          <View style={[editStyles.sheet, { backgroundColor: colors.background }]}>
            {/* Handle */}
            <View style={[editStyles.handle, { backgroundColor: colors.border }]} />

            {/* Header */}
            <View style={editStyles.header}>
              <Text style={[editStyles.title, { color: colors.text }]}>Edit Profile</Text>
              <TouchableOpacity onPress={onClose} style={editStyles.closeBtn} disabled={saving}>
                <Ionicons name="close" size={22} color={colors.mutedForeground} />
              </TouchableOpacity>
            </View>

            <ScrollView
              contentContainerStyle={editStyles.body}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}>

              {/* Email — read-only */}
              <View style={editStyles.fieldGroup}>
                <Text style={[editStyles.label, { color: colors.mutedForeground }]}>Email (cannot be changed)</Text>
                <View style={[editStyles.inputRow, { backgroundColor: colors.surface, borderColor: colors.border, opacity: 0.6 }]}>
                  <Ionicons name="lock-closed-outline" size={15} color={colors.mutedForeground} />
                  <Text style={[editStyles.readOnly, { color: colors.mutedForeground }]}>{email}</Text>
                </View>
              </View>

              {/* First Name */}
              <View style={editStyles.fieldGroup}>
                <Text style={[editStyles.label, { color: colors.mutedForeground }]}>First Name *</Text>
                <View style={[editStyles.inputRow, { backgroundColor: colors.surface, borderColor: error && !form.firstName.trim() ? colors.destructive : colors.border }]}>
                  <TextInput
                    value={form.firstName}
                    onChangeText={v => setField('firstName', v)}
                    placeholder="First name"
                    placeholderTextColor={colors.mutedForeground}
                    style={[editStyles.input, { color: colors.text }]}
                    autoCapitalize="words"
                    returnKeyType="next"
                    editable={!saving}
                  />
                </View>
              </View>

              {/* Last Name */}
              <View style={editStyles.fieldGroup}>
                <Text style={[editStyles.label, { color: colors.mutedForeground }]}>Last Name</Text>
                <View style={[editStyles.inputRow, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                  <TextInput
                    value={form.lastName}
                    onChangeText={v => setField('lastName', v)}
                    placeholder="Last name"
                    placeholderTextColor={colors.mutedForeground}
                    style={[editStyles.input, { color: colors.text }]}
                    autoCapitalize="words"
                    returnKeyType="next"
                    editable={!saving}
                  />
                </View>
              </View>

              {/* Phone */}
              <View style={editStyles.fieldGroup}>
                <Text style={[editStyles.label, { color: colors.mutedForeground }]}>Phone Number</Text>
                <View style={[editStyles.inputRow, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                  <Ionicons name="call-outline" size={15} color={colors.mutedForeground} />
                  <TextInput
                    value={form.phone}
                    onChangeText={v => setField('phone', v)}
                    placeholder="+254712345678"
                    placeholderTextColor={colors.mutedForeground}
                    style={[editStyles.input, { color: colors.text }]}
                    keyboardType="phone-pad"
                    returnKeyType="next"
                    editable={!saving}
                  />
                </View>
                <Text style={[editStyles.hint, { color: colors.mutedForeground }]}>
                  International format, e.g. +254712345678
                </Text>
              </View>

              {/* Delivery Address */}
              <View style={editStyles.fieldGroup}>
                <Text style={[editStyles.label, { color: colors.mutedForeground }]}>Delivery Address</Text>
                <View style={[editStyles.inputRow, editStyles.inputRowMultiline, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                  <Ionicons name="location-outline" size={15} color={colors.mutedForeground} style={{ marginTop: 2 }} />
                  <TextInput
                    value={form.address}
                    onChangeText={v => setField('address', v)}
                    placeholder="e.g. 14 Riverside Drive, Nairobi"
                    placeholderTextColor={colors.mutedForeground}
                    style={[editStyles.input, editStyles.inputMultiline, { color: colors.text }]}
                    autoCapitalize="words"
                    multiline
                    numberOfLines={3}
                    returnKeyType="done"
                    editable={!saving}
                  />
                </View>
                <Text style={[editStyles.hint, { color: colors.mutedForeground }]}>
                  Used for deliveries and service visits
                </Text>
              </View>

              {/* Error */}
              {!!error && (
                <View style={[editStyles.errorBox, { backgroundColor: colors.destructive + '12', borderColor: colors.destructive + '30' }]}>
                  <Ionicons name="alert-circle-outline" size={15} color={colors.destructive} />
                  <Text style={[editStyles.errorText, { color: colors.destructive }]}>{error}</Text>
                </View>
              )}

              {/* Save button */}
              <TouchableOpacity
                onPress={handleSave}
                disabled={saving}
                activeOpacity={0.85}
                style={[editStyles.saveBtn, { backgroundColor: colors.primary, opacity: saving ? 0.7 : 1 }]}>
                {saving
                  ? <ActivityIndicator color="#fff" size="small" />
                  : <Text style={editStyles.saveBtnText}>Save Changes</Text>}
              </TouchableOpacity>
            </ScrollView>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const editStyles = StyleSheet.create({
  overlay:     { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  sheet:       { borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingBottom: Platform.OS === 'ios' ? 34 : 16, maxHeight: '90%' },
  handle:      { width: 40, height: 4, borderRadius: 2, alignSelf: 'center', marginTop: 10 },
  header:      { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 16 },
  title:       { flex: 1, fontSize: 17, fontWeight: '700' as const },
  closeBtn:    { padding: 4 },
  body:        { paddingHorizontal: 20, paddingBottom: 16, gap: 16 },
  fieldGroup:  { gap: 6 },
  label:       { fontSize: 12, fontWeight: '600' as const, textTransform: 'uppercase', letterSpacing: 0.5 },
  inputRow:          { flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: Platform.OS === 'ios' ? 12 : 10 },
  inputRowMultiline: { alignItems: 'flex-start', paddingVertical: 10 },
  input:             { flex: 1, fontSize: 15 },
  inputMultiline:    { minHeight: 60, textAlignVertical: 'top' as const },
  readOnly:    { flex: 1, fontSize: 15 },
  hint:        { fontSize: 11, marginTop: 2 },
  errorBox:    { flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10 },
  errorText:   { flex: 1, fontSize: 13 },
  saveBtn:     { borderRadius: 14, paddingVertical: 16, alignItems: 'center', marginTop: 8 },
  saveBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' as const },
});

// ── Delete Account Confirmation Modal ─────────────────────────────────────────

interface DeleteAccountModalProps {
  visible:  boolean;
  onClose:  () => void;
  onDelete: () => Promise<void>;
}

function DeleteAccountModal({ visible, onClose, onDelete }: DeleteAccountModalProps) {
  const colors   = useColors();
  const [busy,   setBusy]   = useState(false);
  const [error,  setError]  = useState('');
  const [step,   setStep]   = useState<'confirm' | 'final'>('confirm');

  // Reset when opened
  useEffect(() => {
    if (visible) { setStep('confirm'); setError(''); }
  }, [visible]);

  async function handleDelete() {
    setBusy(true);
    setError('');
    try {
      await onDelete();
      // Parent closes the modal after logout
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete account. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={onClose}>
      <View style={delStyles.overlay}>
        <View style={[delStyles.sheet, { backgroundColor: colors.background }]}>
          {/* Icon */}
          <View style={[delStyles.iconWrap, { backgroundColor: colors.destructive + '18' }]}>
            <Ionicons name="trash-outline" size={32} color={colors.destructive} />
          </View>

          {step === 'confirm' ? (
            <>
              <Text style={[delStyles.title, { color: colors.text }]}>Delete your account?</Text>
              <Text style={[delStyles.body, { color: colors.mutedForeground }]}>
                This will permanently erase your personal information — name, email, phone,
                and contact details attached to your orders and tickets.{'\n\n'}
                Your order history will remain in our system as anonymised records for
                business purposes, but no personal data will be retained.
              </Text>
              <View style={delStyles.btnRow}>
                <TouchableOpacity
                  onPress={onClose}
                  style={[delStyles.cancelBtn, { borderColor: colors.border }]}
                  activeOpacity={0.75}>
                  <Text style={[delStyles.cancelText, { color: colors.text }]}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => setStep('final')}
                  style={[delStyles.deleteBtn, { backgroundColor: colors.destructive }]}
                  activeOpacity={0.85}>
                  <Text style={delStyles.deleteBtnText}>Continue</Text>
                </TouchableOpacity>
              </View>
            </>
          ) : (
            <>
              <Text style={[delStyles.title, { color: colors.text }]}>Are you sure?</Text>
              <Text style={[delStyles.body, { color: colors.mutedForeground }]}>
                This cannot be undone. Your account and personal data will be permanently
                deleted immediately.
              </Text>
              {!!error && (
                <View style={[delStyles.errorBox, { backgroundColor: colors.destructive + '12', borderColor: colors.destructive + '30' }]}>
                  <Ionicons name="alert-circle-outline" size={15} color={colors.destructive} />
                  <Text style={[delStyles.errorText, { color: colors.destructive }]}>{error}</Text>
                </View>
              )}
              <View style={delStyles.btnRow}>
                <TouchableOpacity
                  onPress={onClose}
                  disabled={busy}
                  style={[delStyles.cancelBtn, { borderColor: colors.border }]}
                  activeOpacity={0.75}>
                  <Text style={[delStyles.cancelText, { color: colors.text }]}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={handleDelete}
                  disabled={busy}
                  style={[delStyles.deleteBtn, { backgroundColor: colors.destructive, opacity: busy ? 0.7 : 1 }]}
                  activeOpacity={0.85}>
                  {busy
                    ? <ActivityIndicator color="#fff" size="small" />
                    : <Text style={delStyles.deleteBtnText}>Delete my account</Text>}
                </TouchableOpacity>
              </View>
            </>
          )}
        </View>
      </View>
    </Modal>
  );
}

const delStyles = StyleSheet.create({
  overlay:      { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'center', alignItems: 'center', padding: 24 },
  sheet:        { width: '100%', maxWidth: 380, borderRadius: 20, padding: 24, alignItems: 'center', gap: 12 },
  iconWrap:     { width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  title:        { fontSize: 18, fontWeight: '700' as const, textAlign: 'center' },
  body:         { fontSize: 14, lineHeight: 21, textAlign: 'center' },
  btnRow:       { flexDirection: 'row' as const, gap: 10, width: '100%', marginTop: 4 },
  cancelBtn:    { flex: 1, borderWidth: 1.5, borderRadius: 12, paddingVertical: 13, alignItems: 'center' as const },
  cancelText:   { fontSize: 15, fontWeight: '600' as const },
  deleteBtn:    { flex: 1, borderRadius: 12, paddingVertical: 13, alignItems: 'center' as const, justifyContent: 'center' as const, minHeight: 46 },
  deleteBtnText:{ color: '#fff', fontSize: 15, fontWeight: '700' as const },
  errorBox:     { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 8, borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, width: '100%' },
  errorText:    { flex: 1, fontSize: 13 },
});

// ── Main Screen ───────────────────────────────────────────────────────────────

export default function AccountScreen() {
  return (
    <SwipeTabs tab="account">
      <AccountScreenContent />
    </SwipeTabs>
  );
}

function AccountScreenContent() {
  const colors      = useColors();
  const router      = useRouter();
  const { user, logout } = useAuth();
  const api         = useApi();
  const queryClient = useQueryClient();

  const { editProfile } = useLocalSearchParams<{ editProfile?: string }>();

  const [notifStatus,       setNotifStatus]       = useState<string>('undetermined');
  const [filterActivation,  setFilterActivation]  = useState<FilterActivation | null>(null);
  const [editModalVisible,  setEditModalVisible]   = useState(false);
  const [deleteModalVisible, setDeleteModalVisible] = useState(false);
  const [exporting,          setExporting]          = useState(false);
  const [exportError,        setExportError]        = useState('');
  const [ownerDetailsOpen,   setOwnerDetailsOpen]    = useState(false);

  // Auto-open the Edit Profile modal when navigated here with ?editProfile=1
  // (e.g. from the ticket form's "add phone number" link).
  useEffect(() => {
    if (editProfile === '1' && user) {
      setEditModalVisible(true);
    }
  }, [editProfile, user]);

  async function handleExportData() {
    if (exporting) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    setExporting(true);
    setExportError('');
    try {
      const json = await api.exportData();
      const filename = `ultra-clear-data-export-${new Date().toISOString().slice(0, 10)}.json`;
      if (Platform.OS === 'web') {
        // Browser: trigger a direct file download
        const blob = new Blob([json], { type: 'application/json' });
        const url  = URL.createObjectURL(blob);
        const a    = document.createElement('a');
        a.href     = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
      } else {
        // Native: write to cache and open the share sheet so the user can save it
        const file = new File(Paths.cache, filename);
        if (file.exists) file.delete();
        file.create();
        file.write(json);
        if (await Sharing.isAvailableAsync()) {
          await Sharing.shareAsync(file.uri, {
            mimeType: 'application/json',
            dialogTitle: 'Save your Ultra Clear data export',
            UTI: 'public.json',
          });
        } else {
          setExportError('Sharing is not available on this device.');
        }
      }
    } catch (err) {
      setExportError(err instanceof Error ? err.message : 'Failed to download your data. Please try again.');
    } finally {
      setExporting(false);
    }
  }

  const refreshNotifStatus = useCallback(async () => {
    if (Platform.OS === 'web') return;
    const s = await getNotificationPermissionStatus();
    setNotifStatus(s);
  }, []);

  useEffect(() => {
    refreshNotifStatus();
    if (user) getFilterActivation(user.id).then(setFilterActivation);
  }, [refreshNotifStatus, user]);

  async function enableNotifications() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const granted = await requestNotificationPermission();
    setNotifStatus(granted ? 'granted' : 'denied');
  }

  const { data: orders } = useQuery({
    queryKey: ['orders'],
    queryFn: () => api.getOrders(),
    enabled: !!user,
  });

  const { data: rewards } = useQuery({
    queryKey: ['customer-rewards'],
    queryFn: () => api.getRewards(),
    enabled: !!user,
  });

  // Must be called unconditionally before any early return (Rules of Hooks).
  const cartBarInset = useCartBarInset();

  if (!user) {
    return (
      <View style={[styles.screen, { backgroundColor: colors.background }]}>
        <View style={[styles.guestContainer, { marginTop: topPad }]}>
          <View style={[styles.avatarPlaceholder, { backgroundColor: colors.primaryLight }]}>
            <Ionicons name="person-outline" size={40} color={colors.primary} />
          </View>
          <Text style={[styles.guestTitle, { color: colors.text }]}>Sign in to your account</Text>
          <Text style={[styles.guestSub, { color: colors.mutedForeground }]}>
            Access order history, manage your filters, and get personalised recommendations
          </Text>
          <TouchableOpacity onPress={() => router.push('/auth/login')}
            style={[styles.loginBtn, { backgroundColor: colors.primary }]}>
            <Text style={styles.loginBtnText}>Sign In</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => router.push('/auth/register')} style={styles.registerLink}>
            <Text style={[styles.registerLinkText, { color: colors.primary }]}>Create an account</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  const initials     = `${user.firstName[0] ?? ''}${user.lastName[0] ?? ''}`.toUpperCase() || '?';
  const recentOrders = orders?.slice(0, 3) ?? [];

  const editInitial: EditProfileForm = {
    firstName: user.firstName,
    lastName:  user.lastName,
    phone:     user.phone ?? '',
    address:   user.address ?? '',
  };

  return (
    <>
      <ScrollView
        style={[styles.screen, { backgroundColor: colors.background }]}
        contentContainerStyle={{ paddingBottom: cartBarInset || (Platform.OS === 'web' ? 34 : 80) }}>

        {/* Notification permission prompt */}
        {Platform.OS !== 'web' && notifStatus !== 'granted' && (
          <View style={[styles.notifCard, { backgroundColor: colors.primaryLight, borderColor: colors.primary }]}>
            <View style={[styles.notifIconWrap, { backgroundColor: colors.primary }]}>
              <Ionicons name="notifications-outline" size={22} color="#fff" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.notifTitle, { color: colors.text }]}>Stay informed</Text>
              <Text style={[styles.notifSub, { color: colors.mutedForeground }]}>
                Get order updates and filter replacement reminders
              </Text>
            </View>
            {notifStatus === 'denied' ? (
              <Text style={[styles.notifDenied, { color: colors.mutedForeground }]}>
                Enable in Settings
              </Text>
            ) : (
              <TouchableOpacity onPress={enableNotifications}
                style={[styles.notifBtn, { backgroundColor: colors.primary }]}>
                <Text style={styles.notifBtnTxt}>Enable</Text>
              </TouchableOpacity>
            )}
          </View>
        )}

        {/* Profile header */}
        <View style={[styles.profileHeader, { backgroundColor: colors.primary, paddingTop: topPad + 16 }]}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{initials}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.profileName}>{user.firstName} {user.lastName}</Text>
              <Text style={styles.profileEmail}>My Ultra-Clear account</Text>
          </View>
          {/* Edit button in header */}
          <TouchableOpacity
            onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {}); setEditModalVisible(true); }}
            style={styles.editHeaderBtn}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Ionicons name="pencil-outline" size={16} color="rgba(255,255,255,0.9)" />
          </TouchableOpacity>
        </View>

        <View style={styles.body}>
          {/* Account owner details stay private until explicitly expanded. */}
          <View style={styles.section}>
            <View style={styles.sectionRow}>
              <Text style={[styles.sectionTitle, { color: colors.text }]}>My Details</Text>
              <View style={styles.detailActions}>
                <TouchableOpacity
                  onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {}); setEditModalVisible(true); }}
                  activeOpacity={0.75}
                  style={[styles.editBtn, { borderColor: colors.primary }]}>
                  <Ionicons name="pencil-outline" size={13} color={colors.primary} />
                  <Text style={[styles.editBtnText, { color: colors.primary }]}>Edit</Text>
                </TouchableOpacity>
              </View>
            </View>
            <View style={[styles.detailsCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <TouchableOpacity
                onPress={() => setOwnerDetailsOpen(open => !open)}
                activeOpacity={0.75}
                style={[styles.detailsDisclosure, { borderBottomColor: ownerDetailsOpen ? colors.border : 'transparent' }]}
                accessibilityRole="button"
                accessibilityState={{ expanded: ownerDetailsOpen }}
                accessibilityLabel={ownerDetailsOpen ? 'Hide account owner details' : 'Show account owner details'}
              >
                <View style={[styles.detailIconWrap, { backgroundColor: colors.surface }]}>
                  <Ionicons name="shield-checkmark-outline" size={16} color={colors.primary} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.detailValue, { color: colors.text }]}>
                    {ownerDetailsOpen ? 'Account owner details' : 'Show account owner details'}
                  </Text>
                  <Text style={[styles.detailLabel, { color: colors.mutedForeground }]}>
                    {ownerDetailsOpen ? 'Email, phone and delivery address' : 'Details are hidden until you choose to view them'}
                  </Text>
                </View>
                <Ionicons name={ownerDetailsOpen ? 'chevron-up' : 'chevron-down'} size={18} color={colors.mutedForeground} />
              </TouchableOpacity>
              {ownerDetailsOpen && (
                <>
                  <View style={[styles.detailRow, { borderBottomColor: colors.border }]}>
                    <View style={[styles.detailIconWrap, { backgroundColor: colors.surface }]}>
                      <Ionicons name="person-outline" size={15} color={colors.primary} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.detailLabel, { color: colors.mutedForeground }]}>Full Name</Text>
                      <Text style={[styles.detailValue, { color: colors.text }]}>
                        {[user.firstName, user.lastName].filter(Boolean).join(' ') || '—'}
                      </Text>
                    </View>
                  </View>
                  <View style={[styles.detailRow, { borderBottomColor: colors.border }]}>
                    <View style={[styles.detailIconWrap, { backgroundColor: colors.surface }]}>
                      <Ionicons name="mail-outline" size={15} color={colors.primary} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.detailLabel, { color: colors.mutedForeground }]}>Email</Text>
                      <Text style={[styles.detailValue, { color: colors.text }]}>{user.email}</Text>
                    </View>
                    <View style={[styles.lockedBadge, { backgroundColor: colors.surface }]}>
                      <Ionicons name="lock-closed-outline" size={11} color={colors.mutedForeground} />
                    </View>
                  </View>
                  <View style={[styles.detailRow, { borderBottomColor: colors.border }]}>
                    <View style={[styles.detailIconWrap, { backgroundColor: colors.surface }]}>
                      <Ionicons name="call-outline" size={15} color={colors.primary} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.detailLabel, { color: colors.mutedForeground }]}>Phone</Text>
                      <Text style={[styles.detailValue, { color: user.phone ? colors.text : colors.mutedForeground }]}>
                        {user.phone || 'Not added yet'}
                      </Text>
                    </View>
                  </View>
                  <View style={[styles.detailRow, { borderBottomWidth: 0 }]}>
                    <View style={[styles.detailIconWrap, { backgroundColor: colors.surface }]}>
                      <Ionicons name="location-outline" size={15} color={colors.primary} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.detailLabel, { color: colors.mutedForeground }]}>Delivery Address</Text>
                      <Text style={[styles.detailValue, { color: user.address ? colors.text : colors.mutedForeground }]}>
                        {user.address || 'Not added yet'}
                      </Text>
                    </View>
                  </View>
                </>
              )}
            </View>
          </View>

          {/* ── Rewards card ─────────────────────────────────────────── */}
          {user && (
            <View style={styles.section}>
              <Text style={[styles.sectionTitle, { color: colors.text }]}>My Rewards</Text>
              <View style={[rewardStyles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
                {/* Balance */}
                <View style={[rewardStyles.balanceRow, { borderBottomColor: colors.border }]}>
                  <View style={[rewardStyles.balanceIcon, { backgroundColor: colors.primaryLight }]}>
                    <Ionicons name="star" size={22} color={colors.primary} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[rewardStyles.balanceLabel, { color: colors.mutedForeground }]}>Points Balance</Text>
                    <Text style={[rewardStyles.balanceValue, { color: colors.text }]}>
                      {rewards?.balance ?? 0} <Text style={[rewardStyles.balancePts, { color: colors.mutedForeground }]}>pts</Text>
                    </Text>
                  </View>
                </View>

                {/* QR code */}
                <View style={[rewardStyles.qrSection, { borderBottomColor: colors.border }]}>
                  <Text style={[rewardStyles.qrLabel, { color: colors.mutedForeground }]}>Your Rewards QR Code</Text>
                  <View style={[rewardStyles.qrWrap, { backgroundColor: '#fff', borderColor: colors.border }]}>
                    <QRCode
                      testID="account-rewards-qr"
                      value={buildRewardsQrPayload(user.id, user.phone)}
                      size={120}
                      color="#1a1a1a"
                      backgroundColor="#ffffff"
                    />
                  </View>
                  <Text style={[rewardStyles.qrHint, { color: colors.mutedForeground }]}>
                    Show this to field staff or scan in the admin panel to earn points
                  </Text>
                </View>

                {/* Recent history */}
                {rewards && rewards.ledger.length > 0 && (
                  <View style={rewardStyles.historySection}>
                    <Text style={[rewardStyles.historyTitle, { color: colors.text }]}>Recent Points</Text>
                    {rewards.ledger.slice(0, 10).map(entry => (
                      <View key={entry.id} style={[rewardStyles.historyRow, { borderBottomColor: colors.border }]}>
                        <View style={{ flex: 1 }}>
                          <Text style={[rewardStyles.historyReason, { color: colors.text }]} numberOfLines={1}>
                            {entry.reason}
                          </Text>
                          <Text style={[rewardStyles.historyDate, { color: colors.mutedForeground }]}>
                            {new Date(entry.createdAt).toLocaleDateString()}
                          </Text>
                        </View>
                        <Text style={[rewardStyles.historyPoints, { color: entry.points > 0 ? colors.primary : colors.destructive }]}>
                          {entry.points > 0 ? '+' : ''}{entry.points} pts
                        </Text>
                      </View>
                    ))}
                  </View>
                )}
              </View>
            </View>
          )}

          {/* Filter tracker */}
          <FilterTrackerSection
            activation={filterActivation}
            onActivationChange={a => {
              setFilterActivation(a);
              refreshNotifStatus();
            }}
          />

          {/* Recent orders */}
          {recentOrders.length > 0 && (
            <View style={styles.section}>
              <Text style={[styles.sectionTitle, { color: colors.text }]}>Recent Orders</Text>
              <View style={{ gap: 10 }}>
                {recentOrders.map(order => (
                  <OrderCard key={order.id} order={order}
                    onPress={() => router.push(`/order/${order.id}` as never)} />
                ))}
              </View>
            </View>
          )}

          {/* Menu */}
          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>My Account</Text>
            <View style={[styles.menuCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
              {MENU_ITEMS.map((item, i) => (
                <TouchableOpacity key={item.label}
                  onPress={() => router.push(item.route as never)}
                  activeOpacity={0.75}
                  style={[styles.menuItem, i < MENU_ITEMS.length - 1 && { borderBottomWidth: 1, borderBottomColor: colors.border }]}>
                  <View style={[styles.menuIcon, { backgroundColor: colors.surface }]}>
                    <Ionicons name={item.icon} size={18} color={colors.primary} />
                  </View>
                  <Text style={[styles.menuLabel, { color: colors.text }]}>{item.label}</Text>
                  <Ionicons name="chevron-forward" size={16} color={colors.mutedForeground} />
                </TouchableOpacity>
              ))}
            </View>
          </View>

          {/* Logout */}
          <TouchableOpacity onPress={async () => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            await logout();
            queryClient.clear();
          }} style={[styles.logoutBtn, { borderColor: colors.destructive }]}>
            <Ionicons name="log-out-outline" size={18} color={colors.destructive} />
            <Text style={[styles.logoutText, { color: colors.destructive }]}>Sign Out</Text>
          </TouchableOpacity>

          {/* Download my data (GDPR / PDPA data portability) */}
          <TouchableOpacity
            onPress={handleExportData}
            disabled={exporting}
            style={[styles.downloadDataBtn, { borderColor: colors.border, opacity: exporting ? 0.7 : 1 }]}
            activeOpacity={0.75}>
            {exporting
              ? <ActivityIndicator size="small" color={colors.primary} />
              : <Ionicons name="download-outline" size={18} color={colors.primary} />}
            <Text style={[styles.downloadDataText, { color: colors.text }]}>Download my data</Text>
          </TouchableOpacity>
          {!!exportError && (
            <Text style={[styles.exportError, { color: colors.destructive }]}>{exportError}</Text>
          )}

          {/* Delete account */}
          <TouchableOpacity
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
              setDeleteModalVisible(true);
            }}
            style={styles.deleteAccountBtn}>
            <Text style={[styles.deleteAccountText, { color: colors.mutedForeground }]}>Delete my account</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>

      {/* Edit Profile Modal */}
      <EditProfileModal
        visible={editModalVisible}
        initial={editInitial}
        email={user.email}
        onClose={() => setEditModalVisible(false)}
        onSaved={() => setEditModalVisible(false)}
      />

      {/* Delete Account Modal */}
      <DeleteAccountModal
        visible={deleteModalVisible}
        onClose={() => setDeleteModalVisible(false)}
        onDelete={async () => {
          await api.deleteAccount();
          setDeleteModalVisible(false);
          await logout();
          queryClient.clear();
        }}
      />
    </>
  );
}

const styles = StyleSheet.create({
  screen:           { flex: 1 },
  guestContainer:   { flex: 1, alignItems: 'center', padding: 40, gap: 16 },
  avatarPlaceholder:{ width: 80, height: 80, borderRadius: 40, alignItems: 'center', justifyContent: 'center' },
  guestTitle:       { fontSize: 22, fontWeight: '700' as const, textAlign: 'center' },
  guestSub:         { fontSize: 14, textAlign: 'center', lineHeight: 22 },
  loginBtn:         { paddingVertical: 14, paddingHorizontal: 48, borderRadius: 12, marginTop: 8 },
  loginBtnText:     { color: '#fff', fontSize: 16, fontWeight: '700' as const },
  registerLink:     { padding: 8 },
  registerLinkText: { fontSize: 15, fontWeight: '500' as const },

  profileHeader:    { flexDirection: 'row', alignItems: 'center', gap: 16, paddingHorizontal: 20, paddingBottom: 24 },
  avatar:           { width: 54, height: 54, borderRadius: 27, backgroundColor: 'rgba(255,255,255,0.25)', alignItems: 'center', justifyContent: 'center' },
  avatarText:       { color: '#fff', fontSize: 20, fontWeight: '700' as const },
  profileName:      { color: '#fff', fontSize: 18, fontWeight: '700' as const },
  profileEmail:     { color: 'rgba(255,255,255,0.75)', fontSize: 13, marginTop: 2 },
  profilePhoneRow:  { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 4, marginTop: 3 },
  profilePhone:     { color: 'rgba(255,255,255,0.7)', fontSize: 12 },
  editHeaderBtn:    { width: 32, height: 32, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.15)', alignItems: 'center', justifyContent: 'center' },

  body:             { padding: 16, gap: 20 },
  section:          { gap: 12 },
  sectionRow:       { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  detailActions:    { flexDirection: 'row', alignItems: 'center', gap: 8 },
  sectionTitle:     { fontSize: 17, fontWeight: '700' as const },
  editBtn:          { flexDirection: 'row', alignItems: 'center', gap: 5, borderWidth: 1, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5 },
  editBtnText:      { fontSize: 13, fontWeight: '600' as const },

  detailsCard:      { borderRadius: 14, borderWidth: 1, overflow: 'hidden' },
  detailsDisclosure:{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderBottomWidth: 1 },
  detailRow:        { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderBottomWidth: 1 },
  detailIconWrap:   { width: 34, height: 34, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  detailLabel:      { fontSize: 11, fontWeight: '500' as const, marginBottom: 2 },
  detailValue:      { fontSize: 15, fontWeight: '500' as const },
  lockedBadge:      { width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },

  menuCard:         { borderRadius: 14, borderWidth: 1, overflow: 'hidden' },
  menuItem:         { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14 },
  menuIcon:         { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  menuLabel:        { flex: 1, fontSize: 15, fontWeight: '500' as const },
  logoutBtn:           { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderWidth: 1.5, borderRadius: 12, paddingVertical: 14 },
  logoutText:          { fontSize: 15, fontWeight: '600' as const },
  downloadDataBtn:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderWidth: 1.5, borderRadius: 12, paddingVertical: 14 },
  downloadDataText:    { fontSize: 15, fontWeight: '600' as const },
  exportError:         { fontSize: 12, textAlign: 'center' as const, marginTop: -10 },
  deleteAccountBtn:    { alignItems: 'center', paddingVertical: 8 },
  deleteAccountText:   { fontSize: 13, textDecorationLine: 'underline' as const },

  notifCard:        { flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1, borderRadius: 14, padding: 14, marginTop: topPad + 12, marginHorizontal: 16 },
  notifIconWrap:    { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  notifTitle:       { fontSize: 14, fontWeight: '600' as const },
  notifSub:         { fontSize: 12, marginTop: 2 },
  notifBtn:         { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 8 },
  notifBtnTxt:      { color: '#fff', fontSize: 13, fontWeight: '600' as const },
  notifDenied:      { fontSize: 11, maxWidth: 72, textAlign: 'center' },
});

const rewardStyles = StyleSheet.create({
  card:           { borderRadius: 14, borderWidth: 1, overflow: 'hidden' },
  balanceRow:     { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 16, borderBottomWidth: 1 },
  balanceIcon:    { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  balanceLabel:   { fontSize: 12, fontWeight: '500' as const, marginBottom: 2 },
  balanceValue:   { fontSize: 26, fontWeight: '800' as const },
  balancePts:     { fontSize: 14, fontWeight: '500' as const },
  qrSection:      { alignItems: 'center', paddingVertical: 20, paddingHorizontal: 16, gap: 12, borderBottomWidth: 1 },
  qrLabel:        { fontSize: 12, fontWeight: '600' as const, textTransform: 'uppercase' as const, letterSpacing: 0.5 },
  qrWrap:         { padding: 12, borderRadius: 12, borderWidth: 1 },
  qrHint:         { fontSize: 11, textAlign: 'center' as const, maxWidth: 240 },
  historySection: { padding: 14, gap: 0 },
  historyTitle:   { fontSize: 13, fontWeight: '700' as const, marginBottom: 8 },
  historyRow:     { flexDirection: 'row', alignItems: 'center', paddingVertical: 9, borderBottomWidth: 1, gap: 8 },
  historyReason:  { fontSize: 13, fontWeight: '500' as const },
  historyDate:    { fontSize: 11, marginTop: 1 },
  historyPoints:  { fontSize: 14, fontWeight: '700' as const, minWidth: 60, textAlign: 'right' as const },
});
