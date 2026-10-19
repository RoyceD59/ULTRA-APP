import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useColors } from '@/hooks/useColors';

interface Props {
  bottom: number;
  onOpen: () => void;
  onDismiss: () => void;
}

export default function AlisonWelcomeBubble({ bottom, onOpen, onDismiss }: Props) {
  const colors = useColors();
  return (
    <View
      testID="products-alison-nudge"
      style={[styles.bubble, {
        bottom,
        backgroundColor: colors.surface,
        borderColor: colors.primary,
        shadowColor: colors.text,
      }]}>
      <TouchableOpacity
        testID="products-alison-nudge-open"
        accessibilityRole="button"
        accessibilityLabel="Chat with Alison, your filter guide"
        onPress={onOpen}
        activeOpacity={0.85}
        style={styles.welcome}>
        <View style={[styles.avatar, { backgroundColor: colors.primary }]}>
          <Ionicons name="chatbubble-ellipses" size={24} color={colors.primaryForeground} />
        </View>
        <View style={styles.message}>
          <Text style={[styles.title, { color: colors.text }]}>Hi, I’m Alison!</Text>
          <Text style={[styles.text, { color: colors.mutedForeground }]}>
            Need help choosing a filter? Let’s chat.
          </Text>
        </View>
      </TouchableOpacity>
      <TouchableOpacity
        testID="products-alison-nudge-dismiss"
        accessibilityRole="button"
        accessibilityLabel="Dismiss filter help"
        onPress={onDismiss}
        style={styles.dismiss}>
        <Ionicons name="close" size={20} color={colors.mutedForeground} />
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  bubble: {
    position: 'absolute', right: 16, left: 16, maxWidth: 360,
    alignSelf: 'flex-end', marginLeft: 'auto',
    flexDirection: 'row', alignItems: 'center',
    borderWidth: 1, borderRadius: 24, padding: 8,
    shadowOpacity: 0.16, shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 }, elevation: 6, zIndex: 10,
  },
  welcome: {
    flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10,
    minHeight: 56, paddingVertical: 4,
  },
  avatar: {
    width: 44, height: 44, borderRadius: 22,
    alignItems: 'center', justifyContent: 'center',
  },
  message: { flex: 1 },
  title: { fontSize: 14, fontWeight: '700' },
  text: { fontSize: 13, lineHeight: 19, marginTop: 2 },
  dismiss: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
});