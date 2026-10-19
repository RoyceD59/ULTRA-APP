import React, { useEffect, useRef, useState } from 'react';
import { Animated, StyleSheet, View, useWindowDimensions, type StyleProp, type ViewStyle } from 'react-native';
import { Image } from 'expo-image';
import { usePageMotion } from '@/hooks/usePageMotion';
import { BANNER_FADE_MS, nextSlideIndex, startBannerCycle } from '@/lib/bannerSlideshow';

const POSTER_WHITE = '#ffffff';
const POSTER_BLUE = '#095c8e';
const SLIDE_ASPECT = 2; // 1200x600 crops
const MAX_CONTENT_WIDTH = 1200;

/**
 * Local, text-free product crops in user-confirmed order: shower, household, bottles.
 * `split` is where each poster's white wall meets the blue floor, so the side
 * padding on wide screens continues the poster background seamlessly.
 */
export const PRODUCTS_BANNER_SLIDES = [
  { source: require('@/assets/headers/products-slide-shower.jpg'), split: 0.567 },
  { source: require('@/assets/headers/products-slide-household.jpg'), split: 0.597 },
  { source: require('@/assets/headers/products-slide-bottles.jpg'), split: 0.567 },
] as const;

type Props = {
  maxHeight: number;
  style?: StyleProp<ViewStyle>;
  children?: React.ReactNode;
};

/** Decorative images-only banner. All slides stay mounted so later slides never flash blank. */
export default function ProductsBannerSlideshow({ maxHeight, style, children }: Props) {
  const { width } = useWindowDimensions();
  // Never taller than the 2:1 crop, so tall product groups are never cropped vertically.
  const height = Math.round(Math.min(maxHeight, Math.min(width, MAX_CONTENT_WIDTH) / SLIDE_ASPECT));
  const animate = usePageMotion();
  const count = PRODUCTS_BANNER_SLIDES.length;
  const [index, setIndex] = useState(0);
  const [loaded, setLoaded] = useState(() => PRODUCTS_BANNER_SLIDES.map(() => false));
  const ready = loaded.every(Boolean);
  const fades = useRef(PRODUCTS_BANNER_SLIDES.map((_, i) => new Animated.Value(i === 0 ? 1 : 0))).current;

  // Reduced motion: hold the still first frame.
  useEffect(() => {
    if (!animate) {
      setIndex(0);
      return;
    }
    return startBannerCycle(animate && ready, count, () => setIndex(i => nextSlideIndex(i, count)));
  }, [animate, ready, count]);

  useEffect(() => {
    fades.forEach((value, i) => {
      value.stopAnimation();
      if (!animate) { value.setValue(i === index ? 1 : 0); return; }
      Animated.timing(value, { toValue: i === index ? 1 : 0, duration: BANNER_FADE_MS, useNativeDriver: true }).start();
    });
    return () => fades.forEach(value => value.stopAnimation());
  }, [index, animate, fades]);

  return (
    <View style={[styles.wrap, { height }, style]}>
      <View
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
        importantForAccessibility="no-hide-descendants"
        accessibilityElementsHidden
        testID="products-banner-slides">
        {PRODUCTS_BANNER_SLIDES.map(({ source, split }, i) => (
          <Animated.View key={i} testID={`products-banner-slide-${i}`} style={[StyleSheet.absoluteFill, styles.slide, { opacity: fades[i] }]}>
            <View style={[styles.floor, { top: `${split * 100}%` }]} />
            <Image
              source={source}
              style={StyleSheet.absoluteFill}
              contentFit="contain"
              contentPosition="center"
              transition={0}
              priority={i === 0 ? 'high' : 'normal'}
              loading="eager"
              accessible={false}
              onLoad={() => setLoaded(previous => previous[i] ? previous : previous.map((value, slot) => slot === i || value))}
            />
          </Animated.View>
        ))}
      </View>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { width: '100%', backgroundColor: POSTER_WHITE, overflow: 'hidden' },
  slide: { backgroundColor: POSTER_WHITE },
  floor: { position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: POSTER_BLUE },
});
