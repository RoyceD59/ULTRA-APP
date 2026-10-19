import React, { useState } from 'react';
import { Linking, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useColors } from '@/hooks/useColors';
import { publicForestLink } from '@/lib/impactTree';

export default function ForestLink({
  label = 'Explore our growing forest',
  testID = 'global-impact-forest-link',
  light = false,
}: { label?: string; testID?: string; light?: boolean }) {
  const colors = useColors();
  const [error, setError] = useState('');
  const color = light ? '#B5E9FA' : colors.primary;

  async function open() {
    setError('');
    try {
      await Linking.openURL(publicForestLink());
    } catch {
      setError('Unable to open the forest. Please try again.');
    }
  }

  return (
    <View>
      <TouchableOpacity accessibilityRole="link" accessibilityHint="Opens the public forest website outside the app"
        testID={testID} onPress={open} style={styles.link}>
        <Text style={[styles.label, { color }]}>{label}</Text>
        <Ionicons name="open-outline" size={14} color={color} />
      </TouchableOpacity>
      {!!error && <Text accessibilityRole="alert" style={{ color: light ? '#FFD5D5' : colors.destructive, fontSize: 12 }}>{error}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  link: { minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  label: { fontSize: 13, textDecorationLine: 'underline', flexShrink: 1, textAlign: 'center' },
});