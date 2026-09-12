import React, { useState } from 'react';
import {
  View, Text, StyleSheet, TextInput, TouchableOpacity, Platform,
  Alert, ActivityIndicator, KeyboardAvoidingView, ScrollView,
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

// ── Phone helpers ─────────────────────────────────────────────────────────────

/**
 * Normalise to E.164 for Kenya (+254):
 *   07XXXXXXXX  →  +2547XXXXXXXX
 *   01XXXXXXXX  →  +2541XXXXXXXX
 *   2547XXXXXXXX → +2547XXXXXXXX
 *   +254…       → kept as-is
 */
function normaliseKenyaPhone(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  if (digits.startsWith('254') && digits.length === 12) return `+${digits}`;
  if (digits.startsWith('0')   && digits.length === 10) return `+254${digits.slice(1)}`;
  if (digits.length === 9)                               return `+254${digits}`;
  return raw.trim(); // return as-entered for non-KE numbers
}

function isValidPhone(raw: string): boolean {
  const normalised = normaliseKenyaPhone(raw);
  // Accept +254 (12 chars) or any other +XX… with 10-15 digits total
  return /^\+\d{10,15}$/.test(normalised);
}

/** Formats while typing: turn leading 07 / 01 into +254 7 / +254 1 */
function liveFormatPhone(raw: string): string {
  // Only auto-expand if the user typed digits (not if they typed "+" already)
  if (!raw.startsWith('+')) {
    const digits = raw.replace(/\D/g, '');
    if (digits.length > 1 && digits.startsWith('07')) return `+254 ${digits.slice(1)}`;
    if (digits.length > 1 && digits.startsWith('01')) return `+254 ${digits.slice(1)}`;
    if (digits.length > 0 && digits.startsWith('254')) return `+${digits}`;
  }
  return raw;
}

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
  const [password,     setPassword]     = useState('');
  const [referralCode, setReferralCode] = useState('');
  const [showPass,     setShowPass]     = useState(false);
  const [loading,      setLoading]      = useState(false);
  const [registerError, setRegisterError] = useState<{ message: string; hint?: string } | null>(null);

  function handlePhoneChange(text: string) {
    setPhone(liveFormatPhone(text));
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
    if (!isValidPhone(phone)) {
      Alert.alert('Invalid phone number', 'Enter a valid number, e.g. 0712 345678 or +254 712 345678.');
      return;
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setRegisterError(null);
    setLoading(true);
    const result = await register({
      firstName,
      lastName,
      email:        email.trim(),
      phone:        normaliseKenyaPhone(phone),
      password,
      referralCode: referralCode.trim() || undefined,
    });
    setLoading(false);
    if (result.success) {
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
      <ScrollView style={[styles.screen, { backgroundColor: colors.background }]}
        contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">

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
                style={[styles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.card }]}
              />
            </View>
            <View style={[styles.field, { flex: 1 }]}>
              <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>Last name</Text>
              <TextInput
                value={lastName} onChangeText={setLastName}
                placeholder="Doe" placeholderTextColor={colors.border}
                style={[styles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.card }]}
              />
            </View>
          </View>

          {/* Email */}
          <View style={styles.field}>
            <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>Email address *</Text>
            <View style={[styles.inputWrap, { borderColor: colors.border, backgroundColor: colors.card }]}>
              <Ionicons name="mail-outline" size={18} color={colors.mutedForeground} />
              <TextInput
                value={email} onChangeText={setEmail}
                placeholder="you@example.com" keyboardType="email-address"
                autoCapitalize="none" placeholderTextColor={colors.border}
                style={[styles.inputInner, { color: colors.text }]}
              />
            </View>
          </View>

          {/* Phone */}
          <View style={styles.field}>
            <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>Phone number *</Text>
            <View style={[
              styles.inputWrap,
              { borderColor: phone && !isValidPhone(phone) ? '#EF4444' : colors.border, backgroundColor: colors.card },
            ]}>
              <Ionicons name="call-outline" size={18} color={colors.mutedForeground} />
              <TextInput
                value={phone} onChangeText={handlePhoneChange}
                placeholder="+254 7XX XXX XXX" keyboardType="phone-pad"
                placeholderTextColor={colors.border}
                style={[styles.inputInner, { color: colors.text }]}
              />
              {phone && isValidPhone(phone) && (
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
              <TextInput
                value={password} onChangeText={setPassword}
                placeholder="Min. 6 characters" secureTextEntry={!showPass}
                placeholderTextColor={colors.border}
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
              <TextInput
                value={referralCode} onChangeText={v => setReferralCode(v.toUpperCase())}
                placeholder="e.g. JAMES-X4B2" autoCapitalize="characters"
                placeholderTextColor={colors.border}
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
      </ScrollView>
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
