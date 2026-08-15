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
