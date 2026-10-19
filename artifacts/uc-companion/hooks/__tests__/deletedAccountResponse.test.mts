import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  DELETED_ACCOUNT_ERROR,
  PASSWORD_RESET_SESSION_ERROR,
  handleDeletedAccountResponse,
  handleRejectedSessionResponse,
  isDeletedAccountResponse,
  isRejectedSessionResponse,
  retrySessionRequest,
  setDeletedAccountHandler,
} from '../deletedAccountResponse.js';

describe('deleted account API response detection', () => {
  it('matches the exact deleted-account 401 contract', () => {
    assert.equal(
      isDeletedAccountResponse(401, { error: DELETED_ACCOUNT_ERROR }),
      true,
    );
  });

  it('does not sign out for other authentication errors', () => {
    assert.equal(
      isDeletedAccountResponse(401, { error: 'Session expired. Please sign in again.' }),
      false,
    );
  });

  it('does not match the message on a non-401 response', () => {
    assert.equal(
      isDeletedAccountResponse(503, { error: DELETED_ACCOUNT_ERROR }),
      false,
    );
  });

  it('notifies the registered auth handler only for the exact contract', async () => {
    let calls = 0;
    const unregister = setDeletedAccountHandler(async () => {
      calls += 1;
    });

    await handleDeletedAccountResponse(401, { error: 'Unauthorized' });
    await handleDeletedAccountResponse(401, { error: DELETED_ACCOUNT_ERROR });
    unregister();
    await handleDeletedAccountResponse(401, { error: DELETED_ACCOUNT_ERROR });

    assert.equal(calls, 1);
  });

  it('matches only deleted-account and password-reset 401s with a customer token', () => {
    for (const error of [DELETED_ACCOUNT_ERROR, PASSWORD_RESET_SESSION_ERROR]) {
      assert.equal(isRejectedSessionResponse(401, 'app-token', { error }), true);
      assert.equal(isRejectedSessionResponse(401, null, { error }), false);
      assert.equal(isRejectedSessionResponse(401, '', { error }), false);
      assert.equal(isRejectedSessionResponse(403, 'app-token', { error }), false);
      assert.equal(isRejectedSessionResponse(503, 'app-token', { error }), false);
    }
    for (const body of [null, undefined, {}, 'Unauthorized', { error: 'Unauthorized' },
      { error: 'Invalid credentials' }, { error: `${PASSWORD_RESET_SESSION_ERROR} ` }]) {
      assert.equal(isRejectedSessionResponse(401, 'app-token', body), false);
    }
  });

  it('does not retry forced sign-outs but preserves the single retry for other errors', () => {
    for (const message of [DELETED_ACCOUNT_ERROR, PASSWORD_RESET_SESSION_ERROR]) {
      assert.equal(retrySessionRequest(0, { status: 401, body: { error: message } }), false);
      assert.equal(retrySessionRequest(0, { status: 401, data: { error: message } }), false);
    }
    for (const error of [{ status: 401, body: { error: 'Unauthorized' } }, new Error('Network error'),
      { status: 503, body: { error: PASSWORD_RESET_SESSION_ERROR } }]) {
      assert.equal(retrySessionRequest(0, error), true);
      assert.equal(retrySessionRequest(1, error), false);
    }
  });

  it('passes the exact rejected token to the auth handler', async () => {
    const rejectedTokens: string[] = [];
    const unregister = setDeletedAccountHandler(async (rejectedToken) => {
      rejectedTokens.push(rejectedToken);
    });

    await handleRejectedSessionResponse(401, null, { error: PASSWORD_RESET_SESSION_ERROR });
    await handleRejectedSessionResponse(500, 'current-token', { error: PASSWORD_RESET_SESSION_ERROR });
    await handleRejectedSessionResponse(401, 'current-token', { error: 'Unauthorized' });
    await handleRejectedSessionResponse(401, 'current-token', { error: PASSWORD_RESET_SESSION_ERROR });
    unregister();

    assert.deepEqual(rejectedTokens, ['current-token']);
  });
});