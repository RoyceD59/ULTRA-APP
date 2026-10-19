import { beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
// @ts-ignore — the test stub intentionally exposes its in-memory store.
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  AUTH_SESSION_KEY,
  LEGACY_TOKEN_KEY,
  LEGACY_USER_KEY,
  clearPersistedSession,
  loadPersistedSession,
  persistSession,
} from '../sessionPersistence';

const storage = AsyncStorage as unknown as { _storage: Map<string, string>; _reset: () => void };
const profile = { id: 42, email: 'customer@example.com', firstName: 'Amina', lastName: 'Otieno', phone: '' };

describe('Companion session persistence', () => {
  beforeEach(() => storage._reset());

  it('stores token and profile as one record and removes legacy keys', async () => {
    storage._storage.set(LEGACY_TOKEN_KEY, 'old-token');
    storage._storage.set(LEGACY_USER_KEY, JSON.stringify(profile));

    await persistSession({ token: 'new-token', user: profile });

    assert.deepEqual(JSON.parse(storage._storage.get(AUTH_SESSION_KEY)!), {
      token: 'new-token',
      user: profile,
    });
    assert.equal(storage._storage.has(LEGACY_TOKEN_KEY), false);
    assert.equal(storage._storage.has(LEGACY_USER_KEY), false);
    assert.deepEqual(await loadPersistedSession(), {
      session: { token: 'new-token', user: profile },
      malformed: false,
    });
  });

  it('round-trips the temporary-password requirement and expiry', async () => {
    const temporaryProfile = {
      ...profile,
      mustChangePassword: true,
      temporaryPasswordExpiresAt: '2099-01-01T00:00:00.000Z',
    };
    await persistSession({ token: 'temporary-token', user: temporaryProfile });
    assert.deepEqual(await loadPersistedSession(), {
      session: { token: 'temporary-token', user: temporaryProfile },
      malformed: false,
    });
  });

  it('persists and restores phone-only customers with no public email', async () => {
    const phoneProfile = { ...profile, email: '', phone: '+254712345678' };
    await persistSession({ token: 'phone-session', user: phoneProfile });
    assert.deepEqual(await loadPersistedSession(), {
      session: { token: 'phone-session', user: phoneProfile },
      malformed: false,
    });
  });

  it('migrates a phone-only legacy session without discarding it', async () => {
    const phoneProfile = { ...profile, email: '', phone: '+254712345678' };
    storage._storage.set(LEGACY_TOKEN_KEY, 'phone-session');
    storage._storage.set(LEGACY_USER_KEY, JSON.stringify(phoneProfile));
    assert.deepEqual(await loadPersistedSession(), {
      session: { token: 'phone-session', user: phoneProfile },
      malformed: false,
    });
  });

  it('still rejects profiles without either an email or phone', async () => {
    await assert.rejects(
      persistSession({ token: 'invalid-session', user: { ...profile, email: ' ', phone: ' ' } }),
      /invalid Companion session/,
    );
    assert.equal(storage._storage.size, 0);
  });

  it('migrates a complete legacy pair but rejects a partial pair', async () => {
    storage._storage.set(LEGACY_TOKEN_KEY, 'legacy-token');
    storage._storage.set(LEGACY_USER_KEY, JSON.stringify(profile));
    assert.deepEqual(await loadPersistedSession(), {
      session: { token: 'legacy-token', user: profile },
      malformed: false,
    });

    storage._reset();
    storage._storage.set(LEGACY_TOKEN_KEY, 'orphan-token');
    assert.deepEqual(await loadPersistedSession(), { session: null, malformed: true });
  });

  it('marks malformed JSON for cleanup and clears every session representation', async () => {
    storage._storage.set(AUTH_SESSION_KEY, '{not-json');
    const loaded = await loadPersistedSession();
    assert.deepEqual(loaded, { session: null, malformed: true });

    storage._storage.set(LEGACY_TOKEN_KEY, 'stale');
    storage._storage.set(LEGACY_USER_KEY, JSON.stringify(profile));
    await clearPersistedSession();
    assert.equal(storage._storage.size, 0);
  });
});