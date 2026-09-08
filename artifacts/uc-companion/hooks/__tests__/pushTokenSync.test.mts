/**
 * Regression tests for push-token registration & foreground sync
 * (useNotifications.ts — registerCurrentPushToken / syncPushTokenWithServer).
 *
 * Covers the race the completion review flagged: a login-time registration
 * (cached/stale token era) and a foreground sync must be serialized so the
 * server's final token is always the current OS token, and the
 * last-registered marker never resets to a stale value.
 *
 * Run with: pnpm --filter @workspace/uc-companion test
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// @ts-ignore — stubs export private helpers
import notifStub from 'expo-notifications';
// @ts-ignore
import AsyncStorageStub from '@react-native-async-storage/async-storage';
// @ts-ignore
import ConstantsStub, { ExecutionEnvironment } from 'expo-constants';
// @ts-ignore
import ReactNativeStub from 'react-native';

const _resetNotifs: () => void            = (notifStub as any)._reset;
const _setPushToken: (t: string) => void  = (notifStub as any)._setPushToken;
const _setDelay: (ms: number) => void     = (notifStub as any)._setPushTokenDelay;

const _storage: Map<string, string> = (AsyncStorageStub as any)._storage;
const _resetStorage: () => void     = (AsyncStorageStub as any)._reset;
const _resetConstants: () => void   = (ConstantsStub as any)._reset;
const _setExecutionEnvironment: (value: ExecutionEnvironment) => void =
  (ConstantsStub as any)._setExecutionEnvironment;
const _setPlatform: (value: 'ios' | 'android' | 'web') => void =
  (ReactNativeStub as any).__setPlatform;
const _getPushTokenFetchCount: () => number = (notifStub as any)._getPushTokenFetchCount;
const _scheduled: string[] = (notifStub as any)._scheduled;

import {
  registerCurrentPushToken,
  requestNotificationPermission,
  scheduleAllFilterNotifications,
  syncPushTokenWithServer,
} from '../useNotifications.js';

const REGISTERED_KEY = 'uc_push_token_registered';
const CACHED_KEY     = 'uc_push_token';

// ── fetch stub ────────────────────────────────────────────────────────────────
interface RecordedPost { pushToken: string; completedAt: number }
let posts: RecordedPost[] = [];
let postDelayMs = 0;
let postOk = true;
let completionCounter = 0;

(globalThis as any).fetch = async (_url: string, init?: { body?: string }) => {
  const body = JSON.parse(init?.body ?? '{}') as { pushToken: string };
  if (postDelayMs > 0) await new Promise(r => setTimeout(r, postDelayMs));
  posts.push({ pushToken: body.pushToken, completedAt: ++completionCounter });
  return { ok: postOk } as Response;
};

beforeEach(() => {
  _resetNotifs();
  _resetStorage();
  _resetConstants();
  _setPlatform('ios');
  posts = [];
  postDelayMs = 0;
  postOk = true;
  completionCounter = 0;
});

describe('Android Expo Go runtime boundary', () => {
  beforeEach(() => {
    _setPlatform('android');
    _setExecutionEnvironment(ExecutionEnvironment.StoreClient);
  });

  it('keeps permission requests and local reminders enabled without fetching or posting a remote token', async () => {
    assert.equal(await requestNotificationPermission(), true);

    const activation = await scheduleAllFilterNotifications({
      activatedAt: new Date().toISOString(),
      productId: 1,
      productName: 'Portable Water Filter Pump',
      lifespanDays: 120,
    }, 42);

    assert.ok(activation.notifIds.length > 0);
    assert.equal(_scheduled.length, activation.notifIds.length);

    assert.equal(await registerCurrentPushToken('auth-tok', { allowPrompt: true, force: true }), false);
    await syncPushTokenWithServer('auth-tok');

    assert.equal(_getPushTokenFetchCount(), 0);
    assert.equal(posts.length, 0);
  });
});

describe('syncPushTokenWithServer (foreground sync)', () => {
  it('registers a rotated token exactly once and updates the marker', async () => {
    _storage.set(REGISTERED_KEY, 'ExponentPushToken[old]');
    _storage.set(CACHED_KEY, 'ExponentPushToken[old]');
    _setPushToken('ExponentPushToken[new]');

    await syncPushTokenWithServer('auth-tok');

    assert.equal(posts.length, 1);
    assert.equal(posts[0]!.pushToken, 'ExponentPushToken[new]');
    assert.equal(_storage.get(REGISTERED_KEY), 'ExponentPushToken[new]');
    assert.equal(_storage.get(CACHED_KEY), 'ExponentPushToken[new]');
  });

  it('makes no API call when the token is already up to date', async () => {
    _storage.set(REGISTERED_KEY, 'ExponentPushToken[test-1]'); // matches stub default
    await syncPushTokenWithServer('auth-tok');
    assert.equal(posts.length, 0);
  });

  it('does not update the marker when the server rejects the registration', async () => {
    _storage.set(REGISTERED_KEY, 'ExponentPushToken[old]');
    postOk = false;
    await syncPushTokenWithServer('auth-tok');
    assert.equal(_storage.get(REGISTERED_KEY), 'ExponentPushToken[old]');
  });
});

describe('registerCurrentPushToken (login/registration path)', () => {
  it('always fetches the current OS token — never posts a stale cached value', async () => {
    _storage.set(CACHED_KEY, 'ExponentPushToken[stale-cached]');
    _setPushToken('ExponentPushToken[current]');

    await registerCurrentPushToken('auth-tok', { allowPrompt: true, force: true });

    assert.equal(posts.length, 1);
    assert.equal(posts[0]!.pushToken, 'ExponentPushToken[current]');
    assert.equal(_storage.get(REGISTERED_KEY), 'ExponentPushToken[current]');
  });

  it('force posts even when the marker already matches (new user, same device)', async () => {
    _storage.set(REGISTERED_KEY, 'ExponentPushToken[test-1]');
    await registerCurrentPushToken('other-user-tok', { force: true });
    assert.equal(posts.length, 1);
    assert.equal(posts[0]!.pushToken, 'ExponentPushToken[test-1]');
  });
});

describe('login registration racing a foreground sync', () => {
  it('serializes concurrent calls so the final server write is the current token', async () => {
    // Simulate: login-time registration kicks off, token rotates, foreground
    // sync fires while the first request is still in flight. Slow POSTs make
    // a lost-update race visible if requests were allowed to interleave.
    _storage.set(REGISTERED_KEY, 'ExponentPushToken[old]');
    _setPushToken('ExponentPushToken[era-1]');
    postDelayMs = 20;

    const login = registerCurrentPushToken('auth-tok', { allowPrompt: true, force: true });
    // Token rotates while the login registration is queued/in flight
    _setPushToken('ExponentPushToken[era-2]');
    const sync = syncPushTokenWithServer('auth-tok');

    await Promise.all([login, sync]);

    // The last completed server write must be the freshest token…
    const last = posts.reduce((a, b) => (a.completedAt > b.completedAt ? a : b));
    assert.equal(last.pushToken, 'ExponentPushToken[era-2]');
    // …and the marker must match what the server now holds.
    assert.equal(_storage.get(REGISTERED_KEY), 'ExponentPushToken[era-2]');
  });

  it('background→active transitions after login make no redundant API call', async () => {
    _setPushToken('ExponentPushToken[stable]');
    await registerCurrentPushToken('auth-tok', { force: true }); // login
    assert.equal(posts.length, 1);

    await syncPushTokenWithServer('auth-tok'); // foreground #1
    await syncPushTokenWithServer('auth-tok'); // foreground #2
    assert.equal(posts.length, 1); // no extra calls — token unchanged
  });
});
