---
name: API order-flow test harness
description: How to write api-server tests that POST /uc/orders without hitting real WooCommerce/M-Pesa (env deletion + fetch stub pitfalls)
---

# Order-flow tests must strip payment/WC credentials

Any api-server test that POSTs to `/uc/orders` must delete these env vars in `before()` (they ARE present in the dev/test environment via secrets):

```ts
delete process.env["MPESA_CONSUMER_KEY"];
delete process.env["MPESA_CONSUMER_SECRET"];
delete process.env["MPESA_SHORTCODE"];
delete process.env["MPESA_PASSKEY"];
delete process.env["WC_CONSUMER_KEY"];
delete process.env["WC_CONSUMER_SECRET"];
```

**Why:**
- With WC creds present, orders take the WooCommerce path. For reference-bearing (paid) orders it *fails closed* with a retriable 503 unless the WC POST returns a real order — a stubbed fetch cannot satisfy it cleanly.
- A generic fetch stub returning `{ id: "anything" }` is mistaken for a real WC order: the route returns it as the created order (string id ends up in the response and breaks DB follow-up queries). If a stub must answer WC calls, return `[]` for GETs and `{}` (no `id`) for POSTs.
- With M-Pesa creds present, mpesa references are verified against Daraja; without them the server uses mock mode and accepts any reference.

**How to apply:** mirror the `mpesa-idempotency.test.ts` harness (own http server, env deletion, fetch stub, cleanup). With creds deleted, orders take the local DB path — assert stored data (e.g. normalized phone) by querying `ucOrdersTable`, since the DB-path response body does not include `shippingAddress`.

Related: node's test runner spawns one process per test file, so env deletion in one file never leaks into another.

## Order email isolation

Set a test-only `RESEND_BASE_URL` when intercepting order emails with `globalThis.fetch`; do not assume that a global fetch stub intercepts the Replit connector proxy.

**Why:** Without an explicit direct-API base URL, Resend uses its connector's proxy fetch, which bypasses the global stub and can reach the live provider from a regression test.

**How to apply:** Route Resend to a reserved `.invalid` host, stub that exact endpoint, and wait for background provider calls before restoring fetch. Fail on unexpected outbound requests.
