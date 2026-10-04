import React, { useRef, useState } from 'react';
import {
  View, Text, StyleSheet, TextInput, TouchableOpacity, Platform,
  ActivityIndicator, KeyboardAvoidingView, Keyboard,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useColors } from '@/hooks/useColors';
import { useRouter, useLocalSearchParams } from 'expo-router';
import BrandLogo from '@/components/BrandLogo';
import { KeyboardAwareScrollViewCompat } from '@/components/KeyboardAwareScrollViewCompat';
import { getApiBase } from '@/lib/apiBase';
import { getResetRequestError, readResetTokenParam } from '@/lib/passwordReset';

export default function ForgotPasswordScreen() {
  const colors = useColors();
  const router = useRouter();
  const { email: prefillEmail, resetToken: resetTokenParam } = useLocalSearchParams<{ email?: string; resetToken?: string }>();
  const resetToken = readResetTokenParam(resetTokenParam);
  const [email, setEmail] = useState(prefillEmail ?? '');
  const [channel, setChannel] = useState<'email' | 'whatsapp'>('email');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [reset, setReset] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const confirmPasswordRef = useRef<TextInput>(null);

  async function handleSubmit() {
    if (!email.trim()) {
      setError('Please enter your email address or phone number.');
      return;
    }
    Keyboard.dismiss();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch(`${getApiBase()}/api/uc/auth/reset-request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier: email.trim(), channel }),
      });
      if (res.ok) {
        setSent(true);
      } else {
        const data = await res.json() as { error?: unknown };
        setError(getResetRequestError(res.status, data));
      }
    } catch {
      setError('Network error. Please check your connection and try again.');
    } finally {
      setLoading(false);
    }
  }

  async function handleReset() {
    if (newPassword.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }
    Keyboard.dismiss();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch(`${getApiBase()}/api/uc/auth/reset-confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: resetToken, newPassword }),
      });
      const data = await res.json() as { error?: string };
      if (!res.ok) {
        setError(data.error ?? 'This reset link is invalid or expired.');
        return;
      }
      setReset(true);
    } catch {
      setError('Network error. Please check your connection and try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <KeyboardAwareScrollViewCompat
        style={[styles.screen, { backgroundColor: colors.background }]}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
      >
        <BrandLogo width={84} style={{ marginBottom: 4 }} />
        <Text style={[styles.title, { color: colors.text }]}>
          {resetToken ? 'Set a new password' : 'Forgot Password?'}
        </Text>
        <Text style={[styles.sub, { color: colors.mutedForeground }]}>
          {resetToken
            ? 'Choose a new password for your Ultra-Clear account.'
            : "Enter the email address or phone number on your account. We'll send recovery instructions if a verified channel is available."}
        </Text>

        {reset ? (
          <View style={styles.sentBox}>
            <Ionicons name="checkmark-circle" size={48} color="#22C55E" style={{ marginBottom: 12 }} />
            <Text style={[styles.sentTitle, { color: colors.text }]}>Password updated</Text>
            <Text style={[styles.sentBody, { color: colors.mutedForeground }]}>
              Your password has been changed. Sign in with your new password.
            </Text>
            <TouchableOpacity
              onPress={() => router.replace('/auth/login' as never)}
              style={[styles.backBtn, { backgroundColor: colors.primary }]}
            >
              <Text style={styles.backBtnText}>Back to Sign In</Text>
            </TouchableOpacity>
          </View>
        ) : sent ? (
          <View style={styles.sentBox}>
            <Ionicons name="checkmark-circle" size={48} color="#22C55E" style={{ marginBottom: 12 }} />
            <Text style={[styles.sentTitle, { color: colors.text }]}>Check your messages</Text>
            <Text style={[styles.sentBody, { color: colors.mutedForeground }]}>
              If an account matches those details, recovery instructions will arrive shortly.
              Check your email spam folder or WhatsApp.
            </Text>
            <TouchableOpacity
              onPress={() => router.replace('/auth/login' as never)}
              style={[styles.backBtn, { backgroundColor: colors.primary }]}
            >
              <Text style={styles.backBtnText}>Back to Sign In</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.form}>
            {resetToken ? (
              <>
                <View style={styles.field}>
                  <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>New password</Text>
                  <View style={[styles.inputWrap, { borderColor: error ? '#EF4444' : colors.border, backgroundColor: colors.card }]}>
                    <Ionicons name="lock-closed-outline" size={18} color={colors.mutedForeground} />
                    <TextInput
                      testID="reset-new-password"
                      value={newPassword}
                      onChangeText={v => { setNewPassword(v); setError(null); }}
                      placeholder="At least 6 characters"
                      secureTextEntry
                       autoCapitalize="none" autoComplete="new-password" returnKeyType="next"
                       onSubmitEditing={() => confirmPasswordRef.current?.focus()} blurOnSubmit={false}
                      placeholderTextColor={colors.border}
                      style={[styles.input, { color: colors.text }]}
                    />
                  </View>
                </View>
                <View style={styles.field}>
                  <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>Confirm password</Text>
                  <View style={[styles.inputWrap, { borderColor: error ? '#EF4444' : colors.border, backgroundColor: colors.card }]}>
                    <Ionicons name="lock-closed-outline" size={18} color={colors.mutedForeground} />
                     <TextInput ref={confirmPasswordRef}
                      testID="reset-confirm-password"
                      value={confirmPassword}
                      onChangeText={v => { setConfirmPassword(v); setError(null); }}
                      placeholder="Repeat your password"
                      secureTextEntry
                       autoCapitalize="none" autoComplete="new-password" returnKeyType="done"
                       onSubmitEditing={handleReset}
                      placeholderTextColor={colors.border}
                      style={[styles.input, { color: colors.text }]}
                    />
                  </View>
                </View>
              </>
            ) : (
              <>
                <View style={styles.field}>
                  <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>Email address or phone number</Text>
                  <View style={[styles.inputWrap, { borderColor: error ? '#EF4444' : colors.border, backgroundColor: colors.card }]}>
                    <Ionicons name="mail-outline" size={18} color={colors.mutedForeground} />
                    <TextInput
                      testID="reset-email"
                      value={email}
                      onChangeText={v => { setEmail(v); setError(null); }}
                      placeholder="you@example.com or +254..."
                      keyboardType="email-address"
                      autoCapitalize="none"
                      autoComplete="email"
                      returnKeyType="done"
                      onSubmitEditing={handleSubmit}
                      placeholderTextColor={colors.border}
                      style={[styles.input, { color: colors.text }]}
                    />
                  </View>
                  {error && <Text accessibilityLiveRegion="polite" style={styles.errorText}>{error}</Text>}
                </View>
                <View style={styles.field}>
                  <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>Send instructions by</Text>
                  <View style={styles.channelRow}>
                    {(['email', 'whatsapp'] as const).map(option => (
                      <TouchableOpacity
                        key={option}
                        accessibilityRole="radio"
                        accessibilityState={{ selected: channel === option }}
                        onPress={() => setChannel(option)}
                        style={[styles.channelButton, {
                          backgroundColor: channel === option ? colors.primary : colors.card,
                          borderColor: channel === option ? colors.primary : colors.border,
                        }]}
                      >
                        <Text style={{ color: channel === option ? '#fff' : colors.text, fontWeight: '600' }}>
                          {option === 'email' ? 'Email' : 'WhatsApp'}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                  <Text style={[styles.channelHint, { color: colors.mutedForeground }]}>
                    Instructions are sent only if the selected channel is verified on an account.
                  </Text>
                </View>
              </>
            )}
            {Boolean(resetToken && error) && <Text accessibilityLiveRegion="polite" style={styles.errorText}>{error}</Text>}

            <TouchableOpacity
              testID="reset-submit"
              onPress={resetToken ? handleReset : handleSubmit}
              disabled={loading}
              style={[styles.submitBtn, { backgroundColor: loading ? colors.muted : colors.primary }]}
            >
              {loading
                ? <ActivityIndicator color="#fff" size="small" />
                : <Text style={styles.submitBtnText}>{resetToken ? 'Save New Password' : 'Send Reset Link'}</Text>}
            </TouchableOpacity>

            <TouchableOpacity
              testID="reset-back"
              onPress={() => router.replace('/auth/login' as never)}
              style={styles.cancelBtn}
            >
              <Text style={[styles.cancelBtnText, { color: colors.mutedForeground }]}>Back to Sign In</Text>
            </TouchableOpacity>
          </View>
        )}
      </KeyboardAwareScrollViewCompat>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen:        { flex: 1 },
  content:       { padding: 32, alignItems: 'center', gap: 8, paddingTop: Platform.OS === 'web' ? 100 : 60 },
  title:         { fontSize: 28, fontWeight: '800' as const },
  sub:           { fontSize: 15, textAlign: 'center', marginBottom: 16, maxWidth: 320 },
  form:          { width: '100%', gap: 16 },
  field:         { gap: 6 },
  fieldLabel:    { fontSize: 13, fontWeight: '500' as const },
  inputWrap:     { flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 13 },
  input:         { flex: 1, fontSize: 16 },
  channelRow:    { flexDirection: 'row', gap: 8 },
  channelButton: { flex: 1, borderWidth: 1, borderRadius: 10, paddingVertical: 11, alignItems: 'center' },
  channelHint:   { fontSize: 12, lineHeight: 17 },
  errorText:     { fontSize: 12, color: '#EF4444', marginTop: 2 },
  submitBtn:     { borderRadius: 14, paddingVertical: 16, alignItems: 'center' },
  submitBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' as const },
  cancelBtn:     { alignItems: 'center', paddingVertical: 8 },
  cancelBtnText: { fontSize: 14 },
  sentBox:       { width: '100%', alignItems: 'center', gap: 8, paddingTop: 24 },
  sentTitle:     { fontSize: 20, fontWeight: '700' as const },
  sentBody:      { fontSize: 14, textAlign: 'center', maxWidth: 300, lineHeight: 20 },
  backBtn:       { borderRadius: 14, paddingVertical: 14, paddingHorizontal: 32, alignItems: 'center', marginTop: 16 },
  backBtnText:   { color: '#fff', fontSize: 16, fontWeight: '700' as const },
});
