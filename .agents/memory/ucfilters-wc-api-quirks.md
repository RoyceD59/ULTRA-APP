---
name: ucfilters.com WooCommerce API quirks
description: Live WC REST API works but has host-level quirks that break naive clients (PHP notices before JSON, WAF blocking non-browser user agents).
---

# ucfilters.com WooCommerce API quirks

1. **PHP notices prepended to JSON.** The host runs with WordPress debug notices enabled, so `wp-json/wc/v3/*` responses may begin with HTML notice markup (`<br /><b>Notice</b>: _load_textdomain_just_in_time ...`) before the JSON body. `response.json()` fails on these.
   **How to apply:** never parse WC responses with `res.json()` directly — scan for the first `{` or `[` and `JSON.parse` from there (see `parseWcJson` in the api-server WC helpers). Any new WC call must go through those helpers.

2. **WAF blocks non-browser user agents.** Direct requests with default `python-urllib` UA get HTTP 403; the same request with `curl -A "Mozilla/5.0"` (or Node's default fetch UA) succeeds.
   **How to apply:** when debugging the live store from the shell, always pass a browser-like User-Agent.

3. **Live products lack `filter_lifespan_days` meta.** Mock catalogue products carried `lifespanDays`; live WC products return 0 unless the team adds a `filter_lifespan_days` meta field per product in WooCommerce — without it the mobile filter-replacement tracker treats products as non-trackable.
