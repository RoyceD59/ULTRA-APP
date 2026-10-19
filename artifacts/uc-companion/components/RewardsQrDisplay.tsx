import React, { useRef, useState } from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import PageDataLoader from './PageDataLoader';
import PageDataError from './PageDataError';
import { useColors } from '@/hooks/useColors';
import { buildRewardsQrPayload } from '@/lib/rewardsQr';

export type RewardsQrDisplayState = {
  token: string | null;
  loading: boolean;
  error: unknown;
  recoveryRequired: boolean;
  persistenceWarning: boolean;
  retry: () => Promise<unknown>;
  recover: () => Promise<unknown>;
};

export default function RewardsQrDisplay({ state, size, testID }: {
  state: RewardsQrDisplayState; size: number; testID: string;
}) {
  const colors = useColors();
  const pending = useRef(false);
  const [recovering, setRecovering] = useState(false);
  const recover = async () => {
    if (pending.current) return;
    pending.current = true;
    setRecovering(true);
    try { await state.recover(); }
    catch { /* The shared mutation exposes the failure and a read-only retry. */ }
    finally { pending.current = false; setRecovering(false); }
  };
  if (state.loading || recovering) return <PageDataLoader label="Verifying rewards QR…" />;
  if (state.error) {
    return <PageDataError title="Rewards QR unavailable" error={state.error}
      message={(state.error as { status?: number })?.status === 401 ? undefined : 'Your code could not be verified. Connect and retry; this will not replace your code.'}
      onRetry={state.retry} testID={`retry-${testID}`} />;
  }
  if (state.recoveryRequired) {
    return (
      <View testID={`${testID}-recovery`} style={{ alignItems: 'center', gap: 12, maxWidth: 280 }}>
        <Text style={{ color: colors.text, textAlign: 'center' }}>
          A verified QR is needed for this account. Creating a replacement may disable an older code.
        </Text>
        <TouchableOpacity testID={`recover-${testID}`} accessibilityRole="button"
          accessibilityLabel="Create or recover rewards QR" onPress={() => { void recover(); }}
          style={{ backgroundColor: colors.primary, borderRadius: 10, minHeight: 44, padding: 12 }}>
          <Text style={{ color: colors.primaryForeground, fontWeight: '600' }}>Create or recover QR</Text>
        </TouchableOpacity>
      </View>
    );
  }
  if (!state.token) return <PageDataError title="Rewards QR unavailable" onRetry={state.retry} testID={`retry-${testID}`} />;
  return (
    <View style={{ alignItems: 'center', gap: 8 }}>
      {/* A fixed white quiet zone is retained in either theme, without clipping. */}
      <View style={{ backgroundColor: '#ffffff', padding: 12, flexShrink: 0 }}>
        <QRCode testID={testID} value={buildRewardsQrPayload(state.token)} size={size}
          color="#1a1a1a" backgroundColor="#ffffff" />
      </View>
      {state.persistenceWarning ? (
        <Text testID={`${testID}-storage-warning`} style={{ color: colors.mutedForeground, textAlign: 'center', maxWidth: 260 }}>
          This verified code is available now. Secure saving is unavailable; reconnect to load it again.
        </Text>
      ) : null}
    </View>
  );
}