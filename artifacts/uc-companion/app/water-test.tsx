/**
 * Water Test Request screen
 *
 * Changes:
 *  - Email field added — receipt sent directly to submitted address even for guests
 *  - Receipt reference displayed prominently on success screen
 *  - WhatsApp copy button retained on success
 *  - Account-gated: guests see a sign-in/register prompt; their in-progress
 *    form is saved as a device-local draft and restored after authentication
 *  - Name, email AND phone pre-fill from the signed-in account
 */
import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TextInput,
  TouchableOpacity, Platform, ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';
import { useRouter } from 'expo-router';
import { useApi, ApiError } from '@/hooks/useApi';
import { useAuth } from '@/context/AuthContext';
import * as Haptics from 'expo-haptics';
import MediaPicker, { MediaItem } from '@/components/MediaPicker';
import { uploadMediaItems } from '@/lib/uploadMedia';
import { openWhatsApp } from '@/lib/whatsapp';
import { saveDraft, loadDraft, clearDraft } from '@/lib/formDrafts';

const WATER_SOURCES = [
  'Municipal/Tap', 'Borehole', 'Well', 'Rainwater', 'River/Lake', 'Tanker delivery',
];
const CONCERNS = [
  'Bad taste or odor', 'Discolouration', 'Hardness / scale buildup',
  'Skin irritation', 'Gastrointestinal issues', 'General safety check',
];

/** Everything the customer can type/pick on this form — persisted as a draft. */
interface WaterTestDraft {
  name: string;
  address: string;
  phone: string;
  email: string;
  waterSource: string;
  selectedConcerns: string[];
  extraConcerns: string;
  media: MediaItem[];
}

export default function WaterTestScreen() {
  const colors  = useColors();
  const router  = useRouter();
  const api     = useApi();
  const { user, token } = useAuth();

  // Name, email AND phone pre-fill from the signed-in account (all editable).
  const [name,             setName]             = useState(user ? `${user.firstName} ${user.lastName}`.trim() : '');
  const [address,          setAddress]          = useState('');
  const [phone,            setPhone]            = useState(user?.phone ?? '');
  const [email,            setEmail]            = useState(user?.email ?? '');
  const [waterSource,      setWaterSource]      = useState('');
  const [selectedConcerns, setSelectedConcerns] = useState<string[]>([]);
  const [extraConcerns,    setExtraConcerns]    = useState('');
  const [media,            setMedia]            = useState<MediaItem[]>([]);
  const [submitting,       setSubmitting]       = useState(false);
  const [submitted,        setSubmitted]        = useState(false);
  const [receiptRef,       setReceiptRef]       = useState('');
  const [whatsAppSummary,  setWhatsAppSummary]  = useState('');
  const [error,            setError]            = useState('');

  // ── Draft persistence ──────────────────────────────────────────────────────
  // Restore any in-progress draft on mount (e.g. after a mid-flow sign-in),
  // then keep it saved as the user types so nothing is ever lost. Draft values
  // only overwrite a field when the draft actually holds something, so account
  // pre-fill survives for fields the guest never touched.
  const draftReady = useRef(false);
  useEffect(() => {
    (async () => {
      const d = await loadDraft<WaterTestDraft>('water-test');
      if (d) {
        if (typeof d.name === 'string' && d.name.trim()) setName(d.name);
        if (typeof d.address === 'string' && d.address.trim()) setAddress(d.address);
        if (typeof d.phone === 'string' && d.phone.trim()) setPhone(d.phone);
        if (typeof d.email === 'string' && d.email.trim()) setEmail(d.email);
        if (typeof d.waterSource === 'string' && d.waterSource) setWaterSource(d.waterSource);
        if (Array.isArray(d.selectedConcerns)) setSelectedConcerns(d.selectedConcerns);
        if (typeof d.extraConcerns === 'string' && d.extraConcerns) setExtraConcerns(d.extraConcerns);
        if (Array.isArray(d.media)) setMedia(d.media);
      }
      draftReady.current = true;
    })();
  }, []);

  useEffect(() => {
    if (!draftReady.current || submitted) return;
    saveDraft<WaterTestDraft>('water-test', {
      name, address, phone, email, waterSource, selectedConcerns, extraConcerns, media,
    });
  }, [name, address, phone, email, waterSource, selectedConcerns, extraConcerns, media, submitted]);

  // Refresh the account pre-fill after a mid-flow sign-in: fill only the
  // fields the user left blank — never overwrite what they typed.
  useEffect(() => {
    if (!user) return;
    setName(prev => prev.trim() ? prev : `${user.firstName} ${user.lastName}`.trim());
    setEmail(prev => prev.trim() ? prev : (user.email ?? ''));
    setPhone(prev => prev.trim() ? prev : (user.phone ?? ''));
  }, [user]);

  /** Save the draft, then take the guest to sign-in / registration.
   *  `returnTo` brings them straight back here with the draft restored. */
  async function goToAuth(mode: 'login' | 'register') {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    await saveDraft<WaterTestDraft>('water-test', {
      name, address, phone, email, waterSource, selectedConcerns, extraConcerns, media,
    });
    router.push({
      pathname: mode === 'login' ? '/auth/login' : '/auth/register',
      params: { returnTo: '/water-test' },
    } as never);
  }

  const toggleConcern = (c: string) => {
    setSelectedConcerns(prev =>
      prev.includes(c) ? prev.filter(x => x !== c) : [...prev, c],
    );
  };

  async function submit() {
    if (!name.trim() || !address.trim() || !phone.trim() || !waterSource) {
      setError('Please fill in your name, address, phone number, and select a water source.');
      return;
    }
    if (!token) {
      // Account-gated: never let a guest hit the server's 401 — save their
      // work and route them into sign-in, which returns them to this form.
      setError('');
      await goToAuth('login');
      return;
    }
    setError('');
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setSubmitting(true);
    try {
      const uploaded = media.length ? await uploadMediaItems(media, api.requestUploadUrl) : [];
      const concernsText = [...selectedConcerns, extraConcerns].filter(Boolean).join(', ');
      const wt = await api.createWaterTest({
        name, address, phone, email: email.trim() || undefined, waterSource,
        concerns: concernsText,
        photos: uploaded.filter(m => m.type === 'photo').map(m => m.url),
        videos: uploaded.filter(m => m.type === 'video').map(m => m.url),
      });
      const summary = [
        'ULTRA CLEAR — WATER TEST REQUEST',
        `Ref: ${wt.id}`,
        `Name: ${name}`,
        `Phone: ${phone}`,
        `Address: ${address}`,
        `Water source: ${waterSource}`,
        ...(concernsText ? [`Concerns: ${concernsText}`] : []),
      ].join('\n');
      setReceiptRef(wt.id);
      setWhatsAppSummary(summary);
      setSubmitted(true);
      clearDraft('water-test');
    } catch (e) {
      // Session expired / invalid — send the customer to sign-in with their
      // draft saved instead of leaving them stuck on a raw error message.
      if (e instanceof ApiError && (e.status === 401 || e.status === 403)) {
        setError('Your session has expired. Please sign in again — your form is saved.');
        await goToAuth('login');
        return;
      }
      setError(e instanceof Error ? e.message : 'Submission failed. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  if (submitted) {
    return (
      <View style={[styles.screen, { backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center', gap: 16, padding: 40 }]}>
        <View style={[styles.successIcon, { backgroundColor: colors.successLight }]}>
          <Ionicons name="checkmark-circle" size={52} color={colors.success} />
        </View>
        <Text style={[styles.successTitle, { color: colors.text }]}>Request Submitted!</Text>

        {/* Prominent receipt reference */}
        <View style={[styles.refBox, { backgroundColor: colors.primaryLight, borderColor: colors.primary }]}>
          <Text style={[styles.refLabel, { color: colors.mutedForeground }]}>Your receipt reference</Text>
          <Text style={[styles.refNumber, { color: colors.primary }]}>{receiptRef}</Text>
          <Text style={[styles.refHint, { color: colors.mutedForeground }]}>
            {email.trim()
              ? `A receipt has been sent to ${email.trim()}.`
              : 'Save this number for your records.'}
          </Text>
        </View>

        <Text style={[styles.successDesc, { color: colors.mutedForeground }]}>
          Our certified technician will contact you within 24 hours to schedule a convenient time for your free water quality test.
        </Text>
        <TouchableOpacity
          onPress={() => openWhatsApp(whatsAppSummary)}
          style={[styles.doneBtn, { backgroundColor: '#25D366', flexDirection: 'row', alignItems: 'center', gap: 8 }]}
        >
          <Ionicons name="logo-whatsapp" size={20} color="#fff" />
          <Text style={styles.doneBtnText}>Send a copy on WhatsApp</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => router.back()}
          style={[styles.doneBtn, { backgroundColor: colors.primary }]}>
          <Text style={styles.doneBtnText}>Done</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <ScrollView
      style={[styles.screen, { backgroundColor: colors.background }]}
      contentContainerStyle={{ padding: 16, gap: 20, paddingBottom: Platform.OS === 'web' ? 34 : 40 }}
      keyboardShouldPersistTaps="handled"
    >
      <View style={[styles.header, { backgroundColor: colors.primaryLight, borderColor: colors.primary }]}>
        <Ionicons name="flask" size={28} color={colors.primary} />
        <View style={{ flex: 1 }}>
          <Text style={[styles.headerTitle, { color: colors.text }]}>Free Water Quality Test</Text>
          <Text style={[styles.headerSub, { color: colors.mutedForeground }]}>Certified technician visits you at no charge</Text>
        </View>
      </View>

      {/* Guest gate — water test appointments require an account */}
      {!token && (
        <View style={[styles.gateBox, { backgroundColor: colors.primaryLight, borderColor: colors.primary }]}>
          <View style={styles.gateHeader}>
            <Ionicons name="lock-closed" size={18} color={colors.primary} />
            <Text style={[styles.gateTitle, { color: colors.text }]}>Account required</Text>
          </View>
          <Text style={[styles.gateText, { color: colors.mutedForeground }]}>
            Water test appointments are linked to your Ultra-Clear account so our technician can follow up with your results.
            You can fill in the form now — everything you enter is saved and will be right here after you sign in.
          </Text>
          <View style={styles.gateBtnRow}>
            <TouchableOpacity onPress={() => goToAuth('login')}
              style={[styles.gateBtn, { backgroundColor: colors.primary }]}>
              <Text style={styles.gateBtnText}>Sign In</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => goToAuth('register')}
              style={[styles.gateBtn, styles.gateBtnAlt, { borderColor: colors.primary }]}>
              <Text style={[styles.gateBtnText, { color: colors.primary }]}>Create Account</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* Contact details */}
      <View style={styles.section}>
        <Text style={[styles.sectionTitle, { color: colors.text }]}>Your Details</Text>
        {[
          { label: 'Full Name *',        value: name,    onChange: setName,    placeholder: 'Jane Doe' },
          { label: 'Address / Location *', value: address, onChange: setAddress, placeholder: 'Westlands, Nairobi' },
          { label: 'Phone Number *',     value: phone,   onChange: setPhone,   placeholder: '+254700000000', keyboard: 'phone-pad' as const },
          { label: 'Email (for receipt)', value: email,  onChange: setEmail,   placeholder: 'jane@example.com', keyboard: 'email-address' as const },
        ].map(f => (
          <View key={f.label} style={styles.field}>
            <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>{f.label}</Text>
            <TextInput
              value={f.value}
              onChangeText={f.onChange}
              placeholder={f.placeholder}
              placeholderTextColor={colors.border}
              keyboardType={f.keyboard}
              autoCapitalize={f.keyboard === 'email-address' ? 'none' : 'words'}
              style={[styles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.card }]}
            />
          </View>
        ))}
      </View>

      {/* Water source */}
      <View style={styles.section}>
        <Text style={[styles.sectionTitle, { color: colors.text }]}>Water Source *</Text>
        <View style={styles.chips}>
          {WATER_SOURCES.map(s => (
            <TouchableOpacity key={s} onPress={() => setWaterSource(s)} activeOpacity={0.8}
              style={[styles.chip, {
                backgroundColor: waterSource === s ? colors.primary : colors.surface,
                borderColor:     waterSource === s ? colors.primary : colors.border,
              }]}>
              <Text style={{ fontSize: 13, color: waterSource === s ? '#fff' : colors.mutedForeground, fontWeight: '500' as const }}>
                {s}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {/* Concerns */}
      <View style={styles.section}>
        <Text style={[styles.sectionTitle, { color: colors.text }]}>Concerns (select all that apply)</Text>
        <View style={styles.chips}>
          {CONCERNS.map(c => (
            <TouchableOpacity key={c} onPress={() => toggleConcern(c)} activeOpacity={0.8}
              style={[styles.chip, {
                backgroundColor: selectedConcerns.includes(c) ? colors.accent + '20' : colors.surface,
                borderColor:     selectedConcerns.includes(c) ? colors.accent : colors.border,
              }]}>
              <Text style={{ fontSize: 12, color: selectedConcerns.includes(c) ? colors.accent : colors.mutedForeground, fontWeight: '500' as const }}>
                {c}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
        <TextInput
          value={extraConcerns}
          onChangeText={setExtraConcerns}
          placeholder="Any other concerns..."
          placeholderTextColor={colors.border}
          multiline
          numberOfLines={3}
          style={[styles.textarea, { color: colors.text, borderColor: colors.border, backgroundColor: colors.card }]}
        />
      </View>

      {/* Media attachments */}
      <View style={styles.section}>
        <MediaPicker items={media} onChange={setMedia} maxItems={4} label="Attach Photos & Videos  (optional)" />
        <Text style={[styles.hint, { color: colors.mutedForeground }]}>
          Photos or short videos of your water sample or source help our technician prepare.
        </Text>
      </View>

      {/* Inline error */}
      {!!error && (
        <View style={[styles.errorBox, { backgroundColor: '#FEF2F2', borderColor: '#FCA5A5' }]}>
          <Ionicons name="alert-circle-outline" size={16} color="#DC2626" />
          <Text style={[styles.errorText, { color: '#DC2626' }]}>{error}</Text>
        </View>
      )}

      {/* Submit — guests are routed to sign-in (with the draft saved) instead */}
      <TouchableOpacity onPress={submit} disabled={submitting}
        style={[styles.submitBtn, { backgroundColor: submitting ? colors.muted : colors.primary }]}>
        {submitting ? <ActivityIndicator color="#fff" size="small" /> : (
          <>
            <Ionicons name={token ? 'calendar-outline' : 'lock-closed-outline'} size={18} color="#fff" />
            <Text style={styles.submitBtnText}>{token ? 'Book Water Test' : 'Sign In to Book'}</Text>
          </>
        )}
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen:       { flex: 1 },
  header:       { flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1, borderRadius: 14, padding: 14 },
  headerTitle:  { fontSize: 15, fontWeight: '700' as const },
  headerSub:    { fontSize: 12, marginTop: 2 },
  section:      { gap: 10 },
  sectionTitle: { fontSize: 15, fontWeight: '600' as const },
  field:        { gap: 4 },
  fieldLabel:   { fontSize: 12, fontWeight: '500' as const },
  input:        { borderWidth: 1, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 11, fontSize: 15 },
  chips:        { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip:         { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20, borderWidth: 1 },
  textarea:     { borderWidth: 1, borderRadius: 10, padding: 14, fontSize: 14, lineHeight: 20, minHeight: 80, textAlignVertical: 'top' },
  hint:         { fontSize: 12, lineHeight: 18 },
  submitBtn:    { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, borderRadius: 14, paddingVertical: 16 },
  submitBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' as const },
  errorBox:     { flexDirection: 'row', alignItems: 'flex-start', gap: 8, borderWidth: 1, borderRadius: 10, padding: 12 },
  errorText:    { flex: 1, fontSize: 13, lineHeight: 18, fontWeight: '500' as const },
  successIcon:  { width: 90, height: 90, borderRadius: 45, alignItems: 'center', justifyContent: 'center' },
  successTitle: { fontSize: 24, fontWeight: '700' as const },
  successDesc:  { fontSize: 15, lineHeight: 24, textAlign: 'center' },
  refBox:       { width: '100%', borderWidth: 1, borderRadius: 12, padding: 16, alignItems: 'center', gap: 4 },
  refLabel:     { fontSize: 11, fontWeight: '600' as const, letterSpacing: 0.5, textTransform: 'uppercase' },
  refNumber:    { fontSize: 26, fontWeight: '800' as const, letterSpacing: 1 },
  refHint:      { fontSize: 11, textAlign: 'center', marginTop: 2 },
  doneBtn:      { width: '100%', borderRadius: 12, paddingVertical: 14, paddingHorizontal: 48, justifyContent: 'center', alignItems: 'center', marginTop: 4 },
  doneBtnText:  { color: '#fff', fontSize: 16, fontWeight: '700' as const },
  gateBox:      { borderWidth: 1, borderRadius: 14, padding: 14, gap: 10 },
  gateHeader:   { flexDirection: 'row', alignItems: 'center', gap: 8 },
  gateTitle:    { fontSize: 15, fontWeight: '700' as const },
  gateText:     { fontSize: 13, lineHeight: 19 },
  gateBtnRow:   { flexDirection: 'row', gap: 10 },
  gateBtn:      { flex: 1, borderRadius: 10, paddingVertical: 11, alignItems: 'center' },
  gateBtnAlt:   { backgroundColor: 'transparent', borderWidth: 1.5 },
  gateBtnText:  { color: '#fff', fontSize: 14, fontWeight: '700' as const },
});
