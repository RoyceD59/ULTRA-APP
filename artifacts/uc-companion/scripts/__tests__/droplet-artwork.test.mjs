import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { FRAME_COUNT, renderDropletFrame } from '../generate-filter-loader.mjs';

describe('single-droplet artwork generator', () => {
  it('draws exactly one centred glossy droplet on the original transparent canvas', () => {
    for (let frame = 0; frame < FRAME_COUNT; frame++) {
      const svg = renderDropletFrame(frame);
      assert.equal((svg.match(/data-droplet="single"/g) ?? []).length, 1);
      assert.equal((svg.match(/fill="url\(#water\)"/g) ?? []).length, 1);
      assert.match(svg, /width="96" height="112" viewBox="0 0 96 112"/);
      assert.match(svg, /translate\(48 56\)/);
      assert.match(svg, /#52b6dc/);
      assert.match(svg, /#005d8f/);
      assert.match(svg, /stroke="white"/);
      assert.doesNotMatch(svg, /<rect|<image|https?:\/\/(?!www.w3.org)/);
    }
  });
  it('gently pulses without travel and seamlessly repeats the first still frame', () => {
    assert.equal(FRAME_COUNT, 24);
    assert.equal(renderDropletFrame(0), renderDropletFrame(FRAME_COUNT));
    const scales = Array.from({ length: FRAME_COUNT }, (_, frame) =>
      Number(renderDropletFrame(frame).match(/scale\(([\d.]+)\)/)[1]));
    assert.ok(Math.max(...scales) / Math.min(...scales) < 1.065);
    assert.ok(new Set(scales).size > 1, 'not a static loop');
    for (let frame = 0; frame < FRAME_COUNT; frame++) {
      assert.ok(Math.abs(scales[frame] - scales[(frame + 1) % FRAME_COUNT]) < 0.014,
        'small adjacent changes, including the loop boundary');
    }
  });
});