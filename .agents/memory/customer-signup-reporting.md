---
name: Customer signup reporting timezone
description: Product-approved business timezone and calendar reset policy for customer signup counts.
---

Customer signup reporting uses Africa/Nairobi: weeks reset Monday at 00:00 and
months reset on the first at 00:00, with the boundary instant included.

**Why:** The user explicitly chose Kenya-midnight resets rather than UTC resets.
A database session timezone change must not move the dashboard reset instant.

**How to apply:** Preserve this business-timezone contract when changing customer
reporting or optimizing signup counts; do not infer it from deployment settings
or the viewer's timezone.

Recalibrate the summary switch-over threshold when the reporting calendar
changes; benchmark the full boundary-conversion aggregate, not just index access.

**Why:** Explicit Kenya-time boundary calculations materially increased indexed
count cost compared with the earlier database-GMT query. Development-container
timings also varied under load, so they cannot establish a universal volume cliff.

**How to apply:** Preserve the business calendar in both direct counts and summary
buckets, measure both read paths, and leave headroom before observed target failures.