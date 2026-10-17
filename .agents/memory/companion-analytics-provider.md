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

The owner separately approved a Google product-event collector for a temporary
development/debug check, not as a replacement for Umami or approval to activate
Google tracking permanently.

**Why:** The owner supplied an explicit Google measurement destination and debug
markers after the product-event check was blocked on collector approval; its
scope still excluded activation flags and real payments.

**How to apply:** Preserve Umami and native behavior. Inspect actual network
destination and debug markers rather than trusting adapter calls alone. A
collector HTTP 204 is transport evidence, not confirmation that events appeared
in the approved property's DebugView. Keep property-level and paid-purchase
evidence gates separate.

Inspect the serialized collector debug marker when coordinating a Google
DebugView session; setting `debug_mode: true` in the adapter does not by itself
prove debug visibility.

**Why:** The downloaded tag serialized an ordinary `ep.debug_mode=true` parameter
without `_dbg=1`. The owner confirmed event visibility after the bounded test
explicitly added the approved `_dbg=1` marker.

**How to apply:** Check the actual transport and obtain separate property-side
confirmation. Do not turn a temporary debug fix into permanent app activation,
and distinguish owner-attested results from agent-observed report evidence.