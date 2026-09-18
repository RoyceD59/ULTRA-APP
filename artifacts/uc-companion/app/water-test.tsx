import React, { useState, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, ScrollView, TextInput, TouchableOpacity, ActivityIndicator, Platform, Alert, Modal, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useAuth } from '@/context/AuthContext';
import * as Haptics from 'expo-haptics';
import * as Crypto from 'expo-crypto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { openWhatsApp } from '@/lib/whatsapp';
import MediaPicker, { MediaItem } from '@/components/MediaPicker';
import { uploadMediaItems } from '@/lib/uploadMedia';
import { useApi } from '@/hooks/useApi';
import { saveDraft, loadDraft, clearDraft, enqueueDraftSave } from '@/lib/formDrafts';
import { KeyboardAwareScrollViewCompat } from '@/components/KeyboardAwareScrollViewCompat';
import {
  useCreatePublicInstantWaterAssessment,
  useCreateAuthenticatedInstantWaterAssessment,
  useRequestInstantWaterAssessmentVerification,
  useConfirmInstantWaterAssessmentVerification,
  useAttachInstantWaterAssessment,
  useRequestInstantWaterPhysicalTest,
  useListAuthenticatedInstantWaterAssessments,
  useConsumeInstantWaterAssessmentHandoff,
  InstantWaterSource,
  InstantWaterConcern,
  InstantWaterSetting,
  InstantWaterPhysicalTestRequestInputMediaReferencesItemMediaType
} from '@workspace/api-client-react';
import type {
  InstantWaterAssessmentCreated,
  AuthenticatedInstantWaterAssessmentCreated,
  InstantWaterAssessment,
  PublicInstantWaterAssessmentResult
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { HANDOFF_STORAGE_KEY, useConsumeHandoff } from '@/hooks/useWaterTestHandoff';
import { ApiError } from '@/hooks/apiError';
import {
  isValidInstantFirstName,
  isValidInstantPhone,
  normalizeInstantFirstName,
  normalizeInstantPhone,
} from '@workspace/api-zod/instant-water-identity';
import { countryCodeFromValue, type SupportedCountryCode } from '@workspace/api-zod/phone';
import { trackEvent } from '@/lib/analytics';
import { CountryPicker } from '@/components/CountryPicker';

type ViewState = 'form' | 'result' | 'history' | 'booking';

const SOURCES = [
  { label: 'Piped / municipal tap', value: InstantWaterSource.municipal },
  { label: 'Borehole or deep well', value: InstantWaterSource.borehole },
  { label: 'Shallow well, river or spring', value: InstantWaterSource.shallow },
  { label: 'Water vendor, bowser or tanker', value: InstantWaterSource.vendor },
  { label: 'Bottled or sachet water', value: InstantWaterSource.bottled },
  { label: 'Rainwater harvesting', value: InstantWaterSource.rain },
];
const CONCERNS = [
  { label: 'White scale in the kettle, appliances dying early', value: InstantWaterConcern.scale },
  { label: 'Taste or smell — chlorine, metallic, earthy', value: InstantWaterConcern.taste },
  { label: 'Cloudy water, sediment or staining', value: InstantWaterConcern.cloudy },
  { label: 'Dry skin, itchy scalp, hair feels rough after showering', value: InstantWaterConcern.skin },
  { label: 'Not sure it is safe to drink', value: InstantWaterConcern.safety },
  { label: 'Cost of buying bottled water every week', value: InstantWaterConcern.cost },
];
const SETTINGS = [
  { label: 'My home', value: InstantWaterSetting.home },
  { label: 'A rented place', value: InstantWaterSetting.rental },
  { label: 'A salon, spa or barber', value: InstantWaterSetting.salon },
  { label: 'An office or co-working space', value: InstantWaterSetting.office },
  { label: 'A hotel, lodge, restaurant or gym', value: InstantWaterSetting.hospitality },
  { label: 'A school, clinic or NGO', value: InstantWaterSetting.school },
  { label: 'I want to resell or distribute', value: InstantWaterSetting.resell },
];

export default function WaterTestScreen() {
  const colors = useColors();
  const { user, token } = useAuth();
  const api = useApi();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [view, setView] = useState<ViewState>('form');
  const [assessment, setAssessment] = useState<InstantWaterAssessmentCreated | AuthenticatedInstantWaterAssessmentCreated | null>(null);
  const [actionToken, setActionToken] = useState<string>('');

  const [attachError, setAttachError] = useState<string | null>(null);
  const [pendingAttach, setPendingAttach] = useState<any>(null);

  const attachMut = useAttachInstantWaterAssessment();

  const { handoffPending, handoffSuccess, handoffError, clearHandoffError, retryHandoff } = useConsumeHandoff((res) => {
    setView('history');
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
  });

  const attemptAttach = async (parsed: any) => {
    const pending = parsed.assessment || parsed;
    if (pending && pending.assessmentId) {
      setAttachError(null);
      const attachData: any = {};
      if (pending.resultToken) attachData.resultToken = pending.resultToken;
      try {
        await attachMut.mutateAsync({
          assessmentId: pending.assessmentId,
          data: attachData
        });
        await AsyncStorage.removeItem('pending_water_test_attach');
        setPendingAttach(null);
        setAssessment(pending);
        setView('history');
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      } catch (err) {
        console.warn('Failed to attach pending test on login:', err);
        setPendingAttach(parsed);
        setAttachError("We couldn't securely save your previous test to your account. Please try again.");
      }
    }
  };

  // On mount or login, check if there's a pending public test to attach
  useEffect(() => {
    if (token) {
      AsyncStorage.getItem('pending_water_test_attach').then(val => {
        if (val) {
          try {
            attemptAttach(JSON.parse(val));
          } catch (e) {}
        }
      });
    }
  }, [token]);

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      {view === 'form' ? (
        <FormView
          colors={colors} user={user} token={token} router={router}
          handoffPending={handoffPending} handoffSuccess={handoffSuccess}
          handoffError={handoffError} clearHandoffError={clearHandoffError}
          retryHandoff={retryHandoff}
          attachError={attachError} pendingAttach={pendingAttach} attemptAttach={attemptAttach}
          clearAttachError={() => { setAttachError(null); AsyncStorage.removeItem('pending_water_test_attach'); }}
          onResult={(ass) => { setAssessment(ass); setView('result'); }}
          onHistory={() => setView('history')}
        />
      ) : null}
      {view === 'result' && assessment ? (
        <ResultView
          colors={colors} token={token} assessment={assessment}
          actionToken={actionToken} setActionToken={setActionToken}
          onBook={() => setView('booking')} onBack={() => setView('form')}
          onHistory={() => setView('history')} router={router}
        />
      ) : null}
      {view === 'history' ? (
        <HistoryView colors={colors} onBack={() => setView('form')} token={token} />
      ) : null}
      {view === 'booking' && assessment ? (
        <BookingView
          colors={colors} api={api} assessment={assessment} actionToken={actionToken}
          onBack={() => setView('result')}
          onComplete={() => {
            Alert.alert("Request Submitted", "We will contact you shortly to confirm your booking.");
            setView('history');
          }}
        />
      ) : null}
    </View>
  );
}

// ----------------------------------------------------------------------------
// FORM VIEW
// ----------------------------------------------------------------------------
interface Draft {
  firstName: string;
  phone: string;
  country: string;
  area: string;
  source: InstantWaterSource | '';
  concern: InstantWaterConcern | '';
  setting: InstantWaterSetting | '';
  consent: boolean;
}

interface FormViewProps {
  colors: any;
  user: any;
  token: string | null;
  onResult: (ass: InstantWaterAssessmentCreated | AuthenticatedInstantWaterAssessmentCreated) => void;
  onHistory: () => void;
  router: any;
  handoffPending?: boolean;
  handoffSuccess?: boolean;
  handoffError?: string | null;
  clearHandoffError?: () => void;
  retryHandoff?: () => void;
  attachError?: string | null;
  pendingAttach?: any;
  attemptAttach?: (parsed: any) => void;
  clearAttachError?: () => void;
}

function FormView({ colors, user, token, handoffPending, handoffSuccess, handoffError, clearHandoffError, retryHandoff, attachError, pendingAttach, attemptAttach, clearAttachError, onResult, onHistory, router }: FormViewProps) {
  const insets = useSafeAreaInsets();
  const [draft, setDraft] = useState<Draft>({
    firstName: user?.firstName || '',
    phone: user?.phone || '',
    country: 'KE', area: '', source: '', concern: '', setting: '', consent: false
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const draftReady = useRef(false);

  const publicMut = useCreatePublicInstantWaterAssessment();
  const authMut = useCreateAuthenticatedInstantWaterAssessment();

  const idempKeyRef = useRef(Crypto.randomUUID());

  useEffect(() => {
    loadDraft<Draft>('water-test').then(d => {
      if (d) setDraft(prev => ({ ...prev, ...d, country: countryCodeFromValue(d.country) ?? 'KE' }));
      draftReady.current = true;
    });
  }, []);

  useEffect(() => {
    if (!draftReady.current) return;
    enqueueDraftSave('water-test', () => saveDraft('water-test', draft));
  }, [draft]);

  const setField = (k: keyof Draft, v: string | boolean) => {
    setDraft(prev => ({ ...prev, [k]: v }));
    setError('');
  };

  const submit = async () => {
    if (!draft.firstName.trim() || !draft.phone.trim() || !draft.country || !draft.area.trim() || !draft.source || !draft.concern || !draft.setting) {
      setError('Please fill in all required fields.');
      return;
    }
    if (!isValidInstantFirstName(draft.firstName)) {
      setError('Enter a valid first name (2–80 letters, with normal spaces, apostrophes, or hyphens).');
      return;
    }
    const country = countryCodeFromValue(draft.country) ?? 'KE';
    if (!isValidInstantPhone(draft.phone, country)) {
      setError('Enter a valid phone number for the selected country.');
      return;
    }
    if (!token && !draft.consent) {
      setError('Please agree to receive your result.');
      return;
    }

    trackEvent('water_check_started', { countryCode: country });
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    setSubmitting(true);
    setError('');

    try {
      const idempotencyKey = idempKeyRef.current;
      let res;
      if (token) {
        res = await authMut.mutateAsync({
          data: {
            idempotencyKey,
            firstName: normalizeInstantFirstName(draft.firstName) ?? draft.firstName.trim(),
            phone: normalizeInstantPhone(draft.phone, country) ?? draft.phone.trim(),
            answers: {
              country: draft.country,
              area: draft.area.trim(),
              source: draft.source,
              concern: draft.concern,
              setting: draft.setting
            }
          }
        });
      } else {
        res = await publicMut.mutateAsync({
          data: {
            idempotencyKey,
            firstName: normalizeInstantFirstName(draft.firstName) ?? draft.firstName.trim(),
            phone: normalizeInstantPhone(draft.phone, country) ?? draft.phone.trim(),
            consent: true,
            answers: {
              country: draft.country,
              area: draft.area.trim(),
              source: draft.source,
              concern: draft.concern,
              setting: draft.setting
            }
          }
        });
      }
      await clearDraft('water-test');
      idempKeyRef.current = Crypto.randomUUID(); // reset on success
      trackEvent('water_check_completed', { countryCode: country });
      onResult(res);
    } catch (err: any) {
      const status = err instanceof ApiError ? err.status : 0;
      if (status === 400) {
        setError('Please check your details and try again.');
      } else {
        setError('Something went wrong connecting to the server. Please try again.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: Math.max(40, insets.bottom + 20) }} keyboardShouldPersistTaps="handled">
      {handoffPending && !token ? (
        <View style={{ backgroundColor: '#FEF3C7', padding: Math.max(insets.top + 8, 16), paddingBottom: 16, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <Text style={{ flex: 1, color: '#92400E', fontSize: 14 }}>
            Please sign in or create an account to view your water check.
          </Text>
          <TouchableOpacity onPress={() => router.push({ pathname: '/auth/login', params: { returnTo: '/water-test' } })} style={{ backgroundColor: '#D97706', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 6, marginLeft: 12 }}>
            <Text style={{ color: '#fff', fontSize: 13, fontWeight: '600' }}>Sign In</Text>
          </TouchableOpacity>
        </View>
      ) : null}
      {handoffPending && token ? (
        <View style={{ backgroundColor: '#DBEAFE', padding: Math.max(insets.top + 8, 16), paddingBottom: 16, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <Text style={{ flex: 1, color: '#1E3A8A', fontSize: 14 }}>
            Saving your water check securely...
          </Text>
          <ActivityIndicator color="#1E3A8A" style={{ marginLeft: 8 }} />
        </View>
      ) : null}
      {handoffSuccess ? (
        <View style={{ backgroundColor: '#D1FAE5', padding: Math.max(insets.top + 8, 12), paddingBottom: 12, paddingHorizontal: 12, alignItems: 'center' }}>
          <Text style={{ color: '#065F46', fontSize: 14, fontWeight: '500' }}>Assessment saved to your account!</Text>
        </View>
      ) : null}
      {handoffError ? (
        <View style={{ backgroundColor: '#FEE2E2', padding: Math.max(insets.top + 8, 16), paddingBottom: 16, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <Text style={{ flex: 1, color: '#B91C1C', fontSize: 14, lineHeight: 20 }}>
            {handoffError}
          </Text>
          {retryHandoff ? (
             <Pressable onPress={retryHandoff} style={({ pressed }) => [{ padding: 6, opacity: pressed ? 0.7 : 1 }]}>
                <Text style={{ color: '#B91C1C', fontWeight: '600', fontSize: 13 }}>Retry</Text>
             </Pressable>
          ) : null}
          <TouchableOpacity onPress={clearHandoffError} style={{ padding: 4, marginLeft: 8 }}>
            <Ionicons name="close" size={20} color="#B91C1C" />
          </TouchableOpacity>
        </View>
      ) : null}
      {attachError ? (
        <View style={{ backgroundColor: '#FEE2E2', padding: Math.max(insets.top + 8, 16), paddingBottom: 16, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <Text style={{ flex: 1, color: '#B91C1C', fontSize: 14, lineHeight: 20 }}>
            {attachError}
          </Text>
          {attemptAttach && pendingAttach ? (
             <Pressable onPress={() => attemptAttach(pendingAttach)} style={({ pressed }) => [{ padding: 6, opacity: pressed ? 0.7 : 1 }]}>
                <Text style={{ color: '#B91C1C', fontWeight: '600', fontSize: 13 }}>Retry</Text>
             </Pressable>
          ) : null}
          <TouchableOpacity onPress={clearAttachError} style={{ padding: 4, marginLeft: 8 }}>
            <Ionicons name="close" size={20} color="#B91C1C" />
          </TouchableOpacity>
        </View>
      ) : null}

      <View style={[styles.hero, { backgroundColor: colors.primary, paddingTop: !handoffPending && !handoffSuccess && !handoffError && !attachError ? Math.max(insets.top + 16, 40) : 24 }]}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
           <Text style={styles.eyebrow}>FREE · 60 SECONDS · NO LAB NEEDED</Text>
           {token ? (
             <TouchableOpacity onPress={onHistory} style={[styles.historyBtn, { backgroundColor: 'rgba(255,255,255,0.15)' }]}>
                <Ionicons name="time-outline" size={16} color="#fff" />
                <Text style={styles.historyBtnText}>History</Text>
             </TouchableOpacity>
           ) : null}
        </View>
        <Text style={styles.heroTitle}>What is actually in your water?</Text>
        <Text style={styles.heroLede}>
          Six questions. You get an indicative read on hardness, taste, sediment and microbial risk for your area and your water source — on this screen, straight away.
        </Text>
      </View>

      <View style={styles.formContainer}>
        {/* Contact details */}
        <View style={styles.row}>
          <View style={[styles.field, styles.rowField]}>
            <Text style={[styles.label, { color: colors.mutedForeground }]}>First name *</Text>
            <TextInput
              value={draft.firstName} onChangeText={v => setField('firstName', v)}
              placeholder="Amara" placeholderTextColor={colors.border}
              style={[styles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.card }]}
            />
          </View>
          <View style={[styles.field, styles.rowField]}>
            <Text style={[styles.label, { color: colors.mutedForeground }]}>WhatsApp *</Text>
            <TextInput
              value={draft.phone} onChangeText={v => setField('phone', v)}
              placeholder="+254 700 000000" placeholderTextColor={colors.border} keyboardType="phone-pad"
              style={[styles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.card }]}
            />
          </View>
        </View>

        <View style={styles.row}>
          <View style={[styles.field, styles.rowField]}>
            <CountryPicker
              value={(countryCodeFromValue(draft.country) ?? 'KE') as SupportedCountryCode}
              onChange={(code) => setField('country', code)}
              colors={colors}
              label="Country *"
            />
          </View>
        </View>

        <View style={styles.field}>
          <Text style={[styles.label, { color: colors.mutedForeground }]}>Town / area *</Text>
          <TextInput
            value={draft.area} onChangeText={v => setField('area', v)}
            placeholder="Nairobi – Westlands" placeholderTextColor={colors.border}
            style={[styles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.card }]}
          />
        </View>

        <View style={styles.field}>
          <Text style={[styles.label, { color: colors.mutedForeground }]}>Where does your water come from? *</Text>
          <View style={styles.colChips}>
            {SOURCES.map(s => (
              <TouchableOpacity key={s.value} onPress={() => setField('source', s.value)}
                style={[styles.fullChip, { backgroundColor: draft.source === s.value ? colors.primary : colors.surface, borderColor: draft.source === s.value ? colors.primary : colors.border }]}>
                <Text style={{ flexShrink: 1, fontSize: 14, fontWeight: '500', color: draft.source === s.value ? '#fff' : colors.text }}>{s.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        <View style={styles.field}>
          <Text style={[styles.label, { color: colors.mutedForeground }]}>What bothers you most? *</Text>
          <View style={styles.colChips}>
            {CONCERNS.map(s => (
              <TouchableOpacity key={s.value} onPress={() => setField('concern', s.value)}
                style={[styles.fullChip, { backgroundColor: draft.concern === s.value ? colors.primary : colors.surface, borderColor: draft.concern === s.value ? colors.primary : colors.border }]}>
                <Text style={{ flexShrink: 1, fontSize: 14, fontWeight: '500', color: draft.concern === s.value ? '#fff' : colors.text }}>{s.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        <View style={styles.field}>
          <Text style={[styles.label, { color: colors.mutedForeground }]}>This is for *</Text>
          <View style={styles.chipsWrap}>
            {SETTINGS.map(s => (
              <TouchableOpacity key={s.value} onPress={() => setField('setting', s.value)}
                style={[styles.chip, { backgroundColor: draft.setting === s.value ? colors.primary : colors.surface, borderColor: draft.setting === s.value ? colors.primary : colors.border }]}>
                <Text style={{ fontSize: 13, fontWeight: '500', color: draft.setting === s.value ? '#fff' : colors.text }}>{s.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {!token ? (
          <TouchableOpacity activeOpacity={0.8} onPress={() => setField('consent', !draft.consent)} style={styles.consentRow}>
            <View style={[styles.checkbox, { backgroundColor: draft.consent ? colors.primary : colors.surface, borderColor: draft.consent ? colors.primary : colors.border }]}>
              {draft.consent ? <Ionicons name="checkmark" size={16} color="#fff" /> : null}
            </View>
            <Text style={[styles.consentText, { color: colors.mutedForeground }]}>
              Send my result and let an Ultra Clear specialist follow up on WhatsApp. I can opt out any time.
            </Text>
          </TouchableOpacity>
        ) : null}

        {error ? (
          <View style={[styles.errorBox, { backgroundColor: colors.destructive + '12', borderColor: colors.destructive + '30' }]}>
            <Ionicons name="alert-circle-outline" size={16} color={colors.destructive} />
            <Text style={[styles.errorText, { color: colors.destructive }]}>{error}</Text>
          </View>
        ) : null}

        <TouchableOpacity onPress={submit} disabled={submitting} style={[styles.submitBtn, { backgroundColor: submitting ? colors.muted : colors.primary }]}>
          {submitting ? <ActivityIndicator color="#fff" /> : <Text style={styles.submitBtnText}>Show my water reading</Text>}
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}


// ----------------------------------------------------------------------------
// RESULT VIEW
// ----------------------------------------------------------------------------
interface ResultViewProps {
  colors: any;
  token: string | null;
  assessment: InstantWaterAssessmentCreated | AuthenticatedInstantWaterAssessmentCreated;
  actionToken: string;
  setActionToken: (tk: string) => void;
  onBook: () => void;
  onBack: () => void;
  onHistory: () => void;
  router: any;
}

function ResultView({ colors, token, assessment, actionToken, setActionToken, onBook, onBack, onHistory, router }: ResultViewProps) {
  const result = assessment.result;
  const isPublic = !token && 'resultToken' in assessment && assessment.resultToken;
  const [verifyVisible, setVerifyVisible] = useState(false);
  const insets = useSafeAreaInsets();

  const handleWhatsApp = () => {
    const text = `Hello Ultra Clear, here is my water check result.\nReference: ${assessment.reference}\nResult: Hardness ${result.bands?.hardness || 'Unknown'}, Taste ${result.bands?.taste || 'Unknown'}, Sediment ${result.bands?.sediment || 'Unknown'}, Microbial ${result.bands?.microbial || 'Unknown'}\nRecommendation: ${result.recommendation?.name || 'Please contact us'}`;
    openWhatsApp(text);
  };

  const handleBookClick = () => {
    if (isPublic && !actionToken) {
      setVerifyVisible(true);
    } else {
      onBook();
    }
  };

  const handleSaveToAccount = async () => {
    if (isPublic) {
      await AsyncStorage.setItem('pending_water_test_attach', JSON.stringify({ assessment, actionToken }));
      router.push({ pathname: '/auth/login', params: { returnTo: '/water-test' } });
    } else {
      onHistory();
    }
  };

  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 20, paddingTop: Math.max(insets.top + 16, 20), paddingBottom: Math.max(insets.bottom + 40, 40) }}>
      <TouchableOpacity onPress={onBack} style={{ marginBottom: 16, alignSelf: 'flex-start' }}>
        <Ionicons name="arrow-back" size={24} color={colors.text} />
      </TouchableOpacity>

      <View style={styles.resultHeader}>
        <Text style={[styles.eyebrow, { color: colors.primary }]}>YOUR INDICATIVE READING</Text>
        <Text style={[styles.rTitle, { color: colors.text, textAlign: 'center' }]}>Water profile</Text>
        <Text style={[styles.rSub, { color: colors.mutedForeground, textAlign: 'center' }]}>Ref: {assessment.reference}</Text>
      </View>

      <View style={styles.bands}>
        <BandBar name="Hardness & scale" level={result.bands?.hardness || 'Unknown'} colors={colors} />
        <BandBar name="Taste & odour" level={result.bands?.taste || 'Unknown'} colors={colors} />
        <BandBar name="Sediment & clarity" level={result.bands?.sediment || 'Unknown'} colors={colors} />
        <BandBar name="Microbial risk" level={result.bands?.microbial || 'Unknown'} colors={colors} />
      </View>

      {result.recommendation ? (
        <View style={[styles.recBox, { backgroundColor: colors.primary + '12', borderColor: colors.primary + '30' }]}>
          <Text style={[styles.eyebrow, { color: colors.primary }]}>BEST MATCH</Text>
          <Text style={[styles.recName, { color: colors.text }]}>{result.recommendation.name}</Text>
          <Text style={[styles.recWhy, { color: colors.mutedForeground }]}>{result.recommendation.explanation}</Text>
        </View>
      ) : null}

      {result.areaFlag === 'rift_valley_fluoride' ? (
        <View style={[styles.flagBox, { backgroundColor: '#FFFBEB', borderColor: '#FCD34D' }]}>
          <Text style={[styles.flagText, { color: '#92400E' }]}>
            <Text style={{ fontWeight: '700' }}>Rift Valley Flag: </Text>
            Groundwater across the Rift Valley commonly carries elevated fluoride. That needs a laboratory test, not a field kit. We flag it for the technician so it is measured properly.
          </Text>
        </View>
      ) : null}

      <View style={[styles.nextBox, { borderTopColor: colors.border }]}>
        <Text style={[styles.nextTitle, { color: colors.text }]}>Next steps</Text>
        <Text style={[styles.nextBody, { color: colors.mutedForeground }]}>
          {result.serviceAvailable
            ? 'A technician can test your actual water on-site and leave you the numbers whether or not you buy anything.'
            : 'A specialist can send the right options for this profile on WhatsApp.'}
        </Text>

        {result.serviceAvailable ? (
          <TouchableOpacity onPress={handleBookClick} style={[styles.actionBtn, { backgroundColor: colors.primary }]}>
             <Text style={styles.actionBtnText}>Book a physical water test</Text>
          </TouchableOpacity>
        ) : null}

        <TouchableOpacity onPress={handleWhatsApp} style={[styles.actionBtn, { backgroundColor: '#25D366' }]}>
           <Text style={styles.actionBtnText}>Send result on WhatsApp</Text>
        </TouchableOpacity>

        {isPublic ? (
          <TouchableOpacity onPress={handleSaveToAccount} style={[styles.ghostBtn, { borderColor: colors.primary }]}>
             <Text style={[styles.ghostBtnText, { color: colors.primary }]}>Sign in to save to my account</Text>
          </TouchableOpacity>
        ) : null}
        {token ? (
          <TouchableOpacity onPress={onHistory} style={[styles.ghostBtn, { borderColor: colors.primary }]}>
             <Text style={[styles.ghostBtnText, { color: colors.primary }]}>View in my account</Text>
          </TouchableOpacity>
        ) : null}
      </View>

      <Text style={[styles.disclaimer, { color: colors.mutedForeground }]}>
        {result.disclaimer || 'This is an indicative profile built from your answers and known conditions. It is not a laboratory analysis and is not a health assessment.'}
      </Text>

      <VerificationModal
        visible={verifyVisible} assessmentId={assessment.assessmentId} colors={colors}
        onClose={() => setVerifyVisible(false)}
        onSuccess={(tk: string) => { setActionToken(tk); setVerifyVisible(false); onBook(); }}
      />
    </ScrollView>
  );
}

function BandBar({ name, level, colors }: { name: string, level: string, colors: any }) {
  const levels: Record<string, number> = { Low: 1, Moderate: 2, High: 3, Unknown: 0 };
  const val = levels[level] || 0;
  const pct = val === 0 ? 0 : (val / 3) * 100;
  const color = level === 'High' ? colors.destructive : level === 'Moderate' ? '#F59E0B' : level === 'Low' ? colors.success : colors.muted;

  return (
    <View style={{ marginBottom: 16 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 }}>
        <Text style={{ fontSize: 13, fontWeight: '600', color: colors.text, flexShrink: 1, marginRight: 8 }}>{name}</Text>
        <Text style={{ fontSize: 11, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.5, color }}>{level}</Text>
      </View>
      <View style={{ height: 8, backgroundColor: colors.border, borderRadius: 4, overflow: 'hidden' }}>
        <View style={{ width: `${pct}%`, height: '100%', backgroundColor: color, borderRadius: 4 }} />
      </View>
    </View>
  );
}


// ----------------------------------------------------------------------------
// HISTORY VIEW
// ----------------------------------------------------------------------------
interface HistoryViewProps {
  colors: any;
  onBack: () => void;
  token: string | null;
}

function HistoryView({ colors, onBack, token }: HistoryViewProps) {
  const { data, isLoading, error, refetch } = useListAuthenticatedInstantWaterAssessments();
  const insets = useSafeAreaInsets();

  return (
    <View style={{ flex: 1 }}>
      <View style={[styles.historyHeader, { backgroundColor: colors.primary, paddingTop: Math.max(insets.top + 8, 16) }]}>
        <TouchableOpacity onPress={onBack} style={{ padding: 8 }}>
          <Ionicons name="arrow-back" size={24} color="#fff" />
        </TouchableOpacity>
        <Text style={styles.historyTitle}>Water Test History</Text>
        <View style={{ width: 40 }} />
      </View>

      {!token ? (
         <View style={{ padding: 24, alignItems: 'center' }}>
            <Text style={{ color: colors.mutedForeground, textAlign: 'center' }}>You must be signed in to view history.</Text>
         </View>
      ) : isLoading ? (
         <View style={{ padding: 40, alignItems: 'center' }}><ActivityIndicator color={colors.primary} /></View>
      ) : error ? (
         <View style={{ padding: 24, alignItems: 'center' }}>
            <Text style={{ color: colors.destructive, textAlign: 'center', marginBottom: 16 }}>Failed to load history securely.</Text>
            <Pressable onPress={() => refetch()} style={({ pressed }) => [{ paddingHorizontal: 16, paddingVertical: 10, borderRadius: 8, backgroundColor: colors.primary, opacity: pressed ? 0.7 : 1 }]}>
               <Text style={{ color: '#fff', fontWeight: '600' }}>Retry</Text>
            </Pressable>
         </View>
      ) : data?.assessments && data.assessments.length === 0 ? (
         <View style={{ padding: 40, alignItems: 'center' }}>
            <Ionicons name="flask-outline" size={48} color={colors.border} />
            <Text style={{ color: colors.mutedForeground, marginTop: 12 }}>No tests found.</Text>
         </View>
      ) : (
        <ScrollView contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: Math.max(insets.bottom + 16, 16) }}>
          {data?.assessments?.map((item: InstantWaterAssessment) => (
            <View key={item.assessmentId} style={[styles.historyCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 }}>
                <Text style={{ fontSize: 14, fontWeight: '700', color: colors.text, flexShrink: 1 }}>{item.reference}</Text>
                <Text style={{ fontSize: 12, color: colors.mutedForeground, marginLeft: 8 }}>
                  {item.createdAt ? new Date(item.createdAt).toLocaleDateString() : ''}
                </Text>
              </View>
              <View style={styles.historyBandsRow}>
                <Text style={{ fontSize: 12, color: colors.mutedForeground }}>Hardness: <Text style={{ fontWeight: '600', color: colors.text }}>{item.bands?.hardness || 'N/A'}</Text></Text>
                <Text style={{ fontSize: 12, color: colors.mutedForeground }}>Taste: <Text style={{ fontWeight: '600', color: colors.text }}>{item.bands?.taste || 'N/A'}</Text></Text>
              </View>
              <View style={styles.historyBandsRow}>
                <Text style={{ fontSize: 12, color: colors.mutedForeground }}>Sediment: <Text style={{ fontWeight: '600', color: colors.text }}>{item.bands?.sediment || 'N/A'}</Text></Text>
                <Text style={{ fontSize: 12, color: colors.mutedForeground }}>Microbial: <Text style={{ fontWeight: '600', color: colors.text }}>{item.bands?.microbial || 'N/A'}</Text></Text>
              </View>
              <View style={[styles.statusPill, { backgroundColor: colors.surface, marginTop: 10 }]}>
                <Text style={{ fontSize: 11, fontWeight: '600', color: colors.mutedForeground, textTransform: 'uppercase' }}>
                  {item.serviceState ? item.serviceState.replace(/_/g, ' ') : 'UNKNOWN'}
                </Text>
              </View>
            </View>
          ))}
        </ScrollView>
      )}
    </View>
  );
}


// ----------------------------------------------------------------------------
// BOOKING VIEW
// ----------------------------------------------------------------------------
interface BookingViewProps {
  colors: any;
  api: any;
  assessment: InstantWaterAssessmentCreated | AuthenticatedInstantWaterAssessmentCreated;
  actionToken: string;
  onBack: () => void;
  onComplete: () => void;
}

function BookingView({ colors, api, assessment, actionToken, onBack, onComplete }: BookingViewProps) {
  const [address, setAddress] = useState('');
  const [time, setTime] = useState('');
  const [media, setMedia] = useState<MediaItem[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const insets = useSafeAreaInsets();

  const bookMut = useRequestInstantWaterPhysicalTest();
  const idempKeyRef = useRef(Crypto.randomUUID());

  const submit = async () => {
    if (!address.trim() || !time.trim()) {
      setError("Please provide address and preferred time.");
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      const uploaded = media.length
        ? await uploadMediaItems(
            media,
            (meta) =>
              api.requestUploadUrl({
                ...meta,
                assessmentId: assessment.assessmentId,
                actionToken: actionToken || undefined,
              })
          )
        : [];
      const mediaReferences = uploaded.map(m => ({
        reference: m.url,
        mediaType: m.type === 'photo'
          ? InstantWaterPhysicalTestRequestInputMediaReferencesItemMediaType.jpg
          : InstantWaterPhysicalTestRequestInputMediaReferencesItemMediaType.mp4
      }));

      await bookMut.mutateAsync({
        assessmentId: assessment.assessmentId,
        data: {
          idempotencyKey: idempKeyRef.current,
          actionToken: actionToken || undefined,
          serviceAddress: address.trim(),
          preferredContactTime: time.trim(),
          acknowledgement: true,
          mediaReferences
        }
      });
      idempKeyRef.current = Crypto.randomUUID(); // reset on success
      onComplete();
    } catch (err: any) {
      const status = err instanceof ApiError ? err.status : 0;
      if (status === 400) {
        setError('Please check your booking details and try again.');
      } else {
        setError('Booking failed to submit securely. Please try again.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 20, paddingTop: Math.max(insets.top + 16, 20), paddingBottom: Math.max(insets.bottom + 40, 40) }} keyboardShouldPersistTaps="handled">
      <TouchableOpacity onPress={onBack} style={{ marginBottom: 16, alignSelf: 'flex-start' }}>
        <Ionicons name="arrow-back" size={24} color={colors.text} />
      </TouchableOpacity>

      <Text style={[styles.rTitle, { color: colors.text, marginBottom: 8 }]}>Book Physical Test</Text>
      <Text style={{ fontSize: 14, color: colors.mutedForeground, marginBottom: 24, lineHeight: 20 }}>
        A certified technician will visit your location to perform precise measurements.
      </Text>

      <View style={styles.formContainer}>
        <View style={styles.field}>
          <Text style={[styles.label, { color: colors.mutedForeground }]}>Service Address *</Text>
          <TextInput
            value={address} onChangeText={setAddress}
            placeholder="House/Apt, Street, Estate" placeholderTextColor={colors.border}
            style={[styles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.card }]}
          />
        </View>

        <View style={styles.field}>
          <Text style={[styles.label, { color: colors.mutedForeground }]}>Preferred Contact Time *</Text>
          <TextInput
            value={time} onChangeText={setTime}
            placeholder="e.g. Tomorrow morning, Weekdays after 4PM" placeholderTextColor={colors.border}
            style={[styles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.card }]}
          />
        </View>

        <View style={styles.field}>
          <MediaPicker items={media} onChange={setMedia} maxItems={4} label="Attach Photos & Videos (optional)" />
        </View>

        {error ? (
          <View style={[styles.errorBox, { backgroundColor: colors.destructive + '12', borderColor: colors.destructive + '30' }]}>
            <Ionicons name="alert-circle-outline" size={16} color={colors.destructive} />
            <Text style={[styles.errorText, { color: colors.destructive }]}>{error}</Text>
          </View>
        ) : null}

        <TouchableOpacity onPress={submit} disabled={submitting} style={[styles.submitBtn, { backgroundColor: submitting ? colors.muted : colors.primary, marginTop: 12 }]}>
          {submitting ? <ActivityIndicator color="#fff" /> : <Text style={styles.submitBtnText}>Confirm Booking</Text>}
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}


// ----------------------------------------------------------------------------
// VERIFICATION MODAL
// ----------------------------------------------------------------------------
interface VerificationModalProps {
  visible: boolean;
  assessmentId: string;
  onClose: () => void;
  onSuccess: (tk: string) => void;
  colors: any;
}

function VerificationModal({ visible, assessmentId, onClose, onSuccess, colors }: VerificationModalProps) {
  const [step, setStep] = useState<'request' | 'confirm'>('request');
  const [channel, setChannel] = useState<'whatsapp' | 'sms'>('whatsapp');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const reqMut = useRequestInstantWaterAssessmentVerification();
  const confMut = useConfirmInstantWaterAssessmentVerification();
  const idempKeyRef = useRef(Crypto.randomUUID());

  useEffect(() => {
    if (visible) { setStep('request'); setCode(''); setError(''); setChannel('whatsapp'); idempKeyRef.current = Crypto.randomUUID(); }
  }, [visible]);

  const handleRequest = async () => {
    setBusy(true); setError('');
    try {
      await reqMut.mutateAsync({
        assessmentId,
        data: {
          idempotencyKey: idempKeyRef.current,
          channel,
          smsConsent: channel === 'sms' ? true : undefined
        }
      });
      setStep('confirm');
    } catch (err: any) {
      const status = err instanceof ApiError ? err.status : 0;
      if (status === 400) {
        setError('Verification request rejected. Please try again later.');
      } else {
        setError('Verification request failed securely. Please try again.');
      }
    } finally {
      setBusy(false);
    }
  };

  const handleConfirm = async () => {
    if (!code.trim()) { setError("Enter code"); return; }
    setBusy(true); setError('');
    try {
      const res = await confMut.mutateAsync({ assessmentId, data: { code: code.trim() } });
      if (res.verified) {
        onSuccess(res.actionToken);
      } else {
        setError('Invalid code');
      }
    } catch (err: any) {
      const status = err instanceof ApiError ? err.status : 0;
      if (status === 400 || status === 404) {
        setError('Invalid or expired code. Please request a new one.');
      } else {
        setError('Verification failed securely. Please try again.');
      }
    } finally {
      setBusy(false);
    }
  };

  const insets = useSafeAreaInsets();

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.modalOverlay}>
        <KeyboardAwareScrollViewCompat contentContainerStyle={{ flexGrow: 1, justifyContent: 'flex-end' }}>
          <View style={[styles.modalContent, { backgroundColor: colors.background, paddingBottom: Math.max(insets.bottom + 24, 24) }]}>
            <TouchableOpacity onPress={onClose} style={styles.modalClose}>
              <Ionicons name="close" size={24} color={colors.text} />
            </TouchableOpacity>
            <Text style={[styles.modalTitle, { color: colors.text }]}>Verify your phone</Text>
            <Text style={[styles.modalBody, { color: colors.mutedForeground }]}>
              To authorize this physical test or attach it to your account, we need to quickly verify your number.
            </Text>

            {step === 'request' ? (
               <View style={{ gap: 16 }}>
                 <View style={styles.colChips}>
                   <TouchableOpacity onPress={() => setChannel('whatsapp')} style={[styles.fullChip, { backgroundColor: channel === 'whatsapp' ? colors.primary : colors.surface, borderColor: channel === 'whatsapp' ? colors.primary : colors.border }]}>
                     <Ionicons name="logo-whatsapp" size={18} color={channel === 'whatsapp' ? '#fff' : colors.text} />
                     <Text style={{ flexShrink: 1, flexWrap: 'wrap', fontSize: 14, fontWeight: '600', color: channel === 'whatsapp' ? '#fff' : colors.text, marginLeft: 8 }}>Send via WhatsApp</Text>
                   </TouchableOpacity>
                   <TouchableOpacity onPress={() => setChannel('sms')} style={[styles.fullChip, { backgroundColor: channel === 'sms' ? colors.primary : colors.surface, borderColor: channel === 'sms' ? colors.primary : colors.border }]}>
                     <Ionicons name="chatbubble-outline" size={18} color={channel === 'sms' ? '#fff' : colors.text} />
                     <Text style={{ flexShrink: 1, flexWrap: 'wrap', fontSize: 14, fontWeight: '600', color: channel === 'sms' ? '#fff' : colors.text, marginLeft: 8 }}>Send via SMS</Text>
                   </TouchableOpacity>
                 </View>
                 {error ? <Text style={{ color: colors.destructive, fontSize: 13 }}>{error}</Text> : null}
                 <TouchableOpacity onPress={handleRequest} disabled={busy} style={[styles.submitBtn, { backgroundColor: busy ? colors.muted : colors.primary }]}>
                   {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.submitBtnText}>Get Code</Text>}
                 </TouchableOpacity>
               </View>
            ) : (
               <View style={{ gap: 16 }}>
                 <TextInput
                   value={code} onChangeText={setCode} placeholder="6-digit code"
                   keyboardType="number-pad" placeholderTextColor={colors.border}
                   style={[styles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.card, fontSize: 24, textAlign: 'center', letterSpacing: 4 }]}
                 />
                 {error ? <Text style={{ color: colors.destructive, fontSize: 13 }}>{error}</Text> : null}
                 <TouchableOpacity onPress={handleConfirm} disabled={busy} style={[styles.submitBtn, { backgroundColor: busy ? colors.muted : colors.primary }]}>
                   {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.submitBtnText}>Confirm</Text>}
                 </TouchableOpacity>
               </View>
            )}
          </View>
        </KeyboardAwareScrollViewCompat>
      </View>
    </Modal>
  );
}


// ----------------------------------------------------------------------------
// STYLES
// ----------------------------------------------------------------------------
const styles = StyleSheet.create({
  hero: { padding: 24, paddingTop: 40, paddingBottom: 32 },
  eyebrow: { fontSize: 10, fontWeight: '800', color: '#00E5FF', letterSpacing: 1, marginBottom: 12 },
  heroTitle: { fontSize: 28, fontWeight: '700', color: '#fff', marginBottom: 12, lineHeight: 34 },
  heroLede: { fontSize: 14, color: 'rgba(255,255,255,0.85)', lineHeight: 22 },
  historyBtn: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16, gap: 6 },
  historyBtnText: { color: '#fff', fontSize: 12, fontWeight: '600' },

  formContainer: { padding: 20, gap: 20 },
  row: { flexDirection: 'row', gap: 12 },
  field: { gap: 6 },
  rowField: { flex: 1, minWidth: 0 },
  label: { fontSize: 13, fontWeight: '600' },
  input: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15 },

  chipsWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, borderWidth: 1 },
  colChips: { gap: 8 },
  fullChip: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, borderRadius: 12, borderWidth: 1 },

  consentRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, marginTop: 8 },
  checkbox: { width: 22, height: 22, borderRadius: 6, borderWidth: 1, alignItems: 'center', justifyContent: 'center', marginTop: 2 },
  consentText: { flex: 1, fontSize: 13, lineHeight: 20 },

  errorBox: { flexDirection: 'row', gap: 8, padding: 12, borderRadius: 10, borderWidth: 1, alignItems: 'center' },
  errorText: { flex: 1, fontSize: 13 },

  submitBtn: { paddingVertical: 16, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  submitBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },

  resultHeader: { alignItems: 'center', marginBottom: 32 },
  rTitle: { fontSize: 24, fontWeight: '800', marginVertical: 4 },
  rSub: { fontSize: 13 },
  bands: { marginBottom: 24 },

  recBox: { padding: 16, borderRadius: 12, borderWidth: 1, marginBottom: 16 },
  recName: { fontSize: 18, fontWeight: '700', marginBottom: 6, marginTop: 4 },
  recWhy: { fontSize: 14, lineHeight: 22 },

  flagBox: { padding: 16, borderRadius: 12, borderWidth: 1, marginBottom: 16 },
  flagText: { fontSize: 13, lineHeight: 20 },

  nextBox: { paddingTop: 24, borderTopWidth: 1, gap: 12, marginTop: 8 },
  nextTitle: { fontSize: 18, fontWeight: '700' },
  nextBody: { fontSize: 14, lineHeight: 22, marginBottom: 8 },

  actionBtn: { paddingVertical: 14, paddingHorizontal: 16, borderRadius: 12, alignItems: 'center' },
  actionBtnText: { color: '#fff', fontSize: 15, fontWeight: '700', textAlign: 'center', flexShrink: 1 },
  ghostBtn: { paddingVertical: 14, paddingHorizontal: 16, borderRadius: 12, alignItems: 'center', borderWidth: 1 },
  ghostBtnText: { fontSize: 15, fontWeight: '600', textAlign: 'center', flexShrink: 1 },

  disclaimer: { fontSize: 11, lineHeight: 18, marginTop: 32, textAlign: 'center' },

  historyHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16 },
  historyTitle: { color: '#fff', fontSize: 18, fontWeight: '700' },
  historyCard: { padding: 16, borderRadius: 12, borderWidth: 1 },
  historyBandsRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 },
  statusPill: { alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12 },

  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modalContent: { padding: 24, borderTopLeftRadius: 20, borderTopRightRadius: 20, minHeight: 300 },
  modalClose: { position: 'absolute', top: 16, right: 16, zIndex: 10, padding: 8 },
  modalTitle: { fontSize: 20, fontWeight: '700', marginBottom: 8 },
  modalBody: { fontSize: 14, lineHeight: 20, marginBottom: 24 },
});
