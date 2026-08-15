/**
 * New Ticket screen — Multi-product service request.
 *
 * Changes from v1:
 *  - "Bottles & Portable" segment removed (hardware tickets only)
 *  - Multi-select: the customer can flag multiple products per ticket;
 *    all are captured in productModel joined with " / " for the API.
 *  - Success screen shows the ticket reference prominently.
 */
import React, { useState } from 'react';
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

export default function NewTicketScreen() {
  const colors  = useColors();
  const router  = useRouter();
  const api     = useApi();
  const { token } = useAuth();

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
    if (media.length > 0 && !token) {
      setError('An account is required to submit a service request. Please sign in or create an account first.');
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
    } catch (e) {
      // Server requires an account for ticket submission — send the customer
      // to account setup instead of leaving them stuck on an error message.
      if (e instanceof ApiError && (e.status === 401 || e.status === 403)) {
        setError('You need an account to submit a service request. Taking you to account setup…');
        router.push('/auth/register');
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

      {/* Submit */}
      <TouchableOpacity onPress={submit} disabled={submitting}
        style={[styles.submitBtn, { backgroundColor: submitting ? colors.muted : colors.primary }]}>
        {submitting ? <ActivityIndicator color="#fff" size="small" /> : (
          <>
            <Ionicons name="send-outline" size={18} color="#fff" />
            <Text style={styles.submitBtnText}>Submit Ticket</Text>
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
});
