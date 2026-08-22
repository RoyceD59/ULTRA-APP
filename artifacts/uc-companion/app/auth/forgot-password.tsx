import React, { useState } from 'react';
import {
  View, Text, StyleSheet, TextInput, TouchableOpacity, Platform,
  ActivityIndicator, KeyboardAvoidingView, ScrollView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';
import { useRouter, useLocalSearchParams } from 'expo-router';
import BrandLogo from '@/components/BrandLogo';

export default function ForgotPasswordScreen() {
  const colors = useColors();
  const router = useRouter();
  const { email: prefillEmail, resetToken: resetTokenParam } = useLocalSearchParams<{ email?: string; resetToken?: string }>();
  const resetToken = typeof resetTokenParam === 'string' ? resetTokenParam : '';
  const [email, setEmail] = useState(prefillEmail ?? '');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [reset, setReset] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const getBase = () =>
    process.env.EXPO_PUBLIC_DOMAIN
      ? `https://${process.env.EXPO_PUBLIC_DOMAIN}`
      : 'http://localhost:8080';

  async function handleSubmit() {
    if (!email.trim()) {
      setError('Please enter your email address.');
      return;
    }
    setError(null);
    setLoading(true);
    try {
      const res = await fetch(`${getBase()}/api/uc/auth/forgot-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim() }),
      });
      if (res.ok) {
        setSent(true);
      } else {
        const data = await res.json() as { error?: string };
        setError(data.error ?? 'Something went wrong. Please try again.');
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
    setError(null);
    setLoading(true);
    try {
      const res = await fetch(`${getBase()}/api/uc/auth/reset-password`, {
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
      <ScrollView
        style={[styles.screen, { backgroundColor: colors.background }]}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        <BrandLogo width={84} style={{ marginBottom: 4 }} />
        <Text style={[styles.title, { color: colors.text }]}>
          {resetToken ? 'Set a new password' : 'Forgot Password?'}
        </Text>
        <Text style={[styles.sub, { color: colors.mutedForeground }]}>
          {resetToken
            ? 'Choose a new password for your Ultra-Clear account.'
            : "Enter the email on your account and we'll send you a reset link."}
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
            <Text style={[styles.sentTitle, { color: colors.text }]}>Check your inbox</Text>
            <Text style={[styles.sentBody, { color: colors.mutedForeground }]}>
              If an account matches that address, you'll receive a password-reset link shortly.
              Check your spam folder too.
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
                      value={newPassword}
                      onChangeText={v => { setNewPassword(v); setError(null); }}
                      placeholder="At least 6 characters"
                      secureTextEntry
                      autoCapitalize="none"
                      placeholderTextColor={colors.border}
                      style={[styles.input, { color: colors.text }]}
                    />
                  </View>
                </View>
                <View style={styles.field}>
                  <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>Confirm password</Text>
                  <View style={[styles.inputWrap, { borderColor: error ? '#EF4444' : colors.border, backgroundColor: colors.card }]}>
                    <Ionicons name="lock-closed-outline" size={18} color={colors.mutedForeground} />
                    <TextInput
                      value={confirmPassword}
                      onChangeText={v => { setConfirmPassword(v); setError(null); }}
                      placeholder="Repeat your password"
                      secureTextEntry
                      autoCapitalize="none"
                      placeholderTextColor={colors.border}
                      style={[styles.input, { color: colors.text }]}
                    />
                  </View>
                </View>
              </>
            ) : (
              <View style={styles.field}>
                <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>Email address</Text>
                <View style={[styles.inputWrap, { borderColor: error ? '#EF4444' : colors.border, backgroundColor: colors.card }]}>
                  <Ionicons name="mail-outline" size={18} color={colors.mutedForeground} />
                  <TextInput
                    value={email}
                    onChangeText={v => { setEmail(v); setError(null); }}
                    placeholder="you@example.com"
                    keyboardType="email-address"
                    autoCapitalize="none"
                    placeholderTextColor={colors.border}
                    style={[styles.input, { color: colors.text }]}
                  />
                </View>
                {error && <Text style={styles.errorText}>{error}</Text>}
              </View>
            )}
            {resetToken && error && <Text style={styles.errorText}>{error}</Text>}

            <TouchableOpacity
              onPress={resetToken ? handleReset : handleSubmit}
              disabled={loading}
              style={[styles.submitBtn, { backgroundColor: loading ? colors.muted : colors.primary }]}
            >
              {loading
                ? <ActivityIndicator color="#fff" size="small" />
                : <Text style={styles.submitBtnText}>{resetToken ? 'Save New Password' : 'Send Reset Link'}</Text>}
            </TouchableOpacity>

            <TouchableOpacity
              onPress={() => router.back()}
              style={styles.cancelBtn}
            >
              <Text style={[styles.cancelBtnText, { color: colors.mutedForeground }]}>Back to Sign In</Text>
            </TouchableOpacity>
          </View>
        )}
      </ScrollView>
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
