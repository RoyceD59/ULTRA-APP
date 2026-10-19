import React from 'react';
import { View, TouchableOpacity } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import * as Haptics from 'expo-haptics';

interface Props {
  rating: number;
  size?: number;
  color?: string;
  emptyColor?: string;
  gap?: number;
  /** When provided, stars become tappable (input mode). */
  onChange?: (rating: number) => void;
}

/** Displays a 0–5 star rating (half stars supported); tappable in input mode. */
export default function StarRating({
  rating,
  size = 14,
  color = '#F5A623',
  emptyColor = '#C7CDD6',
  gap = 2,
  onChange,
}: Props) {
  const stars = [1, 2, 3, 4, 5].map((i) => {
    let name: 'star' | 'star-half' | 'star-outline' = 'star-outline';
    if (rating >= i - 0.25) name = 'star';
    else if (rating >= i - 0.75) name = 'star-half';
    const icon = (
      <Ionicons
        name={name}
        size={size}
        color={name === 'star-outline' ? emptyColor : color}
      />
    );
    if (!onChange) return <View key={i}>{icon}</View>;
    return (
      <TouchableOpacity
        key={i}
        accessibilityRole="button"
        accessibilityLabel={`Rate ${i} out of 5`}
        accessibilityState={{ selected: rating === i }}
        hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
        onPress={() => {
          onChange(i);
          // Optional tactile feedback must never prevent a rating selection.
          try {
            void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
          } catch { /* unsupported tactile feedback */ }
        }}
      >
        {icon}
      </TouchableOpacity>
    );
  });
  return <View style={{ flexDirection: 'row', alignItems: 'center', gap }}>{stars}</View>;
}
