---
name: Expo SDK-aligned package pins
description: Why every expo-* package in uc-companion must match the installed Expo SDK line (expo-doctor as the gate)
---

Rule: every `expo-*` package version must match what the installed Expo SDK expects (`npx expo-doctor` / `npx expo install --check` must pass). A caret range can pull an SDK-aligned major (e.g. `expo-notifications@57.x`, which belongs to a newer SDK) even though the project is on SDK 54 (expects `~0.32.x`).

**Why:** an SDK-mismatched expo package's JS calls a native API surface that doesn't exist in Expo Go's bundled native module → hard crash at launch on real devices, while web, typecheck, tests, and even `expo export` all still pass. It also drags in duplicate transitive expo packages (e.g. a second `expo-constants`).

**How to apply:** pin expo packages with `~` to the SDK-expected version; when a device launch crashes but bundles build fine, run `npx expo-doctor` first.

Expo Doctor checks the installed dependency graph, not merely the manifest and
lockfile. Check all three before changing version pins.

**Why:** A stale local installation failed Expo Doctor even though the committed
manifest and lockfile already contained every required SDK patch.

**How to apply:** When the recorded versions are correct, restore the frozen
lockfile installation first instead of introducing additional dependency changes.
Stale installations can remain after newer pins arrive from a merge. Rerun
Expo Doctor after installation without suppressing its checks.

Preserve the dependency release-age safety window when newly recommended Expo
patches require a build dependency that is not yet eligible. Do not add an
age-rule exception merely to make Expo Doctor pass.

**Why:** The owner chose to wait for the safety window rather than exempt a
newly released official Expo build dependency.

**How to apply:** Keep the manifest and lockfile consistent while an update is
deferred. Report the earliest retry time and incomplete validation explicitly;
do not substitute compatibility-check success for dependency safety.
