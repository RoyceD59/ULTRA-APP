import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import { pageDataState, animatePageLoader, pageFailureCopy } from '../pageLoading.ts';

describe('initial page loading lifecycle', () => {
  it('shows loading only without data, never on a cached/background refresh', () => {
    assert.equal(pageDataState(false, true, false), 'loading');
    assert.equal(pageDataState(true, true, false), 'ready');
    assert.equal(pageDataState(true, false, true), 'ready');
    assert.equal(pageDataState(false, false, true), 'error');
    assert.equal(pageDataState(false, false, false), 'empty');
    assert.equal(pageDataState(true, false, false), 'ready'); // includes []
    assert.equal(pageDataState(false, true, true), 'error');
  });
  it('uses a still frame for reduced motion, a hidden tab, or a backgrounded app', () => {
    for (const reduced of [false, true]) for (const focused of [false, true]) for (const active of [false, true]) {
      assert.equal(animatePageLoader(reduced, focused, active), !reduced && focused && active);
    }
  });
  it('mounts providers without unused text fonts or a startup timer and retains the native splash', () => {
    const source = readFileSync(new URL('../../app/_layout.tsx', import.meta.url), 'utf8');
    assert.doesNotMatch(source, /Inter_|useFonts|FontDisplay|fontBudget|startupReady|setTimeout|if \(!ready\)/);
    assert.match(source, /if \(Platform.OS !== 'web'\) void SplashScreen.preventAutoHideAsync\(\)/);
    assert.match(source, /useEffect\(\(\) => \{\s*if \(Platform.OS !== 'web'\) \{\s*void SplashScreen.hideAsync\(\).catch\(\(\) => \{\}\);\s*\}\s*\}, \[\]\)/);
    assert.match(source, /<AuthProvider>\s*<CartProvider>/);
    assert.match(source, /<Ionicons name="chevron-back"/);
    assert.match(source, /accessibilityLabel="Back to previous screen or shop"/);
  });
});

describe('local media and non-blocking fallback contracts', () => {
  const base = new URL('../../', import.meta.url);
  it('ships photos below 200 KB and a real animated GIF below 100 KB', () => {
    for (const name of ['home-water.jpg', 'shop-filter.jpg', 'blog-water.jpg']) {
      assert.ok(statSync(new URL(`assets/headers/${name}`, base)).size <= 200_000);
    }
    const gif = readFileSync(new URL('assets/loading/water.gif', base));
    assert.equal(gif.subarray(0, 6).toString(), 'GIF89a');
    assert.ok(gif.length <= 100_000);
    assert.ok(gif.includes(Buffer.from('NETSCAPE2.0'))); // looping extension
    assert.ok(statSync(new URL('assets/loading/water-still.png', base)).size > 0);
  });
  it('always renders header children independently of image failure', () => {
    const source = readFileSync(new URL('components/PhotoHeader.tsx', base), 'utf8');
    assert.match(source, /onError=\{\(\) => setFailed\(true\)\}/);
    assert.match(source, /!failed &&/);
    assert.match(source, /<View style=\{\[styles.panel, panelStyle\]\}>\{children\}<\/View>/);
    assert.doesNotMatch(source, /onLoad.*setReady|prefetch/);
  });
  it('eagerly prioritizes only initial-view headers and reserves their layout', () => {
    const source = readFileSync(new URL('components/PhotoHeader.tsx', base), 'utf8');
    assert.match(source, /initialView = false/);
    assert.match(source, /priority=\{initialView \? 'high' : 'low'\}/);
    assert.match(source, /loading=\{initialView \? 'eager' : 'lazy'\}/);
    assert.match(source, /height: photoHeight/);
    for (const route of ['index', 'products', 'blog']) {
      const page = readFileSync(new URL(`app/(tabs)/${route}.tsx`, base), 'utf8');
      assert.match(page, /<PhotoHeader initialView /);
    }
  });
  it('unmounts GIF when not animating and exposes an accessible loading label', () => {
    const source = readFileSync(new URL('components/PageDataLoader.tsx', base), 'utf8');
    const illustration = readFileSync(new URL('components/FilterDropIllustration.tsx', base), 'utf8');
    assert.match(illustration, /key=\{animate \? 'animated' : 'still'\}/);
    assert.match(illustration, /onError=\{\(\) => setFailed\(true\)\}/);
    assert.match(illustration, /filter-drop-fallback/);
    assert.match(source, /<FilterDropIllustration animate=\{animate\}/);
    assert.match(source, /accessibilityLabel=\{label\}/);
    assert.match(source, /accessibilityRole="progressbar"/);
  });
  it('errors and crash fallback use the still illustration and genuine recovery actions', () => {
    const source = readFileSync(new URL('components/PageDataError.tsx', base), 'utf8');
    assert.match(source, /<FilterDropIllustration \/>/);
    assert.doesNotMatch(source, /animate=|usePageMotion/);
    assert.match(source, /await onRetry\(\)/);
    assert.match(source, /if \(pending.current\) return/);
    assert.match(source, /disabled=\{retrying\}/);
    assert.match(source, /accessibilityRole="button"/);
    const crash = readFileSync(new URL('components/ErrorFallback.tsx', base), 'utf8');
    assert.match(crash, /<FilterDropIllustration \/>/);
    assert.match(crash, /reloadAppAsync\(\)/);
    assert.match(crash, /__DEV__/);
  });
  it('keeps offline, expired authentication, not-found and unexpected failures distinct without diagnostics', () => {
    assert.match(pageFailureCopy(new TypeError('Failed to fetch')), /offline/);
    assert.match(pageFailureCopy({ status: 401 }), /sign in/);
    assert.match(pageFailureCopy({ status: 403 }), /does not have access/);
    assert.match(pageFailureCopy({ status: 404 }), /no longer available/);
    assert.match(pageFailureCopy(new Error('SECRET stack trace')), /try again/);
    assert.doesNotMatch(pageFailureCopy(new Error('SECRET stack trace')), /SECRET|stack trace/);
  });
});