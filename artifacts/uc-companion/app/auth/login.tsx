import React, { useState } from 'react';
import { View, Text, StyleSheet, TextInput, TouchableOpacity, Platform, Alert, ActivityIndicator, KeyboardAvoidingView, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';
import { useRouter } from 'expo-router';
import { useAuth } from '@/context/AuthContext';
import * as Haptics from 'expo-haptics';
import BrandLogo from '@/components/BrandLogo';
import SocialAuthButtons from '@/components/SocialAuthButtons';

export default function LoginScreen() {
  const colors = useColors();
  const router = useRouter();
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleLogin() {
    if (!email || !password) { Alert.alert('Required', 'Enter your email and password.'); return; }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setLoading(true);
    const result = await login(email.trim(), password);
    setLoading(false);
    if (result.success) { router.replace('/(tabs)' as never); }
    else { Alert.alert('Login failed', result.error ?? 'Please check your credentials.'); }
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView style={[styles.screen, { backgroundColor: colors.background }]}
        contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">

        {/* Brand */}
        <BrandLogo width={104} style={{ marginBottom: 4 }} />
        <Text style={[styles.brandSub, { color: colors.mutedForeground }]}>Sign in to your account</Text>

        {/* Form */}
        <View style={styles.form}>
          <View style={styles.field}>
            <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>Email</Text>
            <View style={[styles.inputWrap, { borderColor: colors.border, backgroundColor: colors.card }]}>
              <Ionicons name="mail-outline" size={18} color={colors.mutedForeground} />
              <TextInput value={email} onChangeText={setEmail}
                placeholder="you@example.com" keyboardType="email-address"
                autoCapitalize="none" placeholderTextColor={colors.border}
                style={[styles.input, { color: colors.text }]} />
            </View>
          </View>

          <View style={styles.field}>
            <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>Password</Text>
            <View style={[styles.inputWrap, { borderColor: colors.border, backgroundColor: colors.card }]}>
              <Ionicons name="lock-closed-outline" size={18} color={colors.mutedForeground} />
              <TextInput value={password} onChangeText={setPassword}
                placeholder="••••••••" secureTextEntry={!showPass}
                placeholderTextColor={colors.border}
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
        </View>

        <SocialAuthButtons onSuccess={() => router.replace('/(tabs)' as never)} />

        <View style={styles.footer}>
          <Text style={[styles.footerText, { color: colors.mutedForeground }]}>Don't have an account?</Text>
          <TouchableOpacity onPress={() => router.push('/auth/register')}>
            <Text style={[styles.footerLink, { color: colors.primary }]}>Create account</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
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
  footer: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 16 },
  footerText: { fontSize: 14 },
  footerLink: { fontSize: 14, fontWeight: '600' as const },
});
