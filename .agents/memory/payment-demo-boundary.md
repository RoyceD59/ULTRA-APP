---
name: Payment demo boundary
description: Environment constraints for payment simulations and provider outages.
---

Only explicit development/test environments may simulate payments when provider
credentials are unconfigured. Production, unset and unknown environments must
fail closed. A configured provider's authentication failure is an outage, never
permission to simulate a successful payment, including in development.

**Why:** Public legacy guest orders previously treated missing credentials as
verified payment, allowing arbitrary references to authorize fulfillment.
Development/test demos were retained to avoid adding or replacing checkout flows.

**How to apply:** Apply the same boundary to order verification, payment
initialization, status checks and method availability. Keep COD unaffected.
Never infer demo permission from credential absence or a failed provider call.
