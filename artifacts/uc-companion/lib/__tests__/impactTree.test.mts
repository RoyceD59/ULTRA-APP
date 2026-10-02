import assert from 'node:assert/strict';
import test from 'node:test';
import {
  computeTreeProgress, isEligibleOrder, isReplacementLine, newTreeId, forestLink,
  TREE_ID_PATTERN, TREE_CONFIG,
} from '../impactTree';

const order = (total: string, extra: Record<string, unknown> = {}) => ({
  status: 'completed', paymentStatus: 'paid', currency: 'KES', total,
  lineItems: [{ productId: 1, name: 'Hydra Flux', quantity: 1, total }], ...extra,
});

test('only paid, unreversed KES orders are eligible', () => {
  assert.equal(isEligibleOrder(order('100')), true);
  assert.equal(isEligibleOrder(order('100', { paymentStatus: 'pending', status: 'pending' })), false);
  // Paid-then-refunded Woo orders still report paymentStatus "paid".
  assert.equal(isEligibleOrder(order('100', { status: 'refunded' })), false);
  assert.equal(isEligibleOrder(order('100', { status: 'cancelled' })), false);
  assert.equal(isEligibleOrder(order('100', { currency: 'USD' })), false);
  // Older API shape without paymentStatus falls back to status.
  assert.equal(isEligibleOrder({ status: 'processing', currency: 'KES' }), true);
});

test('interim proxy sale funds about 48% of a KES 750 tree', () => {
  const p = computeTreeProgress([order('12220')], 0);
  assert.equal(p.allocationKes, 366.6);
  assert.equal(p.totalPctOfTree, 48);
  assert.equal(p.treesFunded, 0);
  assert.equal(p.stage, 'sapling'); // ≥25% of a tree
  assert.equal(computeTreeProgress([order('3000')], 0).stage, 'seed'); // 90 KES = 12%
});

test('stages follow funding thresholds 25% / 50% / 100%', () => {
  assert.equal(computeTreeProgress([order('6250')], 0).stage, 'sapling');   // 187.5 = 25%
  assert.equal(computeTreeProgress([order('12500')], 0).stage, 'growing');  // 375 = 50%
  const funded = computeTreeProgress([order('25000')], 0);                  // 750 = 100%
  assert.equal(funded.stage, 'funded');
  assert.equal(funded.treesFunded, 1);
  assert.equal(funded.currentTreePct, 0);
});

test('refills animate to Sprout but never add funding', () => {
  const p = computeTreeProgress([order('1000')], 3);
  assert.equal(p.stage, 'sprout');
  assert.equal(p.allocationKes, 30);
  assert.equal(p.refillEntries, 3);
});

test('a replacement purchase triggers Sprout and is counted', () => {
  const p = computeTreeProgress([order('1500', {
    lineItems: [{ productId: 22, name: 'Bottle Filter Cartridge', quantity: 2, total: '1500' }],
  })], 0);
  assert.equal(p.stage, 'sprout');
  assert.equal(p.replacementPurchases, 2);
  assert.equal(isReplacementLine({ productId: 9001, name: 'Live Store Shower Cartridge', quantity: 1, total: '1' }), true);
});

test('no eligible order means no tree; multiple trees roll over', () => {
  assert.equal(computeTreeProgress([], 5).stage, 'none');
  const p = computeTreeProgress([order('40,000'), order('2,000', { status: 'refunded' })], 0);
  assert.equal(p.eligiblePurchasesKes, 40000);
  assert.equal(p.treesFunded, 1);         // 1,200 KES
  assert.equal(p.currentTreePct, 60);
  assert.equal(p.totalPctOfTree, 160);
});

test('tree ids are random-format and links carry only id + stage', () => {
  const id = newTreeId(() => new Uint8Array([0, 1, 2, 3, 31, 255]));
  assert.match(id, TREE_ID_PATTERN);
  const link = forestLink('https://example.org/forest.html', id, 'sapling');
  const params = new URL(link).searchParams;
  assert.deepEqual([...params.keys()].sort(), ['stage', 'tree']);
  assert.equal(TREE_CONFIG.treeCostKes, 750);
});
