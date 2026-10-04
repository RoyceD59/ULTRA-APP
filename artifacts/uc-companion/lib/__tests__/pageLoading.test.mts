import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import { pageDataState, animatePageLoader, pageFailureCopy, startupReady, FONT_STARTUP_BUDGET_MS } from '../pageLoading.ts';

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
  it('allows fonts to succeed/error early and never waits beyond the startup budget', () => {
    assert.equal(FONT_STARTUP_BUDGET_MS, 600);
    assert.equal(startupReady(false, null, false), false);
    assert.equal(startupReady(true, null, false), true);
    assert.equal(startupReady(false, new Error('missing font'), false), true);
    assert.equal(startupReady(false, null, true), true);
  });
  it('never gates web content on delayed, failed, or missing fonts', () => {
    for (const loaded of [false, true]) for (const expired of [false, true]) {
      assert.equal(startupReady(loaded, null, expired, 'web'), true);
      assert.equal(startupReady(loaded, new Error('font error'), expired, 'web'), true);
    }
    for (const platform of ['android', 'ios']) {
      assert.equal(startupReady(false, null, false, platform), false);
      assert.equal(startupReady(false, null, true, platform), true);
    }
    const source = readFileSync(new URL('../../app/_layout.tsx', import.meta.url), 'utf8');
    assert.match(source, /startupReady\(fontsLoaded, fontError, fontBudgetExpired, Platform.OS\)/);
    assert.equal((source.match(/display: FontDisplay.SWAP/g) || []).length, 4);
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