import assert from 'node:assert/strict';
import test from 'node:test';
import { growTree, ridgePath, grassPath, MAX_LEAVES } from '../treeGeometry';

test('the same seed grows the same tree', () => {
  assert.deepEqual(growTree(523, 110), growTree(523, 110));
  assert.notDeepEqual(growTree(523, 110).leaves, growTree(524, 110).leaves);
});

test('trees rise above their base and stay within a sensible footprint', () => {
  for (const [seed, h, sp] of [[77, 55, 'broadleaf'], [311, 85, 'broadleaf'], [9, 100, 'acacia']] as const) {
    const t = growTree(seed, h, sp);
    assert.ok(t.box.y0 < -h * 0.6, 'crown is well above the base');
    assert.ok(t.box.y1 <= 1, 'nothing grows below ground');
    assert.ok(t.box.x1 - t.box.x0 < h * 2, 'crown width is plausible');
    assert.ok(t.leafCount > 60 && t.leafCount < 900, `leaf count ${t.leafCount}`);
    assert.equal(t.leaves.length, 4);
    assert.ok(t.leaves.every(d => d.length > 0), 'every light band has leaves');
  }
});

test('leaf count does not grow with drawing size (mobile budget)', () => {
  const small = growTree(523, 55).leafCount, big = growTree(523, 220).leafCount;
  assert.ok(big < 900 && Math.abs(big - small) / small < 0.35, `${small} vs ${big}`);
});

test('every tree stays within the leaf budget', () => {
  for (let seed = 1; seed <= 60; seed++) {
    for (const sp of ['broadleaf', 'acacia'] as const) {
      const t = growTree(seed * 97, 100, sp);
      assert.ok(t.leafCount <= MAX_LEAVES, `${seed} ${sp}: ${t.leafCount}`);
      assert.ok(t.leaves.join('').length + t.leafShadow.length < 60_000);
    }
  }
});

test('acacia crowns are flatter and wider than broadleaf crowns', () => {
  const a = growTree(9, 100, 'acacia'), b = growTree(9, 100, 'broadleaf');
  const ratio = (t: typeof a) => (t.box.x1 - t.box.x0) / -t.box.y0;
  assert.ok(ratio(a) > ratio(b));
});

test('scene paths are well-formed', () => {
  const ridge = ridgePath(3, 320, 80, 10, 150);
  assert.match(ridge, /^M0 150L0 [\d.-]+.*L320 150Z$/);
  assert.ok(!/NaN/.test(ridge + grassPath(5, 320, 90, 150, 40)));
});
