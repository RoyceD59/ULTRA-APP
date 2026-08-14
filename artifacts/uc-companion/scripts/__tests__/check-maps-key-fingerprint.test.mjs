import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), "..", "check-maps-key-fingerprint.mjs");
const FP_A = "0B:F7:73:4C:C4:9F:C4:B2:FC:AE:CC:5E:C5:DF:F6:E2:2C:36:C6:A0";
const FP_B = "7A:B7:C2:F0:B4:01:95:34:2A:07:23:1A:2D:74:93:DD:54:58:90:92";

let recordPath;

function run(args) {
  try {
    const stdout = execFileSync(process.execPath, [SCRIPT, ...args], {
      encoding: "utf8",
      env: { ...process.env, MAPS_FP_RECORD: recordPath },
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { code: 0, out: stdout };
  } catch (e) {
    return { code: e.status, out: `${e.stdout ?? ""}${e.stderr ?? ""}` };
  }
}

const record = () => JSON.parse(readFileSync(recordPath, "utf8"));

beforeEach(() => {
  recordPath = join(mkdtempSync(join(tmpdir(), "maps-fp-")), "maps-key-fingerprints.json");
  writeFileSync(
    recordPath,
    JSON.stringify({
      package: "com.ultraclean.companion",
      fingerprints: {
        playAppSigning: { sha1: null, updatedAt: null, gcpRestrictionConfirmed: false },
        uploadKey: { sha1: null, updatedAt: null },
      },
    })
  );
});

describe("play-signing identity (Maps restriction)", () => {
  test("fails when nothing recorded yet", () => {
    const r = run(["--fingerprint", FP_A]);
    assert.equal(r.code, 1);
    assert.match(r.out, /No play-signing fingerprint recorded yet/);
  });

  test("initial registration via --update exits 1 with ACTION REQUIRED and records unconfirmed", () => {
    const r = run(["--fingerprint", FP_A, "--update"]);
    assert.equal(r.code, 1);
    assert.match(r.out, /ACTION REQUIRED/);
    assert.equal(record().fingerprints.playAppSigning.sha1, FP_A);
    assert.equal(record().fingerprints.playAppSigning.gcpRestrictionConfirmed, false);
  });

  test("check fails until restriction confirmed, passes after --confirm-restriction", () => {
    run(["--fingerprint", FP_A, "--update"]);
    let r = run(["--fingerprint", FP_A]);
    assert.equal(r.code, 1);
    assert.match(r.out, /NOT been confirmed/);
    r = run(["--confirm-restriction"]);
    assert.equal(r.code, 0);
    r = run(["--fingerprint", FP_A]);
    assert.equal(r.code, 0);
    assert.match(r.out, /✅ OK/);
  });

  test("detects rotation (mismatch) after confirmation", () => {
    run(["--fingerprint", FP_A, "--update"]);
    run(["--confirm-restriction"]);
    const r = run(["--fingerprint", FP_B]);
    assert.equal(r.code, 1);
    assert.match(r.out, /PLAY APP-SIGNING CERTIFICATE CHANGE DETECTED/);
  });

  test("rotation via --update resets confirmation and requires re-confirm", () => {
    run(["--fingerprint", FP_A, "--update"]);
    run(["--confirm-restriction"]);
    const r = run(["--fingerprint", FP_B, "--update"]);
    assert.equal(r.code, 1);
    assert.equal(record().fingerprints.playAppSigning.sha1, FP_B);
    assert.equal(record().fingerprints.playAppSigning.gcpRestrictionConfirmed, false);
    const r2 = run(["--fingerprint", FP_B]);
    assert.equal(r2.code, 1);
    run(["--confirm-restriction"]);
    assert.equal(run(["--fingerprint", FP_B]).code, 0);
  });

  test("--keystore is rejected for play-signing (Google holds the cert)", () => {
    const r = run(["--keystore", "/tmp/nope.keystore"]);
    assert.equal(r.code, 1);
    assert.match(r.out, /no local keystore/);
  });

  test("--confirm-restriction refuses with nothing recorded", () => {
    const r = run(["--confirm-restriction"]);
    assert.equal(r.code, 1);
    assert.match(r.out, /No recorded Play app-signing fingerprint/);
  });

  test("normalizes lowercase/unseparated fingerprints", () => {
    run(["--fingerprint", FP_A, "--update"]);
    run(["--confirm-restriction"]);
    const loose = FP_A.toLowerCase().replaceAll(":", "");
    assert.equal(run(["--fingerprint", loose]).code, 0);
  });

  test("rejects malformed fingerprint", () => {
    const r = run(["--fingerprint", "not-a-sha1"]);
    assert.equal(r.code, 1);
    assert.match(r.out, /Not a valid SHA-1/);
  });
});

describe("upload identity (drift tracking only)", () => {
  test("registers and passes without any restriction confirmation", () => {
    const r = run(["--identity", "upload", "--fingerprint", FP_A, "--update"]);
    assert.equal(r.code, 0);
    assert.equal(record().fingerprints.uploadKey.sha1, FP_A);
    assert.equal(run(["--identity", "upload", "--fingerprint", FP_A]).code, 0);
  });

  test("detects upload keystore drift without touching play-signing state", () => {
    run(["--fingerprint", FP_B, "--update"]);
    run(["--confirm-restriction"]);
    run(["--identity", "upload", "--fingerprint", FP_A, "--update"]);
    const r = run(["--identity", "upload", "--fingerprint", FP_B]);
    assert.equal(r.code, 1);
    assert.match(r.out, /UPLOAD KEYSTORE CHANGE DETECTED/);
    assert.equal(record().fingerprints.playAppSigning.gcpRestrictionConfirmed, true);
  });

  test("unknown identity rejected", () => {
    const r = run(["--identity", "bogus", "--fingerprint", FP_A]);
    assert.equal(r.code, 1);
    assert.match(r.out, /Unknown --identity/);
  });
});
