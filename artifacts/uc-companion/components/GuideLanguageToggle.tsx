import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useColors } from '@/hooks/useColors';
import { useGuideLanguage } from '@/hooks/useGuideLanguage';

export default function GuideLanguageToggle() {
  const colors = useColors();
  const { language, setLanguage } = useGuideLanguage();
  return (
    <View style={styles.row}>
      <Text style={[styles.label, { color: colors.mutedForeground }]}>
        {language === 'sw' ? 'Lugha ya mwongozo' : 'Guide language'}
      </Text>
      <View style={[styles.toggle, { borderColor: colors.border, backgroundColor: colors.card }]}>
        {(['en', 'sw'] as const).map(value => (
          <Pressable key={value} accessibilityRole="button"
            accessibilityLabel={value === 'en' ? 'English' : 'Kiswahili'}
            accessibilityState={{ selected: language === value }}
            onPress={() => { void setLanguage(value); }}
            style={[styles.button, language === value && { backgroundColor: colors.primaryLight }]}>
            <Text style={[styles.text, { color: language === value ? colors.primary : colors.mutedForeground }]}>
              {value.toUpperCase()}
            </Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  label: { fontSize: 13, flexShrink: 1 },
  toggle: { flexDirection: 'row', borderWidth: 1, borderRadius: 10, overflow: 'hidden' },
  button: { minWidth: 48, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  text: { fontSize: 13, fontWeight: '700' },
});