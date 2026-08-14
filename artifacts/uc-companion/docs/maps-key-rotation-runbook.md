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

## First production setup (still pending)

The record currently has `sha1: null` for both identities because the app has not been
uploaded to Play yet. Once the first AAB is uploaded and Play App Signing is enrolled:
record the Play app-signing SHA-1 (`--update`), add the restriction in Google Cloud
Console, `--confirm-restriction`, and record the upload-key SHA-1
(`--identity upload --update`).
