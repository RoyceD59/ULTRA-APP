import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import { pageDataState, animatePageLoader, startupReady, FONT_STARTUP_BUDGET_MS } from '../pageLoading.ts';

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
  it('unmounts GIF when not animating and exposes an accessible loading label', () => {
    const source = readFileSync(new URL('components/PageDataLoader.tsx', base), 'utf8');
    assert.match(source, /key=\{animate \? 'animated' : 'still'\}/);
    assert.match(source, /accessibilityLabel=\{label\}/);
    assert.match(source, /accessibilityRole="progressbar"/);
  });
});