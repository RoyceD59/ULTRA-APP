import React from 'react';
import { Image, useColorScheme, type ImageStyle, type StyleProp } from 'react-native';

const LOGO_WHITE = require('@/assets/images/logo-lockup-white.png');
const LOGO_DEEP = require('@/assets/images/logo-lockup-deep.png');

/** Native asset dimensions (both variants are 800x1025). */
const ASPECT = 1025 / 800;

/**
 * Ultra Clear brand lock-up (ULTRA wordmark + UC emblem, cropped from the
 * primary vertical logo). Per brand rules: Deep Ocean Blue on light
 * backgrounds, white (reverse) on dark / blue backgrounds.
 */
export default function BrandLogo({
  width = 110,
  variant,
  style,
}: {
  width?: number;
  /** Override auto scheme-based colour: 'deep' for light bg, 'white' for dark/blue bg. */
  variant?: 'white' | 'deep';
  style?: StyleProp<ImageStyle>;
}) {
  const scheme = useColorScheme();
  const resolved = variant ?? (scheme === 'dark' ? 'white' : 'deep');
  return (
    <Image
      source={resolved === 'white' ? LOGO_WHITE : LOGO_DEEP}
      style={[{ width, height: Math.round(width * ASPECT) }, style]}
      resizeMode="contain"
      accessibilityLabel="Ultra Clear"
    />
  );
}
