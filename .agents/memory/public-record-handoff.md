---
name: Public record layout handoff
description: Why a visibly rendered product page can reject every pointer click after hydration.
---

The server document and interactive React screen must explicitly transfer layout
ownership when the product API response arrives.

**Why:** The fallback's natural-document layout remained active after React
removed the fallback content. Buttons looked correctly positioned, but browser
hit-testing returned the HTML element instead of the buttons. Removing the
fallback layout mode restored real clicks; forced clicks would have hidden this.

**How to apply:** Confirm ordinary pointer clicks after loading a published
deep link, not just screenshots or forced browser clicks. Release fallback
layout only when the interactive page is ready, not while the public-document
fallback still owns the screen. Navigation groups must select a published
record rather than assuming the first configured record is available.
