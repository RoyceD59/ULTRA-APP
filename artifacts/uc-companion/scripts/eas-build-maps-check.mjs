#!/usr/bin/env node
/**
 * EAS build hook — registered as the `eas-build-pre-install` npm script so EAS
 * runs it BEFORE the build starts (and therefore before any artifact is produced).
 *
 * Fail-closed design
 * ──────────────────
 * For production Android builds this hook ALWAYS fails if PLAY_APP_SIGNING_SHA1
 * is not set.  The only way to set it is through the authorised GitHub Actions
 * pipeline (.github/workflows/maps-fingerprint-check.yml), which:
 *   1. Runs the fingerprint check locally with a fresh operator-supplied SHA-1.
 *   2. Creates the PLAY_APP_SIGNING_SHA1 EAS secret transiently (for one build).
 *   3. Triggers `eas build --wait`, at which point THIS hook reads the secret
 *      and re-validates the fingerprint on the EAS worker.
 *   4. Deletes the EAS secret immediately after the build (even on failure).
 *
 * The secret is absent between releases, so any direct `eas build --profile
 * production` call (bypassing the CI pipeline) will reach this hook, find the
 * secret missing, and exit 1 — the build is blocked.
 *
 * Non-production / non-Android builds: exit 0 unconditionally.
 *
 * Exit codes: 0 = OK or skipped, 1 = check failed / secret absent.
 * See docs/maps-key-rotation-runbook.md for the full procedure.
 */
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const platform = process.env.EAS_BUILD_PLATFORM; // "android" | "ios"
const profile   = process.env.EAS_BUILD_PROFILE;  // "development" | "preview" | "production"

if (platform !== "android" || profile !== "production") {
  console.log(
    `ℹ️  Maps fingerprint check skipped (platform=${platform ?? "unknown"}, profile=${profile ?? "unknown"}).`
  );
  process.exit(0);
}

// ── Fail-closed for production Android ───────────────────────────────────────
const sha1 = process.env.PLAY_APP_SIGNING_SHA1;

if (!sha1) {
  console.error(
    "\n❌ PLAY_APP_SIGNING_SHA1 is not set — production Android build BLOCKED.\n\n" +
    "   This secret must be supplied by the GitHub Actions release pipeline:\n" +
    "   .github/workflows/maps-fingerprint-check.yml (workflow_dispatch)\n\n" +
    "   The pipeline:\n" +
    "     1. Asks the operator for the fresh Play Console SHA-1.\n" +
    "     2. Runs the fingerprint check locally.\n" +
    "     3. Sets PLAY_APP_SIGNING_SHA1 as a transient EAS secret for this build.\n" +
    "     4. Triggers eas build — this hook then validates it here on the worker.\n" +
    "     5. Deletes the secret after the build.\n\n" +
    "   Do NOT trigger production builds directly with `eas build`.\n" +
    "   See docs/maps-key-rotation-runbook.md.\n"
  );
  process.exit(1);
}

console.log(
  "🔑 Production Android build — Maps key fingerprint check (PLAY_APP_SIGNING_SHA1 is set)…"
);

const script = join(dirname(fileURLToPath(import.meta.url)), "check-maps-key-fingerprint.mjs");

try {
  execFileSync(process.execPath, [script, "--fingerprint", sha1], { stdio: "inherit" });
} catch {
  console.error("\n   Runbook: docs/maps-key-rotation-runbook.md\n");
  process.exit(1);
}
