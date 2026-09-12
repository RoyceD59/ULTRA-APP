import React, { useCallback, useMemo, useRef, useState } from 'react';
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
import { CarouselRegisterContext, type CarouselRef } from './SwipeTabsContext';

/**
 * SwipeTabs — horizontal swipe navigation between the bottom tabs.
 *
 * Wrap a tab screen's content and pass its tab name; swiping left/right
 * slides to the neighbouring tab. The content follows the finger slightly
 * (damped) for tactile feedback, then springs back.
 *
 * The Map tab is deliberately NOT wrapped: panning is how you move the map,
 * so a swipe there must never switch tabs. Map is also skipped as a swipe
 * destination; enter and leave it via the tab bar.
 *
 * Gesture arbitration:
 * Each horizontal FlatList in this screen must be wrapped in HorizontalCarousel,
 * which registers its NativeViewGestureHandler ref with this component via
 * CarouselRegisterContext. Those refs are passed to
 * `pan.requireExternalGestureToFail(...)`, which means:
 *
 *   - If any carousel's native scroll handler activates (the user is scrolling
 *     a carousel), the pan blocks until that handler fails. Since a committed
 *     scroll stays active until the finger lifts, the pan never fires →
 *     no accidental tab switch.
 *   - If no carousel scroll activates within ACTIVATE_X (45 px), those
 *     handlers have all failed (or were never relevant) → the pan can activate
 *     normally for a tab switch.
 *   - Any vertical movement ≥ FAIL_Y (18 px) fails the pan immediately,
 *     handing the touch to the nearest vertical ScrollView.
 *
 * Physical-device checklist (simulators don't reproduce gesture racing
 * reliably; each item must be verified on a real iOS and Android device):
 * [ ] Swipe on plain screen content → switches tab
 * [ ] Swipe on promo banner strip → scrolls strip, no tab switch
 * [ ] Swipe on featured products strip → scrolls strip, no tab switch
 * [ ] Swipe on category chips → scrolls chips, no tab switch
 * [ ] Vertical scroll anywhere → unaffected by SwipeTabs
 * [ ] Vertical scroll on Support screen (SectionList / FlatList / ScrollView tabs)
 *     → unaffected; a slow diagonal drag never triggers a tab switch
 * [ ] Map tab: swiping the map does NOT switch tabs (not wrapped in SwipeTabs)
 * If a carousel loses the race: raise ACTIVATE_X or lower TRIGGER_DIST.
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

/**
 * Tabs that are NOT wrapped in SwipeTabs and therefore cannot be reached via a
 * swipe gesture. They still appear in TAB_ORDER (which drives the tab bar) but
 * are skipped when computing the swipe neighbours of an adjacent tab.
 *
 * Map is excluded because horizontal panning is how you interact with the map
 * itself — wrapping it would intercept those drags. Navigating to/from Map is
 * done via the tab bar only.
 *
 * Effect on neighbours:
 *   • Support (left of Map) — nextTab skips Map → no right-edge swipe to Map
 *   • Account (right of Map) — prevTab skips Map → no left-edge swipe to Map
 */
const NON_SWIPE_TABS = new Set<SwipeTab>(['map']);

const ACTIVATE_X = 45;   // px of horizontal drag before the gesture claims the touch
const FAIL_Y = 20;       // px of vertical drag that hands the touch to scrolling
                         // (20 px gives a comfortable margin for content-heavy screens like
                         // Support — a user scrolling vertically reaches 20 px long before the
                         // 45 px horizontal gate fires, so the pan never activates)
const TRIGGER_DIST = 70; // drag distance that commits a tab change
const TRIGGER_VELOCITY = 800; // or a quick flick

export default function SwipeTabs({ tab, children }: { tab: SwipeTab; children: React.ReactNode }) {
  const router = useRouter();
  const drag = useSharedValue(0);

  // Collect NativeViewGestureHandler refs from HorizontalCarousel children.
  // Stored in state so that adding/removing a carousel triggers a re-render
  // and the pan gesture is rebuilt with the updated requireExternalGestureToFail list.
  const [carouselRefs, setCarouselRefs] = useState<CarouselRef[]>([]);

  const register = useCallback((ref: CarouselRef) => {
    setCarouselRefs(prev => [...prev, ref]);
    return () => setCarouselRefs(prev => prev.filter(r => r !== ref));
  }, []);

  const idx = TAB_ORDER.indexOf(tab);

  // Walk backwards/forwards through TAB_ORDER, skipping any tab in
  // NON_SWIPE_TABS, so that swipe navigation never lands on a tab that isn't
  // wrapped in SwipeTabs (e.g. Map).
  const prevTab = (() => {
    for (let i = idx - 1; i >= 0; i--) {
      if (!NON_SWIPE_TABS.has(TAB_ORDER[i])) return TAB_ORDER[i];
    }
    return null;
  })();
  const nextTab = (() => {
    for (let i = idx + 1; i < TAB_ORDER.length; i++) {
      if (!NON_SWIPE_TABS.has(TAB_ORDER[i])) return TAB_ORDER[i];
    }
    return null;
  })();

  const goTo = (target: SwipeTab) => {
    if (Platform.OS !== 'web') {
      Haptics.selectionAsync().catch(() => {});
    }
    router.navigate(TAB_HREF[target]);
  };

  // Rebuild the gesture whenever the carousel ref list, or the available
  // neighbours, changes so that requireExternalGestureToFail stays current.
  const pan = useMemo(() => {
    const gesture = Gesture.Pan()
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

    // If any HorizontalCarousel has registered, require all of them to fail
    // (i.e. not scroll) before the pan is allowed to activate.
    if (carouselRefs.length > 0) {
      gesture.requireExternalGestureToFail(...carouselRefs);
    }

    return gesture;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [carouselRefs, prevTab, nextTab]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: drag.value }],
  }));

  return (
    <CarouselRegisterContext.Provider value={register}>
      <GestureDetector gesture={pan}>
        <Animated.View style={[styles.fill, animatedStyle]}>{children}</Animated.View>
      </GestureDetector>
    </CarouselRegisterContext.Provider>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
});
