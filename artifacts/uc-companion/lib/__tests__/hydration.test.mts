import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseLitres, localCalendarDate, validReminderTime } from '../hydration';
import { evaluateColdStart } from '../coldStartNotification';

describe('daily hydration input and routing', () => {
  it('accepts decimal and zero totals without accepting empty or nonfinite text', () => {
    for (const [input, value] of [['0', 0], ['1.25', 1.25], ['1,25', 1.25]] as const) assert.equal(parseLitres(input), value);
    for (const input of ['', '-1', 'Infinity', 'NaN', '1e3', '1.2.3', '9'.repeat(400)]) assert.equal(parseLitres(input), null);
    assert.equal(parseLitres('1001'), 1001);
  });
  it('formats the local calendar day, not the UTC calendar day', () => {
    const date = new Date(2026, 9, 3, 0, 1);
    assert.equal(localCalendarDate(date), '2026-10-03');
    const end = new Date(2026, 9, 3, 23, 59);
    assert.equal(localCalendarDate(end), '2026-10-03');
  });
  it('validates local reminder times', () => {
    for (const time of ['20:00', '00:00', '23:59']) assert.equal(validReminderTime(time), true);
    for (const time of ['24:00', '20:60', '8:00', '']) assert.equal(validReminderTime(time), false);
  });
  it('defers hydration routing while signed out and routes after authentication', () => {
    assert.deepEqual(evaluateColdStart({ screen: 'hydration', userId: 1 }, false), { type: 'PENDING' });
    assert.deepEqual(evaluateColdStart({ screen: 'hydration', userId: 1 }, true), { type: 'ROUTE_AND_CLEAR', screen: 'hydration' });
  });
});