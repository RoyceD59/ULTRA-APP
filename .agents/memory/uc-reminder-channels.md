---
name: UC reminder channels (email/SMS/WhatsApp)
description: Durable architectural decisions for server-side filter reminder dispatch — opt-in model, at-most-once claim, and the Postgres µs vs JS ms timestamp trap.
---

# Filter reminders via email / SMS / WhatsApp

## Design decisions (be consistent)

- **Strictly opt-in**: `uc_notif_prefs.reminder_email/_sms/_whatsapp`, all default false.
- **App is authoritative** for activation date; it syncs a mirror to `uc_filter_reminders`.
  A cycle change (productId or activatedAt differs) resets `sent_stages` to `[]`.
- **At-most-once per stage**: dispatcher claims each stage with a conditional jsonb append
  (`NOT (sent_stages ? key)`) keyed to user + product + activation date, BEFORE sending.
  Concurrent runs / autoscale instances race on this update; only one wins. One attempt
  ever — no retries. Failures stay visible in `uc_notification_log`.
- **Stale-skip**: stages more than 3 days overdue are claimed but never sent (prevents
  backlog blast when a user opts in long after activation).
- **Postgres µs vs JS ms trap**: `claimStage` uses `date_trunc('milliseconds', activated_at)`
  on both sides of the comparison so raw `now()` inserts (µs precision) still match the
  JS `Date` value (ms precision) carried in the in-memory row.

**Why claim-before-send:** production autoscale runs multiple instances, each with its
own cron. Without the atomic claim the same stage can be sent by two instances simultaneously.
