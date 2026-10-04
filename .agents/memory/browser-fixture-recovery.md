---
name: Browser fixture recovery
description: Safe recovery of isolated development fixtures when a browser testing worker resets.
---

A browser testing worker reset is not a database rollback. Runtime credentials
and browser state may disappear while its shared-development database fixtures
remain.

**Why:** A Companion walkthrough lost its in-memory fixture passwords after a
worker reset, but the disposable accounts and linked assignment still existed.
Only those accounts could safely have their passwords rotated before cleanup.

**How to apply:** Keep a separate, nonsecret manifest of exact fixture IDs before
browser interactions. After a reset, reconcile and clean only those tracked
records, or explicitly recover those fixture accounts. Never reset existing
customer credentials, delete by a broad name/email match, or assume fresh
browser state implies fresh database state. Keep credentials out of reports and
project memory.