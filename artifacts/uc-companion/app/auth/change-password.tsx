import React, { useRef, useState } from 'react';
import {
  ActivityIndicator,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import BrandLogo from '@/components/BrandLogo';
import { KeyboardAwareScrollViewCompat } from '@/components/KeyboardAwareScrollViewCompat';
import { useAuth } from '@/context/AuthContext';
import { useColors } from '@/hooks/useColors';

export default function ChangePasswordScreen() {
  const colors = useColors();
  const router = useRouter();
  const { changePassword, mustChangePassword } = useAuth();
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const confirmRef = useRef<TextInput>(null);

  async function handleSubmit() {
    if (newPassword.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }
    Keyboard.dismiss();
    setError(null);
    setLoading(true);
    const result = await changePassword(newPassword);
    setLoading(false);
    if (result.success) {
      router.replace('/(tabs)' as never);
    } else {
      setError(result.error ?? 'Unable to change password. Please try again.');
    }
  }

  // The root navigator normally prevents this screen from being reached by a
  // permanent session. Keep the screen inert rather than offering a second
  // password-change path if a stale navigation event arrives during a swap.
  if (!mustChangePassword) {
    return null;
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <KeyboardAwareScrollViewCompat
        style={[styles.screen, { backgroundColor: colors.background }]}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
      >
        <BrandLogo width={104} style={{ marginBottom: 4 }} />
        <Text style={[styles.title, { color: colors.text }]}>Create a new password</Text>
        <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
          Your temporary password can only be used once. Choose a permanent password to continue using Companion.
        </Text>

        <View style={styles.form}>
          <View style={styles.field}>
            <Text style={[styles.label, { color: colors.mutedForeground }]}>New password</Text>
            <View style={[styles.inputWrap, { borderColor: error ? '#EF4444' : colors.border, backgroundColor: colors.card }]}>
              <Ionicons name="lock-closed-outline" size={18} color={colors.mutedForeground} />
              <TextInput
                testID="change-password-new"
                value={newPassword}
                onChangeText={value => { setNewPassword(value); setError(null); }}
                placeholder="At least 8 characters"
                placeholderTextColor={colors.border}
                secureTextEntry
                autoCapitalize="none"
                autoComplete="new-password"
                returnKeyType="next"
                blurOnSubmit={false}
                onSubmitEditing={() => confirmRef.current?.focus()}
                style={[styles.input, { color: colors.text }]}
              />
            </View>
          </View>

          <View style={styles.field}>
            <Text style={[styles.label, { color: colors.mutedForeground }]}>Confirm password</Text>
            <View style={[styles.inputWrap, { borderColor: error ? '#EF4444' : colors.border, backgroundColor: colors.card }]}>
              <Ionicons name="lock-closed-outline" size={18} color={colors.mutedForeground} />
              <TextInput
                ref={confirmRef}
                testID="change-password-confirm"
                value={confirmPassword}
                onChangeText={value => { setConfirmPassword(value); setError(null); }}
                placeholder="Repeat your password"
                placeholderTextColor={colors.border}
                secureTextEntry
                autoCapitalize="none"
                autoComplete="new-password"
                returnKeyType="done"
                onSubmitEditing={handleSubmit}
                style={[styles.input, { color: colors.text }]}
              />
            </View>
          </View>

          {error && <Text accessibilityLiveRegion="polite" style={styles.error}>{error}</Text>}

          <TouchableOpacity
            testID="change-password-submit"
            onPress={handleSubmit}
            disabled={loading}
            style={[styles.submit, { backgroundColor: loading ? colors.muted : colors.primary }]}
          >
            {loading
              ? <ActivityIndicator color="#fff" size="small" />
              : <Text style={styles.submitText}>Save password</Text>}
          </TouchableOpacity>
        </View>
      </KeyboardAwareScrollViewCompat>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { padding: 32, alignItems: 'center', gap: 8, paddingTop: Platform.OS === 'web' ? 100 : 60 },
  title: { fontSize: 28, fontWeight: '800' as const, textAlign: 'center' },
  subtitle: { fontSize: 15, lineHeight: 21, textAlign: 'center', marginBottom: 16, maxWidth: 330 },
  form: { width: '100%', gap: 16 },
  field: { gap: 6 },
  label: { fontSize: 13, fontWeight: '500' as const },
  inputWrap: { flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 13 },
  input: { flex: 1, fontSize: 16 },
  error: { fontSize: 12, color: '#EF4444', marginTop: -6 },
  submit: { borderRadius: 14, paddingVertical: 16, alignItems: 'center', marginTop: 8 },
  submitText: { color: '#fff', fontSize: 16, fontWeight: '700' as const },
});