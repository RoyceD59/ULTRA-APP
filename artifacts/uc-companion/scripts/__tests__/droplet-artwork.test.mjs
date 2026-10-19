import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { FRAME_COUNT, FRAME_DELAY_CS, renderDropletFrame, renderStillFrame } from '../generate-filter-loader.mjs';

// The retained owner-supplied artwork replaced the earlier stationary pulse.
describe('supplied falling-droplet artwork generator', () => {
  it('never draws more than one drop and preserves the transparent source canvas', () => {
    let visibleFrames = 0;
    for (let frame = 0; frame < FRAME_COUNT; frame++) {
      const svg = renderDropletFrame(frame);
      const drops = (svg.match(/fill="url\(#cw-glass\)"/g) ?? []).length;
      assert.ok(drops <= 1, 'only one falling droplet at a time');
      visibleFrames += drops;
      assert.match(svg, /width="96" height="112" viewBox="0 -2 24 28"/);
      assert.match(svg, /cw-reflection/);
      assert.doesNotMatch(svg, /<rect|<image|https?:\/\/(?!www.w3.org)/);
      assert.equal(svg, renderDropletFrame(frame + FRAME_COUNT), 'loop repeats deterministically');
    }
    assert.ok(visibleFrames > 1 && visibleFrames < FRAME_COUNT, 'drop falls, then leaves time for ripples');
  });
  it('uses the approved 1.5-second cadence, falling motion and a visible still fallback', () => {
    assert.equal(FRAME_COUNT * FRAME_DELAY_CS, 150);
    const positions = Array.from({ length: FRAME_COUNT }, (_, frame) =>
      renderDropletFrame(frame).match(/translate\(12 ([\d.]+)\) scale\([\d.]+ [\d.]+\)/)?.[1])
      .filter(Boolean).map(Number);
    assert.ok(positions.length > 1);
    assert.ok(positions.every((value, index) => index === 0 || value > positions[index - 1]));
    const still = renderStillFrame();
    assert.equal((still.match(/fill="url\(#water\)"/g) ?? []).length, 1);
    assert.match(still, /width="96" height="112" viewBox="0 -2 24 28"/);
    assert.doesNotMatch(still, /<rect|<image/);
  });
});
