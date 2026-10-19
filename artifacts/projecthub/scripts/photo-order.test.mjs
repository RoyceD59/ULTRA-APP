import test from 'node:test';
import assert from 'node:assert/strict';
import { moveRecordPhoto } from '../src/lib/product-photo-order.ts';

test('moving photos preserves names, links, accessibility and approvals across a save round trip', () => {
  const original = [
    { slot: 1, display_name: 'Kitchen', file: '/api/storage/a', alt: 'Kitchen tap', approved: true, child_sku: 'BLUE' },
    { slot: 2, display_name: 'Parts', file: '/api/storage/b', alt: 'Filter parts', approved: false, pictured_colour: 'Green' },
  ];
  const moved = JSON.parse(JSON.stringify(moveRecordPhoto(original, 2, -1)));
  assert.deepEqual(moved, [{ ...original[1], slot: 1 }, { ...original[0], slot: 2 }]);
  assert.equal(original[0].slot, 1);
  assert.deepEqual(moveRecordPhoto(original, 1, -1), original);
  assert.deepEqual(moveRecordPhoto(original, 2, 1), [original[0], { ...original[1], slot: 3 }]);
});
