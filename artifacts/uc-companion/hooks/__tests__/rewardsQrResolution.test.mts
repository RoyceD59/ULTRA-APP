import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolveRewardsQrToken } from '../../lib/rewardsQrResolution';

const saved = 's'.repeat(43), fresh = 'f'.repeat(43);
const signal = () => new AbortController().signal;
function state(overrides: Record<string, unknown> = {}) {
  return { userId: 2, status: 'active' as const, version: 'a'.repeat(64), valid: false, qrToken: fresh, ...overrides } as any;
}
describe('server-authoritative rewards QR resolution', () => {
  it('validates a saved candidate before display; the server replacement always wins', async () => {
    const writes: unknown[] = [];
    const result = await resolveRewardsQrToken(2, null, async (candidate) => {
      assert.equal(candidate, saved);
      return state();
    }, async () => saved, async (...args) => { writes.push(args); }, signal());
    assert.equal(result.token, fresh);
    assert.deepEqual(writes, [[2, fresh]]);
  });
  it('revalidates even a rewards response token instead of trusting a stale snapshot', async () => {
    let inspected = false;
    const result = await resolveRewardsQrToken(2, saved, async (candidate) => {
      inspected = true; assert.equal(candidate, saved);
      return state({ status: 'revoked', qrToken: null });
    }, async () => { throw new Error('should not read local'); }, async () => {}, signal());
    assert.equal(inspected, true);
    assert.equal(result.token, null);
    assert.equal(result.recoveryRequired, true);
  });
  it('keeps a valid legacy token only when server hash validation succeeds', async () => {
    const valid = await resolveRewardsQrToken(2, null, async () => state({ valid: true, qrToken: null }),
      async () => saved, async () => {}, signal());
    assert.equal(valid.token, saved);
    const invalid = await resolveRewardsQrToken(2, null, async () => state({ valid: false, qrToken: null }),
      async () => saved, async () => {}, signal());
    assert.equal(invalid.token, null);
    assert.equal(invalid.recoveryRequired, true);
  });
  it('does not return local credentials on network failure or issue/rotate on missing state', async () => {
    await assert.rejects(resolveRewardsQrToken(2, null, async () => { throw new Error('offline'); },
      async () => saved, async () => {}, signal()), /offline/);
    const missing = await resolveRewardsQrToken(2, null, async () => state({ status: 'missing', qrToken: null, version: null }),
      async () => null, async () => { throw new Error('must not write a missing token'); }, signal());
    assert.equal(missing.token, null);
    assert.equal(missing.version, null);
    assert.equal(missing.recoveryRequired, true);
  });
  it('tolerates disabled secure storage and reports non-persistence without replacing a valid code', async () => {
    const result = await resolveRewardsQrToken(2, null, async () => state(),
      async () => { throw new Error('blocked'); }, async () => { throw new Error('blocked'); }, signal());
    assert.equal(result.token, fresh);
    assert.equal(result.persistenceWarning, true);
  });
  it('rejects account mismatch, ignores malformed local candidates, and never persists wrong-owner results', async () => {
    let stored = false;
    await assert.rejects(resolveRewardsQrToken(2, null, async candidate => {
      assert.equal(candidate, null);
      return state({ userId: 3 });
    }, async () => 'corrupt', async () => { stored = true; }, signal()), /account/);
    assert.equal(stored, false);
  });
  it('bounded secure-storage reads cannot trap loading indefinitely', async () => {
    const result = await resolveRewardsQrToken(2, null, async () => state(),
      () => new Promise(() => {}), async () => {}, signal());
    assert.equal(result.token, fresh);
    assert.equal(result.persistenceWarning, true);
  });
});