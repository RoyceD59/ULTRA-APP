import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { getSwipeNeighbours, SWIPE_TAB_ORDER } from '../swipeTabs.ts';

describe('swipe tab neighbours', () => {
  it('skips Map when swiping forward from Support', () => {
    assert.equal(getSwipeNeighbours('support').next, 'account');
  });

  it('has no forward swipe destination from Account', () => {
    assert.equal(getSwipeNeighbours('account').next, null);
  });

  it('never returns Map as a swipe destination', () => {
    for (const tab of SWIPE_TAB_ORDER) {
      const neighbours = getSwipeNeighbours(tab);
      assert.notEqual(neighbours.previous, 'map');
      assert.notEqual(neighbours.next, 'map');
    }
  });
});