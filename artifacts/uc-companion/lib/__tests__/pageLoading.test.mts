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
  it('bundles a transparent falling-drop loop at the original illustration footprint', async () => {
    const gif = readFileSync(new URL('assets/loading/water.gif', base));
    assert.equal(gif.readUInt16LE(6), 96);
    assert.equal(gif.readUInt16LE(8), 112);
    // Walk GIF blocks, rather than counting bytes inside compressed pixels.
    let offset = 13 + ((gif[10] & 128) ? 3 * 2 ** ((gif[10] & 7) + 1) : 0);
    let frames = 0;
    let controls = 0;
    const skipBlocks = () => {
      while (gif[offset] !== 0) offset += 1 + gif[offset];
      offset++;
    };
    while (offset < gif.length && gif[offset] !== 0x3b) {
      const marker = gif[offset++];
      if (marker === 0x21) {
        const label = gif[offset++];
        if (label === 0xf9) {
          assert.equal(gif[offset], 4);
          assert.equal(gif[offset + 1] & 1, 1, 'transparent background');
          assert.equal((gif[offset + 1] >> 2) & 7, 2, 'clear previous frame to avoid trails');
          assert.equal(gif.readUInt16LE(offset + 2), 10, 'gentle 100ms frames');
          controls++;
        }
        skipBlocks();
      } else {
        assert.equal(marker, 0x2c, 'valid image descriptor');
        const flags = gif[offset + 8];
        offset += 9;
        if (flags & 128) offset += 3 * 2 ** ((flags & 7) + 1);
        offset++; // LZW code size
        skipBlocks();
        frames++;
      }
    }
    assert.equal(frames, 15, '1.5 s loop');
    assert.equal(controls, frames);
    const still = readFileSync(new URL('assets/loading/water-still.png', base));
    assert.equal(still.readUInt32BE(16), 96);
    assert.equal(still.readUInt32BE(20), 112);
    assert.ok(still.length < 25_000);
    const artwork = readFileSync(new URL('scripts/generate-filter-loader.mjs', base), 'utf8');
    assert.match(artwork, /source\/companion-water-loader.svg/);
    assert.match(artwork, /FRAME_COUNT = 15/);
    assert.match(artwork, /water-still.png/);
    for (const f of ['companion-water-loader.svg', 'companion-water-loader-static.svg']) {
      const svg = readFileSync(new URL(`assets/loading/source/${f}`, base), 'utf8');
      assert.doesNotMatch(svg, /<animate|@keyframes/, 'uploaded SVG is not natively animated');
    }
    const live = readFileSync(new URL('assets/loading/source/companion-water-loader.svg', base), 'utf8');
    for (const c of ['#b5e7ee', '#76c8dd', '#08475f']) assert.match(live, new RegExp(c));
    const mod = await import('../../scripts/generate-filter-loader.mjs');
    assert.equal(mod.renderDropletFrame(0), mod.renderDropletFrame(15)); // deterministic loop
    assert.notEqual(mod.renderDropletFrame(3), mod.renderDropletFrame(12));
    assert.match(mod.renderDropletFrame(12), /cw-wave/); // ripples after impact
    assert.match(mod.renderDropletFrame(0), /stroke="url\(#cw-wave\)"/); // waves overlap the next fall
    assert.match(mod.renderStillFrame(), /M12 5c/); // supplied still retains a visible droplet
    assert.match(mod.renderStillFrame(), /fill="url\(#water\)"/);
    const webp = readFileSync(new URL('assets/loading/water.webp', base));
    assert.equal(webp.subarray(0, 4).toString(), 'RIFF');
    assert.equal(webp.subarray(8, 12).toString(), 'WEBP');
    assert.ok(webp.includes(Buffer.from('ANIM')), 'bundled animation');
    let cursor = 12;
    let webpFrames = 0;
    while (cursor + 8 <= webp.length) {
      const size = webp.readUInt32LE(cursor + 4);
      if (webp.subarray(cursor, cursor + 4).toString() === 'ANMF') {
        webpFrames++;
        assert.equal(webp.readUIntLE(cursor + 20, 3), 100);
      }
      cursor += 8 + size + (size % 2);
    }
    assert.equal(webpFrames, 15);
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
  it('unmounts the animation when motion is disabled and exposes an accessible loading label', () => {
    const source = readFileSync(new URL('components/PageDataLoader.tsx', base), 'utf8');
    const illustration = readFileSync(new URL('components/FilterDropIllustration.tsx', base), 'utf8');
    assert.match(illustration, /key=\{animate \? 'animated' : 'still'\}/);
    assert.match(illustration, /onError=\{\(\) => setFailed\(true\)\}/);
    assert.match(illustration, /filter-drop-fallback/);
    assert.match(illustration, /name="water-outline"/);
    assert.match(illustration, /width: 56, height: 64/);
    assert.match(illustration, /autoplay=\{animate\}/);
    assert.match(illustration, /animate = false/);
    assert.match(illustration, /require\('@\/assets\/loading\/water.webp'\)/);
    assert.match(illustration, /require\('@\/assets\/loading\/water-still.png'\)/);
    assert.doesNotMatch(illustration, /https?:\/\//);
    assert.match(source, /<FilterDropIllustration animate=\{animate\}/);
    assert.match(source, /accessibilityLabel=\{label\}/);
    assert.match(source, /accessibilityRole="progressbar"/);
    assert.match(source, /accessibilityState=\{\{ busy: true \}\}/);
    assert.match(source, /aria-busy=\{true\}/);
    assert.match(source, /accessibilityLiveRegion="polite"/);
    assert.match(source, /<Text[^>]*>\{label\}<\/Text>/, 'retains visible loading text');
    assert.match(source, /minHeight: 76/);
  });
  it('keeps motion preference, focus and platform visibility wired to the shared policy', () => {
    const source = readFileSync(new URL('hooks/usePageMotion.ts', base), 'utf8');
    assert.match(source, /useState\(true\)/); // conservative until preference is known
    assert.match(source, /prefers-reduced-motion: reduce/);
    assert.match(source, /visibilitychange/);
    assert.match(source, /useFocusEffect/);
    assert.match(source, /return \(\) => setFocused\(false\)/);
    assert.match(source, /reduceMotionChanged/);
    assert.match(source, /value === 'active'/);
    assert.match(source, /animatePageLoader\(reduced, focused, foreground\)/);
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