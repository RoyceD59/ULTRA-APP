import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { delayMpesaRetryCheckIndicator } from '../mpesaRetryCheckIndicator.js';

test('retry-check feedback stays hidden until 500 ms, then appears', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let shown = 0;
  const stop = delayMpesaRetryCheckIndicator(() => shown++);
  t.mock.timers.tick(499);
  assert.equal(shown, 0);
  t.mock.timers.tick(1);
  assert.equal(shown, 1);
  stop();
  t.mock.timers.tick(1000);
  assert.equal(shown, 1);
});

for (const reason of ['fast completion', 'query failure', 'cancel', 'unmount']) {
  test(`${reason} clears delayed feedback before it can flash`, (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    let shown = false;
    const stop = delayMpesaRetryCheckIndicator(() => { shown = true; });
    t.mock.timers.tick(499);
    stop();
    stop(); // Cleanup can run both at cancellation and when the query settles.
    t.mock.timers.tick(1000);
    assert.equal(shown, false);
  });
}

test('stopping an old check does not cancel a newer check', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const shown: string[] = [];
  const stopOld = delayMpesaRetryCheckIndicator(() => shown.push('old'));
  stopOld();
  const stopNew = delayMpesaRetryCheckIndicator(() => shown.push('new'));
  stopOld();
  t.mock.timers.tick(500);
  assert.deepEqual(shown, ['new']);
  stopNew();
});

test('checkout wires feedback only around the prior-status query and clears it safely', () => {
  const source = readFileSync(new URL('../../app/checkout.tsx', import.meta.url), 'utf8');
  assert.match(source, /if \(processing \|\| mpesaCheckCleanupRef\.current\) return/);
  assert.match(source, /finally \{[\s\S]*?stopIndicator\(\);[\s\S]*?if \(mpesaCheckCleanupRef\.current === stopIndicator\) clearMpesaRetryCheck\(\)/);
  assert.match(source, /cancelMpesaPoll\(attemptRef, pollRef\);\s*clearMpesaRetryCheck\(\)/);
  assert.match(source, /useEffect\(\(\) => \(\) => \{\s*mpesaCheckCleanupRef\.current\?\.\(\)/);
  assert.match(source, /mpesaCheckingPrevious \? \(\s*mpesaCheckVisible \?/);
  assert.match(source, /Checking your previous payment…/);
});