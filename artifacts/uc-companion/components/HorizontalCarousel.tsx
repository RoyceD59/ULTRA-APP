import React, { useRef } from 'react';
import { FlatList, Platform, type FlatListProps } from 'react-native';
import { NativeViewGestureHandler } from 'react-native-gesture-handler';
import { useRegisterAsCarousel } from './SwipeTabsContext';

/**
 * HorizontalCarousel — a horizontal FlatList whose native scroll gesture is
 * registered with the enclosing SwipeTabs via CarouselRegisterContext.
 *
 * SwipeTabs calls `pan.requireExternalGestureToFail(...carouselRefs)`, which
 * means the pan gesture can only activate once every registered carousel
 * handler has failed (i.e. is not scrolling). The resulting arbitration:
 *
 *   - User drags on a carousel → native scroll handler activates and stays
 *     active; pan is blocked for the lifetime of that touch → carousel wins.
 *   - User drags on empty content → no carousel handler activates; they all
 *     fail immediately → pan activates normally → tab switches.
 *   - Vertical drift ≥ 18 px → pan's failOffsetY kicks in regardless.
 *
 * This component must be used for every horizontal FlatList on screens that
 * are wrapped by SwipeTabs (Home, Products, Support). Horizontal lists on
 * screens NOT wrapped by SwipeTabs (Map) need no special treatment.
 */
function HorizontalCarousel<T>(props: FlatListProps<T>) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ref = useRef<any>(null);
  useRegisterAsCarousel(ref);

  if (Platform.OS === 'web') return <FlatList {...props} horizontal />;

  return (
    <NativeViewGestureHandler ref={ref}>
      <FlatList {...props} horizontal />
    </NativeViewGestureHandler>
  );
}

export default HorizontalCarousel;
