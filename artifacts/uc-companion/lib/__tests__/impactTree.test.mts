import assert from 'node:assert/strict';
import test from 'node:test';
import { displayStage, newTreeId, forestLink, TREE_ID_PATTERN, TREE_CONFIG } from '../impactTree';

const tree = (over: Record<string, unknown> = {}, t: Record<string, unknown> | null = {}) => ({
  eligibleOrders: 1, eligiblePurchasesKes: 12220, allocationKes: 366.6, treeShareKes: 183.3, cleanWaterKes: 183.3,
  replacementPurchases: 0, treesHelped: 1,
  tree: t === null ? null : { stage: 'seed', fundedPct: 24, established: false, yourShareKes: 183.3, ...t },
  config: { contributionRate: 0.03, treeShare: 0.5, treeCostKes: 750 },
  ...over,
}) as any;

test('no paid purchase means no tree; paid but unallocated is a seed', () => {
  assert.equal(displayStage(undefined, 0), 'none');
  assert.equal(displayStage(tree({ eligibleOrders: 0 }), 3), 'none');
  assert.equal(displayStage(tree({}, null), 0), 'seed');
});

test('shared tree stage drives the display', () => {
  assert.equal(displayStage(tree({}, { stage: 'sapling', fundedPct: 30 }), 0), 'sapling');
  assert.equal(displayStage(tree({}, { stage: 'growing', fundedPct: 60 }), 0), 'growing');
  assert.equal(displayStage(tree({}, { stage: 'funded', fundedPct: 100 }), 0), 'funded');
});

test('refills or replacements water a seed into a sprout, but never past funding stages', () => {
  assert.equal(displayStage(tree(), 2), 'sprout');
  assert.equal(displayStage(tree({ replacementPurchases: 1 }), 0), 'sprout');
  assert.equal(displayStage(tree({}, { stage: 'growing', fundedPct: 60 }), 5), 'growing');
});

test('only programme verification shows established', () => {
  assert.equal(displayStage(tree({}, { stage: 'funded', fundedPct: 100, established: true }), 0), 'established');
});

test('tree ids are random-format and links carry only id + stage', () => {
  const id = newTreeId(() => new Uint8Array([0, 1, 2, 3, 31, 255]));
  assert.match(id, TREE_ID_PATTERN);
  const params = new URL(forestLink('https://forest.example.org/', id, 'sapling')).searchParams;
  assert.deepEqual([...params.keys()].sort(), ['stage', 'tree']);
  assert.equal(TREE_CONFIG.treeCostKes * 1, 750);
  assert.equal(TREE_CONFIG.contributionRate * TREE_CONFIG.treeShare, 0.015);
});
