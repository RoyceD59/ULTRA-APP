import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolveReminderOptInActivation } from '../reminderOptInFlow.js';

const activation = {
  productId: 42,
  productName: 'Ultra Clear Filter',
  lifespanDays: 180,
  activatedAt: '2026-09-12T08:00:00.000Z',
  notifIds: ['notification-1'],
};

describe('home nudge reminder opt-in flow', () => {
  it('opens the sheet after a new signed-in registration closes the modal', async () => {
    const result = await resolveReminderOptInActivation({
      activation,
      isReplacement: false,
      initiatingUserId: 7,
      getCurrentUserId: () => 7,
      wasSeen: async () => false,
    });

    assert.equal(result, activation);
  });

  it('does not reopen the sheet when this registration was already handled', async () => {
    const result = await resolveReminderOptInActivation({
      activation,
      isReplacement: false,
      initiatingUserId: 7,
      getCurrentUserId: () => 7,
      wasSeen: async () => true,
    });

    assert.equal(result, null);
  });

  it('does not open the sheet if the user signs out during the seen-state check', async () => {
    let currentUserId: number | null = 7;
    const result = await resolveReminderOptInActivation({
      activation,
      isReplacement: false,
      initiatingUserId: 7,
      getCurrentUserId: () => currentUserId,
      wasSeen: async () => {
        currentUserId = null;
        return false;
      },
    });

    assert.equal(result, null);
  });
});