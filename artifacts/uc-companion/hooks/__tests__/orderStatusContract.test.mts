import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { UCOrder, UCOrderStatusEvent } from '../useApi.ts';

describe('customer order-status contract', () => {
  it('carries the durable customer stage and account-visible event history', () => {
    const event: UCOrderStatusEvent = {
      id: 1,
      stage: 'shipped',
      status: 'Handed over to delivery partner',
      actor: 'system',
      eventKey: 'shipped_out',
      created_at: '2026-09-15T10:00:00Z',
    };

    const order: UCOrder = {
      id: 101,
      orderNumber: 'UC-101',
      status: 'completed',
      dateCreated: '2026-09-14T10:00:00Z',
      total: '15000',
      currency: 'KES',
      lineItems: [],
      paymentMethod: 'mpesa',
      shippingAddress: {
        firstName: 'Amina',
        lastName: 'Kamau',
        address1: 'Westlands',
        address2: '',
        city: 'Nairobi',
        country: 'KE',
        phone: '+254712345678',
      },
      customerStage: 'shipped',
      customerStageUpdatedAt: '2026-09-15T10:00:00Z',
      statusEvents: [event],
    };

    assert.equal(order.customerStage, 'shipped');
    assert.equal(order.statusEvents?.length, 1);
    assert.equal(order.statusEvents?.[0]?.stage, 'shipped');
  });
});