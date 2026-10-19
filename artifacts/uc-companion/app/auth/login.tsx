import React, { useRef, useState } from 'react';
import { View, Text, StyleSheet, TextInput, TouchableOpacity, Platform, Alert, ActivityIndicator, KeyboardAvoidingView, Keyboard } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useColors } from '@/hooks/useColors';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useAuth } from '@/context/AuthContext';
import * as Haptics from 'expo-haptics';
import BrandLogo from '@/components/BrandLogo';
import SocialAuthButtons from '@/components/SocialAuthButtons';
import { resolveReturnTo } from '@/lib/authReturn';
import { KeyboardAwareScrollViewCompat } from '@/components/KeyboardAwareScrollViewCompat';
import { ExpiredSessionNotice } from '@/components/ExpiredSessionNotice';

export default function LoginScreen() {
  const colors = useColors();
  const router = useRouter();
  const { returnTo: returnToParam } = useLocalSearchParams<{ returnTo?: string }>();
  const returnTo = resolveReturnTo(returnToParam);
  const { login, mustChangePassword, sessionNotice, dismissSessionNotice } = useAuth();
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [loading, setLoading] = useState(false);
  const passwordRef = useRef<TextInput>(null);

  /** After auth, land back on the form that sent us here (draft restores there). */
  function navigateAfterAuth() {
    if (returnTo) router.replace(returnTo as never);
    else router.replace('/(tabs)' as never);
  }

  async function handleLogin() {
    if (!identifier.trim() || !password) {
      Alert.alert('Required', 'Enter your email or phone number and password.');
      return;
    }
    Keyboard.dismiss();
    dismissSessionNotice();
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setLoading(true);
    const result = await login(identifier.trim(), password);
    setLoading(false);
    if (result.success) {
      // AuthProvider has already persisted the temporary session. Route it
      // directly into the guarded password replacement flow.
      if (result.requiresPasswordChange || mustChangePassword) router.replace('/auth/change-password' as never);
      else navigateAfterAuth();
    }
    else { Alert.alert('Login failed', result.error ?? 'Please check your credentials.'); }
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <KeyboardAwareScrollViewCompat style={[styles.screen, { backgroundColor: colors.background }]}
        contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">

        {/* Brand */}
        <BrandLogo width={104} style={{ marginBottom: 4 }} />
        <Text style={[styles.brandSub, { color: colors.mutedForeground }]}>Sign in to your account</Text>

        <ExpiredSessionNotice
          message={sessionNotice}
          backgroundColor={colors.warningLight}
          borderColor={colors.warning}
          textColor={colors.text}
        />

        {/* Form */}
        <View style={styles.form}>
          <View style={styles.field}>
            <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>Email or phone number</Text>
            <View style={[styles.inputWrap, { borderColor: colors.border, backgroundColor: colors.card }]}>
              <Ionicons name="person-outline" size={18} color={colors.mutedForeground} />
              <TextInput testID="login-identifier" value={identifier} onChangeText={setIdentifier}
                placeholder="you@example.com or +254 700 000 000" keyboardType="email-address"
                 autoCapitalize="none" autoComplete="username" returnKeyType="next"
                 onSubmitEditing={() => passwordRef.current?.focus()} blurOnSubmit={false} placeholderTextColor={colors.border}
                style={[styles.input, { color: colors.text }]} />
            </View>
          </View>

          <View style={styles.field}>
            <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>Password</Text>
            <View style={[styles.inputWrap, { borderColor: colors.border, backgroundColor: colors.card }]}>
              <Ionicons name="lock-closed-outline" size={18} color={colors.mutedForeground} />
              <TextInput ref={passwordRef} value={password} onChangeText={setPassword}
                placeholder="••••••••" secureTextEntry={!showPass}
                 autoComplete="current-password" autoCapitalize="none" returnKeyType="done"
                 onSubmitEditing={handleLogin} placeholderTextColor={colors.border}
                style={[styles.input, { color: colors.text }]} />
              <TouchableOpacity onPress={() => setShowPass(!showPass)}>
                <Ionicons name={showPass ? 'eye-off-outline' : 'eye-outline'} size={18} color={colors.mutedForeground} />
              </TouchableOpacity>
            </View>
          </View>

          <TouchableOpacity onPress={handleLogin} disabled={loading}
            style={[styles.loginBtn, { backgroundColor: loading ? colors.muted : colors.primary }]}>
            {loading ? <ActivityIndicator color="#fff" size="small" /> :
              <Text style={styles.loginBtnText}>Sign In</Text>}
          </TouchableOpacity>

          <TouchableOpacity
            testID="forgot-password-link"
            onPress={() => {
              dismissSessionNotice();
              router.push(
                identifier.trim()
                  ? ({ pathname: '/auth/forgot-password', params: { email: identifier.trim() } } as never)
                  : ('/auth/forgot-password' as never),
              );
            }}
            style={styles.forgotPasswordBtn}
          >
            <Text style={[styles.forgotPasswordText, { color: colors.primary }]}>Forgot password?</Text>
          </TouchableOpacity>
        </View>

        <SocialAuthButtons onSuccess={navigateAfterAuth} />

        <View style={styles.footer}>
          <Text style={[styles.footerText, { color: colors.mutedForeground }]}>Don't have an account?</Text>
          <TouchableOpacity onPress={() => {
            dismissSessionNotice();
            router.push(
              returnTo
                ? ({ pathname: '/auth/register', params: { returnTo } } as never)
                : ('/auth/register' as never),
            );
          }}>
            <Text style={[styles.footerLink, { color: colors.primary }]}>Create account</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAwareScrollViewCompat>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { padding: 32, alignItems: 'center', gap: 8, paddingTop: Platform.OS === 'web' ? 100 : 60 },
  brandSub: { fontSize: 15, marginBottom: 16 },
  form: { width: '100%', gap: 16 },
  field: { gap: 6 },
  fieldLabel: { fontSize: 13, fontWeight: '500' as const },
  inputWrap: { flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 13 },
  input: { flex: 1, fontSize: 16 },
  loginBtn: { borderRadius: 14, paddingVertical: 16, alignItems: 'center', marginTop: 8 },
  loginBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' as const },
  forgotPasswordBtn: { alignSelf: 'center', paddingHorizontal: 8, paddingVertical: 4 },
  forgotPasswordText: { fontSize: 14, fontWeight: '600' as const },
  footer: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 16 },
  footerText: { fontSize: 14 },
  footerLink: { fontSize: 14, fontWeight: '600' as const },
});
