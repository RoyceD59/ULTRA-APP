import { describe, it, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { RewardsQrController } from '../../lib/RewardsQrController';
import { buildRewardsQrPayload } from '../../lib/rewardsQr';
import { resolveRewardsQrToken } from '../../lib/rewardsQrResolution';

describe('RewardsQrController lifecycle', () => {
  let onStateChange: ReturnType<typeof mock.fn>;
  let apiRotate: ReturnType<typeof mock.fn>;
  let readLocal: ReturnType<typeof mock.fn>;
  let storeLocal: ReturnType<typeof mock.fn>;

  beforeEach(() => {
    onStateChange = mock.fn();
    apiRotate = mock.fn();
    readLocal = mock.fn();
    storeLocal = mock.fn();
  });

  it('handles full revoked-token recovery sequence and account isolation', async () => {
    const controller = new RewardsQrController(onStateChange, resolveRewardsQrToken);
    
    // 1. Mount for account A with stale secure-storage token and no rewards yet
    const userA = 1;
    readLocal.mock.mockImplementation(async (id: number) => {
      if (id === userA) return 'stale-token-A';
      return null;
    });

    await controller.setProps(userA, undefined, apiRotate as any, readLocal as any, storeLocal as any);
    
    // Stale token loads as offline fallback
    assert.equal(controller.state.token, 'stale-token-A');
    assert.equal(controller.state.loading, false);
    
    // 2. Rerender/refresh with authoritative rewards.qrToken replacement from server
    const freshRewardsA = { qrToken: 'fresh-token-A' };
    await controller.setProps(userA, freshRewardsA as any, apiRotate as any, readLocal as any, storeLocal as any);
    
    // Hook output changes to replacement
    assert.equal(controller.state.token, 'fresh-token-A');
    assert.equal(controller.state.loading, false);
    
    // Secure storage is overwritten for account A
    assert.equal(storeLocal.mock.callCount(), 1);
    assert.deepEqual(storeLocal.mock.calls[0].arguments, [userA, 'fresh-token-A']);
    
    // QR payload builder accepts/uses replacement, not stale
    const payload = buildRewardsQrPayload(controller.state.token!);
    assert.equal(payload, 'uc-rewards:v1:fresh-token-A');
    
    // 3. Switch to account B
    const userB = 2;
    readLocal.mock.mockImplementation(async (id: number) => null); // No local token for B
    apiRotate.mock.mockImplementation(async () => ({ qrToken: 'rotated-token-B' }));
    
    // This call does not await immediately to check intermediate state
    const promise = controller.setProps(userB, undefined, apiRotate as any, readLocal as any, storeLocal as any);
    
    // Assert switching to account B clears A token before B resolves
    assert.equal(controller.state.token, null);
    assert.equal(controller.state.loading, true);
    
    await promise;
    
    // Provide rewards without token, forcing rotation for B
    await controller.setProps(userB, { qrToken: null } as any, apiRotate as any, readLocal as any, storeLocal as any);
    
    assert.equal(controller.state.token, 'rotated-token-B');
    assert.equal(storeLocal.mock.callCount(), 2);
    assert.deepEqual(storeLocal.mock.calls[1].arguments, [userB, 'rotated-token-B']);
  });
});
