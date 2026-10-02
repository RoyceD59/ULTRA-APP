/**
 * AlisonBubble — floating Alison chat bubble for the checkout flow.
 *
 * Behaviour:
 *  - Optionally waits `appearDelayMs` before showing (used on the payment-
 *    waiting screen so the bubble only appears when payment feels delayed).
 *  - Shows the greeting message expanded, then auto-collapses to a small
 *    avatar bubble after `collapseAfterMs` (2 s per spec) of display.
 *  - Tapping the bubble (collapsed or expanded) opens the Alison AI chat.
 */
import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Animated } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';
import { useRouter } from 'expo-router';

interface Props {
  message: string;
  /** Milliseconds the message stays expanded before collapsing. Default 2000. */
  collapseAfterMs?: number;
  /** Milliseconds to wait before the bubble appears at all. Default 0. */
  appearDelayMs?: number;
  /** Distance from the bottom edge (above footers/buttons). Default 96. */
  bottomOffset?: number;
  /** Inline support stays in document flow instead of covering form controls. */
  placement?: 'floating' | 'inline';
}

export default function AlisonBubble({
  message,
  collapseAfterMs = 2000,
  appearDelayMs = 0,
  bottomOffset = 96,
  placement = 'floating',
}: Props) {
  const colors = useColors();
  const router = useRouter();
  const [visible, setVisible] = useState(appearDelayMs === 0);
  const [expanded, setExpanded] = useState(true);
  const fade = useRef(new Animated.Value(0)).current;

  // Appear (optionally delayed), then collapse after the message has been
  // displayed for collapseAfterMs.
  useEffect(() => {
    let collapseTimer: ReturnType<typeof setTimeout> | null = null;
    const appearTimer = setTimeout(() => {
      setVisible(true);
      Animated.timing(fade, { toValue: 1, duration: 250, useNativeDriver: true }).start();
      collapseTimer = setTimeout(() => setExpanded(false), collapseAfterMs);
    }, appearDelayMs);
    return () => {
      clearTimeout(appearTimer);
      if (collapseTimer) clearTimeout(collapseTimer);
    };
  }, [appearDelayMs, collapseAfterMs, fade]);

  if (!visible) return null;

  function openChat() {
    router.push('/ai-chat' as never);
  }

  return (
    <Animated.View
      pointerEvents="box-none"
      style={[
        placement === 'inline' ? styles.inlineWrap : styles.wrap,
        placement === 'floating' ? { bottom: bottomOffset } : null,
        { opacity: fade },
      ]}
    >
      {expanded && (
        <TouchableOpacity
          activeOpacity={0.9}
          onPress={openChat}
          style={[styles.messageCard, { backgroundColor: colors.card, borderColor: colors.primary }]}
        >
          <Text style={[styles.messageName, { color: colors.primary }]}>Alison</Text>
          <Text style={[styles.messageText, { color: colors.text }]}>{message}</Text>
        </TouchableOpacity>
      )}
      <TouchableOpacity
        activeOpacity={0.85}
        onPress={openChat}
        accessibilityLabel="Chat with Alison"
        style={[styles.avatar, { backgroundColor: colors.primary }]}
      >
        <Ionicons name="chatbubble-ellipses" size={24} color="#fff" />
        <View style={styles.onlineDot} />
      </TouchableOpacity>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  inlineWrap: {
    alignItems: 'flex-end',
    gap: 8,
  },
  wrap: {
    position: 'absolute',
    right: 16,
    alignItems: 'flex-end',
    gap: 8,
    zIndex: 50,
  },
  messageCard: {
    maxWidth: 280,
    borderRadius: 16,
    borderBottomRightRadius: 4,
    borderWidth: 1.5,
    padding: 12,
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  },
  messageName: { fontSize: 12, fontWeight: '700' as const, marginBottom: 2 },
  messageText: { fontSize: 13, lineHeight: 19 },
  avatar: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
    elevation: 5,
  },
  onlineDot: {
    position: 'absolute',
    top: 2,
    right: 2,
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: '#22c55e',
    borderWidth: 2,
    borderColor: '#fff',
  },
});
