---
name: Expo password-reset deep links
description: Query-parameter constraint for Ultra-Clear Companion password reset deep links.
---

Use `resetToken` as the deep-link query parameter for Companion password resets. Keep the raw reset token in the query string only for the client-to-API handoff; the API remains responsible for hashing and validating it.

**Why:** In the Expo web preview, a query parameter named `token` is intercepted before the reset screen mounts, producing a blank page despite a valid route. `resetToken` reaches the screen normally.

**How to apply:** Generate Companion deep links such as `uc-companion://auth/forgot-password?resetToken=...`. The API's conventional web reset endpoint may continue to use its own `token` parameter.