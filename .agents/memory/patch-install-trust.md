---
name: Patched install trust
description: Plain frozen pnpm installs trust existing hash-qualified patch directories; inactive patches persist unless bytes are verified
---
A plain `pnpm install --frozen-lockfile` reports "Already up to date" and keeps any existing `name@ver_patch_hash=<hash>` directory, even if its bytes lack the patch. Only `--force` replaces it.

**Why:** a security-review stage once failed its cache guard; fresh cold installs of the same archive all passed, and the original unpatched directory was never reproduced.

**How to apply:** never treat a directory name, exit 0 or a preparation marker as proof. Run `security-patch-installation.mjs verify --stage` (builder does this before the marker and on reuse). Reproductions need ~3 GB each; two concurrent cold stores hit the workspace quota (EDQUOT), so delete the first before the second.
