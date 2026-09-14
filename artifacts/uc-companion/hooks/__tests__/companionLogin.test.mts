import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  COMPANION_LOGIN_ERROR,
  companionLoginError,
  RATE_LIMIT_MESSAGE,
} from '../rateLimitAlert.js';

describe('Companion password login errors', () => {
  it('uses one neutral message for invalid email or phone credentials', () => {
    assert.equal(
      companionLoginError(401, false, 'Invalid credentials'),
      COMPANION_LOGIN_ERROR,
    );
    assert.equal(
      companionLoginError(404, false, 'No account exists for that phone'),
      COMPANION_LOGIN_ERROR,
    );
  });

  it('retains safe rate-limit guidance without exposing account state', () => {
    assert.equal(
      companionLoginError(429, false, undefined),
      RATE_LIMIT_MESSAGE,
    );
  });

  it('does not report an error for a successful response', () => {
    assert.equal(companionLoginError(200, true, undefined), null);
  });
});