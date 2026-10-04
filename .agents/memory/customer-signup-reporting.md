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