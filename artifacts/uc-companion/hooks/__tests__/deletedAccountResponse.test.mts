import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  DELETED_ACCOUNT_ERROR,
  handleDeletedAccountResponse,
  handleRejectedSessionResponse,
  isDeletedAccountResponse,
  isRejectedSessionResponse,
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

  it('matches any 401 only when the request carried a customer token', () => {
    assert.equal(isRejectedSessionResponse(401, 'app-token'), true);
    assert.equal(isRejectedSessionResponse(401, null), false);
    assert.equal(isRejectedSessionResponse(403, 'app-token'), false);
  });

  it('passes the exact rejected token to the auth handler', async () => {
    const rejectedTokens: string[] = [];
    const unregister = setDeletedAccountHandler(async (rejectedToken) => {
      rejectedTokens.push(rejectedToken);
    });

    await handleRejectedSessionResponse(401, null);
    await handleRejectedSessionResponse(500, 'current-token');
    await handleRejectedSessionResponse(401, 'current-token');
    unregister();

    assert.deepEqual(rejectedTokens, ['current-token']);
  });
});