import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildImpactBadgeSvg, buildImpactShareMessage } from '../impactBadge.ts';

describe('impact badge sharing', () => {
  it('includes impact, invitation and referral code in the image', () => {
    const svg = buildImpactBadgeSvg(12500, 4, 'CLEAR<&');
    assert.match(svg, /12,500 L/);
    assert.match(svg, /LEVEL 4/);
    assert.match(svg, /JOIN ULTRA-CLEAR COMPANION/);
    assert.match(svg, /CLEAR&lt;&amp;/);
  });

  it('builds a public invitation caption without private account data', () => {
    assert.equal(
      buildImpactShareMessage(250, 2, 'UC123'),
      'My Ultra-Clear Impact Badge: 250 L refilled, Level 2. Join Ultra-Clear Companion and use my referral code UC123. ucfilters.com/app',
    );
  });
});