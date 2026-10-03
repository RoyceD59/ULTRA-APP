import React, { useCallback, useState, useEffect, useMemo } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  Share, Alert, ActivityIndicator, Platform, Modal,
  FlatList, TextInput, Pressable,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import * as SMS from 'expo-sms';
import * as Contacts from 'expo-contacts';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { useColors } from '@/hooks/useColors';
import PageDataLoader from '@/components/PageDataLoader';
import PageDataError from '@/components/PageDataError';
import { useRouter } from 'expo-router';
import { useAuth } from '@/context/AuthContext';
import { customerQueryKeys } from '@/lib/customerQueryKeys';
import { useApi, type ReferralDiscountState } from '@/hooks/useApi';

const UC_SKY  = '#52b6dc';
const UC_DEEP = '#005d8f';

// ─── Helpers ──────────────────────────────────────────────────────────────────
function firstPhone(contact: Contacts.ExistingContact): string | null {
  return contact.phoneNumbers?.[0]?.number ?? null;
}

function buildMessage(referralCode: string): string {
  return (
    `Try Ultra Clear — Nairobi's trusted water purification brand.\n\n` +
    `Use my referral code *${referralCode}* when you sign up.\n\n` +
    `Referral rewards are earned only after your first successful eligible purchase.\n\n` +
    `Download the app and get pure, healthy water: ucfilters.com/app\n\n` +
    `Stay hydrated! 💧`
  );
}

function DiscountState({ label, discount }: { label: string; discount: ReferralDiscountState }) {
  const colors = useColors();
  const status = discount.status === 'available'
    ? `${discount.discountPercent}% off available`
    : discount.status === 'used'
      ? `${discount.discountPercent}% off used`
      : 'Not earned yet';
  return (
    <View style={[styles.discountRow, { borderColor: colors.border }]}>
      <View style={[styles.discountIcon, { backgroundColor: discount.status === 'available' ? UC_SKY + '33' : colors.background }]}>
        <Ionicons name={discount.status === 'used' ? 'checkmark-circle-outline' : 'pricetag-outline'} size={20} color={UC_DEEP} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[styles.discountTitle, { color: colors.text }]}>{label}</Text>
        <Text style={[styles.discountStatus, { color: colors.mutedForeground }]}>{status}</Text>
      </View>
    </View>
  );
}
function ContactRow({
  contact, selected, onToggle,
}: {
  contact: Contacts.ExistingContact;
  selected: boolean;
  onToggle: () => void;
}) {
  const colors = useColors();
  const phone = firstPhone(contact);
  const initials = [contact.firstName?.[0], contact.lastName?.[0]]
    .filter(Boolean).join('').toUpperCase() || '?';

  return (
    <Pressable onPress={onToggle}
      style={[styles.contactRow, { borderBottomColor: colors.border }]}>
      {/* Avatar */}
      <View style={[styles.contactAvatar,
        { backgroundColor: selected ? UC_DEEP : UC_SKY + '33' }]}>
        <Text style={[styles.contactInitials, { color: selected ? '#fff' : UC_DEEP }]}>
          {initials}
        </Text>
      </View>
      {/* Name + number */}
      <View style={{ flex: 1 }}>
        <Text style={[styles.contactName, { color: colors.text }]}>
          {[contact.firstName, contact.lastName].filter(Boolean).join(' ') || 'Unknown'}
        </Text>
        {phone ? (
          <Text style={[styles.contactPhone, { color: colors.mutedForeground }]}>{phone}</Text>
        ) : (
          <Text style={[styles.contactPhone, { color: colors.border }]}>No phone number</Text>
        )}
      </View>
      {/* Checkbox */}
      <View style={[styles.checkbox,
        { borderColor: selected ? UC_DEEP : colors.border,
          backgroundColor: selected ? UC_DEEP : 'transparent' }]}>
        {selected && <Ionicons name="checkmark" size={14} color="#fff" />}
      </View>
    </Pressable>
  );
}

// ─── ContactPickerModal ────────────────────────────────────────────────────────
function ContactPickerModal({
  visible, onClose, referralCode,
}: {
  visible: boolean;
  onClose: () => void;
  referralCode: string;
}) {
  const colors = useColors();
  const [contacts, setContacts]         = useState<Contacts.ExistingContact[]>([]);
  const [search, setSearch]             = useState('');
  const [selected, setSelected]         = useState<Set<string>>(new Set());
  const [loading, setLoading]           = useState(false);
  const [permDenied, setPermDenied]     = useState(false);
  const [sending, setSending]           = useState(false);
  const [showPreview, setShowPreview]   = useState(false);

  // Load contacts when modal opens
  useEffect(() => {
    if (!visible) { setSearch(''); setSelected(new Set()); setShowPreview(false); return; }
    if (Platform.OS === 'web') return; // contacts not available on web

    (async () => {
      setLoading(true);
      const { status } = await Contacts.requestPermissionsAsync();
      if (status !== 'granted') { setPermDenied(true); setLoading(false); return; }
      setPermDenied(false);
      const { data } = await Contacts.getContactsAsync({
        fields: [
          Contacts.Fields.FirstName,
          Contacts.Fields.LastName,
          Contacts.Fields.PhoneNumbers,
        ],
        sort: Contacts.SortTypes.FirstName,
      });
      // Only keep contacts that have at least one phone number
      setContacts(data.filter(c => (c.phoneNumbers?.length ?? 0) > 0));
      setLoading(false);
    })();
  }, [visible]);

  const filtered = useMemo(() => {
    if (!search.trim()) return contacts;
    const q = search.toLowerCase();
    return contacts.filter(c =>
      `${c.firstName ?? ''} ${c.lastName ?? ''}`.toLowerCase().includes(q) ||
      firstPhone(c)?.includes(q)
    );
  }, [contacts, search]);

  function toggleContact(id: string) {
    Haptics.selectionAsync();
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  const selectedContacts = contacts.filter(c => c.id && selected.has(c.id));
  const selectedPhones   = selectedContacts.map(c => firstPhone(c)!).filter(Boolean);

  // Share content intentionally excludes both the sender and recipient identity.
  const previewMessage = buildMessage(referralCode);

  async function handleSend() {
    if (selectedPhones.length === 0) {
      Alert.alert('No contacts selected', 'Please select at least one contact to invite.');
      return;
    }

    setSending(true);
    try {
      const smsAvailable = await SMS.isAvailableAsync();
      if (smsAvailable) {
        await SMS.sendSMSAsync(selectedPhones, previewMessage);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        onClose();
        Alert.alert('Invites sent! 🎉', `Your referral was shared with ${selectedContacts.length} contact${selectedContacts.length > 1 ? 's' : ''}.`);
      } else {
        // Fallback: native share sheet
        await Share.share({ message: previewMessage, title: 'Join Ultra Clear!' });
        onClose();
      }
    } catch { /* user cancelled */ }
    setSending(false);
  }

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={[styles.modalContainer, { backgroundColor: colors.background }]}>

        {/* Modal header */}
        <View style={[styles.modalHeader, { backgroundColor: UC_DEEP }]}>
          <TouchableOpacity onPress={onClose} style={styles.modalClose}>
            <Ionicons name="close" size={22} color="#fff" />
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            <Text style={styles.modalTitle}>Invite from Contacts</Text>
            <Text style={styles.modalSub}>
              {selected.size > 0
                ? `${selected.size} contact${selected.size > 1 ? 's' : ''} selected`
                : 'Select contacts to invite'}
            </Text>
          </View>
          {selected.size > 0 && (
            <TouchableOpacity onPress={() => setShowPreview(true)}
              style={[styles.previewBtn, { backgroundColor: UC_SKY }]}>
              <Ionicons name="eye-outline" size={16} color={UC_DEEP} />
              <Text style={[styles.previewBtnText, { color: UC_DEEP }]}>Preview</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Web — not supported */}
        {Platform.OS === 'web' ? (
          <View style={styles.noContactsWrap}>
            <Ionicons name="phone-portrait-outline" size={48} color={colors.mutedForeground} />
            <Text style={[styles.noContactsTitle, { color: colors.text }]}>Use the mobile app</Text>
            <Text style={[styles.noContactsText, { color: colors.mutedForeground }]}>
              Contact access is only available on iOS and Android.{'\n'}Use the Share button to send your code instead.
            </Text>
          </View>
        ) : permDenied ? (
          <View style={styles.noContactsWrap}>
            <Ionicons name="lock-closed-outline" size={48} color={colors.mutedForeground} />
            <Text style={[styles.noContactsTitle, { color: colors.text }]}>Contacts access denied</Text>
            <Text style={[styles.noContactsText, { color: colors.mutedForeground }]}>
              Go to Settings → Ultra Clear → Contacts and enable access to invite friends directly.
            </Text>
            <TouchableOpacity onPress={onClose}
              style={[styles.btn, { backgroundColor: UC_DEEP }]}>
              <Text style={styles.btnText}>Got it</Text>
            </TouchableOpacity>
          </View>
        ) : loading ? (
          <View style={styles.noContactsWrap}>
            <ActivityIndicator color={UC_DEEP} size="large" />
            <Text style={[styles.noContactsText, { color: colors.mutedForeground }]}>Loading contacts…</Text>
          </View>
        ) : (
          <>
            {/* Search bar */}
            <View style={[styles.searchWrap, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Ionicons name="search-outline" size={18} color={colors.mutedForeground} />
              <TextInput
                value={search} onChangeText={setSearch}
                placeholder="Search name or number…"
                placeholderTextColor={colors.border}
                style={[styles.searchInput, { color: colors.text }]}
                clearButtonMode="while-editing"
              />
              {search.length > 0 && Platform.OS !== 'ios' && (
                <TouchableOpacity onPress={() => setSearch('')}>
                  <Ionicons name="close-circle" size={18} color={colors.mutedForeground} />
                </TouchableOpacity>
              )}
            </View>

            {filtered.length === 0 ? (
              <View style={styles.noContactsWrap}>
                <Ionicons name="person-outline" size={48} color={colors.mutedForeground} />
                <Text style={[styles.noContactsText, { color: colors.mutedForeground }]}>
                  {search ? 'No contacts match your search.' : 'No contacts with phone numbers found.'}
                </Text>
              </View>
            ) : (
              <FlatList
                data={filtered}
                keyExtractor={c => c.id}
                renderItem={({ item }) => (
                  <ContactRow
                    contact={item}
                    selected={!!(item.id && selected.has(item.id))}
                    onToggle={() => item.id && toggleContact(item.id)}
                  />
                )}
                contentContainerStyle={{ paddingBottom: 120 }}
                keyboardShouldPersistTaps="handled"
              />
            )}

            {/* Send button — sticky footer */}
            {selected.size > 0 && (
              <View style={[styles.modalFooter, { backgroundColor: colors.background, borderTopColor: colors.border }]}>
                <TouchableOpacity onPress={handleSend} disabled={sending}
                  style={[styles.sendBtn, { backgroundColor: sending ? colors.muted : UC_DEEP }]}>
                  {sending ? (
                    <ActivityIndicator color="#fff" size="small" />
                  ) : (
                    <>
                      <Ionicons name="send" size={18} color="#fff" />
                      <Text style={styles.sendBtnText}>
                        Send Invite{selected.size > 1 ? `s (${selected.size})` : ''}
                      </Text>
                    </>
                  )}
                </TouchableOpacity>
              </View>
            )}
          </>
        )}
      </View>

      {/* Message preview sub-modal */}
      <Modal visible={showPreview} transparent animationType="fade" onRequestClose={() => setShowPreview(false)}>
        <View style={styles.previewOverlay}>
          <View style={[styles.previewCard, { backgroundColor: colors.card }]}>
            <Text style={[styles.previewTitle, { color: colors.text }]}>Message Preview</Text>
            <Text style={[styles.previewMeta, { color: colors.mutedForeground }]}>
              This is what your contact{selected.size > 1 ? 's' : ''} will receive
              :
            </Text>
            <View style={[styles.previewBubble, { backgroundColor: UC_DEEP + '10', borderColor: UC_SKY }]}>
              <Text style={[styles.previewText, { color: colors.text }]}>{previewMessage}</Text>
            </View>
            <View style={styles.previewActions}>
              <TouchableOpacity onPress={() => setShowPreview(false)}
                style={[styles.previewActionBtn, { borderColor: colors.border }]}>
                <Text style={[styles.previewActionText, { color: colors.mutedForeground }]}>Edit selection</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => { setShowPreview(false); handleSend(); }}
                style={[styles.previewActionBtn, { backgroundColor: UC_DEEP, borderColor: UC_DEEP }]}>
                <Ionicons name="send" size={14} color="#fff" />
                <Text style={[styles.previewActionText, { color: '#fff' }]}>Send Now</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </Modal>
  );
}

// ─── Main Screen ──────────────────────────────────────────────────────────────
export default function ReferralScreen() {
  const colors = useColors();
  const router = useRouter();
  const { user } = useAuth();
  const api = useApi();
  const topPad = Platform.OS === 'web' ? 67 : 0;

  const [showContacts, setShowContacts] = useState(false);

  const { data: referral, isLoading: refLoading, isError: refError, error: referralError, refetch: retryReferral } = useQuery({
    queryKey: customerQueryKeys.referral(user?.id),
    queryFn: () => api.getMyReferral(),
    enabled: !!user,
    staleTime: 60_000,
  });

  const handleCopy = useCallback(async () => {
    if (!referral?.code) return;
    await Clipboard.setStringAsync(referral.code);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    Alert.alert('Copied!', `Code ${referral.code} copied to clipboard.`);
  }, [referral?.code]);

  const handleShare = useCallback(async () => {
    if (!referral) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      await Share.share({ message: buildMessage(referral.code), title: 'Join Ultra Clear!' });
    } catch { /* dismissed */ }
  }, [referral]);

  if (!user) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <Ionicons name="person-circle-outline" size={60} color={colors.mutedForeground} />
        <Text style={[styles.guestTitle, { color: colors.text }]}>Sign in to refer friends</Text>
        <TouchableOpacity onPress={() => router.push('/auth/login')}
          style={[styles.btn, { backgroundColor: UC_DEEP }]}>
          <Text style={styles.btnText}>Sign In</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <>
      <ScrollView
        style={[styles.screen, { backgroundColor: colors.background }]}
        contentContainerStyle={{ paddingBottom: Platform.OS === 'web' ? 34 : 80 }}
        showsVerticalScrollIndicator={false}
      >
        {/* Hero header */}
        <View style={[styles.hero, { paddingTop: topPad + 20 }]}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
            <Ionicons name="arrow-back" size={22} color="#fff" />
          </TouchableOpacity>
          <View style={styles.heroIcon}>
            <Ionicons name="gift" size={32} color={UC_DEEP} />
          </View>
          <Text style={styles.heroTitle}>Refer & Earn</Text>
          <Text style={styles.heroSub}>
             Share your code and earn rewards for successful referrals.
          </Text>
        </View>

        <View style={styles.body}>
          {/* Referral code card */}
          {refError ? <PageDataError title="Referral details unavailable" error={referralError} onRetry={retryReferral} /> : null}
          {refLoading ? (
            <PageDataLoader label="Loading referral details…" />
          ) : referral ? (
            <View style={[styles.codeCard, { backgroundColor: colors.card, borderColor: UC_SKY }]}>
              <Text style={[styles.codeLabel, { color: colors.mutedForeground }]}>YOUR REFERRAL CODE</Text>
              <Text style={[styles.codeValue, { color: UC_DEEP }]}>{referral.code}</Text>

              {/* Primary action row */}
              <View style={styles.codeActions}>
                <TouchableOpacity onPress={handleCopy}
                  style={[styles.codeBtn, { backgroundColor: UC_DEEP + '12', borderColor: UC_DEEP }]}>
                  <Ionicons name="copy-outline" size={16} color={UC_DEEP} />
                  <Text style={[styles.codeBtnText, { color: UC_DEEP }]}>Copy</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={handleShare}
                  style={[styles.codeBtn, { backgroundColor: UC_DEEP, borderColor: UC_DEEP }]}>
                  <Ionicons name="share-social-outline" size={16} color="#fff" />
                  <Text style={[styles.codeBtnText, { color: '#fff' }]}>Share Link</Text>
                </TouchableOpacity>
              </View>

              {/* Contacts CTA */}
              <TouchableOpacity
                onPress={() => setShowContacts(true)}
                style={[styles.contactsBtn, { backgroundColor: UC_SKY + '1A', borderColor: UC_SKY }]}>
                <View style={[styles.contactsBtnIcon, { backgroundColor: UC_DEEP }]}>
                  <Ionicons name="people" size={18} color="#fff" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.contactsBtnTitle, { color: UC_DEEP }]}>Invite from Contacts</Text>
                  <Text style={[styles.contactsBtnSub, { color: colors.mutedForeground }]}>
                    Pick friends and send a personalised message
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={UC_DEEP} />
              </TouchableOpacity>
            </View>
          ) : null}

          {/* Durable referral progress */}
          {referral && (
            <View style={styles.statsRow}>
              <View style={[styles.statCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <Text style={[styles.statNum, { color: UC_DEEP }]}>{referral.successfulReferrals}/{referral.referralLimit}</Text>
                <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>Successful referrals</Text>
              </View>
              <View style={[styles.statCard, { backgroundColor: UC_DEEP, borderColor: UC_DEEP }]}>
                <Text style={[styles.statNum, { color: '#fff' }]}>
                   {referral.pointsEarned.toLocaleString()}
                </Text>
                <Text style={[styles.statLabel, { color: 'rgba(255,255,255,0.75)' }]}>Points earned</Text>
              </View>
            </View>
          )}

          {referral && (
            <View style={[styles.benefitsCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Text style={[styles.sectionTitle, { color: colors.text }]}>Your referral benefits</Text>
              <DiscountState label="Earned for referring" discount={referral.discounts.referrer} />
              <DiscountState label="Earned as a referred customer" discount={referral.discounts.referred} />
              {referral.pendingAttribution && (
                <Text style={[styles.pendingText, { color: colors.mutedForeground }]}>
                  Your referral attribution is pending your first successful eligible purchase.
                </Text>
              )}
            </View>
          )}

          {/* How it works */}
          <View style={[styles.howCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>How it works</Text>
            {([
               { icon: 'people-outline', text: 'Pick friends from your contacts or share your code link' },
               { icon: 'person-add-outline', text: 'They sign up and enter your code to be attributed to you' },
               { icon: 'card-outline', text: 'Installing the app or entering a code alone does not earn a benefit' },
               { icon: 'checkmark-circle-outline', text: 'Benefits are issued only after their first successful eligible purchase' },
            ] as const).map((step, i) => (
              <View key={i} style={styles.howStep}>
                <View style={[styles.howIcon, { backgroundColor: UC_SKY + '22' }]}>
                  <Ionicons name={step.icon} size={18} color={UC_DEEP} />
                </View>
                <Text style={[styles.howText, { color: colors.text }]}>{step.text}</Text>
              </View>
            ))}
          </View>

        </View>
      </ScrollView>

      {/* Contact picker modal */}
      {referral && (
        <ContactPickerModal
          visible={showContacts}
          onClose={() => setShowContacts(false)}
          referralCode={referral.code}
        />
      )}
    </>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  screen: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16, padding: 32 },
  guestTitle: { fontSize: 20, fontWeight: '700', textAlign: 'center' },
  btn: { paddingVertical: 14, paddingHorizontal: 40, borderRadius: 12 },
  btnText: { color: '#fff', fontSize: 16, fontWeight: '700' },

  // Hero
  hero: { backgroundColor: UC_DEEP, paddingHorizontal: 24, paddingBottom: 32, alignItems: 'center', gap: 10 },
  backBtn: { position: 'absolute', top: 16, left: 16, padding: 8 },
  heroIcon: { width: 64, height: 64, borderRadius: 32, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center', marginTop: 12 },
  heroTitle: { fontSize: 26, fontWeight: '800', color: '#fff' },
  heroSub: { fontSize: 14, color: 'rgba(255,255,255,0.80)', textAlign: 'center', lineHeight: 20 },

  // Body
  body: { padding: 16, gap: 20 },

  // Code card
  codeCard: { borderRadius: 16, borderWidth: 2, padding: 20, alignItems: 'center', gap: 12 },
  codeLabel: { fontSize: 11, fontWeight: '700', letterSpacing: 1.5 },
  codeValue: { fontSize: 34, fontWeight: '900', letterSpacing: 4 },
  codeActions: { flexDirection: 'row', gap: 10, width: '100%' },
  codeBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderWidth: 1.5, borderRadius: 10, paddingVertical: 12 },
  codeBtnText: { fontSize: 14, fontWeight: '600' },

  // Contacts CTA
  contactsBtn: { flexDirection: 'row', alignItems: 'center', gap: 12, width: '100%', borderWidth: 1.5, borderRadius: 12, padding: 14 },
  contactsBtnIcon: { width: 38, height: 38, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  contactsBtnTitle: { fontSize: 14, fontWeight: '700' },
  contactsBtnSub: { fontSize: 12, marginTop: 1 },

  // Stats
  statsRow: { flexDirection: 'row', gap: 10 },
  statCard: { flex: 1, borderRadius: 12, borderWidth: 1, padding: 14, alignItems: 'center', gap: 4 },
  statNum: { fontSize: 18, fontWeight: '800' },
  statLabel: { fontSize: 11, fontWeight: '500', textAlign: 'center' },

  // How it works
  howCard: { borderRadius: 14, borderWidth: 1, padding: 16, gap: 14 },
  sectionTitle: { fontSize: 17, fontWeight: '700' },
  howStep: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  howIcon: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  howText: { flex: 1, fontSize: 14, lineHeight: 20 },

  // Referral benefits
  benefitsCard: { borderRadius: 14, borderWidth: 1, padding: 16, gap: 12 },
  discountRow: { flexDirection: 'row', alignItems: 'center', gap: 10, borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 12 },
  discountIcon: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  discountTitle: { fontSize: 14, fontWeight: '700' },
  discountStatus: { fontSize: 13, marginTop: 2 },
  pendingText: { fontSize: 12, lineHeight: 17 },

  // Contact picker modal
  modalContainer: { flex: 1 },
  modalHeader: { paddingTop: Platform.OS === 'ios' ? 0 : 16, paddingBottom: 16, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', gap: 12 },
  modalClose: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  modalTitle: { color: '#fff', fontSize: 17, fontWeight: '700' },
  modalSub: { color: 'rgba(255,255,255,0.75)', fontSize: 13, marginTop: 1 },
  previewBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8 },
  previewBtnText: { fontSize: 13, fontWeight: '600' },

  searchWrap: { flexDirection: 'row', alignItems: 'center', gap: 8, margin: 12, borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10 },
  searchInput: { flex: 1, fontSize: 15 },

  // Contact row
  contactRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  contactAvatar: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  contactInitials: { fontSize: 16, fontWeight: '700' },
  contactName: { fontSize: 15, fontWeight: '600' },
  contactPhone: { fontSize: 13, marginTop: 1 },
  checkbox: { width: 24, height: 24, borderRadius: 12, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },

  // No contacts / empty states
  noContactsWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16, padding: 40 },
  noContactsTitle: { fontSize: 18, fontWeight: '700', textAlign: 'center' },
  noContactsText: { fontSize: 14, textAlign: 'center', lineHeight: 20 },

  // Footer / send button
  modalFooter: { position: 'absolute', bottom: 0, left: 0, right: 0, padding: 16, paddingBottom: Platform.OS === 'ios' ? 32 : 16, borderTopWidth: 1 },
  sendBtn: { borderRadius: 14, paddingVertical: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  sendBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },

  // Message preview sub-modal
  previewOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', padding: 24 },
  previewCard: { borderRadius: 20, padding: 20, gap: 14 },
  previewTitle: { fontSize: 18, fontWeight: '700' },
  previewMeta: { fontSize: 13, lineHeight: 18 },
  previewBubble: { borderRadius: 12, borderWidth: 1, padding: 14 },
  previewText: { fontSize: 14, lineHeight: 22 },
  previewActions: { flexDirection: 'row', gap: 10 },
  previewActionBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderWidth: 1, borderRadius: 10, paddingVertical: 12 },
  previewActionText: { fontSize: 14, fontWeight: '600' },
});
