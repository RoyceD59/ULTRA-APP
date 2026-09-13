import React from 'react';
import {
  ActivityIndicator,
  FlatList,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import QRCode from 'react-native-qrcode-svg';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '@/context/AuthContext';
import { useApi, type CustomerRewards } from '@/hooks/useApi';
import { useColors } from '@/hooks/useColors';
import { useRewardsQrToken } from '@/hooks/useRewardsQrToken';
import { buildRewardsQrPayload } from '@/lib/rewardsQr';

type LedgerEntry = CustomerRewards['ledger'][number];

function formatLedgerDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Date unavailable';
  return date.toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

function LedgerRow({ entry, isLast }: { entry: LedgerEntry; isLast: boolean }) {
  const colors = useColors();
  const isCredit = entry.points >= 0;

  return (
    <View
      testID={`reward-ledger-entry-${entry.id}`}
      style={[
        styles.ledgerRow,
        !isLast && { borderBottomWidth: 1, borderBottomColor: colors.border },
      ]}
    >
      <View
        style={[
          styles.entryIcon,
          { backgroundColor: isCredit ? colors.successLight : colors.muted },
        ]}
      >
        <Ionicons
          name={isCredit ? 'arrow-up' : 'arrow-down'}
          size={17}
          color={isCredit ? colors.success : colors.destructive}
        />
      </View>
      <View style={styles.entryCopy}>
        <Text style={[styles.reason, { color: colors.text }]}>{entry.reason}</Text>
        <Text style={[styles.date, { color: colors.mutedForeground }]}>
          {formatLedgerDate(entry.createdAt)}
        </Text>
      </View>
      <Text
        style={[
          styles.points,
          { color: isCredit ? colors.success : colors.destructive },
        ]}
      >
        {entry.points > 0 ? '+' : ''}{entry.points.toLocaleString()} pts
      </Text>
    </View>
  );
}

export default function RewardsScreen() {
  const colors = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user, isLoading: authLoading } = useAuth();
  const api = useApi();
  const {
    data: rewards,
    isLoading,
    isError,
    isRefetching,
    refetch,
  } = useQuery({
    queryKey: ['customer-rewards'],
    queryFn: () => api.getRewards(),
    enabled: !!user,
    staleTime: 0,
    refetchOnMount: 'always',
  });
  const { token: qrToken, loading: qrLoading, error: qrError, retry: retryQr } =
    useRewardsQrToken(user?.id, rewards);
  const qrBadge = rewards?.snapshot?.qrBadge
    ?? (qrError ? 'refresh_required' : qrToken ? 'ready' : undefined);

  const webBottomInset = Platform.OS === 'web' ? 34 : 0;

  if (authLoading) {
    return (
      <View style={[styles.centered, { backgroundColor: colors.background }]}>
        <ActivityIndicator color={colors.primary} size="large" />
      </View>
    );
  }

  if (!user) {
    return (
      <View style={[styles.centered, styles.gate, { backgroundColor: colors.background }]}>
        <View style={[styles.gateIcon, { backgroundColor: colors.primaryLight }]}>
          <Ionicons name="star-outline" size={34} color={colors.primary} />
        </View>
        <Text style={[styles.gateTitle, { color: colors.text }]}>Sign in to see your rewards</Text>
        <Text style={[styles.gateCopy, { color: colors.mutedForeground }]}>
          Your points balance and activity are private to your account.
        </Text>
        <TouchableOpacity
          testID="rewards-sign-in"
          onPress={() => router.push('/auth/login')}
          style={[styles.primaryButton, { backgroundColor: colors.primary }]}
        >
          <Text style={[styles.primaryButtonText, { color: colors.primaryForeground }]}>Sign In</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (isLoading) {
    return (
      <View style={[styles.centered, { backgroundColor: colors.background }]}>
        <ActivityIndicator color={colors.primary} size="large" />
        <Text style={[styles.loadingText, { color: colors.mutedForeground }]}>Loading your rewards…</Text>
      </View>
    );
  }

  if (isError || !rewards) {
    return (
      <View style={[styles.centered, styles.gate, { backgroundColor: colors.background }]}>
        <Ionicons name="cloud-offline-outline" size={36} color={colors.mutedForeground} />
        <Text style={[styles.gateTitle, { color: colors.text }]}>Rewards are unavailable</Text>
        <Text style={[styles.gateCopy, { color: colors.mutedForeground }]}>
          Check your connection and try again.
        </Text>
        <TouchableOpacity
          testID="retry-rewards"
          onPress={() => refetch()}
          style={[styles.retryButton, { borderColor: colors.primary }]}
        >
          <Text style={[styles.retryText, { color: colors.primary }]}>Try Again</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <FlatList
      testID="rewards-ledger"
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={[
        styles.content,
        { paddingBottom: Math.max(insets.bottom, webBottomInset) + 24 },
      ]}
      data={rewards.ledger}
      keyExtractor={(entry) => String(entry.id)}
      refreshing={isRefetching}
      onRefresh={refetch}
      ListHeaderComponent={(
        <>
          <View style={[styles.balanceCard, { backgroundColor: colors.primary }]}>
            <View style={styles.balanceHeading}>
              <Ionicons name="star" size={18} color={colors.primaryForeground} />
              <Text style={[styles.balanceLabel, { color: colors.primaryForeground }]}>Current balance</Text>
            </View>
            <Text
              testID="rewards-balance"
              style={[styles.balanceValue, { color: colors.primaryForeground }]}
            >
              {rewards.balance.toLocaleString()}
            </Text>
            <Text style={[styles.balanceUnit, { color: colors.primaryForeground }]}>reward points</Text>
             {rewards.snapshot && (
               <Text style={[styles.snapshotLabel, { color: colors.primaryForeground }]}>
                 {rewards.snapshot.tier.toUpperCase()} tier · {rewards.snapshot.status}
               </Text>
             )}
          </View>
          <View style={[styles.qrCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={styles.qrHeading}>
              <View>
                <Text style={[styles.qrTitle, { color: colors.text }]}>Your rewards identity</Text>
                <Text style={[styles.qrCopy, { color: colors.mutedForeground }]}>Show this QR code to earn points</Text>
              </View>
              {qrBadge && (
                <View style={[styles.qrBadge, { backgroundColor: qrBadge === 'ready' ? colors.successLight : colors.warningLight }]}>
                  <Ionicons
                    name={qrBadge === 'ready' ? 'shield-checkmark-outline' : 'refresh-outline'}
                    size={12}
                    color={qrBadge === 'ready' ? colors.success : colors.warning}
                  />
                  <Text style={[styles.qrBadgeText, { color: qrBadge === 'ready' ? colors.success : colors.warning }]}>
                    {qrBadge === 'ready' ? 'Ready' : 'Refresh needed'}
                  </Text>
                </View>
              )}
            </View>
            <View style={[styles.qrWrap, { borderColor: colors.border }]}>
              {qrLoading ? <ActivityIndicator testID="rewards-qr-loading" color={colors.primary} /> : qrError || !qrToken ? (
                <View style={styles.qrFallback}>
                  <Ionicons name="alert-circle-outline" size={24} color={colors.destructive} />
                  <Text style={[styles.qrError, { color: colors.destructive }]}>QR unavailable</Text>
                  <TouchableOpacity testID="retry-rewards-qr" onPress={retryQr}>
                    <Text style={[styles.retryText, { color: colors.primary }]}>Retry</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <QRCode testID="rewards-qr" value={buildRewardsQrPayload(qrToken)} size={150} color="#1a1a1a" backgroundColor="#fff" />
              )}
            </View>
          </View>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>Recent activity</Text>
        </>
      )}
      ListEmptyComponent={(
        <View style={[styles.emptyCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Ionicons name="receipt-outline" size={30} color={colors.mutedForeground} />
          <Text style={[styles.emptyTitle, { color: colors.text }]}>No points activity yet</Text>
          <Text style={[styles.emptyCopy, { color: colors.mutedForeground }]}>
            Points you earn or use will appear here.
          </Text>
        </View>
      )}
      renderItem={({ item, index }) => (
        <View
          style={[
            styles.ledgerCard,
            { backgroundColor: colors.card, borderColor: colors.border },
            index === 0 && styles.firstLedgerRow,
            index === rewards.ledger.length - 1 && styles.lastLedgerRow,
          ]}
        >
          <LedgerRow entry={item} isLast={index === rewards.ledger.length - 1} />
        </View>
      )}
    />
  );
}

const styles = StyleSheet.create({
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  gate: {
    paddingHorizontal: 32,
  },
  gateIcon: {
    width: 68,
    height: 68,
    borderRadius: 34,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  gateTitle: {
    fontSize: 21,
    fontWeight: '700',
    textAlign: 'center',
  },
  gateCopy: {
    fontSize: 14,
    lineHeight: 21,
    textAlign: 'center',
    maxWidth: 310,
  },
  primaryButton: {
    minWidth: 150,
    alignItems: 'center',
    borderRadius: 12,
    paddingHorizontal: 24,
    paddingVertical: 13,
    marginTop: 6,
  },
  primaryButtonText: {
    fontSize: 15,
    fontWeight: '700',
  },
  retryButton: {
    borderWidth: 1.5,
    borderRadius: 10,
    paddingHorizontal: 22,
    paddingVertical: 11,
    marginTop: 4,
  },
  retryText: {
    fontSize: 14,
    fontWeight: '700',
  },
  loadingText: {
    fontSize: 14,
  },
  content: {
    padding: 16,
  },
  balanceCard: {
    borderRadius: 18,
    paddingHorizontal: 22,
    paddingVertical: 24,
    marginBottom: 24,
  },
  balanceHeading: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  balanceLabel: {
    fontSize: 13,
    fontWeight: '600',
    opacity: 0.88,
  },
  balanceValue: {
    fontSize: 48,
    lineHeight: 56,
    fontWeight: '800',
    marginTop: 8,
  },
  balanceUnit: {
    fontSize: 14,
    fontWeight: '500',
    opacity: 0.8,
  },
  qrCard: {
    borderWidth: 1,
    borderRadius: 14,
    padding: 16,
    marginBottom: 24,
    gap: 14,
  },
  qrHeading: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  qrTitle: {
    fontSize: 16,
    fontWeight: '700',
  },
  qrCopy: {
    fontSize: 12,
    marginTop: 3,
  },
  qrBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    borderRadius: 10,
    paddingHorizontal: 7,
    paddingVertical: 4,
  },
  qrBadgeText: {
    fontSize: 10,
    fontWeight: '700',
  },
  qrWrap: {
    minHeight: 182,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    backgroundColor: '#fff',
  },
  qrFallback: {
    alignItems: 'center',
    gap: 5,
  },
  qrError: {
    fontSize: 12,
  },
  snapshotLabel: {
    fontSize: 12,
    fontWeight: '700',
    marginTop: 10,
    opacity: 0.85,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 12,
  },
  ledgerCard: {
    borderLeftWidth: 1,
    borderRightWidth: 1,
  },
  firstLedgerRow: {
    borderTopWidth: 1,
    borderTopLeftRadius: 14,
    borderTopRightRadius: 14,
    overflow: 'hidden',
  },
  lastLedgerRow: {
    borderBottomWidth: 1,
    borderBottomLeftRadius: 14,
    borderBottomRightRadius: 14,
    overflow: 'hidden',
  },
  ledgerRow: {
    minHeight: 72,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  entryIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  entryCopy: {
    flex: 1,
    gap: 3,
  },
  reason: {
    fontSize: 14,
    lineHeight: 19,
    fontWeight: '600',
  },
  date: {
    fontSize: 12,
  },
  points: {
    fontSize: 14,
    fontWeight: '700',
    textAlign: 'right',
  },
  emptyCard: {
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 24,
    paddingVertical: 32,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '700',
    marginTop: 10,
  },
  emptyCopy: {
    fontSize: 13,
    lineHeight: 19,
    textAlign: 'center',
    marginTop: 5,
  },
});