import {
  View, Text, StyleSheet, TextInput, TouchableOpacity, Platform,
  Alert, ActivityIndicator, Keyboard, KeyboardAvoidingView, ScrollView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useAuth } from '@/context/AuthContext';
import * as Haptics from 'expo-haptics';
import BrandLogo from '@/components/BrandLogo';
import SocialAuthButtons from '@/components/SocialAuthButtons';
import RegistrationErrorNotice from '@/components/RegistrationErrorNotice';
import { resolveReturnTo } from '@/lib/authReturn';
import { CountryPicker } from '@/components/CountryPicker';
import { normalizeInstantPhone, isValidInstantPhone } from '@workspace/api-zod/instant-water-identity';
import type { SupportedCountryCode } from '@workspace/api-zod/phone';
import { trackEvent } from '@/lib/analytics';

import React, { useRef, useState } from 'react';
import { KeyboardAwareScrollViewCompat } from '@/components/KeyboardAwareScrollViewCompat';

// ── Screen ────────────────────────────────────────────────────────────────────

export default function RegisterScreen() {
  const colors = useColors();
  const router = useRouter();
  const { returnTo: returnToParam } = useLocalSearchParams<{ returnTo?: string }>();
  const returnTo = resolveReturnTo(returnToParam);
  const { register } = useAuth();
  const [firstName,    setFirstName]    = useState('');
  const [lastName,     setLastName]     = useState('');
  const [email,        setEmail]        = useState('');
  const [phone,        setPhone]        = useState('');
  const [phoneCountry, setPhoneCountry] = useState<SupportedCountryCode>('KE');
  const [password,     setPassword]     = useState('');
  const [referralCode, setReferralCode] = useState('');
  const [showPass,     setShowPass]     = useState(false);
  const [loading,      setLoading]      = useState(false);
  const [registerError, setRegisterError] = useState<{ message: string; hint?: string } | null>(null);
  const lastNameRef = useRef<TextInput>(null);
  const emailRef = useRef<TextInput>(null);
  const phoneRef = useRef<TextInput>(null);
  const passwordRef = useRef<TextInput>(null);
  const referralRef = useRef<TextInput>(null);

  function handlePhoneChange(text: string) {
    setPhone(text);
  }

  async function handleRegister() {
    if (!firstName || !email || !phone || !password) {
      Alert.alert('Required fields', 'Please fill in your name, email, phone number and password.');
      return;
    }
    if (password.length < 6) {
      Alert.alert('Weak password', 'Password must be at least 6 characters.');
      return;
    }
    const normalizedPhone = normalizeInstantPhone(phone, phoneCountry);
    if (!normalizedPhone || !isValidInstantPhone(phone, phoneCountry)) {
      Alert.alert('Invalid phone number', 'Enter a valid phone number for the selected country.');
      return;
    }
    Keyboard.dismiss();
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setRegisterError(null);
    setLoading(true);
    const result = await register({
      firstName,
      lastName,
      email:        email.trim(),
      phone:        normalizedPhone,
      password,
      referralCode: referralCode.trim() || undefined,
    });
    setLoading(false);
    if (result.success) {
      trackEvent('signup_completed', { countryCode: phoneCountry });
      navigateAfterAuth();
    } else {
      setRegisterError({ message: result.error ?? 'Please try again.', hint: result.hint });
    }
  }

  /** After auth, land back on the form that sent us here (draft restores there). */
  function navigateAfterAuth() {
    if (returnTo) router.replace(returnTo as never);
    else router.replace('/(tabs)' as never);
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <KeyboardAwareScrollViewCompat style={[styles.screen, { backgroundColor: colors.background }]}
        contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">

        <BrandLogo width={84} style={{ marginBottom: 4 }} />
        <Text style={[styles.title, { color: colors.text }]}>Create Account</Text>
        <Text style={[styles.sub, { color: colors.mutedForeground }]}>Join Ultra-Clear today</Text>

        <View style={styles.form}>
          {/* Name row */}
          <View style={styles.nameRow}>
            <View style={[styles.field, { flex: 1 }]}>
              <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>First name *</Text>
              <TextInput
                value={firstName} onChangeText={setFirstName}
                placeholder="Jane" placeholderTextColor={colors.border}
                autoComplete="given-name" autoCapitalize="words" returnKeyType="next"
                onSubmitEditing={() => lastNameRef.current?.focus()} blurOnSubmit={false}
                style={[styles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.card }]}
              />
            </View>
            <View style={[styles.field, { flex: 1 }]}>
              <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>Last name</Text>
              <TextInput ref={lastNameRef}
                value={lastName} onChangeText={setLastName}
                placeholder="Doe" placeholderTextColor={colors.border}
                autoComplete="family-name" autoCapitalize="words" returnKeyType="next"
                onSubmitEditing={() => emailRef.current?.focus()} blurOnSubmit={false}
                style={[styles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.card }]}
              />
            </View>
          </View>

          {/* Email */}
          <View style={styles.field}>
            <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>Email address *</Text>
            <View style={[styles.inputWrap, { borderColor: colors.border, backgroundColor: colors.card }]}>
              <Ionicons name="mail-outline" size={18} color={colors.mutedForeground} />
              <TextInput ref={emailRef}
                value={email} onChangeText={setEmail}
                placeholder="you@example.com" keyboardType="email-address"
                autoCapitalize="none" autoComplete="email" returnKeyType="next"
                onSubmitEditing={() => phoneRef.current?.focus()} blurOnSubmit={false} placeholderTextColor={colors.border}
                style={[styles.inputInner, { color: colors.text }]}
              />
            </View>
          </View>

          {/* Phone */}
          <View style={styles.field}>
            <CountryPicker value={phoneCountry} onChange={setPhoneCountry} colors={colors} label="Phone country *" />
            <View style={[
              styles.inputWrap,
              { borderColor: phone && !isValidInstantPhone(phone, phoneCountry) ? '#EF4444' : colors.border, backgroundColor: colors.card },
            ]}>
              <Ionicons name="call-outline" size={18} color={colors.mutedForeground} />
              <TextInput ref={phoneRef}
                value={phone} onChangeText={handlePhoneChange}
                placeholder="+254 7XX XXX XXX" keyboardType="phone-pad"
                autoComplete="tel" returnKeyType="next" onSubmitEditing={() => passwordRef.current?.focus()} blurOnSubmit={false} placeholderTextColor={colors.border}
                style={[styles.inputInner, { color: colors.text }]}
              />
              {phone && isValidInstantPhone(phone, phoneCountry) && (
                <Ionicons name="checkmark-circle" size={18} color="#22C55E" />
              )}
            </View>
            <Text style={[styles.fieldHint, { color: colors.mutedForeground }]}>
              Used for order SMS alerts and filter reminders
            </Text>
          </View>

          {/* Password */}
          <View style={styles.field}>
            <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>Password *</Text>
            <View style={[styles.inputWrap, { borderColor: colors.border, backgroundColor: colors.card }]}>
              <Ionicons name="lock-closed-outline" size={18} color={colors.mutedForeground} />
              <TextInput ref={passwordRef}
                value={password} onChangeText={setPassword}
                placeholder="Min. 6 characters" secureTextEntry={!showPass}
                autoComplete="new-password" autoCapitalize="none" returnKeyType="next"
                onSubmitEditing={() => referralRef.current?.focus()} blurOnSubmit={false} placeholderTextColor={colors.border}
                style={[styles.inputInner, { color: colors.text }]}
              />
              <TouchableOpacity onPress={() => setShowPass(!showPass)}>
                <Ionicons name={showPass ? 'eye-off-outline' : 'eye-outline'} size={18} color={colors.mutedForeground} />
              </TouchableOpacity>
            </View>
          </View>

          {/* Referral code */}
          <View style={styles.field}>
            <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>Referral code (optional)</Text>
            <View style={[
              styles.inputWrap,
              { borderColor: referralCode ? '#005d8f' : colors.border, backgroundColor: colors.card },
            ]}>
              <Ionicons name="gift-outline" size={18} color={referralCode ? '#005d8f' : colors.mutedForeground} />
              <TextInput ref={referralRef}
                value={referralCode} onChangeText={v => setReferralCode(v.toUpperCase())}
                placeholder="e.g. JAMES-X4B2" autoCapitalize="characters"
                returnKeyType="done" onSubmitEditing={handleRegister} placeholderTextColor={colors.border}
                style={[styles.inputInner, { color: colors.text }]}
              />
              {!!referralCode && <Ionicons name="checkmark-circle" size={18} color="#005d8f" />}
            </View>
            {!!referralCode && (
              <Text style={{ fontSize: 11, color: '#005d8f', marginTop: 2 }}>
                🎉 You'll get 10% off your first order!
              </Text>
            )}
          </View>

          <TouchableOpacity
            onPress={handleRegister} disabled={loading}
            style={[styles.registerBtn, { backgroundColor: loading ? colors.muted : colors.primary }]}>
            {loading
              ? <ActivityIndicator color="#fff" size="small" />
              : <Text style={styles.registerBtnText}>Create Account</Text>}
          </TouchableOpacity>

          {registerError && (
            <RegistrationErrorNotice
              message={registerError.message}
              hint={registerError.hint}
              primaryColor={colors.primary}
              cardColor={colors.card}
              onForgotPassword={() => router.push(
                ({ pathname: '/auth/forgot-password', params: { email: email.trim() } } as never)
              )}
            />
          )}
        </View>

        <SocialAuthButtons onSuccess={navigateAfterAuth} />

        <View style={styles.footer}>
          <Text style={[styles.footerText, { color: colors.mutedForeground }]}>Already have an account?</Text>
          <TouchableOpacity onPress={() => router.push(
            returnTo
              ? ({ pathname: '/auth/login', params: { returnTo } } as never)
              : ('/auth/login' as never),
          )}>
            <Text style={[styles.footerLink, { color: colors.primary }]}>Sign in</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAwareScrollViewCompat>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen:         { flex: 1 },
  content:        { padding: 32, alignItems: 'center', gap: 8, paddingTop: Platform.OS === 'web' ? 100 : 60 },
  title:          { fontSize: 28, fontWeight: '800' as const },
  sub:            { fontSize: 15, marginBottom: 16 },
  form:           { width: '100%', gap: 14 },
  nameRow:        { flexDirection: 'row', gap: 12 },
  field:          { gap: 5 },
  fieldLabel:     { fontSize: 12, fontWeight: '500' as const },
  fieldHint:      { fontSize: 11, marginTop: 2 },
  input:          { borderWidth: 1, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15 },
  inputWrap:      { flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 13 },
  inputInner:     { flex: 1, fontSize: 16 },
  registerBtn:    { borderRadius: 14, paddingVertical: 16, alignItems: 'center', marginTop: 8 },
  registerBtnText:{ color: '#fff', fontSize: 16, fontWeight: '700' as const },
  footer:         { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 16 },
  footerText:     { fontSize: 14 },
  footerLink:     { fontSize: 14, fontWeight: '600' as const },
});
