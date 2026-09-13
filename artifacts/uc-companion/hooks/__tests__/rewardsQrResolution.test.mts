import { describe, it, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { resolveRewardsQrToken } from '../../lib/rewardsQrResolution';

describe('resolveRewardsQrToken', () => {
  let apiRotate: ReturnType<typeof mock.fn>;
  let readLocal: ReturnType<typeof mock.fn>;
  let storeLocal: ReturnType<typeof mock.fn>;

  beforeEach(() => {
    apiRotate = mock.fn();
    readLocal = mock.fn();
    storeLocal = mock.fn();
  });

  it('uses rewards.qrToken if provided, ignoring local token (authoritative server)', async () => {
    readLocal.mock.mockImplementation(async () => 'stale-local-123');
    
    const result = await resolveRewardsQrToken(2, 'fresh-rewards-token', apiRotate as any, readLocal as any, storeLocal as any);
    
    assert.equal(result.token, 'fresh-rewards-token');
    assert.equal(result.source, 'rewards');
    
    // We shouldn't even read local if server token is provided
    assert.equal(readLocal.mock.callCount(), 0);
    assert.equal(apiRotate.mock.callCount(), 0);
    
    assert.equal(storeLocal.mock.callCount(), 1);
    assert.deepEqual(storeLocal.mock.calls[0].arguments, [2, 'fresh-rewards-token']);
  });

  it('returns local token if present and no rewards token is provided', async () => {
    readLocal.mock.mockImplementation(async () => 'local-token-123');
    const result = await resolveRewardsQrToken(1, undefined, apiRotate as any, readLocal as any, storeLocal as any);
    
    assert.equal(result.token, 'local-token-123');
    assert.equal(result.source, 'local');
    assert.equal(apiRotate.mock.callCount(), 0);
    assert.equal(storeLocal.mock.callCount(), 0);
  });

  it('calls rotate API if local is empty and rewards payload provides no token, then stores it', async () => {
    readLocal.mock.mockImplementation(async () => null);
    apiRotate.mock.mockImplementation(async () => ({ qrToken: 'rotated-token-789' }));
    
    const result = await resolveRewardsQrToken(3, null, apiRotate as any, readLocal as any, storeLocal as any);
    
    assert.equal(result.token, 'rotated-token-789');
    assert.equal(result.source, 'rotated');
    assert.equal(apiRotate.mock.callCount(), 1);
    
    assert.equal(storeLocal.mock.callCount(), 1);
    assert.deepEqual(storeLocal.mock.calls[0].arguments, [3, 'rotated-token-789']);
  });

  it('rotates a token when secure storage cannot be read', async () => {
    readLocal.mock.mockImplementation(async () => { throw new Error('Storage unavailable'); });
    apiRotate.mock.mockImplementation(async () => ({ qrToken: 'rotated-without-storage' }));
    storeLocal.mock.mockImplementation(async () => { throw new Error('Storage unavailable'); });

    const result = await resolveRewardsQrToken(5, null, apiRotate as any, readLocal as any, storeLocal as any);

    assert.equal(result.token, 'rotated-without-storage');
    assert.equal(result.source, 'rotated');
    assert.equal(apiRotate.mock.callCount(), 1);
  });

  it('still returns a server-issued token when secure storage cannot persist it', async () => {
    storeLocal.mock.mockImplementation(async () => { throw new Error('Storage unavailable'); });

    const result = await resolveRewardsQrToken(6, 'server-token', apiRotate as any, readLocal as any, storeLocal as any);

    assert.equal(result.token, 'server-token');
    assert.equal(result.source, 'rewards');
  });
  
  it('throws if rotate API throws, and does not store', async () => {
    readLocal.mock.mockImplementation(async () => null);
    apiRotate.mock.mockImplementation(async () => { throw new Error('API down'); });
    
    await assert.rejects(
      resolveRewardsQrToken(4, undefined, apiRotate as any, readLocal as any, storeLocal as any),
      /API down/
    );
    
    assert.equal(storeLocal.mock.callCount(), 0);
  });
});
