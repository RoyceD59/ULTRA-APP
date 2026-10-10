# WhatsApp credential backup retry

The owner approved bounded per-file retries and disconnect safety on 2026-10-10.

## Behavior and boundaries

Retry only a failed storage save, up to four calls with one-, two- and four-second
backoff. Retry recognizable transient network/TLS failures, HTTP 408, HTTP 429
and HTTP 5xx. Do not retry unknown errors, permission/configuration failures or
certificate-trust failures. Provider SDK internal retry behavior is unchanged;
four attempts means four application-level save calls, not four network packets.
This is not an indefinite backup job or a promise of a hard overall deadline.

Re-read the local file before a retry, preserving the serialized credential
event queue. Capture the lifecycle generation and cancellation signal when the
socket starts. Check both before reading and before every storage attempt.
Disconnect/new lifecycle cancels backoff promptly and prevents obsolete retries.
Never race/abandon a started storage save. Drain all admitted file tasks even
when one fails, then let the existing Disconnect cleanup remove both copies.

Use a dependency-injected helper for storage, local reads, clocks/waits and
structured logging. Real bucket paths and credential bytes never enter logs.
Log only fixed operation/status/category values, attempts and delay durations.
Keep errors non-fatal to the WhatsApp process; exhausted retries remain explicit.

## Verification and scope

Use isolated in-memory storage and synthetic credential bytes, never the live
WhatsApp prefix or existing session files. Verify recovery without another
credential event, permanent/exhausted failure bounds, changed bytes on retry,
generation changes during reads/backoff, cancellation, draining parallel writes,
and Disconnect deleting only after admitted writes finish. Verify log redaction.

No session reset/re-pairing, provider activation, production writes, schema
change, deployment, release-selection change or customer notification is
authorized. Source/test results do not establish live deployment or backup health.
