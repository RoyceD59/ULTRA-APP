import { describe, it, mock, beforeEach, afterEach } from 'node:test';
import * as assert from 'node:assert/strict';
import { captureHandoffUrl, processHandoffState, HANDOFF_STORAGE_KEY } from '../useWaterTestHandoff.js';
import { Platform } from 'react-native';
import { _reset, _storage } from '@react-native-async-storage/async-storage';
import { ApiError } from '../apiError.js';

const tick = () => new Promise<void>(resolve => setImmediate(resolve));

describe('captureHandoffUrl', () => {
  let origOS: string;

  beforeEach(async () => {
    mock.restoreAll();
    _reset();
    origOS = Platform.OS;
  });

  afterEach(() => {
    Platform.OS = origOS;
  });

  it('captures water-check-handoff from query param', async () => {
    captureHandoffUrl('app://water-test?water-check-handoff=token123');
    await tick();
    const stored = _storage.get(HANDOFF_STORAGE_KEY) || null;
    assert.equal(stored, 'token123');
  });

  it('captures water-check-handoff from fragment', async () => {
    captureHandoffUrl('https://example.com/test#water-check-handoff=token456');
    await tick();
    const stored = _storage.get(HANDOFF_STORAGE_KEY) || null;
    assert.equal(stored, 'token456');
  });

  it('clears hash from window.location on web', async () => {
    Platform.OS = 'web';
    
    // Mock window context for test
    if (typeof window !== 'undefined') {
      window.location.hash = '#water-check-handoff=token789';
      mock.method(window.history, 'replaceState', (state: any, title: string, url: string) => {
         window.location.hash = url.includes('#') ? url.substring(url.indexOf('#')) : '';
      });
    }

    captureHandoffUrl('https://example.com/#water-check-handoff=token789');
    await tick();

    const stored = _storage.get(HANDOFF_STORAGE_KEY) || null;
    assert.equal(stored, 'token789');
    
    if (typeof window !== 'undefined') {
      assert.equal(window.location.hash.includes('water-check-handoff'), false);
    }
  });

  it('ignores urls without the token', async () => {
    captureHandoffUrl('https://example.com/test');
    await tick();
    const stored = _storage.get(HANDOFF_STORAGE_KEY) || null;
    assert.equal(stored, null);
  });
});

describe('processHandoffState', () => {
  let pendingState: boolean;
  let successState: boolean;
  let successResult: any;
  let errorState: string | null;

  const setPending = (v: boolean) => { pendingState = v; };
  const setSuccess = (v: boolean) => { successState = v; };
  const setError = (v: string | null) => { errorState = v; };
  const onSuccess = (res: any) => { successResult = res; };

  beforeEach(() => {
    _reset();
    pendingState = false;
    successState = false;
    errorState = null;
    successResult = null;
  });

  it('does nothing if no handoff token', async () => {
    await processHandoffState('my-jwt', async () => ({} as any), onSuccess, setPending, setSuccess, setError);
    assert.equal(pendingState, false);
    assert.equal(successState, false);
  });

  it('persists across signed-out state', async () => {
    _storage.set(HANDOFF_STORAGE_KEY, 'some-handoff');
    await processHandoffState(null, async () => ({} as any), onSuccess, setPending, setSuccess, setError);
    assert.equal(pendingState, true);
    assert.equal(successState, false);
    assert.equal(_storage.get(HANDOFF_STORAGE_KEY), 'some-handoff');
  });

  it('cleans up on successful consume', async () => {
    _storage.set(HANDOFF_STORAGE_KEY, 'some-handoff');
    await processHandoffState('my-jwt', async () => ({ id: 1 } as any), onSuccess, setPending, setSuccess, setError);
    
    assert.equal(pendingState, false);
    assert.equal(successState, true);
    assert.equal(errorState, null);
    assert.equal(successResult.id, 1);
    assert.equal(_storage.has(HANDOFF_STORAGE_KEY), false);
  });

  it('retains token for unverified-phone/retryable failures', async () => {
    _storage.set(HANDOFF_STORAGE_KEY, 'some-handoff');
    const consumeFn = async () => { throw new ApiError('Conflict', 409, {}); };
    
    await processHandoffState('my-jwt', consumeFn, onSuccess, setPending, setSuccess, setError);
    
    assert.equal(pendingState, true);
    assert.equal(successState, false);
    assert.equal(errorState, null);
    assert.equal(_storage.get(HANDOFF_STORAGE_KEY), 'some-handoff');
  });

  it('removes token and exposes error on terminal 404 response', async () => {
    _storage.set(HANDOFF_STORAGE_KEY, 'some-handoff');
    const consumeFn = async () => { throw new ApiError('Not found', 404, {}); };

    await processHandoffState('my-jwt', consumeFn, onSuccess, setPending, setSuccess, setError);

    assert.equal(pendingState, false);
    assert.equal(successState, false);
    assert.ok(typeof errorState === 'string');
    assert.equal(_storage.has(HANDOFF_STORAGE_KEY), false);
  });

  it('removes token and exposes error on terminal 403 (forbidden) response', async () => {
    _storage.set(HANDOFF_STORAGE_KEY, 'some-handoff');
    const consumeFn = async () => { throw new ApiError('Forbidden', 403, {}); };

    await processHandoffState('my-jwt', consumeFn, onSuccess, setPending, setSuccess, setError);

    assert.equal(pendingState, false);
    assert.equal(successState, false);
    assert.ok(typeof errorState === 'string');
    assert.equal(_storage.has(HANDOFF_STORAGE_KEY), false);
  });
});
