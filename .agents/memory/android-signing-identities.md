---
name: Android signing identities — interim development credentials
description: Team decision on signing identities for the UC Companion Android app while no production build exists
---

# Interim development credentials for Android signing

**Rule:** Until the first EAS production build / Play upload exists, development proceeds on the standard Android debug keystore (`~/.android/debug.keystore`, alias `androiddebugkey`), tracked as the `development` identity in the Maps-key fingerprint record. The production identities (`playAppSigning`, `uploadKey`) stay null and the pre-release play-signing guard fails closed — recording dev credentials must never unblock release.

**Why:** The Play app-signing certificate physically does not exist until Google generates it at the first Play upload; the user explicitly directed to proceed using development credentials until the first EAS build exists.

**How to apply:** For dev-build Maps tiles, the development SHA-1 must be added as an additional entry in the Google Cloud Maps-key Android restriction (user console action). When the first AAB is uploaded, record the real production fingerprints per the rotation runbook and consider removing the dev SHA-1 from the restriction.
