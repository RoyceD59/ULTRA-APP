---
name: pnpm automatic version switching on Nix
description: Avoid recursive package-manager installs when the pinned pnpm version differs from the Nix-provided executable.
---

Disable pnpm automatic package-manager-version management in this Replit environment when importing a repository with a different pinned version. Keep the repository pin for external CI.

**Why:** The Nix-provided pnpm attempted to install the pinned pnpm using itself, recursively spawning installations until the container reached its thread/process limit. Codegen and checks failed before running.

**How to apply:** Preserve the project-level `manage-package-manager-versions=false` setting. If checks cannot fork or Node cannot create a worker thread, inspect command lines before blaming tests; stop only the recursive installer processes. The installed pnpm can consume the compatible frozen lockfile; external CI explicitly installs the pinned version.

Isolated benchmark/source copies must inherit `.npmrc` before invoking pnpm; do
not share writable `node_modules` links with a copy that can bootstrap its own
package manager.

**Why:** A temporary baseline tree without that setting triggered version
bootstrap through a shared dependency link and changed the real workspace's
installation, breaking Metro resolution despite no dependency changes in the task.

**How to apply:** Copy package-manager configuration before any command in a
temporary tree, or invoke the already-installed CLI directly. Keep baseline
outputs outside the deliverable and use the frozen lockfile to repair unintended
installation changes without changing package versions.