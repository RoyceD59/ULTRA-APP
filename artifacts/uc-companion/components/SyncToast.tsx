/**
 * SyncToast
 *
 * A lightweight, self-dismissing banner that slides in from the top,
 * stays for `duration` ms, then fades out.
 *
 * Usage:
 *   <SyncToast message="..." visible={true} onHide={() => setMsg(null)} />
 *
 * Pass `visible={false}` (or omit `message`) to keep it hidden.
 * When `visible` flips true a fresh animation cycle starts.
 */
import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

interface Props {
  /** The message to display. */
  message: string;
  /** Whether the toast is currently shown. */
  visible: boolean;
  /** Called once the dismiss animation is finished. */
  onHide: () => void;
  /** How long (ms) the toast stays fully visible before fading. Default 3000. */
  duration?: number;
}

export default function SyncToast({
  message,
  visible,
  onHide,
  duration = 3000,
}: Props) {
  const opacity   = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(-20)).current;
  const insets    = useSafeAreaInsets();

  useEffect(() => {
    if (!visible) return;

    // Reset to start position in case a previous animation is mid-flight.
    opacity.setValue(0);
    translateY.setValue(-20);

    const fadeIn = Animated.parallel([
      Animated.timing(opacity,    { toValue: 1,   duration: 250, useNativeDriver: true }),
      Animated.timing(translateY, { toValue: 0,   duration: 250, useNativeDriver: true }),
    ]);

    const hold = Animated.delay(duration);

    const fadeOut = Animated.parallel([
      Animated.timing(opacity,    { toValue: 0,  duration: 350, useNativeDriver: true }),
      Animated.timing(translateY, { toValue: -10, duration: 350, useNativeDriver: true }),
    ]);

    Animated.sequence([fadeIn, hold, fadeOut]).start(({ finished }) => {
      if (finished) onHide();
    });

    return () => {
      // If the component unmounts mid-animation, stop immediately.
      opacity.stopAnimation();
      translateY.stopAnimation();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  if (!visible && !message) return null;

  return (
    <Animated.View
      style={[
        styles.container,
        {
          top: insets.top + 12,
          opacity,
          transform: [{ translateY }],
        },
      ]}
      pointerEvents="none"
    >
      <View style={styles.pill}>
        <Ionicons name="sync-circle-outline" size={16} color="#0054A6" style={styles.icon} />
        <Text style={styles.text} numberOfLines={2}>
          {message}
        </Text>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    position:        'absolute',
    left:            16,
    right:           16,
    alignItems:      'center',
    zIndex:          9999,
    elevation:       10,
  },
  pill: {
    flexDirection:   'row',
    alignItems:      'center',
    backgroundColor: '#EFF6FF',         // light blue tint — UC brand family
    borderColor:     '#BFDBFE',
    borderWidth:     1,
    borderRadius:    12,
    paddingHorizontal: 14,
    paddingVertical:   10,
    maxWidth:          420,
    shadowColor:       '#000',
    shadowOpacity:     0.08,
    shadowRadius:      8,
    shadowOffset:      { width: 0, height: 3 },
    gap:               8,
  },
  icon: {
    flexShrink: 0,
  },
  text: {
    flex:       1,
    fontSize:   13,
    fontWeight: '500',
    color:      '#1E3A5F',
    lineHeight: 18,
  },
});
