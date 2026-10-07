---
name: API fetch stubs and outbound guard assertions
description: Keep local test HTTP separate from provider mocks, and classify business calls when testing fail-closed guards.
---

Keep application-test HTTP transport independently controllable from outbound
provider doubles.

**Why:** The same global function otherwise intercepts the test client itself,
so the test can fail before exercising the application.

**How to apply:** Use separate transport handles/adapters for local client
requests and provider interactions.

When testing rejection before pricing, fulfillment or payment, count those
specific business endpoints rather than every global fetch.

**Why:** Rejected requests can still legitimately perform identity/framework
checks. Those calls do not establish that pricing, fulfillment or money moved.

**How to apply:** Assert the rejection response, no matching pricing/fulfillment/
money-provider calls, and no new order or retry anchor. Do not suppress legitimate
authorization checks merely to make a zero-global-fetch assertion pass.
