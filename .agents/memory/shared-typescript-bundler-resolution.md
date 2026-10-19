---
name: Shared TypeScript bundler resolution
description: Type checking and server tests do not establish Metro's resolution of shared source imports.
---

Shared TypeScript source consumed directly by Expo Metro should use extensionless
local TypeScript imports where the package's compiler mode permits them.

**Why:** TypeScript and server-oriented TSX tests resolved a relative `.js`
specifier to its `.ts` implementation, while native Metro treated it as a
missing file. All those earlier checks passed despite a failing native build.

**How to apply:** Check the actual consuming bundler, not just emitted
declarations or Node tests, when adding shared browser/native helpers. Keep
explicit `.js` specifiers where a package genuinely requires compiled Node ESM;
do not mechanically change every workspace import.