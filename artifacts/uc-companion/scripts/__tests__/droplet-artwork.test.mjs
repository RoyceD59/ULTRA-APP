import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { FRAME_COUNT, FRAME_DELAY_CS, renderDropletFrame, renderStillFrame } from '../generate-filter-loader.mjs';

describe('single-droplet artwork generator', () => {
  it('preserves the supplied glossy drop, transparent canvas and ripple artwork', () => {
    for (let frame = 0; frame < FRAME_COUNT; frame++) {
      const svg = renderDropletFrame(frame);
      const drops = (svg.match(/<path d="M12 1c[^"]+" fill="url\(#cw-glass\)"/g) ?? []).length;
      assert.equal(drops, frame / FRAME_COUNT < 0.62 ? 1 : 0, 'one falling drop, none after impact');
      assert.match(svg, /width="96" height="112" viewBox="0 -2 24 28"/);
      assert.match(svg, /id="cw-glass"/);
      assert.match(svg, /id="cw-reflection"/);
      assert.match(svg, /<ellipse cx="12" cy="21"/);
      assert.doesNotMatch(svg, /<rect|<image|https?:\/\/(?!www.w3.org)/);
    }
  });
  it('falls towards the water surface and loops at the approved 1.5 second duration', () => {
    assert.equal(FRAME_COUNT * FRAME_DELAY_CS, 150);
    assert.equal(renderDropletFrame(0), renderDropletFrame(FRAME_COUNT));
    const positions = Array.from({ length: Math.ceil(FRAME_COUNT * 0.62) }, (_, frame) =>
      Number(renderDropletFrame(frame).match(/translate\(12 ([\d.]+)\) scale\([\d.]+ [\d.]+\)/)[1]));
    assert.equal(positions[0], 1);
    assert.ok(positions.every((position, index) => index === 0 || position > positions[index - 1]));
    assert.ok(positions.at(-1) > 10, 'drop reaches the surface, not a static pulse');
  });
  it('uses a separate visible static droplet for reduced motion, not an empty impact frame', () => {
    const still = renderStillFrame();
    assert.match(still, /width="96" height="112" viewBox="0 -2 24 28"/);
    assert.match(still, /<path d="M12 5c[^"]+" fill="url\(#water\)"/);
    assert.doesNotMatch(still, /<animate|<image/);
  });
});