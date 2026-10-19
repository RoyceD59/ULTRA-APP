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

Intercepted browser fixtures must return each endpoint's actual response shape. Unknown reads should fail explicitly; never reuse a generic profile or empty-object response for unrelated list and aggregate endpoints.

**Why:** Broad safe-read fallbacks produced home/tree rendering errors during an isolated Companion check, requiring multiple fixture corrections before the actual changed flow could be verified.

**How to apply:** Map only the required endpoints to contract-shaped synthetic responses, and mark unrelated programme/evidence reads unavailable. Distinguish fixture failures from application defects before editing application code.

Offline browser checks should distinguish optional presentation assets from
unexpected service calls while still blocking all outbound traffic.

**Why:** A fully successful signed-in export was initially reported as failed
solely because the page requested optional remote font CSS. That is not evidence
of an export or authentication failure.

**How to apply:** Explicitly classify known optional assets in isolated checks;
keep unknown outbound requests as failures. Do not allow real providers just to
make a test pass, or change product code to fix a test-environment restriction.

The documented browser testing worker is not guaranteed to be available in every
task environment. A locally resolvable Playwright package also does not establish
that a browser executable is installed.

**Why:** A verification session encountered an unsupported testing-worker
configuration, missing Chromium, and a timed-out browser setup. None of these
provided evidence about the application's interactive behavior.

**How to apply:** Check actual tool availability before promising an interactive
run. Report unavailable execution as blocked, not passed. Browser viewport
emulation must not be presented as physical-device verification.
