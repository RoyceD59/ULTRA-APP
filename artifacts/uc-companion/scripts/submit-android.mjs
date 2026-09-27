#!/usr/bin/env node
/**
 * Production Android submit wrapper.
 *
 * Enforces the Maps fingerprint pre-submission check before calling
 * `eas submit`. The operator MUST retrieve the current Play app-signing
 * SHA-1 from Play Console and pass it at runtime — it must NOT come from a
 * stored env file, shell variable set days ago, or a saved note. A stale
 * value gives the check a false pass while Maps silently breaks for users.
 *
 * Usage (from artifacts/uc-companion):
 *   PLAY_APP_SIGNING_SHA1="<SHA-1 from Play Console → Setup → App signing>" \
 *     node scripts/submit-android.mjs [--buildId <id>]
 *
 * Or as an npm script:
 *   PLAY_APP_SIGNING_SHA1="..." pnpm submit:android [-- --buildId <id>]
 *
 * The extra arguments (e.g. --buildId) are forwarded to `eas submit`.
 *
 * See docs/maps-key-rotation-runbook.md for the full rotation procedure.
 */
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const sha1 = process.env.PLAY_APP_SIGNING_SHA1;

if (!sha1) {
  console.error(
    "\n❌ PLAY_APP_SIGNING_SHA1 is required.\n" +
    "   Retrieve the current SHA-1 from Play Console → Setup → App signing\n" +
    "   and pass it at invocation time:\n\n" +
    '     PLAY_APP_SIGNING_SHA1="<SHA-1>" node scripts/submit-android.mjs\n\n' +
    "   Do NOT use a stored value — it must be freshly retrieved to detect a rotation.\n" +
    "   See docs/maps-key-rotation-runbook.md.\n"
  );
  process.exit(1);
}

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const checkScript = join(root, "scripts", "check-maps-key-fingerprint.mjs");

console.log("🔑 Pre-submission Maps fingerprint check…");
try {
  execFileSync(process.execPath, [checkScript, "--fingerprint", sha1], {
    stdio: "inherit",
    cwd: root,
  });
} catch {
  console.error(
    "\n❌ Maps fingerprint check failed — submission blocked.\n" +
    "   See docs/maps-key-rotation-runbook.md.\n"
  );
  process.exit(1);
}

console.log("\n✅ Fingerprint check passed. Proceeding with eas submit…\n");

// Forward any extra CLI args to eas submit.
// Use --id <id> (not --buildId) to target a specific build.
// Example: PLAY_APP_SIGNING_SHA1="..." pnpm submit:android -- --id <build-id>
const extraArgs = process.argv.slice(2);
execFileSync(
  "eas",
  ["submit", "--platform", "android", "--profile", "production", ...extraArgs],
  { stdio: "inherit", cwd: root }
);
