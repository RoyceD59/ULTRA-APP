import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';
import { usePageMotion } from '@/hooks/usePageMotion';

/** Small, non-blocking page-data indicator; never used for payments/submission. */
export default function PageDataLoader({ label }: { label: string }) {
  const colors = useColors();
  const animate = usePageMotion();
  const [failed, setFailed] = useState(false);
  return (
    <View testID="page-data-loader" accessible accessibilityRole="progressbar"
      accessibilityLabel={label} accessibilityState={{ busy: true }} aria-busy={true} accessibilityLiveRegion="polite"
      style={styles.row}>
      {failed ? <Ionicons name="water-outline" size={28} color={colors.primary} /> : (
        <Image
          key={animate ? 'animated' : 'still'}
          testID={animate ? 'water-loader-animated' : 'water-loader-still'}
          source={animate ? require('@/assets/loading/water.gif') : require('@/assets/loading/water-still.png')}
          style={styles.image} contentFit="contain" accessible={false}
          autoplay={animate} onError={() => setFailed(true)}
        />
      )}
      <Text style={[styles.label, { color: colors.mutedForeground }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { minHeight: 76, padding: 12, gap: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  image: { width: 48, height: 48, borderRadius: 12 },
  label: { fontSize: 13, flexShrink: 1 },
});