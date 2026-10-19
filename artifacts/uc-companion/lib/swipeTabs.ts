import { COMPANION_TABS, type CompanionTab } from './companionLayout';
export const SWIPE_TAB_ORDER: readonly CompanionTab[] = COMPANION_TABS.map(tab => tab.name);
export type SwipeTab = (typeof SWIPE_TAB_ORDER)[number];

const NON_SWIPE_TABS = new Set<SwipeTab>(['map']);

export function getSwipeNeighbours(tab: SwipeTab): {
  previous: SwipeTab | null;
  next: SwipeTab | null;
} {
  const index = SWIPE_TAB_ORDER.indexOf(tab);
  let previous: SwipeTab | null = null;
  let next: SwipeTab | null = null;

  for (let i = index - 1; i >= 0; i--) {
    const candidate = SWIPE_TAB_ORDER[i];
    if (!NON_SWIPE_TABS.has(candidate)) {
      previous = candidate;
      break;
    }
  }

  for (let i = index + 1; i < SWIPE_TAB_ORDER.length; i++) {
    const candidate = SWIPE_TAB_ORDER[i];
    if (!NON_SWIPE_TABS.has(candidate)) {
      next = candidate;
      break;
    }
  }

  return { previous, next };
}