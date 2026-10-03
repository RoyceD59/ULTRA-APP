import React, { useEffect, useRef, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, ScrollView, Platform } from 'react-native';
import PageDataLoader from '@/components/PageDataLoader';
import PageDataError from '@/components/PageDataError';
import { useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { saveUcDailyHydration } from '@workspace/api-client-react';
import { useColors } from '@/hooks/useColors';
import { useAuth } from '@/context/AuthContext';
import { useHydration, hydrationKey } from '@/hooks/useHydration';
import { parseLitres } from '@/lib/hydration';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export default function HydrationScreen() {
  const colors = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user, token } = useAuth();
  const { data, date, isLoading, isError, error, refetch } = useHydration();
  const client = useQueryClient();
  const [input, setInput] = useState('');
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);
  const activeOwner = useRef(user?.id);
  const activeDate = useRef(date);
  activeDate.current = date;
  activeOwner.current = user?.id;
  useEffect(() => { setInput(data?.litres == null ? '' : String(data.litres)); }, [data?.litres, date, user?.id]);
  useEffect(() => { setMessage(''); setSaving(false); }, [date, user?.id]);
  const save = async () => {
    const litres = parseLitres(input);
    if (litres === null) { setMessage('Enter a finite, nonnegative decimal total in litres, including zero.'); return; }
    if (!user || !token) return;
    const owner = user.id;
    const savedDate = date; // Never derive a second date after a midnight retry.
    setSaving(true); setMessage('');
    try {
      const result = await saveUcDailyHydration(savedDate, { litres }, { headers: { Authorization: `Bearer ${token}` } });
      if (activeOwner.current !== owner) return;
      client.setQueryData(hydrationKey(owner, savedDate), result);
      if (activeDate.current === savedDate) setMessage(`Saved ${litres} litres for ${savedDate}.`);
    } catch { if (activeOwner.current === owner && activeDate.current === savedDate) setMessage('Could not save. Your total has not changed. Please retry.'); }
    finally { if (activeOwner.current === owner && activeDate.current === savedDate) setSaving(false); }
  };
  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.background }} contentContainerStyle={{ padding: 24, paddingTop: insets.top + 20, gap: 18, paddingBottom: insets.bottom + 40 }}>
      <TouchableOpacity accessibilityRole="button" onPress={() => router.canGoBack() ? router.back() : router.replace('/(tabs)')}>
        <Text style={{ color: colors.primary }}>Back</Text>
      </TouchableOpacity>
      <Text style={{ color: colors.text, fontSize: 26, fontWeight: '700' }}>Daily filtered water</Text>
      <Text style={{ color: colors.mutedForeground }}>Your local date: {date}. Record the total filtered water you drank today, in litres. Saving replaces the daily total; it does not add another entry.</Text>
      {!user ? (
        <TouchableOpacity accessibilityRole="button" onPress={() => router.push({ pathname: '/auth/login', params: { returnTo: '/hydration' } })}>
          <Text style={{ color: colors.primary }}>Sign in to record and sync your total</Text>
        </TouchableOpacity>
      ) : !data && isLoading ? <PageDataLoader label="Loading today’s total…" /> : !data && isError ? (
        <PageDataError title="Today’s total unavailable" error={error} onRetry={refetch} />
      ) : (
        <>
          {isError ? <PageDataError title="Today’s total could not refresh" message="Your last loaded total is shown below. Retry to get the latest total." onRetry={refetch} /> : null}
          <Text style={{ color: colors.text, fontSize: 20 }}>{data?.litres == null ? 'Not recorded today' : `Today: ${data.litres} L`}</Text>
          <Text style={{ color: colors.text }}>Daily total (litres)</Text>
          <TextInput accessibilityLabel="Daily filtered-water total in litres" value={input} onChangeText={setInput} keyboardType="decimal-pad" placeholder="e.g. 1.25" placeholderTextColor={colors.mutedForeground}
            style={{ padding: 14, borderWidth: 1, borderColor: colors.border, borderRadius: 12, backgroundColor: colors.card, color: colors.text, fontSize: 18 }} />
          <TouchableOpacity disabled={saving} accessibilityRole="button" onPress={save} style={{ padding: 16, borderRadius: 12, backgroundColor: colors.primary, opacity: saving ? 0.6 : 1 }}>
            <Text style={{ color: '#fff', textAlign: 'center', fontWeight: '700' }}>{saving ? 'Saving…' : 'Save daily total'}</Text>
          </TouchableOpacity>
        </>
      )}
      {!!message && <Text accessibilityLiveRegion="polite" style={{ color: colors.text }}>{message}</Text>}
      <TouchableOpacity accessibilityRole="button" onPress={() => router.push('/notification-preferences')}><Text style={{ color: colors.primary }}>Daily reminder preferences</Text></TouchableOpacity>
      {Platform.OS === 'web' && <Text style={{ color: colors.mutedForeground }}>You can log water here and see a daily in-app prompt. Background hydration reminders require the mobile app.</Text>}
    </ScrollView>
  );
}