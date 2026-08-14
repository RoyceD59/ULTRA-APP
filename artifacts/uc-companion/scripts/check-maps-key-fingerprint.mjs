#!/usr/bin/env node
/**
 * Guard: Google Maps Android key restriction vs. Android signing identities.
 *
 * Production ships as an AAB via Google Play with Play App Signing, so devices
 * receive an APK signed by **Google Play's app-signing certificate** — NOT the
 * EAS/release (upload) keystore. The Maps key's Android-app restriction in
 * Google Cloud Console must therefore be pinned to the **Play app-signing
 * SHA-1** (from Play Console → Setup → App signing). The upload keystore only
 * authenticates uploads to Play; it is tracked here separately so a rotation
 * of either identity is detected, but only the Play app-signing cert is the
 * Maps-restriction identity.
 *
 * This script compares current fingerprints against the record in
 * security/maps-key-fingerprints.json and fails loudly on any drift, and
 * fails until the Google Cloud restriction is explicitly confirmed for the
 * recorded Play app-signing fingerprint.
 *
 * Usage (from artifacts/uc-companion):
 *   Check the Play app-signing cert (the Maps restriction identity):
 *     node scripts/check-maps-key-fingerprint.mjs --identity play-signing --fingerprint <SHA-1 from Play Console>
 *   Check the EAS upload keystore (drift tracking only):
 *     node scripts/check-maps-key-fingerprint.mjs --identity upload --fingerprint <SHA-1 from eas credentials>
 *     node scripts/check-maps-key-fingerprint.mjs --identity upload --keystore upload.keystore --alias <alias> --storepass <pass>
 *   Record a new fingerprint after an intentional rotation:
 *     ... --update       (for play-signing, marks gcpRestrictionConfirmed=false until confirmed)
 *   Confirm the Google Cloud Console restriction matches the recorded play-signing SHA-1:
 *     node scripts/check-maps-key-fingerprint.mjs --confirm-restriction
 *
 * Env: MAPS_FP_RECORD overrides the record file path (used by tests).
 * Exit codes: 0 = OK, 1 = mismatch / restriction unconfirmed / error.
 * Full rotation runbook: docs/maps-key-rotation-runbook.md
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const RECORD_PATH = process.env.MAPS_FP_RECORD ?? join(root, "security", "maps-key-fingerprints.json");
const SHA1_RE = /^([0-9A-F]{2}:){19}[0-9A-F]{2}$/;
const IDENTITIES = {
  "play-signing": {
    key: "playAppSigning",
    label: "Play app-signing certificate (Maps restriction identity)",
    restriction: true,
  },
  upload: {
    key: "uploadKey",
    label: "EAS upload keystore (upload identity only — NOT the Maps restriction)",
    restriction: false,
  },
  development: {
    key: "development",
    label: "Development/debug keystore (dev builds only — interim identity until the first production build exists)",
    restriction: false,
  },
};

const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const flag = (name) => args.includes(`--${name}`);

function fail(msg) {
  console.error(`\n❌ ${msg}\n`);
  process.exit(1);
}

function loadRecord() {
  if (!existsSync(RECORD_PATH)) fail(`Fingerprint record missing: ${RECORD_PATH}`);
  return JSON.parse(readFileSync(RECORD_PATH, "utf8"));
}

function saveRecord(rec) {
  writeFileSync(RECORD_PATH, JSON.stringify(rec, null, 2) + "\n");
}

function normalize(fp) {
  const v = fp.trim().toUpperCase().replace(/[^0-9A-F]/g, "");
  if (v.length !== 40) fail(`Not a valid SHA-1 fingerprint: "${fp}"`);
  return v.match(/.{2}/g).join(":");
}

function fingerprintFromKeystore(keystore, alias, storepass) {
  if (!existsSync(keystore)) fail(`Keystore not found: ${keystore}`);
  const kt = ["-list", "-v", "-keystore", keystore];
  if (alias) kt.push("-alias", alias);
  kt.push("-storepass", storepass ?? "");
  let out;
  try {
    out = execFileSync("keytool", kt, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  } catch (e) {
    fail(`keytool failed (is a JDK installed? wrong password/alias?):\n${e.stderr || e.message}`);
  }
  const m = out.match(/SHA1:\s*([0-9A-F:]{59})/i);
  if (!m) fail("Could not find a SHA1 fingerprint in keytool output.");
  return normalize(m[1]);
}

// ---- main ----
const record = loadRecord();

if (flag("confirm-restriction")) {
  const entry = record.fingerprints.playAppSigning;
  if (!SHA1_RE.test(entry.sha1 ?? "")) {
    fail(
      "No recorded Play app-signing fingerprint to confirm. Run with --identity play-signing --fingerprint <SHA-1> --update first."
    );
  }
  entry.gcpRestrictionConfirmed = true;
  entry.restrictionConfirmedAt = new Date().toISOString();
  saveRecord(record);
  console.log(`✅ Recorded: Google Cloud Console Maps restriction confirmed for Play app-signing SHA-1 ${entry.sha1}`);
  process.exit(0);
}

const identityName = opt("identity") ?? "play-signing";
const identity = IDENTITIES[identityName];
if (!identity) fail(`Unknown --identity "${identityName}". Use "play-signing", "upload", or "development".`);
const entry = record.fingerprints[identity.key] ?? (record.fingerprints[identity.key] = { sha1: null, updatedAt: null });

let current;
if (opt("keystore")) {
  if (identity.restriction) {
    fail(
      "The Play app-signing certificate has no local keystore — Google holds it. " +
        "Copy its SHA-1 from Play Console → Setup → App signing and pass it with --fingerprint. " +
        "(--keystore is only valid with --identity upload or --identity development.)"
    );
  }
  current = fingerprintFromKeystore(opt("keystore"), opt("alias"), opt("storepass"));
} else if (opt("fingerprint")) {
  current = normalize(opt("fingerprint"));
} else {
  fail("Provide --fingerprint <SHA-1> (or --keystore for --identity upload). See header for usage.");
}

console.log(`Identity: ${identity.label}`);
console.log(`Current SHA-1:   ${current}`);
console.log(`Recorded SHA-1:  ${entry.sha1 ?? "(none recorded)"}`);

if (flag("update")) {
  const changed = entry.sha1 !== current;
  entry.sha1 = current;
  entry.updatedAt = new Date().toISOString();
  if (identity.restriction && changed) {
    entry.gcpRestrictionConfirmed = false;
    delete entry.restrictionConfirmedAt;
  }
  saveRecord(record);
  console.log(`\n📝 Recorded new ${identityName} fingerprint.`);
  if (identity.restriction && changed) {
    console.log(
      `\n⚠️  ACTION REQUIRED — the Play app-signing fingerprint changed. Update the Maps key restriction NOW:\n` +
        `   1. Google Cloud Console → APIs & Services → Credentials → GOOGLE_MAPS_ANDROID_KEY\n` +
        `   2. Application restrictions → Android apps → entry for ${record.package}\n` +
        `   3. Add the new SHA-1: ${current}\n` +
        `      (keep the old SHA-1 listed until every device has updated past builds signed with it)\n` +
        `   4. If a key was lost/compromised, ROTATE the Maps API key itself (new key, update EAS secret, delete old key).\n` +
        `   5. Then run: node scripts/check-maps-key-fingerprint.mjs --confirm-restriction\n` +
        `   Runbook: docs/maps-key-rotation-runbook.md`
    );
    process.exit(1); // fail until restriction is confirmed
  }
  if (identityName === "upload" && changed) {
    console.log(
      `\nℹ️  Upload keystore changed. This does NOT change the Maps restriction (Play App Signing re-signs releases),\n` +
        `   but verify the Play app-signing SHA-1 is unchanged in Play Console → Setup → App signing, and re-run the\n` +
        `   play-signing check. If Google also reset the app-signing key, follow the runbook rotation procedure.`
    );
  }
  if (identityName === "development" && changed) {
    console.log(
      `\nℹ️  Development keystore recorded. For Maps tiles to load in dev/debug builds, add this SHA-1 as an\n` +
        `   ADDITIONAL entry under the Android-apps restriction for ${record.package} in Google Cloud Console.\n` +
        `   This is an interim identity — the production release remains blocked until the Play app-signing\n` +
        `   fingerprint is recorded and confirmed (see docs/maps-key-rotation-runbook.md).`
    );
  }
  process.exit(0);
}

if (!SHA1_RE.test(entry.sha1 ?? "")) {
  fail(
    `No ${identityName} fingerprint recorded yet. Record the current one with --update` +
      (identity.restriction ? `, set the Google Cloud restriction, then --confirm-restriction.` : `.`)
  );
}

if (current !== entry.sha1) {
  fail(
    identity.restriction
      ? `PLAY APP-SIGNING CERTIFICATE CHANGE DETECTED — current SHA-1 does not match the recorded one.\n` +
          `Production Maps requests WILL BE REJECTED until the Google Cloud Console restriction includes the new SHA-1.\n` +
          `Follow docs/maps-key-rotation-runbook.md, then re-run with --update and --confirm-restriction.`
      : identityName === "development"
        ? `DEVELOPMENT KEYSTORE CHANGE DETECTED — current SHA-1 does not match the recorded one.\n` +
            `If the debug keystore was intentionally regenerated, re-run with --update and add the new SHA-1 to the\n` +
            `Maps key's Android-apps restriction so dev builds keep loading tiles.\n` +
            `Runbook: docs/maps-key-rotation-runbook.md`
        : `UPLOAD KEYSTORE CHANGE DETECTED — current SHA-1 does not match the recorded one.\n` +
            `Verify in Play Console that the app-signing certificate is unchanged, then re-run with --update.\n` +
            `Runbook: docs/maps-key-rotation-runbook.md`
  );
}

if (identity.restriction && !entry.gcpRestrictionConfirmed) {
  fail(
    `Fingerprint matches, but the Google Cloud Console Maps restriction has NOT been confirmed for it.\n` +
      `Verify the Android-apps restriction for ${record.package} lists ${entry.sha1}, then run:\n` +
      `  node scripts/check-maps-key-fingerprint.mjs --confirm-restriction`
  );
}

console.log(`\n✅ OK — ${identityName} fingerprint matches the record${identity.restriction ? " and the GCP Maps restriction is confirmed" : ""}.`);
