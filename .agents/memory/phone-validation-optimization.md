---
name: Phone validation optimization policy
description: Preserve phone acceptance and identity semantics when reducing Companion payload.
---

Optimize unused code, not phone country coverage or metadata accuracy. Keep
canonical identity's refusal to guess local numbers separate from the
instant-water forms' legacy Kenya default and selected-country checks.

**Why:** Existing customer identities depend on exact normalization and validity
results. Switching metadata tiers for a smaller download can change which
customer numbers are accepted, even when country calling codes look unchanged.
Global unstable bundler settings would also widen an intentionally phone-only
optimization.

**How to apply:** Compare against the original public parser across worldwide
examples, invalid variants and country mismatches before accepting payload
savings. Prefer a narrowly scoped public-API facade over unsupported private
imports or app-wide graph changes. Regenerate and revalidate after upstream
dependency changes rather than silently keeping old metadata.