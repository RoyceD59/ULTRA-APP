import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { companionLayout, COMPANION_TABS, cartContentInset } = require('../../lib/companionLayout.ts');

test('cart spacing preserves hydration, safe areas and large text', () => {
  assert.equal(cartContentInset(false, 5, 20), 44);
  assert.equal(cartContentInset(true, 0, 20), 44);
  assert.equal(cartContentInset(true, 5, 20), 132);
  assert.ok(cartContentInset(true, 5, 20, 2) > cartContentInset(true, 5, 20));
});

test('all six customer destinations are present and unique', () => {
  assert.deepEqual(COMPANION_TABS.map(tab => tab.name), ['index', 'products', 'blog', 'support', 'map', 'account']);
  assert.equal(new Set(COMPANION_TABS.map(tab => tab.href)).size, 6);
});

test('navigation moves at the compact / medium / expanded boundaries', () => {
  for (const [width, size, rail] of [[320,'compact',0],[599,'compact',0],[600,'medium',88],[1023,'medium',88],[1024,'expanded',216],[1920,'expanded',216]]) {
    const layout = companionLayout(width);
    assert.equal(layout.size, size);
    assert.equal(layout.navigationWidth, rail);
    assert.equal(layout.bottomNavigationHeight > 0, size === 'compact');
  }
});

test('grids fit the actual content area at every width and text scale', () => {
  for (const scale of [1, 1.5, 2, 3]) {
    for (let width = 280; width <= 2560; width += 7) {
      const layout = companionLayout(width, scale);
      const used = layout.cardWidth * layout.columns + layout.gap * (layout.columns - 1) + 2 * layout.gutter;
      assert.ok(used <= layout.contentWidth + 0.01, `overflow at ${width}/${scale}`);
      assert.ok(layout.columns >= 1 && layout.columns <= 5);
      assert.ok(layout.contentWidth <= 1200);
      if (layout.columns > 1) assert.ok(layout.cardWidth >= 156 * scale);
    }
  }
});

test('larger accessibility text reduces density and grows the mobile dock', () => {
  assert.ok(companionLayout(390, 2).columns < companionLayout(390).columns);
  assert.ok(companionLayout(390, 2).bottomNavigationHeight > companionLayout(390).bottomNavigationHeight);
});
