# Alison conversation access and client management

## Approved safeguards

ProjectHub will offer a dedicated Alison viewer client with only `alison.read`,
show the matching client ID alongside the one-time secret, and distinguish
invalid credentials, missing scope, rate limits, and connectivity failures.
Credentials stay in memory, never browser storage or analytics.

Deletion is administrator-only. The client must be suspended or revoked and
have no unexpired, unrevoked tokens. A confirmation explains that deleting the
client and its tokens is permanent. Audit history is retained. Client issuance
and deletion serialize on the client row so concurrent requests cannot bypass
the deletion guard.

## Create credentials

1. Sign in to ProjectHub as an administrator.
2. Open **Agent operations** (`/admin/agent-operations`).
3. Enter a descriptive name, or keep the quick-create default.
4. Choose **Create Alison viewer**. This grants only `alison.read`.
5. Copy the **Client ID** and **Client secret** from the same one-time panel.
   Store the secret securely outside chat. It cannot be recovered later.
6. Open **Alison conversations** (`/alison-conversations`), enter that pair,
   and select **Connect securely**.

Create and use the credentials against the same API environment. A client
created in a development database is not automatically present in production.
ProjectHub account passwords and provider API keys are not Alison client secrets.
Saving a value in deployment Secrets does not register an OAuth client; the
client must exist in the API's client registry.

Tokens last 15 minutes. Reconnect when a token expires. Anonymous conversations
are retained for 30 days; an empty list after connecting is not a login failure.

## Troubleshoot access

- **Invalid client:** verify the matching ID/secret pair, active status, expiry,
  and environment. If the secret was lost or rotated, use the new secret.
- **Missing `alison.read`:** create an Alison viewer. Rotating a secret does not
  add scopes.
- **Expired client:** create a replacement with a valid expiry. Rotation does
  not extend the client's expiry.
- **Too many attempts:** wait a minute and reconnect.
- **Connectivity/service failure:** check API availability rather than rotating
  working credentials repeatedly.

**Rotate** replaces the secret, revokes existing tokens and reactivates a
suspended/revoked client. Its configured expiry is unchanged.

## Remove an unused client

1. Check that no agent or colleague still needs it.
2. Select **Suspend**. This immediately revokes its tokens.
3. Select **Delete** and confirm the permanent removal.

The API independently verifies inactivity and live tokens even if the displayed
list is stale. A conflict leaves the client intact and the UI refreshes its
status. Past audit records, including the deletion, remain available.

## Verification scope

Tests use generated, disposable fixture credentials, never saved provider keys.
Coverage includes client creation, credential exchange, required scopes,
rotation, suspension, deletion guards, retained audit history, and administrator
authorization. This document describes development changes, not publication.
