---
name: Promotions and fulfillment policy
description: Managed service benefits and payment reservation constraints for Companion
---

Companion customers explicitly choose free collection or paid delivery. Free shipping and free water tests are ProjectHub-managed promotion codes, not automatic basket or order-count thresholds.

**Why:** The user explicitly chose this policy.

**How to apply:** Do not introduce threshold benefits or waive an unselected delivery service. The physical-test booking flow has no payment stage; never invent a fee or describe an entitlement as a refund.

Reserve the benefit atomically with the immutable pending checkout before requesting money. A successfully reserved benefit stays valid for that payment's recovery even if the code later expires or is deactivated.

**Why:** Checking the final available use only after charging could leave a customer paid without the promised discount. Requoting a paid retry can also change its total.

**How to apply:** Release a payment reservation only when no attempt began or the provider independently confirms a terminal failure. Pending or unknown provider outcomes must remain bound to the original checkout.

Retry a definitively failed M-Pesa push as a new payment attempt on the same reserved checkout, retaining the previous attempt identity rather than replaying its failed provider response.

**Why:** Reusing a saved failed push response sends the customer back to polling a payment that can never complete.

**How to apply:** Independently confirm terminal failure and atomically replace the attempt; do not consume or release the benefit again.