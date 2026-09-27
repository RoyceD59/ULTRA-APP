# Runbook: Maps key rotation & re-restriction on signing-key change

The `GOOGLE_MAPS_ANDROID_KEY` has an **Android apps** application restriction in Google
Cloud Console pinned to the package name (`com.ultraclean.companion`) and a **SHA-1
certificate fingerprint**. Getting the *right* certificate matters:

## Which certificate signs what (Play App Signing)

Production is submitted as an **AAB via Google Play** (`eas.json` → production →
`buildType: "aab"`). With **Play App Signing**, Google re-signs the APKs delivered to
devices with **Google Play's app-signing certificate** — not the EAS upload keystore.

| Identity | Who holds it | SHA-1 source | Role |
|---|---|---|---|
| **Play app-signing certificate** | Google | Play Console → Setup → App signing → "App signing key certificate" | **The SHA-1 the Maps restriction must list.** Signs what users install. |
| EAS upload keystore | EAS (Expo) | `eas credentials` (Android → production → Keystore), or `keytool -list -v` | Authenticates uploads to Play only. **Not** the Maps restriction identity. Losing it needs an upload-key reset with Google, but does not change the Maps restriction. |
| Debug keystore | dev machines / EAS dev builds | `keytool` on the debug keystore | Add as a *second* SHA-1 entry if Maps must work in dev/internal APK builds. |

If either key is rotated/replaced, drift must be caught immediately: a stale restriction
means production Maps requests are **rejected**; a leaked key with a still-valid entry
means **billable abuse**.

## The guard script

`scripts/check-maps-key-fingerprint.mjs` compares current fingerprints against the record
in `security/maps-key-fingerprints.json` (committed) and exits 1 on any drift. For the
Play app-signing identity it also fails until the Google Cloud restriction has been
explicitly confirmed. Automated tests: `scripts/__tests__/check-maps-key-fingerprint.test.mjs`
(run via `pnpm --filter @workspace/uc-companion test`).

```bash
# From artifacts/uc-companion:

# The Maps restriction identity — SHA-1 copied from Play Console → Setup → App signing:
node scripts/check-maps-key-fingerprint.mjs --fingerprint "AA:BB:...:99"          # check
node scripts/check-maps-key-fingerprint.mjs --fingerprint "AA:BB:...:99" --update # record after rotation
node scripts/check-maps-key-fingerprint.mjs --confirm-restriction                 # after updating GCP console

# The EAS upload keystore (drift tracking only):
node scripts/check-maps-key-fingerprint.mjs --identity upload --fingerprint "..." [--update]
node scripts/check-maps-key-fingerprint.mjs --identity upload --keystore upload.keystore --alias <a> --storepass <p>
```

Run the play-signing check as part of the pre-release checklist before every production
Android build. It only passes when the recorded SHA-1 matches Play Console **and** the
restriction has been confirmed.

## Automated guards (CI and EAS hook)

Two gates enforce the fingerprint check before every production Android submission.

### Why a persistent stored secret is not enough

After Google rotates the Play app-signing certificate, the new SHA-1 appears in Play
Console. Any secret or environment variable set before the rotation still holds the old
value — so a check that compares a stored secret against a stored record will pass even
though Maps is now broken for users. **The SHA-1 must be retrieved fresh from Play Console
immediately before each submission and attested by the operator.**

### 1. GitHub Actions — `maps-fingerprint-check` workflow (primary submission gate)

`.github/workflows/maps-fingerprint-check.yml` has two jobs:

**`record-health` (push to main)** — structural sanity check only. Verifies that
`security/maps-key-fingerprints.json` has a recorded Play SHA-1 and that
`gcpRestrictionConfirmed` is `true`. Catches accidental edits; cannot detect a cert
rotation. Non-blocking early warning.

**`pre-submit-gate` (workflow_dispatch)** — the actual submission gate. Before every
production Android submission, the operator dispatches this workflow and enters the current
Play app-signing SHA-1 in the required input field. The workflow compares that freshly-
entered value against the committed record and fails if they differ or the restriction is
unconfirmed.

**How to run before each production submission:**
1. Open Play Console → (your app) → Setup → App signing → copy the SHA-1 fingerprint.
2. In GitHub → Actions → `Maps key fingerprint check` → `Run workflow`.
3. Paste the SHA-1 into the `play_signing_sha1` input field and click **Run workflow**.
4. Wait for the workflow to go green, then proceed with `eas submit`.

### 2. EAS `eas-build-pre-install` hook (fail-closed secondary gate)

`scripts/eas-build-maps-check.mjs` is registered as the `eas-build-pre-install` npm script
in `package.json`. EAS runs it before the build starts. For production Android builds it
is **fail-closed**: if `PLAY_APP_SIGNING_SHA1` is not set, the build exits 1 immediately.

`PLAY_APP_SIGNING_SHA1` is managed transiently by the GitHub Actions pipeline:
- **Before** `eas build`: the CI job creates the EAS secret set to the fresh operator-supplied SHA-1.
- **After** the build (always, even on failure): the CI job deletes the EAS secret.

This means the secret is absent between releases. Any developer who runs
`eas build --platform android --profile production` directly (outside the CI pipeline)
will hit the fail-closed hook and be blocked.

**Do NOT create `PLAY_APP_SIGNING_SHA1` as a persistent EAS project secret.** The CI
pipeline manages it transiently. A persistent value would become stale after a cert rotation
and give the hook a false pass.

### 3. Submit wrapper script (local testing only)

`scripts/submit-android.mjs` / `pnpm submit:android` wraps `eas submit` with a mandatory
pre-flight fingerprint check. For production releases **always use the GitHub Actions
pipeline** — this wrapper is for local testing and ad-hoc scenarios only:

```bash
PLAY_APP_SIGNING_SHA1="<SHA-1 from Play Console → Setup → App signing>" \
  pnpm submit:android [-- --id <build-id>]
```

## Rotation procedure

### A. Play app-signing key changed (Google key upgrade/reset — the case that breaks Maps)

1. Copy the new SHA-1 from Play Console → Setup → App signing.
2. Run the guard with `--update`. It records the new fingerprint, flags the restriction
   unconfirmed, and prints the console steps.
3. In [Google Cloud Console → Credentials](https://console.cloud.google.com/apis/credentials),
   open the Maps key → Application restrictions → Android apps → `com.ultraclean.companion`:
   **add** the new SHA-1. **Keep the old SHA-1 listed during migration** — devices still on
   builds signed with the old certificate keep working until everyone has updated; remove
   it only after the old builds are retired.
4. If a key was lost or compromised: also rotate the Maps API key itself — create a new
   key with the same restriction, update the `GOOGLE_MAPS_ANDROID_KEY` EAS secret /
   environment variable, then delete the old key.
5. Run `--confirm-restriction`, then the plain check — it must print ✅ before shipping.

### B. EAS upload keystore changed (does not itself break Maps)

1. Run `--identity upload ... --update` to record the new upload fingerprint.
2. Verify in Play Console → Setup → App signing that the **app-signing** SHA-1 is
   unchanged; if Google reset it too, follow procedure A.

## Verification — performed 2026-08-14

Detection behaviour is covered by 12 automated tests (initial registration, unconfirmed
restriction, confirmation, rotation/mismatch for both identities, fingerprint
normalization, malformed input, keystore-mode rejection for play-signing). The
keystore-file path (`--identity upload --keystore`) was additionally exercised end-to-end
with two locally generated staging keystores: check passed for the recorded keystore and
failed with "CHANGE DETECTED" for a substituted one.

The Google-side behaviour (requests rejected on fingerprint mismatch, accepted after the
restriction is updated) is enforced by Google's Android-app restriction and must be
spot-checked on a Play-distributed build (internal testing track is enough, since Play
App Signing signs internal-track builds with the same app-signing certificate): install
from the track, open the Locations map screen, and confirm tiles load. With a wrong SHA-1
the map renders blank/grey and `adb logcat` shows an `Authorization failure` from the
Google Maps SDK.

### Internal-testing-track spot-check — **PENDING** (no production build yet)

As of 2026-08-17, `security/maps-key-fingerprints.json` still shows
`playAppSigning.sha1: null` and `gcpRestrictionConfirmed: false`. No AAB has been
submitted to Google Play yet, so the Play app-signing certificate does not exist and
the internal-testing-track spot-check (step 9 of the first-production-setup checklist
below) **cannot be performed yet**.

**Pre-conditions that must all be met before the spot-check:**

1. First AAB uploaded to Google Play and enrolled in Play App Signing.
2. Play app-signing SHA-1 retrieved from Play Console → Setup → App signing and recorded
   via `node scripts/check-maps-key-fingerprint.mjs --fingerprint "<SHA-1>" --update`.
3. That SHA-1 added to the Maps key restriction in Google Cloud Console.
4. Restriction confirmed via `node scripts/check-maps-key-fingerprint.mjs --confirm-restriction`
   (sets `gcpRestrictionConfirmed: true`).
5. Internal-testing-track build promoted / re-built so that the Play-signed APK is
   available for install from the Play Store.

**How to complete the spot-check when those conditions are met:**

1. Install the internal-testing-track build on a physical Android device via the Play Store.
2. Open the Locations map screen.
3. Confirm map tiles load visibly (not blank or grey).
4. Run `adb logcat | grep -i "authorization"` — no `Authorization failure` should appear
   from the Google Maps SDK.
5. Update this section with the result and the date, replacing the PENDING notice above.

## First production setup (action required — no Play build exists yet)

> **Status:** `security/maps-key-fingerprints.json` has `sha1: null` for both
> `playAppSigning` and `uploadKey`. The Maps restriction is NOT locked to the production
> certificate yet. Complete every step below immediately after the first AAB is uploaded.

### Step-by-step checklist

**Prerequisites:** first AAB submitted to Google Play → enrolled in Play App Signing.

1. **Get the Play app-signing SHA-1.**
   Play Console → (your app) → Setup → App signing → "App signing key certificate" section
   → copy the SHA-1 fingerprint (format: `AA:BB:CC:…:ZZ`).

2. **Record the Play app-signing fingerprint** (from `artifacts/uc-companion`):
   ```bash
   node scripts/check-maps-key-fingerprint.mjs \
     --identity play-signing \
     --fingerprint "<SHA-1 from step 1>" \
     --update
   ```
   The script will print `⚠️ ACTION REQUIRED` and exit 1 — that is expected until step 4.

3. **Get the EAS upload-keystore SHA-1** (separate identity, drift tracking only):
   ```bash
   eas credentials   # Android → production → Keystore → show fingerprints
   ```
   Or extract from the keystore file directly:
   ```bash
   keytool -list -v -keystore <upload.keystore> -alias <alias> -storepass <pass>
   ```

4. **Add the Play app-signing SHA-1 to the Maps key restriction in Google Cloud Console.**
   [Cloud Console → APIs & Services → Credentials](https://console.cloud.google.com/apis/credentials) →
   open `GOOGLE_MAPS_ANDROID_KEY` → Application restrictions → Android apps →
   entry for `com.ultraclean.companion`:
   - **Add** the new Play app-signing SHA-1 (from step 1).
   - Keep the development SHA-1 (`AE:C5:96:4B:D2:7B:8D:DB:29:ED:CE:53:E9:9C:A7:13:A4:3E:FD:0D`)
     listed for now — you will remove it explicitly in step 7 once production is confirmed working.

5. **Confirm the restriction is set:**
   ```bash
   node scripts/check-maps-key-fingerprint.mjs --confirm-restriction
   ```
   This marks `gcpRestrictionConfirmed: true` in the JSON and exits 0. The script will
   also remind you to remove the development entry (step 7).

6. **Record the upload-keystore fingerprint:**
   ```bash
   node scripts/check-maps-key-fingerprint.mjs \
     --identity upload \
     --fingerprint "<SHA-1 from step 3>" \
     --update
   ```

7. **Remove the development SHA-1 from the Maps key restriction** (security hardening).

   The debug keystore SHA-1 was added as an interim entry so Maps tiles load in local
   dev builds. Now that production is confirmed, it must be removed — any device that
   has the standard Android debug keystore (auto-generated with the well-known password
   `android`) can otherwise bill against this Maps key.

   a. In [Google Cloud Console → Credentials](https://console.cloud.google.com/apis/credentials),
      open `GOOGLE_MAPS_ANDROID_KEY` → Application restrictions → Android apps →
      entry for `com.ultraclean.companion`. **Delete** the development SHA-1:
      `AE:C5:96:4B:D2:7B:8D:DB:29:ED:CE:53:E9:9C:A7:13:A4:3E:FD:0D`

   b. Mark it as removed in the record:
      ```bash
      node scripts/check-maps-key-fingerprint.mjs --remove-dev-restriction
      ```
      This sets `development.gcpEntryRemoved = true` in `security/maps-key-fingerprints.json`
      and exits 0. Future `--fingerprint` checks will no longer warn about the dev entry.

   c. **If dev builds still need Maps tiles**, provision a separate Maps API key in
      Google Cloud Console restricted only to the debug SHA-1 and set it as an EAS
      dev-build secret (e.g. `GOOGLE_MAPS_ANDROID_KEY_DEV`). Do not re-add the debug
      SHA-1 to the production key.

8. **Run the full check — must pass before shipping:**
   ```bash
   node scripts/check-maps-key-fingerprint.mjs \
     --fingerprint "<Play app-signing SHA-1>"
   # Expected: ✅ OK — play-signing fingerprint matches the record and the GCP Maps restriction is confirmed.
   # (No ⚠️ ACTION RECOMMENDED warning after step 7b is done.)
   ```

9. **Spot-check on the internal-testing-track build.**
   Install from the internal track, open the Locations map screen, and confirm tiles load.
   A blank/grey map with `Authorization failure` in `adb logcat` means the SHA-1 in the
   GCP restriction does not match the Play app-signing certificate — revisit step 4.

10. **Commit `security/maps-key-fingerprints.json`** (updated by the script) so the record
    is preserved in version control.

## Interim: development credentials (recorded 2026-08-14)

Per team decision, development proceeds on **development credentials** until the first
production build exists. The standard Android debug keystore
(`~/.android/debug.keystore`, alias `androiddebugkey` — auto-generated by Android
tooling) is tracked as a third identity:

```bash
node scripts/check-maps-key-fingerprint.mjs --identity development \
  --keystore ~/.android/debug.keystore --alias androiddebugkey --storepass android [--update]
```

For Maps tiles to load in dev/debug builds, the recorded development SHA-1 must be added
as an **additional** entry under the Android-apps restriction for
`com.ultraclean.companion` in Google Cloud Console. This does not weaken the release
gate: the pre-release play-signing check still fails until the real Play app-signing
fingerprint is recorded and confirmed. Remove the development SHA-1 from the restriction
once production credentials are in place if dev builds no longer need live Maps.
