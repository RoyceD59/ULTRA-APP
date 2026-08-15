import React, { createContext, useContext, useEffect } from 'react';
/**
 * CarouselRegisterContext carries a callback that horizontal carousels call on
 * mount to register their NativeViewGestureHandler ref with the enclosing
 * SwipeTabs. SwipeTabs then passes those refs to
 * `pan.requireExternalGestureToFail(...)` so that:
 *
 *   - If a carousel's native scroll handler activates (user is scrolling the
 *     carousel), the pan waits for it to fail. Since the scroll stays active,
 *     the pan never fires → no accidental tab switch.
 *   - If no carousel handler activates within ACTIVATE_X, all handlers have
 *     effectively failed → pan can activate normally for a tab switch.
 *
 * `any` is intentional: requireExternalGestureToFail bridges RNGH's old and
 * new gesture APIs; the cross-API ref type doesn't round-trip through
 * TypeScript cleanly, and `any` is consistent with RNGH's own examples.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type CarouselRef = React.RefObject<any>;
export type RegisterCarouselFn = (ref: CarouselRef) => () => void;

export const CarouselRegisterContext = createContext<RegisterCarouselFn>(() => () => {});

/** Called by HorizontalCarousel to register itself with the enclosing SwipeTabs. */
export function useRegisterAsCarousel(ref: CarouselRef) {
  const register = useContext(CarouselRegisterContext);
  useEffect(() => register(ref), [register, ref]);
}
