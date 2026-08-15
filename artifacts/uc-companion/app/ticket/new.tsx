/**
 * New Ticket screen — Multi-product service request.
 *
 * Changes from v1:
 *  - "Bottles & Portable" segment removed (hardware tickets only)
 *  - Multi-select: the customer can flag multiple products per ticket;
 *    all are captured in productModel joined with " / " for the API.
 *  - Success screen shows the ticket reference prominently.
 *  - Account-gated: guests see a sign-in/register prompt; their in-progress
 *    form is saved as a device-local draft and restored after authentication.
 *  - Signed-in users see their account contact details (name/email/phone).
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

const CONTACT_TIMES = ['Morning (8am–12pm)', 'Afternoon (12pm–5pm)', 'Evening (5pm–8pm)', 'Any time'];

/**
 * Product catalogue grouped by segment — Bottles & Portable removed.
 * Customers submit tickets for filtration hardware, accessories, and solutions.
 */
const PRODUCT_SEGMENTS: { segment: string; models: string[] }[] = [
  {
    segment: 'Home Filters',
    models: ['Sweet Home', 'Counter Reverse Osmosis', 'Electric Pitcher', 'RO Home System'],
  },
  {
    segment: 'Shower & Skin',
    models: ["J'adore", 'Channel', 'Derma Care', 'Pure Drop', 'Derma Flux'],
  },
  {
    segment: 'Accessories',
    models: [
      'Bottle Filter Cartridge', 'Faucet Filter Cartridge', 'Shower Filter Cartridge',
      'Derma Flux Cartridge', 'Survivor Straw Cartridge', 'Filter Shell',
    ],
  },
  {
    segment: 'Solutions',
    models: ['Aqua Stream 1200', 'Water ATMs'],
  },
];

/** Everything the customer can type/pick on this form — persisted as a draft. */
interface TicketDraft {
  selectedProducts: string[];
  issue: string;
  contactTime: string;
  media: MediaItem[];
}

export default function NewTicketScreen() {
  const colors  = useColors();
  const router  = useRouter();
  const api     = useApi();
  const { token, user } = useAuth();

  // Multi-select product models
  const [selectedProducts, setSelectedProducts] = useState<string[]>([]);
  const [issue,        setIssue]        = useState('');
  const [contactTime,  setContactTime]  = useState(CONTACT_TIMES[3]!);
  const [media,        setMedia]        = useState<MediaItem[]>([]);
  const [submitting,   setSubmitting]   = useState(false);
  const [submitted,    setSubmitted]    = useState(false);
  const [ticketRef,    setTicketRef]    = useState('');
  const [whatsAppSummary, setWhatsAppSummary] = useState('');
  const [error,        setError]        = useState('');

  // ── Draft persistence ──────────────────────────────────────────────────────
  // Restore any in-progress draft on mount (e.g. after a mid-flow sign-in),
  // then keep it saved as the user types so nothing is ever lost.
  const draftReady = useRef(false);
  useEffect(() => {
    (async () => {
      const d = await loadDraft<TicketDraft>('ticket');
      if (d) {
        if (Array.isArray(d.selectedProducts)) setSelectedProducts(d.selectedProducts);
        if (typeof d.issue === 'string') setIssue(d.issue);
        if (typeof d.contactTime === 'string' && CONTACT_TIMES.includes(d.contactTime)) setContactTime(d.contactTime);
        if (Array.isArray(d.media)) setMedia(d.media);
      }
      draftReady.current = true;
    })();
  }, []);

  useEffect(() => {
    if (!draftReady.current || submitted) return;
    saveDraft<TicketDraft>('ticket', { selectedProducts, issue, contactTime, media });
  }, [selectedProducts, issue, contactTime, media, submitted]);

  /** Save the draft, then take the guest to sign-in / registration.
   *  `returnTo` brings them straight back here with the draft restored. */
  async function goToAuth(mode: 'login' | 'register') {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    await saveDraft<TicketDraft>('ticket', { selectedProducts, issue, contactTime, media });
    router.push({
      pathname: mode === 'login' ? '/auth/login' : '/auth/register',
      params: { returnTo: '/ticket/new' },
    } as never);
  }

  function toggleProduct(model: string) {
    setSelectedProducts(prev =>
      prev.includes(model) ? prev.filter(p => p !== model) : [...prev, model],
    );
  }

  async function submit() {
    const productModel = selectedProducts.length > 0
      ? selectedProducts.join(' / ')
      : '';

    if (selectedProducts.length === 0) {
      setError('Please select at least one product — or tap "Other" if your product isn\'t listed.');
      return;
    }
    if (!issue.trim()) {
      setError('Please describe the issue so our team can help you.');
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
      const ticket = await api.createTicket({
        productModel,
        issueDescription: issue,
        preferredContactTime: contactTime,
        photos: uploaded.filter(m => m.type === 'photo').map(m => m.url),
        videos: uploaded.filter(m => m.type === 'video').map(m => m.url),
      });
      const summary = [
        'ULTRA CLEAR — SERVICE REQUEST',
        `Ref: ${ticket.id}`,
        `Product(s): ${productModel}`,
        `Issue: ${issue}`,
        `Preferred contact time: ${contactTime}`,
      ].join('\n');
      setTicketRef(ticket.id);
      setWhatsAppSummary(summary);
      setSubmitted(true);
      clearDraft('ticket');
    } catch (e) {
      // Session expired / invalid — send the customer to sign-in with their
      // draft saved instead of leaving them stuck on a raw error message.
      if (e instanceof ApiError && (e.status === 401 || e.status === 403)) {
        setError('Your session has expired. Please sign in again — your form is saved.');
        await goToAuth('login');
        return;
      }
      setError(e instanceof Error ? e.message : 'Failed to submit ticket. Please try again.');
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
        <Text style={[styles.successTitle, { color: colors.text }]}>Ticket Submitted!</Text>

        {/* Prominent ticket reference */}
        <View style={[styles.refBox, { backgroundColor: colors.primaryLight, borderColor: colors.primary }]}>
          <Text style={[styles.refLabel, { color: colors.mutedForeground }]}>Your ticket reference</Text>
          <Text style={[styles.refNumber, { color: colors.primary }]}>{ticketRef}</Text>
          <Text style={[styles.refHint, { color: colors.mutedForeground }]}>
            Save this number — the team will quote it when they contact you.
          </Text>
        </View>

        <Text style={[styles.successDesc, { color: colors.mutedForeground }]}>
          Our team will contact you within 24–48 hours. A confirmation has been sent to your registered email.
        </Text>
        <TouchableOpacity
          onPress={() => openWhatsApp(whatsAppSummary)}
          style={[styles.doneBtn, { backgroundColor: '#25D366', flexDirection: 'row', alignItems: 'center', gap: 8 }]}
        >
          <Ionicons name="logo-whatsapp" size={20} color="#fff" />
          <Text style={styles.doneBtnText}>Send a copy on WhatsApp</Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => router.push('/(tabs)/support')}
          style={[styles.doneBtn, { backgroundColor: colors.primary }]}
        >
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
      {/* Guest gate — service requests require an account */}
      {!token && (
        <View style={[styles.gateBox, { backgroundColor: colors.primaryLight, borderColor: colors.primary }]}>
          <View style={styles.gateHeader}>
            <Ionicons name="lock-closed" size={18} color={colors.primary} />
            <Text style={[styles.gateTitle, { color: colors.text }]}>Account required</Text>
          </View>
          <Text style={[styles.gateText, { color: colors.mutedForeground }]}>
            Service requests are linked to your Ultra-Clear account so our team can track and follow up on your ticket.
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

      {/* Signed-in contact details — sourced from the account (server uses these too) */}
      {user && (
        <View style={styles.section}>
          <Text style={[styles.label, { color: colors.text }]}>Your Contact Details</Text>
          <View style={[styles.accountCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={styles.accountRow}>
              <Ionicons name="person-outline" size={16} color={colors.mutedForeground} />
              <Text style={[styles.accountText, { color: colors.text }]}>
                {`${user.firstName} ${user.lastName}`.trim()}
              </Text>
            </View>
            <View style={styles.accountRow}>
              <Ionicons name="mail-outline" size={16} color={colors.mutedForeground} />
              <Text style={[styles.accountText, { color: colors.text }]}>{user.email}</Text>
            </View>
            <View style={styles.accountRow}>
              <Ionicons name="call-outline" size={16} color={colors.mutedForeground} />
              {user.phone ? (
                <Text style={[styles.accountText, { color: colors.text }]}>{user.phone}</Text>
              ) : (
                <TouchableOpacity
                  onPress={() => {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    router.push('/(tabs)/account?editProfile=1' as never);
                  }}
                  activeOpacity={0.7}
                  style={styles.addPhoneLink}
                >
                  <Text style={[styles.addPhoneLinkText, { color: colors.primary }]}>
                    No phone number — tap to add one
                  </Text>
                  <Ionicons name="chevron-forward" size={13} color={colors.primary} />
                </TouchableOpacity>
              )}
            </View>
            <Text style={[styles.accountHint, { color: colors.mutedForeground }]}>
              From your account — the team will use these details to contact you.
            </Text>
          </View>
        </View>
      )}

      {/* Product model — multi-select, grouped by segment */}
      <View style={styles.section}>
        <Text style={[styles.label, { color: colors.text }]}>
          Product(s) with Issue{' '}
          <Text style={[styles.multiHint, { color: colors.mutedForeground }]}>(select all that apply)</Text>
        </Text>
        {PRODUCT_SEGMENTS.map(seg => (
          <View key={seg.segment} style={styles.segmentBlock}>
            <Text style={[styles.segmentLabel, { color: colors.mutedForeground }]}>{seg.segment}</Text>
            <View style={styles.chips}>
              {seg.models.map(m => {
                const selected = selectedProducts.includes(m);
                return (
                  <TouchableOpacity key={m} onPress={() => toggleProduct(m)} activeOpacity={0.8}
                    style={[styles.chip, {
                      backgroundColor: selected ? colors.primary : colors.surface,
                      borderColor:     selected ? colors.primary : colors.border,
                    }]}>
                    {selected && (
                      <Ionicons name="checkmark" size={11} color="#fff" style={{ marginRight: 2 }} />
                    )}
                    <Text style={{ fontSize: 12, color: selected ? '#fff' : colors.mutedForeground, fontWeight: '500' as const }}>
                      {m}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        ))}
        {/* Other — catch-all */}
        <View style={styles.chips}>
          {['Other'].map(m => {
            const selected = selectedProducts.includes(m);
            return (
              <TouchableOpacity key={m} onPress={() => toggleProduct(m)} activeOpacity={0.8}
                style={[styles.chip, {
                  backgroundColor: selected ? colors.primary : colors.surface,
                  borderColor:     selected ? colors.primary : colors.border,
                }]}>
                {selected && <Ionicons name="checkmark" size={11} color="#fff" style={{ marginRight: 2 }} />}
                <Text style={{ fontSize: 12, color: selected ? '#fff' : colors.mutedForeground, fontWeight: '500' as const }}>
                  {m}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
        {selectedProducts.length > 0 && (
          <Text style={[styles.selectionSummary, { color: colors.primary }]}>
            Selected: {selectedProducts.join(', ')}
          </Text>
        )}
      </View>

      {/* Issue description */}
      <View style={styles.section}>
        <Text style={[styles.label, { color: colors.text }]}>Describe the Issue *</Text>
        <TextInput
          value={issue}
          onChangeText={setIssue}
          multiline
          numberOfLines={5}
          placeholder="What's happening with your system? Include any error messages, unusual sounds, or changes in water quality..."
          placeholderTextColor={colors.border}
          style={[styles.textarea, { color: colors.text, borderColor: colors.border, backgroundColor: colors.card }]}
        />
      </View>

      {/* Contact time */}
      <View style={styles.section}>
        <Text style={[styles.label, { color: colors.text }]}>Preferred Contact Time</Text>
        <View style={styles.chips}>
          {CONTACT_TIMES.map(t => (
            <TouchableOpacity key={t} onPress={() => setContactTime(t)} activeOpacity={0.8}
              style={[styles.chip, {
                backgroundColor: contactTime === t ? colors.primary : colors.surface,
                borderColor:     contactTime === t ? colors.primary : colors.border,
              }]}>
              <Text style={{ fontSize: 12, color: contactTime === t ? '#fff' : colors.mutedForeground, fontWeight: '500' as const }}>
                {t}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {/* Media attachments */}
      <View style={styles.section}>
        <MediaPicker items={media} onChange={setMedia} maxItems={6} label="Attach Photos & Videos" />
        <Text style={[styles.hint, { color: colors.mutedForeground }]}>
          Up to 6 items · Videos capped at 15 seconds · Tap a video thumbnail to preview
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
            <Ionicons name={token ? 'send-outline' : 'lock-closed-outline'} size={18} color="#fff" />
            <Text style={styles.submitBtnText}>{token ? 'Submit Ticket' : 'Sign In to Submit'}</Text>
          </>
        )}
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen:           { flex: 1 },
  section:          { gap: 10 },
  label:            { fontSize: 15, fontWeight: '600' as const },
  multiHint:        { fontSize: 12, fontWeight: '400' as const },
  segmentBlock:     { gap: 6 },
  segmentLabel:     { fontSize: 11, fontWeight: '700' as const, textTransform: 'uppercase', letterSpacing: 0.5 },
  chips:            { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip:             { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20, borderWidth: 1 },
  selectionSummary: { fontSize: 12, fontWeight: '500' as const, marginTop: 2 },
  textarea:         { borderWidth: 1, borderRadius: 12, padding: 14, fontSize: 14, lineHeight: 21, minHeight: 120, textAlignVertical: 'top' },
  hint:             { fontSize: 12, lineHeight: 18 },
  submitBtn:        { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, borderRadius: 14, paddingVertical: 16 },
  submitBtnText:    { color: '#fff', fontSize: 16, fontWeight: '700' as const },
  errorBox:         { flexDirection: 'row', alignItems: 'flex-start', gap: 8, borderWidth: 1, borderRadius: 10, padding: 12 },
  errorText:        { flex: 1, fontSize: 13, lineHeight: 18, fontWeight: '500' as const },
  successIcon:      { width: 96, height: 96, borderRadius: 48, alignItems: 'center', justifyContent: 'center' },
  successTitle:     { fontSize: 22, fontWeight: '700' as const },
  successDesc:      { fontSize: 14, lineHeight: 21, textAlign: 'center' },
  refBox:           { width: '100%', borderWidth: 1, borderRadius: 12, padding: 16, alignItems: 'center', gap: 4 },
  refLabel:         { fontSize: 11, fontWeight: '600' as const, letterSpacing: 0.5, textTransform: 'uppercase' },
  refNumber:        { fontSize: 22, fontWeight: '800' as const, letterSpacing: 1 },
  refHint:          { fontSize: 11, textAlign: 'center', marginTop: 2 },
  doneBtn:          { width: '100%', borderRadius: 14, paddingVertical: 14, paddingHorizontal: 32, justifyContent: 'center', alignItems: 'center' },
  doneBtnText:      { color: '#fff', fontSize: 15, fontWeight: '700' as const },
  gateBox:          { borderWidth: 1, borderRadius: 14, padding: 14, gap: 10 },
  gateHeader:       { flexDirection: 'row', alignItems: 'center', gap: 8 },
  gateTitle:        { fontSize: 15, fontWeight: '700' as const },
  gateText:         { fontSize: 13, lineHeight: 19 },
  gateBtnRow:       { flexDirection: 'row', gap: 10 },
  gateBtn:          { flex: 1, borderRadius: 10, paddingVertical: 11, alignItems: 'center' },
  gateBtnAlt:       { backgroundColor: 'transparent', borderWidth: 1.5 },
  gateBtnText:      { color: '#fff', fontSize: 14, fontWeight: '700' as const },
  accountCard:      { borderWidth: 1, borderRadius: 12, padding: 14, gap: 8 },
  accountRow:       { flexDirection: 'row', alignItems: 'center', gap: 8 },
  accountText:      { fontSize: 14, fontWeight: '500' as const, flex: 1 },
  accountHint:      { fontSize: 11, lineHeight: 16, marginTop: 2 },
  addPhoneLink:     { flexDirection: 'row', alignItems: 'center', gap: 4, flex: 1 },
  addPhoneLinkText: { fontSize: 13, fontWeight: '500' as const },
});
