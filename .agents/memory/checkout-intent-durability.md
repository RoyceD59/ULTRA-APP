---
name: Checkout intent durability
description: Preserve retry identity across reload and isolate every checkout draft and late response by account.
---
Persist the original account-scoped checkout intent before starting payment or order submission. Restore it read-only; an unknown outcome must not become a fresh payment.

**Why:** Browser/native restarts lose in-memory references while the payment or remote order may already exist. Reconstructing a new identity can repeat a financial action.

**How to apply:** Keep the original basket, transaction contact, method and quote until confirmation or server-authorized cancellation. On confirmed completion, retire the frozen state so a genuinely new purchase has a new identity. On account changes, clear private payment and promotion drafts, cancel old quote results, and check the captured account after asynchronous work before changing UI or storage.

Preserve anonymous checkout using a separate device-local recovery namespace; absence of a signed-in account must not leave readiness permanently false or access a customer's saved checkout.

**Why:** Guest checkout remains supported; recovery must not silently impose a new authentication requirement.

**How to apply:** Load and persist guest intents through the same safety checks, isolate them from every authenticated account, and never attach guest purchases to an account solely because sign-in occurs.

Recovery must have a server-authorized exit for both resolved receipts and definitive preflight failures. A read reporting no order is insufficient authorization to discard an intent.

**Why:** A delayed original request can arrive after that read. Clearing its identity without an atomic retirement barrier can permit a second financial attempt; retaining a resolved receipt forever blocks future purchases.

**How to apply:** Retire confirmed receipts only from owned server evidence. Safely cancel unstarted or independently terminal failed attempts before enabling editing, and keep delayed retired requests blocked under the same creation lock. Unknown outcomes remain frozen and actionable.

A rejected signed session must never be reinterpreted as guest checkout.

**Why:** Retry keys are owner-scoped. Reusing a signed customer's key in the anonymous namespace can create a second financial attempt rather than recovering the first.

**How to apply:** Allow guests only when authorization is absent; reject invalid supplied credentials before initialization, confirmation or retirement. Keep saved identities in their original account namespace.