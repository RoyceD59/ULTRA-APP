---
name: UC reminder channels (email/SMS/WhatsApp)
description: How server-side filter reminders work — opt-in flags, app→server sync, at-most-once dispatch, and the Postgres µs vs JS ms timestamp trap.
---

# Filter reminders via email / SMS / WhatsApp

Server mirrors the app's 5-stage filter schedule and delivers it through external
channels for users who opted in. Shipped Aug 14, 2026.

## Design (be consistent with this)
- **Strictly opt-in**: `uc_notif_prefs.reminder_email/_sms/_whatsapp`, all default false.
  Toggles live in the app's Notification Preferences screen (signed-in only).
- **App is authoritative** for activation; it fire-and-forget syncs a mirror to
  `uc_filter_reminders` (PUT `/api/uc/reminders/sync`) on every schedule/clear.
  A cycle change (productId or activatedAt differs) resets `sent_stages`.
- **Daily dispatch** at 07:30 UTC (10:30 Nairobi) via the scheduler; audited to
  `uc_notification_log` (templates `filter_reminder_<stage>`), incl. WhatsApp.
- **At-most-once per stage**: dispatcher CLAIMS each stage before sending — a
  conditional jsonb append keyed to user + product + activation date + `NOT (sent_stages ? key)`.
  Verified with parallel runs. One attempt ever, no retries; failures stay visible in the log.
- **Stale-skip**: stages more than 3 days overdue are claimed but never sent
  (prevents backlog blast when someone opts in months after activation).
- Abuse guards on sync: rate-limited, activatedAt must be within (−1h, 3y].

## Why
Opt-in and one-attempt were explicit user/product decisions (no spam, SMS costs
money). Claim-before-send exists because production autoscale can run multiple
instances, each with its own cron.

## Trap: Postgres microseconds vs JS milliseconds
`timestamptz` stores microseconds; JS `Date` carries milliseconds. A `WHERE ts = $date`
equality silently never matches for rows written with `now()` in SQL. Compare with
`date_trunc('milliseconds', col) = date_trunc('milliseconds', $param::timestamptz)`.
This silently broke stage claiming until caught by a live double-run test.

## Known gaps (proposed as follow-up tasks)
- Performance check-in shortens effective lifespan locally but doesn't sync it;
  server sends at rated-lifespan dates (or stale-skips).
- Channel delivery prerequisites: Resend domain DNS verification (email),
  AT_API_KEY/AT_USERNAME secrets (SMS), linked WhatsApp session in ProjectHub.
