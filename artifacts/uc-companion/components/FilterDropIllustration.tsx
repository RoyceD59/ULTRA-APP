import React, { useState } from 'react';
import { Image } from 'expo-image';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useColors } from '@/hooks/useColors';

/** One bundled glossy blue water droplet. Error feedback always uses the still frame. */
export default function FilterDropIllustration({ animate = false }: { animate?: boolean }) {
  const colors = useColors();
  const [failed, setFailed] = useState(false);
  if (failed) return <Ionicons testID="filter-drop-fallback" name="water-outline" size={32} color={colors.primary} accessible={false} />;
  return (
    <Image key={animate ? 'animated' : 'still'}
      testID={animate ? 'water-loader-animated' : 'water-loader-still'}
      source={animate ? require('@/assets/loading/water.gif') : require('@/assets/loading/water-still.png')}
      style={{ width: 56, height: 64 }} contentFit="contain" accessible={false}
      autoplay={animate} onError={() => setFailed(true)} />
  );
}