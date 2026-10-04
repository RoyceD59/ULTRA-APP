import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { getSwipeNeighbours, SWIPE_TAB_ORDER } from '../swipeTabs.ts';

describe('swipe tab neighbours', () => {
  it('has no backward swipe destination from Home', () => {
    assert.equal(getSwipeNeighbours('index').previous, null);
  });

  for (const [tab, previous] of [
    ['products', 'index'],
    ['blog', 'products'],
    ['support', 'blog'],
    ['account', 'support'],
  ] as const) {
    it(`swipes backward from ${tab} to ${previous}`, () => {
      assert.equal(getSwipeNeighbours(tab).previous, previous);
    });
  }

  it('includes Blog between Products and Support in both directions', () => {
    assert.equal(getSwipeNeighbours('products').next, 'blog');
    assert.deepEqual(getSwipeNeighbours('blog'), { previous: 'products', next: 'support' });
    assert.equal(getSwipeNeighbours('support').previous, 'blog');
  });
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
