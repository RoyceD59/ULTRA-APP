import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  DELETED_ACCOUNT_ERROR,
  handleDeletedAccountResponse,
  isDeletedAccountResponse,
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
});