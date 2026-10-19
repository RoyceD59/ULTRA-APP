import { test } from 'node:test';
import assert from 'node:assert/strict';
import { myFiltersPresentation } from '../myFiltersPresentation.ts';
import { assignedPrimaryActivation } from '../assignedFilterHydration.ts';

const primary = { productId: 1, productName: 'Filter', lifespanDays: 90, activatedAt: '2026-09-01', notifIds: ['keep'], cleanCount: 3, registeredFilterId: 7 };
const online = (source: 'app' | 'store' = 'app', quantity = 2) => ({
  source, orderId: 12, dateCreated: '2026-08-01', phone: 'receipt-phone', status: 'completed',
  items: [{ lineId: 5, productId: 1, name: 'Filter', quantity, lifespanDays: 90, capacityLitres: 150,
    availableUnitIds: [`${source}:12:5:1`, `${source}:12:5:2`], unavailableReason: null }],
});
const offline = () => ({ source: 'offline' as const, saleId: 12, saleDate: '2026-08-01', label: 'Linked sale',
  items: [{ lineId: 'line', productId: 1, name: 'Filter', quantity: 2, lifespanDays: 90, capacityLitres: 150,
    availableUnitIds: ['uuid-a'], unavailableReason: null,
    registeredUnits: [{ unitId: 'uuid-b', installationDate: '2026-09-01', active: true }] }],
});
const assignment = (filterId: number | null = 7, id = 1) => ({
  id, filterId, customerName: 'Fixture', email: '', phone: '', productId: 1, productName: 'Filter',
  lifespanDays: 90, capacityLitres: 150, installationDate: '2026-09-01', orderId: 12, orderItemId: 5,
  orderReference: '12', cashCollectionState: 'awaiting_collection', status: 'linked' as const,
  active: true, activatedAt: '2026-09-01',
});

test('one ready group includes all online/offline units even with a primary', () => {
  const model = myFiltersPresentation(primary, [online()], [offline()]);
  assert.equal(model.ready.length, 3);
  assert.equal(new Set(model.ready.map(u => u.key)).size, 3);
  assert.equal(model.ready[2].offlineSelection?.unitId, 'uuid-a');
  assert.equal(model.ready[0].purchaseSelection?.source, 'app');
  assert.equal(model.ready[0].purchaseSelection?.unitId, 'app:12:5:1');
  assert.equal(model.ready[1].purchaseSelection?.unitId, 'app:12:5:2');
  assert.equal(primary.cleanCount, 3);
  assert.deepEqual(primary.notifIds, ['keep']);
});
test('same product, date and raw order number never deduplicate sources', () => {
  assert.equal(myFiltersPresentation(null, [online('app'), online('store')], [offline()]).ready.length, 5);
});
test('exact primary registration ID suppresses assignment, not similar legacy rows', () => {
  const model = myFiltersPresentation(primary, [], [], [assignment(), assignment(null, 2), assignment(8, 3)]);
  assert.deepEqual(model.other.map(r => r.key), ['assignment:2', 'assignment:3']);
});
test('activated assignments remain registered and never become activation offers', () => {
  const a = assignment();
  const hydrated = assignedPrimaryActivation(null, [a]);
  assert.equal(hydrated?.registeredFilterId, 7);
  assert.equal(myFiltersPresentation(hydrated, [], [], [a]).other.length, 0);
  assert.equal(myFiltersPresentation(null, [], [], [a]).ready.length, 0);
});
test('offline primary identity suppresses only that registered row; history remains', () => {
  const model = myFiltersPresentation({ ...primary, offlineUnitId: 'uuid-b' }, [], [offline()]);
  assert.equal(model.other.length, 0);
  assert.equal(model.history.length, 1);
  assert.equal(model.ready.length, 1);
});
test('restore selection is distinct and retains server installation date', () => {
  const model = myFiltersPresentation(null, [], [offline()]);
  assert.equal(model.other[0].offlineSelection?.registeredInstallationDate, '2026-09-01');
  assert.equal(model.ready[0].offlineSelection?.registeredInstallationDate, undefined);
});
test('partial quantities and authoritative unavailable explanations survive', () => {
  const p = online();
  p.items[0].availableUnitIds = ['app:12:5:2'];
  assert.match(myFiltersPresentation(null, [p]).ready[0].label, /Unit 2 of 2/);
  p.items[0].unavailableReason = 'Payment is not confirmed.' as any;
  const model = myFiltersPresentation(null, [p], [offline()]);
  assert.equal(model.ready.length, 1);
  assert.match(model.history[0].description, /Payment is not confirmed/);
});
test('repeated exact unit reads do not multiply units; failed source absence does not hide others', () => {
  assert.equal(myFiltersPresentation(null, [online(), online()]).ready.length, 2);
  assert.equal(myFiltersPresentation(null, undefined, [offline()]).ready.length, 1);
});
test('offline read registration IDs deduplicate across primary, assignments and ledger', () => {
  const sale = offline();
  (sale.items[0].registeredUnits[0] as any).registeredFilterId = 7;
  const ledger = [{ id: 7, productId: 1, productName: 'Filter', ratedCapacityLitres: 150, usedLitres: 0,
    remainingCapacityLitres: 150, activatedAt: '2026-09-01', sourceOrderId: null }];
  assert.equal(myFiltersPresentation(primary, [], [sale], [], ledger).other.length, 0);
  assert.equal(myFiltersPresentation({ ...primary, registeredFilterId: undefined, offlineUnitId: 'uuid-b' }, [], [sale], [assignment()], ledger).other.length, 0);
  assert.equal(myFiltersPresentation(null, [], [sale], [assignment()], ledger).other.length, 1);
  assert.equal(myFiltersPresentation(null, [], [sale], [assignment()], ledger).other[0].offlineSelection?.unitId, 'uuid-b');
  assert.equal(myFiltersPresentation(null, [], [sale], [], ledger).other.length, 1);
});
