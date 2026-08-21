import React from 'react';
import { TouchableOpacity, Text, StyleSheet } from 'react-native';
import { useColors } from '@/hooks/useColors';

interface Props {
  label: string;
  active: boolean;
  onPress: () => void;
}

export default function FilterChip({ label, active, onPress }: Props) {
  const colors = useColors();
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.75}
      style={[
        styles.chip,
        active
          ? { backgroundColor: colors.primaryLight, borderColor: colors.primary, borderWidth: 2 }
          : { backgroundColor: 'transparent', borderColor: colors.border, borderWidth: 1 },
      ]}>
      <Text style={[styles.label, { color: active ? colors.primary : colors.mutedForeground, fontWeight: active ? '700' : '500' }]}>
        {label}
      </Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  chip: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20 },
  label: { fontSize: 13 },
});
