import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import FilterDropIllustration from './FilterDropIllustration';
import { useColors } from '@/hooks/useColors';
import { usePageMotion } from '@/hooks/usePageMotion';

/** Small, non-blocking page-data indicator; never used for payments/submission. */
export default function PageDataLoader({ label }: { label: string }) {
  const colors = useColors();
  const animate = usePageMotion();
  return (
    <View testID="page-data-loader" accessible accessibilityRole="progressbar"
      accessibilityLabel={label} accessibilityState={{ busy: true }} aria-busy={true} accessibilityLiveRegion="polite"
      style={styles.row}>
      <FilterDropIllustration animate={animate} />
      <Text style={[styles.label, { color: colors.mutedForeground }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { minHeight: 76, padding: 12, gap: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  label: { fontSize: 13, flexShrink: 1 },
});