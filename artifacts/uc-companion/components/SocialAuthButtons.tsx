/**
 * "Continue with Google / Apple" buttons for the login and register screens.
 *
 * Flow: Clerk's `startSSOFlow` opens the provider's OAuth page in a browser
 * sheet. When it completes, we activate the Clerk session, grab its session
 * token, and exchange it with our API (`POST /api/uc/auth/social`) for the
 * app's normal account session — so social users get exactly the same
 * account, orders, and reminders as email/password users.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, Platform, ActivityIndicator, StyleSheet, Alert } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import * as AuthSession from 'expo-auth-session';
import { ClerkLoaded, useSSO } from '@clerk/expo';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useColors } from '@/hooks/useColors';
import { useAuth } from '@/context/AuthContext';

// Preloads the browser on Android to reduce authentication load time.
function useWarmUpBrowser() {
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    void WebBrowser.warmUpAsync();
    return () => {
      void WebBrowser.coolDownAsync();
    };
  }, []);
}

// Handle any pending authentication sessions (required for the OAuth redirect).
WebBrowser.maybeCompleteAuthSession();

type Provider = 'google' | 'apple';

export default function SocialAuthButtons({ onSuccess }: { onSuccess: () => void }) {
  useWarmUpBrowser();
  const colors = useColors();
  const { startSSOFlow } = useSSO();
  const { socialLogin } = useAuth();
  const [busy, setBusy] = useState<Provider | null>(null);

  const handlePress = useCallback(async (provider: Provider) => {
    if (busy) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setBusy(provider);
    try {
      const { createdSessionId, setActive } = await startSSOFlow({
        strategy: provider === 'google' ? 'oauth_google' : 'oauth_apple',
        redirectUrl: AuthSession.makeRedirectUri(),
      });

      if (!createdSessionId || !setActive) {
        // User cancelled, or extra requirements (e.g. MFA) are pending.
        setBusy(null);
        return;
      }

      let clerkToken: string | null = null;
      await setActive({
        session: createdSessionId,
        navigate: async ({ session }) => {
          if (session?.currentTask) return;
          clerkToken = (await session?.getToken()) ?? null;
        },
      });

      if (!clerkToken) {
        setBusy(null);
        Alert.alert('Sign-in failed', 'Could not complete sign-in. Please try again.');
        return;
      }

      const result = await socialLogin(clerkToken);
      setBusy(null);
      if (result.success) {
        onSuccess();
      } else {
        Alert.alert('Sign-in failed', result.error ?? 'Please try again.');
      }
    } catch {
      // Browser sheet dismissed or network hiccup — return quietly to the form.
      setBusy(null);
    }
  }, [busy, startSSOFlow, socialLogin, onSuccess]);

  // ClerkLoaded: if Clerk can't initialize (offline / outage), the social
  // buttons simply don't render and email/password login stays fully usable.
  return (
    <ClerkLoaded>
      <View style={styles.wrap}>
        <View style={styles.dividerRow}>
          <View style={[styles.dividerLine, { backgroundColor: colors.border }]} />
          <Text style={[styles.dividerText, { color: colors.mutedForeground }]}>or continue with</Text>
          <View style={[styles.dividerLine, { backgroundColor: colors.border }]} />
        </View>

        <TouchableOpacity
          onPress={() => handlePress('google')}
          disabled={busy !== null}
          style={[styles.btn, { borderColor: colors.border, backgroundColor: colors.card, opacity: busy && busy !== 'google' ? 0.5 : 1 }]}
        >
          {busy === 'google'
            ? <ActivityIndicator size="small" color={colors.mutedForeground} />
            : <Ionicons name="logo-google" size={18} color={colors.text} />}
          <Text style={[styles.btnText, { color: colors.text }]}>Continue with Google</Text>
        </TouchableOpacity>

        <TouchableOpacity
          onPress={() => handlePress('apple')}
          disabled={busy !== null}
          style={[styles.btn, { borderColor: colors.border, backgroundColor: colors.card, opacity: busy && busy !== 'apple' ? 0.5 : 1 }]}
        >
          {busy === 'apple'
            ? <ActivityIndicator size="small" color={colors.mutedForeground} />
            : <Ionicons name="logo-apple" size={20} color={colors.text} />}
          <Text style={[styles.btnText, { color: colors.text }]}>Continue with Apple</Text>
        </TouchableOpacity>
      </View>
    </ClerkLoaded>
  );
}

const styles = StyleSheet.create({
  wrap: { width: '100%', gap: 12, marginTop: 20 },
  dividerRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  dividerLine: { flex: 1, height: StyleSheet.hairlineWidth },
  dividerText: { fontSize: 13 },
  btn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10,
    borderWidth: 1, borderRadius: 14, paddingVertical: 14,
  },
  btnText: { fontSize: 15, fontWeight: '600' as const },
});
