---
name: Companion SEO scope and measurement
description: Owner approval boundaries and attribution limits for Companion browser SEO.
---

Treat the Companion browser app, private ProjectHub and external WooCommerce/
marketing site as different audit targets. Historical marketing Lighthouse
results are not a Companion baseline without verified hostname, build and route
provenance.

**Why:** The source-only audit covered Companion, but supplied historical
Lighthouse inputs could not confidently be attributed to its code. The external
marketing site's source was not supplied.

**How to apply:** Identify the actual target and record build/configuration before
reporting performance changes. Do not claim scores, LCP gains or package savings
from source inspection or local fixtures.

SEO implementation approval is not approval to change canonical hosts, publish,
run production benchmarks, change security headers or mutate customer data.

**Why:** The owner-review boundary separates public indexing work from changes
that could affect authentication, payments, other hostnames and customer records.

**How to apply:** Keep those operations as explicit approval gates and verify
protected journeys before enabling a new public renderer in production.