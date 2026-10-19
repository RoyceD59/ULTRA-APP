import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { commitPurchaseBackedRegistration } from '../filterRegistrationCommit.js';

describe('purchase-backed filter registration', () => {
  it('cannot schedule or show a local activation when the server commit fails', async () => {
    let scheduled = false;
    let shown = false;
    await assert.rejects(
      () => commitPurchaseBackedRegistration(
        async () => { throw new Error('Purchase verification failed'); },
        async () => { scheduled = true; return { id: 'local-activation' }; },
        () => { shown = true; },
      ),
      /Purchase verification failed/,
    );
    assert.equal(scheduled, false, 'local reminders must not be scheduled without a server record');
    assert.equal(shown, false, 'the app must not show a successful registration without a server record');
  });

  it('only shows an activation after the purchase commit succeeds', async () => {
    const events: string[] = [];
    await commitPurchaseBackedRegistration(
      async () => { events.push('committed'); },
      async () => { events.push('scheduled'); return { id: 'durable-backed' }; },
      () => { events.push('shown'); },
    );
    assert.deepEqual(events, ['committed', 'scheduled', 'shown']);
  });
  it('carries the server-owned cycle identity into the saved local activation', async () => {
    let shown: { registeredFilterId: number } | undefined;
    await commitPurchaseBackedRegistration(
      async () => ({ registration: { id: 42 } }),
      async committed => ({ registeredFilterId: committed.registration.id }),
      activation => { shown = activation; },
    );
    assert.equal(shown?.registeredFilterId, 42);
  });
});