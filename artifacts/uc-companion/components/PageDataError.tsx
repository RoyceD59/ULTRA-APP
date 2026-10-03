import React, { useRef, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useColors } from '@/hooks/useColors';
import FilterDropIllustration from './FilterDropIllustration';
import { pageFailureCopy } from '@/lib/pageLoading';
import { useRouter } from 'expo-router';

/** Page-data recovery only: never use this for payment/submission retries. */
export default function PageDataError({
  title, onRetry, error, message, actionLabel = 'Retry', testID = 'page-data-retry',
}: {
  title: string;
  onRetry: () => unknown;
  error?: unknown;
  message?: string;
  actionLabel?: string;
  testID?: string;
}) {
  const colors = useColors();
  const router = useRouter();
  const needsSignIn = (error as { status?: number } | null)?.status === 401;
  const forbidden = (error as { status?: number } | null)?.status === 403;
  const missing = (error as { status?: number } | null)?.status === 404 && actionLabel === 'Retry';
  const action = needsSignIn ? 'Sign in' : forbidden ? 'Return Home' : missing ? 'Go back' : actionLabel;
  const [retrying, setRetrying] = useState(false);
  const pending = useRef(false);
  const recover = async () => {
    if (pending.current) return;
    if (needsSignIn) { router.push('/auth/login'); return; }
    if (forbidden) { router.replace('/(tabs)'); return; }
    if (missing) { router.canGoBack() ? router.back() : router.replace('/(tabs)'); return; }
    pending.current = true;
    setRetrying(true);
    try { await onRetry(); } catch { /* The owning read keeps its contextual error visible. */ }
    finally { pending.current = false; setRetrying(false); }
  };
  return (
    <View testID="page-data-error" style={styles.container}>
      <FilterDropIllustration />
      <Text accessibilityRole="header" style={[styles.title, { color: colors.text }]}>{title}</Text>
      <Text accessibilityLiveRegion="polite" style={[styles.message, { color: colors.mutedForeground }]}>
        {message ?? pageFailureCopy(error)}
      </Text>
      <TouchableOpacity testID={testID} accessibilityRole="button" accessibilityLabel={`${action}: ${title}`}
        disabled={retrying} accessibilityState={{ disabled: retrying, busy: retrying }}
        onPress={() => { void recover(); }} style={[styles.button, { backgroundColor: colors.primary, opacity: retrying ? 0.6 : 1 }]}>
        <Text style={{ color: colors.primaryForeground, fontWeight: '600' }}>{retrying ? 'Retrying…' : action}</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { alignItems: 'center', padding: 16, gap: 8 },
  title: { fontSize: 16, fontWeight: '600', textAlign: 'center' },
  message: { fontSize: 13, lineHeight: 19, textAlign: 'center', maxWidth: 360 },
  button: { minHeight: 44, paddingHorizontal: 20, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
});