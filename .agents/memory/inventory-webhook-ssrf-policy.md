---
name: Inventory webhook SSRF policy
description: Security policy for ProjectHub's admin-configured n8n inventory webhook.
---

Outbound inventory webhook destinations must be external HTTPS services only. Validate public IP literals without DNS, but resolve every hostname at request time, reject every private/reserved/IANA special-use answer, and pin the connection to a validated address while retaining hostname TLS validation. Redirects must not be followed.

**Why:** String-prefix IPv6 checks and broad global-unicast checks both leave bypasses through link-local and IANA special-purpose ranges; a saved literal must also work at request time without a failing DNS lookup.

**How to apply:** Keep the IPv4/IPv6 deny policy and its boundary regressions in lockstep with IANA special-purpose assignments. Any new configurable outbound HTTP client must use this same resolve-validate-pin pattern rather than a plain fetch.