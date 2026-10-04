---
name: Companion analytics provider
description: Approved collection provider and scope for Companion browser analytics.
---

The user chose a separate Umami analytics service for Companion web rather than setting up a separate website for Replit Growth.

**Why:** Replit-hosted custom analytics supports website artifacts, while Companion is registered as mobile. Separate Umami was offered as the option that preserves current hosting.

**How to apply:** Reuse the approved privacy-filtered events, keep collection web-only, and keep ProjectHub's Replit analytics separate. Do not change native analytics, migrate hosting, or publish automatically. Provider selection is not proof that collection has been configured or activated.

The presence of `window.umami` does not identify the approved separate collector. Replit's injected tracker also creates that global, so treating any existing instance as ready can send Companion events to the wrong reporting service.

**Why:** The published Companion page included Replit's tracker, while the separate Umami loader treated an existing global as success without checking its collector identity.

**How to apply:** Verify collector provenance and destination, not just script/global existence. Keep the separate Companion collector independent of ProjectHub/Replit analytics and apply privacy filtering to the actual sender. Confirm report ingestion separately from successful script loading.

Field web vitals are ongoing browser observability, not a substitute for the
signed-in and physical-phone usability checks. Preparing collection does not
authorize activation or publication.

**Why:** The user explicitly separated field evidence from physical-device
usability and required approval before activation/publication.

**How to apply:** Keep those evidence gates separate in performance reports and
release decisions; never treat field percentiles as native or physical-phone
verification.