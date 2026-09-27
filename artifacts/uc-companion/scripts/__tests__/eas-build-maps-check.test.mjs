/**
 * Tests for scripts/eas-build-maps-check.mjs
 *
 * Covers:
 *  - Skip for non-android platform
 *  - Skip for non-production profile
 *  - Skip when neither platform nor profile is set (local / CI non-EAS context)
 *  - Fail loudly when PLAY_APP_SIGNING_SHA1 is absent on a production-android build
 *  - Fail when the fingerprint mismatches the committed record
 *  - Pass when fingerprint matches the record and the restriction is confirmed
 *  - Fail when fingerprint matches but restriction is not yet confirmed
 */
import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HOOK = join(dirname(fileURLToPath(import.meta.url)), "..", "eas-build-maps-check.mjs");

const FP_GOOD = "0B:F7:73:4C:C4:9F:C4:B2:FC:AE:CC:5E:C5:DF:F6:E2:2C:36:C6:A0";
const FP_BAD  = "7A:B7:C2:F0:B4:01:95:34:2A:07:23:1A:2D:74:93:DD:54:58:90:92";

let recordPath;

/** Run the hook with arbitrary env overrides. */
function run(env = {}) {
  try {
    const stdout = execFileSync(process.execPath, [HOOK], {
      encoding: "utf8",
      env: {
        ...process.env,
        // Inject a fresh MAPS_FP_RECORD for every run so the hook
        // reads our temp file, not the real security/maps-key-fingerprints.json.
        MAPS_FP_RECORD: recordPath,
        ...env,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { code: 0, out: stdout };
  } catch (e) {
    return { code: e.status ?? 1, out: `${e.stdout ?? ""}${e.stderr ?? ""}` };
  }
}

/** Write a fingerprint record to the temp file. */
function setRecord(overrides = {}) {
  const base = {
    package: "com.ultraclean.companion",
    fingerprints: {
      playAppSigning: {
        sha1: FP_GOOD,
        updatedAt: new Date().toISOString(),
        gcpRestrictionConfirmed: true,
        restrictionConfirmedAt: new Date().toISOString(),
      },
    },
  };
  // Deep-merge overrides.fingerprints.playAppSigning
  if (overrides.playAppSigning) {
    Object.assign(base.fingerprints.playAppSigning, overrides.playAppSigning);
  }
  writeFileSync(recordPath, JSON.stringify(base, null, 2));
}

beforeEach(() => {
  recordPath = join(mkdtempSync(join(tmpdir(), "eas-hook-test-")), "record.json");
  setRecord();
});

// ── Skipping behaviour ────────────────────────────────────────────────────────

describe("eas-build-maps-check — skip cases", () => {
  test("skips when EAS_BUILD_PLATFORM is ios (regardless of profile)", () => {
    const r = run({ EAS_BUILD_PLATFORM: "ios", EAS_BUILD_PROFILE: "production" });
    assert.equal(r.code, 0, `expected exit 0, got ${r.code}\n${r.out}`);
    assert.ok(r.out.includes("skipped"), `expected 'skipped' in output:\n${r.out}`);
  });

  test("skips when EAS_BUILD_PROFILE is preview (android)", () => {
    const r = run({ EAS_BUILD_PLATFORM: "android", EAS_BUILD_PROFILE: "preview" });
    assert.equal(r.code, 0, `expected exit 0, got ${r.code}\n${r.out}`);
    assert.ok(r.out.includes("skipped"), `expected 'skipped' in output:\n${r.out}`);
  });

  test("skips when EAS_BUILD_PROFILE is development (android)", () => {
    const r = run({ EAS_BUILD_PLATFORM: "android", EAS_BUILD_PROFILE: "development" });
    assert.equal(r.code, 0, `expected exit 0, got ${r.code}\n${r.out}`);
    assert.ok(r.out.includes("skipped"), `expected 'skipped' in output:\n${r.out}`);
  });

  test("skips when neither platform nor profile is set (non-EAS local context)", () => {
    const r = run({
      EAS_BUILD_PLATFORM: undefined,
      EAS_BUILD_PROFILE:  undefined,
      PLAY_APP_SIGNING_SHA1: undefined,
    });
    assert.equal(r.code, 0, `expected exit 0, got ${r.code}\n${r.out}`);
    assert.ok(r.out.includes("skipped"), `expected 'skipped' in output:\n${r.out}`);
  });
});

// ── Production Android path ───────────────────────────────────────────────────

describe("eas-build-maps-check — production android path", () => {
  const prodEnv = { EAS_BUILD_PLATFORM: "android", EAS_BUILD_PROFILE: "production" };

  test("fails (exit 1) with a clear message when PLAY_APP_SIGNING_SHA1 is not set", () => {
    // The hook is fail-closed: PLAY_APP_SIGNING_SHA1 is only set by the
    // GitHub Actions release pipeline (transiently, per build).  A direct
    // `eas build --profile production` without going through CI will not have
    // the secret and must be blocked here.
    const r = run({ ...prodEnv, PLAY_APP_SIGNING_SHA1: undefined });
    assert.equal(r.code, 1, `expected exit 1, got ${r.code}\n${r.out}`);
    assert.ok(
      r.out.includes("PLAY_APP_SIGNING_SHA1"),
      `expected env-var name in error output:\n${r.out}`
    );
    assert.ok(
      r.out.toLowerCase().includes("pipeline") ||
      r.out.toLowerCase().includes("github actions") ||
      r.out.toLowerCase().includes("blocked"),
      `expected reference to CI pipeline or blocked state:\n${r.out}`
    );
  });

  test("fails when the provided fingerprint mismatches the committed record", () => {
    const r = run({ ...prodEnv, PLAY_APP_SIGNING_SHA1: FP_BAD });
    assert.equal(r.code, 1, `expected exit 1, got ${r.code}\n${r.out}`);
    assert.ok(
      r.out.toUpperCase().includes("CHANGE DETECTED") || r.out.includes("does not match"),
      `expected mismatch message in output:\n${r.out}`
    );
  });

  test("fails when fingerprint matches but GCP restriction is not yet confirmed", () => {
    setRecord({ playAppSigning: { gcpRestrictionConfirmed: false, restrictionConfirmedAt: undefined } });
    const r = run({ ...prodEnv, PLAY_APP_SIGNING_SHA1: FP_GOOD });
    assert.equal(r.code, 1, `expected exit 1, got ${r.code}\n${r.out}`);
    assert.ok(
      r.out.includes("NOT been confirmed") || r.out.includes("not confirmed"),
      `expected restriction-unconfirmed message:\n${r.out}`
    );
  });

  test("passes (exit 0) when fingerprint matches and restriction is confirmed", () => {
    const r = run({ ...prodEnv, PLAY_APP_SIGNING_SHA1: FP_GOOD });
    assert.equal(r.code, 0, `expected exit 0, got ${r.code}\n${r.out}`);
    assert.ok(r.out.includes("✅"), `expected ✅ in output:\n${r.out}`);
  });
});
