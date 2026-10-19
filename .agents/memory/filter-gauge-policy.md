---
name: Filter gauge policy
description: Limits of the display-only lifespan indicator and the meaning of capacity usage.
---

Filter lifespan status is display-only. Use the more depleted valid time/capacity basis; gauge refresh must never alter existing replacement or cleaning reminders, opt-ins, activation, or cleaning history.

**Why:** The user explicitly scoped the gauge to status display, not a change to any prior reminder or maintenance policies.

**How to apply:** Keep capacity exhaustion a display result rather than a new reminder trigger. Invalid or ambiguous cycle links require an explicitly labelled time-only fallback.

Recorded personal-impact litres are customer/staff-entered filter-specific refills, not sensor-verified consumption. Ownership verification alone does not verify a physical measurement.

**Why:** The existing ledger represents manually recorded refills; implying measured litres would overstate the evidence.

**How to apply:** Label this basis as recorded litres, require authenticated ownership and exact purchase/activation-cycle agreement, and never estimate usage from hydration or unrelated refill activity.