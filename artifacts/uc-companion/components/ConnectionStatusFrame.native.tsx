import React, { type PropsWithChildren, useSyncExternalStore } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  getNativeConnectionStatus,
  subscribeNativeConnectionStatus,
} from '@/lib/nativeConnectionStatus';

export default function ConnectionStatusFrame({ children }: PropsWithChildren) {
  const online = useSyncExternalStore(
    subscribeNativeConnectionStatus,
    getNativeConnectionStatus,
    getNativeConnectionStatus,
  );
  const insets = useSafeAreaInsets();

  return (
    <View style={styles.frame}>
      <View style={styles.content}>{children}</View>
      {online === false && (
        <View
          pointerEvents="none"
          accessibilityLiveRegion="polite"
          style={[styles.notice, { paddingBottom: Math.max(insets.bottom, 8) }]}
        >
          <Ionicons name="cloud-offline-outline" size={16} color="#526F8D" accessible={false} />
          <Text style={styles.text}>Offline — saved content may be out of date.</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { flex: 1 },
  content: { flex: 1 },
  notice: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingTop: 8,
    paddingHorizontal: 16,
    backgroundColor: '#F4F8FF',
    borderTopColor: '#E2EBF5',
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  text: { flexShrink: 1, fontSize: 12, lineHeight: 18, color: '#526F8D' },
});