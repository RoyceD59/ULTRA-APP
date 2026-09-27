import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

interface ExpiredSessionNoticeProps {
  message: string | null;
  backgroundColor: string;
  borderColor: string;
  textColor: string;
}

export function ExpiredSessionNotice({
  message,
  backgroundColor,
  borderColor,
  textColor,
}: ExpiredSessionNoticeProps) {
  if (!message) return null;

  return (
    <View
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
      style={[styles.notice, { backgroundColor, borderColor }]}
      testID="expired-session-notice"
    >
      <Ionicons name="information-circle-outline" size={20} color={borderColor} />
      <Text style={[styles.text, { color: textColor }]}>{message}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  notice: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    marginBottom: 8,
  },
  text: {
    flex: 1,
    fontSize: 14,
    lineHeight: 20,
  },
});