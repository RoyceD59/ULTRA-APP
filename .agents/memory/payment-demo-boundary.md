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

## Controlled-provider verification

Provider-evidence runs must affirm that simulation is disabled before preparing
orders or making requests. Do not borrow unrelated live credentials merely to
satisfy import-time configuration.

**Why:** Development/test mode permits credential-free demonstrations, which
can otherwise be mistaken for real provider evidence. Payment helpers also
transitively load an eager review-AI client even when a payment does not use AI;
inheriting the whole live environment to satisfy it defeats fixture isolation.

**How to apply:** Separate simulation control from database/credential
isolation. Fail closed on missing provider setup; make unrelated integrations
explicitly unavailable in the fixture only. Label local headers, mocked
callbacks, actual sandbox transactions and external ingress/delivery evidence
separately rather than presenting one category as proof of another.

## Saved M-Pesa test-credential approval

For isolated payment verification, the owner instructed “for mpesa use what is
already saved” and confirmed “those are test”.

**Why:** The owner explicitly approved this credential source; requesting
duplicate M-Pesa test credentials is unnecessary.

**How to apply:** Reuse the saved M-Pesa credentials only in sandbox-pinned
verification with selective credential allowlisting. Do not replace the saved
values, inherit unrelated credentials, or treat this as approval to reuse
Paystack credentials or initiate live payments. Public test routing and
notification recipients remain separate approval boundaries.

## Temporary HTTPS test approval and unknown outcomes

The owner approved temporary HTTPS development tests for the isolated payment
fixture, not publishing, production routing, live funds or notification targets.

**Why:** Explicit operational scope is narrower than normal app activation.

**How to apply:** Keep exposure in the development-only namespace, sandbox-pin
provider access, and keep credential/recipient approvals separate. An unknown
sandbox outcome is not a failed or successful payment: preserve its original
buyer/order and private recovery context, and never issue a replacement charge
merely to debug missing provider-response evidence.

## Sandbox diagnostic evidence boundaries

Isolation must not silently erase safe provider failure evidence. A sample-phone
test does not create an owner-phone notification, and portal request-history
availability must be verified rather than assumed.

**Why:** Suppressed diagnostics left a sandbox attempt inconclusive; asking the
owner for a nonexistent notification did not resolve it.

**How to apply:** Preserve bounded, non-sensitive upstream diagnostics separately
from client errors. A shortcode differing from a common example is a setup
hypothesis, not proof of rejection. Compare actual simulator Test Data without
displaying or silently replacing saved credentials, and retain unknown attempts.

## Owner-confirmed Daraja Test Data comparison

On 13 October 2026 the owner confirmed “Setup matches”: the saved shortcode and
passkey match Daraja sandbox Test Data and M-Pesa Express Sandbox is enabled.

**Why:** This direct confirmation supersedes suspicion based only on a shortcode
different from the common example.

**How to apply:** Do not silently substitute default merchant values or repeat
the same setup question without evidence of a change. Configuration confirmation
is not proof that an STK request was accepted or a pending payment resolved.
