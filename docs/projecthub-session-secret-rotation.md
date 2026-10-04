# ProjectHub session-secret rotation

ProjectHub rejects JWTs signed with the previous `SESSION_SECRET` once the
running API uses the replacement secret. Client-side expiry checks do not
validate signatures: the protected API's 401 response is the enforcement point.
The shared client 401 handler removes the saved token and user, and `AuthGuard`
shows the sign-in form while preserving the requested page in `next`.

Existing bcrypt hashes in `team_settings.passcode_hash` do not depend on
`SESSION_SECRET` and need no rehash. Individual team passwords also remain
usable for a fresh login. The legacy passcode fallback when no stored hash
exists does use `SESSION_SECRET`; that fallback is not an independent passcode.

## Operational limits

- Replacing a configured secret is effective only once every running API
  instance uses the new value. An instance still using the old value can still
  accept the old signature.
- Existing signed tokens for Companion customers use the same secret, so
  rotation also revokes those tokens. This is not a ProjectHub-only logout.
- The browser returns to login when it receives an authenticated request's 401,
  not instantaneously when the secret changes. It cannot detect rotation from
  the token's expiry alone. Previously rendered content is not remotely erased.
- These are isolated regression checks, not a production rotation rehearsal.
  No deployed secret or production data was changed to run them.

## Regression checks

Run from the workspace root:

```sh
cd artifacts/api-server
TEST_GLOB='src/tests/session-secret-rotation.test.ts' pnpm test
```

```sh
cd artifacts/projecthub
pnpm exec vitest run src/session-secret-rotation.test.tsx src/lib/team-auth.test.ts
```

The API test uses synthetic old and new keys, logs in before rotation,
checks 401 responses across protected route families and a credential write,
then logs in again with the unchanged password. It also checks the persisted
passcode hash, successful passcode login, and fail-closed missing-secret behavior.
The client test keeps the real router, auth guard, storage helpers, and sign-in
form; only the protected page/layout and API response are fixtures. It checks
the 401 redirect, storage cleanup, original URL, reload behavior, and that a
403 permission denial does not revoke the session.