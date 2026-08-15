import React from 'react';
import { Platform, StyleSheet } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useRouter, type Href } from 'expo-router';
import * as Haptics from 'expo-haptics';

/**
 * SwipeTabs — horizontal swipe navigation between the bottom tabs.
 *
 * Wrap a tab screen's content and pass its tab name; swiping left/right
 * slides to the neighbouring tab. The content follows the finger slightly
 * (damped) for tactile feedback, then springs back.
 *
 * The Map tab is deliberately NOT wrapped: panning is how you move the map,
 * so a swipe there must never switch tabs. You can still swipe *to* the map
 * from its neighbours and leave it via the tab bar.
 *
 * Gesture tuning:
 * - activeOffsetX ±45: horizontal carousels (products strip, promo banners)
 *   win the gesture for small horizontal movements; the tab swipe only
 *   activates on a decisive horizontal drag.
 * - failOffsetY ±18: vertical scrolling always wins.
 */

const TAB_ORDER = ['index', 'products', 'support', 'map', 'account'] as const;
export type SwipeTab = (typeof TAB_ORDER)[number];

const TAB_HREF: Record<SwipeTab, Href> = {
  index: '/',
  products: '/products',
  support: '/support',
  map: '/map',
  account: '/account',
};

const ACTIVATE_X = 45;   // px of horizontal drag before the gesture claims the touch
const FAIL_Y = 18;       // px of vertical drag that hands the touch to scrolling
const TRIGGER_DIST = 70; // drag distance that commits a tab change
const TRIGGER_VELOCITY = 800; // or a quick flick

export default function SwipeTabs({ tab, children }: { tab: SwipeTab; children: React.ReactNode }) {
  const router = useRouter();
  const drag = useSharedValue(0);

  const idx = TAB_ORDER.indexOf(tab);
  const prevTab = idx > 0 ? TAB_ORDER[idx - 1] : null;
  const nextTab = idx < TAB_ORDER.length - 1 ? TAB_ORDER[idx + 1] : null;

  const goTo = (target: SwipeTab) => {
    if (Platform.OS !== 'web') {
      Haptics.selectionAsync().catch(() => {});
    }
    router.navigate(TAB_HREF[target]);
  };

  const pan = Gesture.Pan()
    .activeOffsetX([-ACTIVATE_X, ACTIVATE_X])
    .failOffsetY([-FAIL_Y, FAIL_Y])
    .onUpdate((e) => {
      // Follow the finger, damped; extra resistance when there is no
      // neighbour in that direction (rubber-band at the first/last tab).
      const hasNeighbour = e.translationX < 0 ? nextTab !== null : prevTab !== null;
      const damping = hasNeighbour ? 3 : 8;
      const capped = Math.max(-90, Math.min(90, e.translationX / damping));
      drag.value = capped;
    })
    .onEnd((e) => {
      const goingNext =
        (e.translationX < -TRIGGER_DIST || e.velocityX < -TRIGGER_VELOCITY) && nextTab !== null;
      const goingPrev =
        (e.translationX > TRIGGER_DIST || e.velocityX > TRIGGER_VELOCITY) && prevTab !== null;

      drag.value = withTiming(0, { duration: 180 });
      if (goingNext) {
        runOnJS(goTo)(nextTab!);
      } else if (goingPrev) {
        runOnJS(goTo)(prevTab!);
      }
    });

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: drag.value }],
  }));

  return (
    <GestureDetector gesture={pan}>
      <Animated.View style={[styles.fill, animatedStyle]}>{children}</Animated.View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
});
