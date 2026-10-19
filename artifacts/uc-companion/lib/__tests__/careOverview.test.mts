import { it } from 'node:test';
import assert from 'node:assert/strict';
import { careOverviewAvailable } from '../careOverview.js';

const capabilities = { version: 1, careOverview: true, promoRefill: false, paidRefill: false, moneyWallet: false, paidCare: false, automaticCollection: false };
it('requires authoritative server opt-in without opening later economic phases', () => {
  assert.equal(careOverviewAvailable(capabilities), true);
  assert.equal(careOverviewAvailable({ ...capabilities, careOverview: false }), false);
});
it('fails closed for old servers, malformed capabilities and incompatible phase data', () => {
  for (const value of [null, undefined, {}, { ...capabilities, version: 2 }, { ...capabilities, moneyWallet: true }]) {
    assert.equal(careOverviewAvailable(value), false);
  }
});
