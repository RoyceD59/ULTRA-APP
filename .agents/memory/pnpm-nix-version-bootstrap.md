---
name: pnpm version bootstrap under Nix
description: Automatic pnpm version management can recurse through the provisioned binary and exhaust workspace processes.
---

Use the provisioned pnpm binary in this workspace; treat a pnpm upgrade as an explicit toolchain change rather than enabling automatic version bootstrap.

**Why:** When the declared package-manager version differed from the provisioned Nix binary, pnpm's self-install repeatedly invoked the same provisioned binary. Concurrent workflows exhausted the process/thread limit, causing unrelated shell commands and Node startup to fail.

**How to apply:** Before changing the package-manager pin or reenabling automatic version management, verify that bootstrap resolves to the newly installed executable rather than recursing through the Nix wrapper. Do not interpret resource-exhaustion failures across unrelated workflows as application bugs.