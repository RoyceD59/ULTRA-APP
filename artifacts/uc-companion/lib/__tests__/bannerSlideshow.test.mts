import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import {
  BANNER_INTERVAL_MS, nextSlideIndex, shouldCycleBanner, startBannerCycle,
} from '../bannerSlideshow.ts';

const base = new URL('../../', import.meta.url);
const read = (p: string) => readFileSync(new URL(p, base), 'utf8');

function fakeTimers() {
  const active = new Map<number, { fn: () => void; ms: number }>();
  let id = 0;
  return {
    active,
    set: (fn: () => void, ms: number) => { active.set(++id, { fn, ms }); return id; },
    clear: (key: unknown) => { active.delete(key as number); },
  };
}

describe('Products banner slideshow timing', () => {
  it('advances every 3000ms and loops through all slides', () => {
    assert.equal(BANNER_INTERVAL_MS, 3000);
    assert.deepEqual([0, 1, 2].map(i => nextSlideIndex(i, 3)), [1, 2, 0]);
    assert.equal(nextSlideIndex(0, 1), 0);
    const timers = fakeTimers();
    let index = 0;
    const stop = startBannerCycle(true, 3, () => { index = nextSlideIndex(index, 3); }, timers);
    const [entry] = [...timers.active.values()];
    assert.equal(entry.ms, 3000);
    for (let tick = 0; tick < 4; tick++) entry.fn();
    assert.equal(index, 1);
    stop();
    assert.equal(timers.active.size, 0, 'cleanup clears the interval');
  });
  it('never schedules a timer when motion is paused or there is one slide', () => {
    assert.equal(shouldCycleBanner(false, 3), false);
    assert.equal(shouldCycleBanner(true, 1), false);
    assert.equal(shouldCycleBanner(true, 3), true);
    const timers = fakeTimers();
    startBannerCycle(false, 3, () => {}, timers);
    startBannerCycle(true, 1, () => {}, timers);
    assert.equal(timers.active.size, 0);
  });
});

describe('Products banner structure', () => {
  const component = read('components/ProductsBannerSlideshow.tsx');
  const page = read('app/(tabs)/products.tsx');
  it('pauses via the shared reduced-motion, focus, hidden-tab and background policy', () => {
    assert.match(component, /const animate = usePageMotion\(\)/);
    assert.match(component, /startBannerCycle\(animate && ready, count/, 'never cycle into a still-loading slide');
    assert.match(component, /loaded\.every\(Boolean\)/);
    assert.match(component, /i === 0 \? 1 : 0/, 'first slide visible immediately');
    assert.match(component, /value\.setValue/, 'still frame without fades when paused');
    assert.match(component, /if \(!animate\) \{\s*setIndex\(0\)/, 'reduced motion returns to the first slide');
    assert.match(component, /value\.stopAnimation\(\)/, 'pause and cleanup stop active fades');
  });
  it('mounts all local slides, decorative and text-free, without gesture handlers', () => {
    for (const name of ['shower', 'household', 'bottles']) {
      assert.match(component, new RegExp(`require\\('@/assets/headers/products-slide-${name}.jpg'\\)`));
      assert.ok(statSync(new URL(`assets/headers/products-slide-${name}.jpg`, base)).size <= 120_000);
    }
    assert.ok(component.indexOf('shower') < component.indexOf('household'));
    assert.ok(component.indexOf('household') < component.indexOf('bottles'));
    assert.match(component, /loading="eager"/);
    assert.match(component, /contentFit="contain"/);
    assert.match(component, /accessibilityElementsHidden/);
    assert.match(component, /importantForAccessibility="no-hide-descendants"/);
    assert.match(component, /pointerEvents="none"/);
    assert.doesNotMatch(component, /<Text|https?:\/\/|onPress|PanResponder|Gesture|onTouch/);
  });
  it('replaces the Products header photo and logo with the banner and an icon-only cart overlay', () => {
    assert.match(page, /<ProductsBannerSlideshow maxHeight=\{\d+\}>/);
    assert.doesNotMatch(page, /PhotoHeader|shop-filter|logo-lockup/);
    assert.match(page, /accessibilityLabel=\{`Cart, \$\{items.length\} items`\}/);
    assert.match(page, /<Ionicons name="cart-outline" size=\{22\}/);
    assert.match(page, /styles.cartBadge/);
    assert.match(page, /<AlisonWelcomeBubble/);
    for (const route of ['index', 'blog']) assert.match(read(`app/(tabs)/${route}.tsx`), /<PhotoHeader initialView /);
  });
});
