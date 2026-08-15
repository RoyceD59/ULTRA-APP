/**
 * Regression tests: effective lifespan and adjusted offsets keep server
 * reminders in step with rescheduled phone notifications after a check-in.
 *
 * Scenarios covered:
 *   1. Normal (early) check-in — offset30/15 are before elapsed; due stages
 *      fire at the adjusted dates and not at the rated-lifespan dates.
 *   2. Late check-in — check-in happens AFTER the formula-derived replace30
 *      offset. The app stores "tomorrow" (elapsed+1) as offset30. The server
 *      uses the stored offset and fires within the grace window, not skip_stale.
 *   3. replace15 parity — the app uses (effDays−10) while the formula uses
 *      (L−15). Stored offsets eliminate the discrepancy entirely.
 *   4. Already-sent stages are never re-emitted after an adjustment.
 *   5. Fallback: when no adjustedOffsets are stored the server falls back to
 *      the lifespan formula (existing filters unaffected).
 *   6. Second sync after a backfill: stored offsets survive a same-cycle
 *      re-sync and the correct stages are still due.
 *
 * Run with: pnpm --filter @workspace/api-server test
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { dueStages, GRACE_DAYS } from "../lib/reminder-dispatch.js";

/** Build an activatedAt Date that is `n` days in the past. */
function daysBack(n: number): Date {
  return new Date(Date.now() - n * 86_400_000);
}

// ── 1. Normal (early) check-in ────────────────────────────────────────────────
// Rated lifespan 90 days. Check-in at day 20 → effective 54 days.
// App computes: offset30 = max(21, 54−30)=24; offset15 = max(25, 54−10)=44.

describe("dueStages — early check-in (stored adjusted offsets)", () => {
  const adjustedOffsets = { replace30: 24, replace15: 44 };

  it("fires replace30 on the adjusted date (day 24)", () => {
    const decisions = dueStages(90, daysBack(24), [], new Date(), adjustedOffsets);
    const keys = decisions.map((d) => d.key);
    assert.ok(keys.includes("replace30"), `expected replace30 at day 24; got [${keys.join(", ")}]`);
  });

  it("does NOT fire replace30 at day 24 without stored offsets (rated 90 days → offset 60)", () => {
    const decisions = dueStages(90, daysBack(24), []);
    const keys = decisions.map((d) => d.key);
    assert.ok(!keys.includes("replace30"), `replace30 must not fire at day 24 with rated lifespan 90`);
  });

  it("fires replace15 on the adjusted date (day 44)", () => {
    const decisions = dueStages(90, daysBack(44), ["activation", "day30", "replace30"], new Date(), adjustedOffsets);
    const keys = decisions.map((d) => d.key);
    assert.ok(keys.includes("replace15"), `expected replace15 at day 44; got [${keys.join(", ")}]`);
  });

  it("replace15 adjusted date (day 44) differs from rated formula (L−15 = 75) — confirms parity fix", () => {
    // Without adjustedOffsets, replace15 would be due at day 75, not 44.
    const withoutAdj = dueStages(90, daysBack(44), [], new Date());
    assert.ok(
      !withoutAdj.map((d) => d.key).includes("replace15"),
      "replace15 at day 44 must NOT fire with the rated formula (offset = 75)",
    );
  });
});

// ── 2. Late check-in ──────────────────────────────────────────────────────────
// Rated lifespan 90 days. Check-in at day 26 → effective 54 days.
// App computes: offset30 = max(27, 24)=27 (tomorrow); offset15 = max(28, 44)=44.
// Day 28 (2 days after the late check-in) → replace30 should be due (within grace),
// NOT skip_stale.

describe("dueStages — late check-in (check-in past formula offset, stored 'tomorrow')", () => {
  const adjustedOffsets = { replace30: 27, replace15: 44 };

  it("fires replace30 as 'send' on day 28 (within grace of stored offset 27)", () => {
    const decisions = dueStages(90, daysBack(28), [], new Date(), adjustedOffsets);
    const replace30 = decisions.find((d) => d.key === "replace30");
    assert.ok(replace30, `replace30 should be emitted at day 28 with stored offset 27`);
    assert.equal(replace30.action, "send", `replace30 at day 28 (offset+1 within grace) must be 'send'`);
  });

  it("marks replace30 skip_stale once past the grace window (day 27 + GRACE_DAYS + 1)", () => {
    const dayPastGrace = 27 + GRACE_DAYS + 1;
    const decisions = dueStages(90, daysBack(dayPastGrace), [], new Date(), adjustedOffsets);
    const replace30 = decisions.find((d) => d.key === "replace30");
    assert.ok(replace30, `replace30 should still be emitted past grace`);
    assert.equal(replace30.action, "skip_stale", `replace30 past grace must be 'skip_stale'`);
  });

  it("would incorrectly mark replace30 skip_stale at day 28 WITHOUT stored offsets", () => {
    // Formula offset for replace30 with lifespan 90 = max(min(60,89),1)=60.
    // Day 28 < 60 → not even due yet without the stored offset.
    // (This test validates the formula alone can't handle this case.)
    const decisions = dueStages(90, daysBack(28), []);
    assert.ok(
      !decisions.find((d) => d.key === "replace30"),
      "without stored offsets replace30 must not yet be due at day 28 with rated lifespan 90",
    );
  });
});

// ── 3. Already-sent stages not re-emitted after adjustment ───────────────────

describe("dueStages — sent stages preserved across effective-lifespan update", () => {
  it("does not re-emit stages already sent under the original schedule", () => {
    const alreadySent = ["activation", "day30", "replace30"];
    const adjustedOffsets = { replace30: 24, replace15: 44 };
    const decisions = dueStages(54, daysBack(60), alreadySent, new Date(), adjustedOffsets);
    const emitted = decisions.map((d) => d.key as string);
    for (const sent of alreadySent) {
      assert.ok(!emitted.includes(sent), `${sent} must not re-fire after adjustment`);
    }
  });
});

// ── 4. Fallback: no adjustedOffsets → formula used (existing filters safe) ───

describe("dueStages — fallback to formula when no adjustedOffsets stored", () => {
  it("fires replace30 at the formula date when no adjustedOffsets present", () => {
    // L=60: offset = max(min(30,59),1)=30
    const decisions = dueStages(60, daysBack(30), []);
    assert.ok(
      decisions.find((d) => d.key === "replace30"),
      "replace30 should fire at formula offset (day 30) with no adjustedOffsets",
    );
  });

  it("does not fire replace30 before the formula date with null adjustedOffsets", () => {
    const decisions = dueStages(60, daysBack(25), [], new Date(), null);
    assert.ok(
      !decisions.find((d) => d.key === "replace30"),
      "replace30 must not fire before formula date when adjustedOffsets is null",
    );
  });
});

// ── 5. Second sync / backfill preserves adjusted stages ──────────────────────

describe("dueStages — second sync (backfill) with same stored offsets", () => {
  it("same adjustedOffsets on second sync produce same due decisions", () => {
    const adjustedOffsets = { replace30: 27, replace15: 44 };
    const first = dueStages(90, daysBack(28), [], new Date(), adjustedOffsets);
    const second = dueStages(90, daysBack(28), [], new Date(), adjustedOffsets);
    assert.deepEqual(
      first.map((d) => d.key),
      second.map((d) => d.key),
      "two syncs with identical stored offsets must produce identical due-stage decisions",
    );
  });
});

// ── 6. Cross-channel parity: early check-in (effective < rated lifespan) ─────
// Scenario: borehole water reduces a 90-day filter to an effective ~50-day life.
// The local scheduler always uses RATED lifespanDays for day30/day60 guards
// (lifespanDays > 45, lifespanDays > 75) so day60 fires at day 60 on the
// handset. The server must also fire day60 using rated lifespanDays — not
// suppress it because 50 > 75 is false.

describe("dueStages — cross-channel parity: rated lifespan governs day30/day60", () => {
  it("day60 fires using rated lifespanDays (90), not suppressed by effective lifespan (50)", () => {
    // The dispatcher passes rated lifespanDays to dueStages — effective lifespan
    // only affects replace30/replace15 (via adjustedReplaceOffsets, not day guards).
    const decisions = dueStages(90, daysBack(62), [], new Date());
    const d60 = decisions.find((d) => d.key === "day60");
    assert.ok(
      d60,
      "day60 must fire on day 62 when rated lifespanDays=90 (90>75=true) — must not be suppressed by a ~50-day effective lifespan",
    );
    assert.equal(d60!.action, "send", "day60 must be 'send', not 'skip_stale', on day 62");
  });

  it("day60 does not fire for a filter whose rated lifespan is too short (rated=54)", () => {
    // Even without effective-lifespan reduction, day60 is null when rated L <= 75.
    const decisions = dueStages(54, daysBack(62), [], new Date());
    assert.ok(
      !decisions.find((d) => d.key === "day60"),
      "day60 must not fire when rated lifespanDays=54 (54>75=false)",
    );
  });

  it("replace30 fires at adjusted offset (not rated formula) while day60 uses rated lifespan guard", () => {
    // Borehole water check-in: rated L=90, effective L=50 → adjusted replace30=37.
    // Day 62: day60 due (rated 90>75), replace30 also due (elapsed 62 >= stored 37 — already in grace).
    const adjustedOffsets = { replace30: 37, replace15: 48 };
    const decisions = dueStages(90, daysBack(62), ["activation", "day30"], new Date(), adjustedOffsets);

    const d60 = decisions.find((d) => d.key === "day60");
    assert.ok(d60, "day60 must fire at day 62 (rated L=90 > 75)");

    // replace30 stored at day 37; grace window = 37..40; day 62 is past grace → skip_stale
    // (already sent in practice, but for a fresh filter this protects the test)
    const r30 = decisions.find((d) => d.key === "replace30");
    assert.ok(r30, "replace30 must be in decisions list at day 62");
    assert.equal(
      r30!.action,
      "skip_stale",
      "replace30 at day 37 must be skip_stale on day 62 (well past grace window)",
    );
  });
});

// ── 7. Late check-in: stored offset exceeds rated lifespan ───────────────────
// When a filter is used past its rated lifespan and the user does a check-in,
// the app computes replace30 = elapsed + 1 (e.g. day 92 on a 90-day filter).
// The server must NOT clamp this to lifespanDays (90); clamping would put
// replace30 in the past, causing the dispatcher to mark it skip_stale.

describe("dueStages — late check-in with replace30 > lifespanDays", () => {
  it("fires replace30 on the exact day the stored offset is reached (offset=92, elapsed=92)", () => {
    // Filter activated 92 days ago; rated lifespan 90 days.
    // App computed replace30 = elapsed+1 = 92 at check-in (day 91).
    // Today is day 92 — the offset is reached; stage must fire.
    const adjustedOffsets = { replace30: 92, replace15: 93 };
    const decisions = dueStages(90, daysBack(92), [], new Date(), adjustedOffsets);

    const r30 = decisions.find((d) => d.key === "replace30");
    assert.ok(r30, "replace30 must be due when elapsed (92) >= stored offset (92)");
    assert.notEqual(
      r30!.action,
      "skip_stale",
      "replace30 must not be skip_stale — offset just reached today",
    );
  });

  it("does not fire replace30 one day before the stored offset (offset=92, elapsed=91)", () => {
    // Filter activated 91 days ago; rated lifespan 90. App set replace30 = 92 (tomorrow).
    const adjustedOffsets = { replace30: 92, replace15: 93 };
    const decisions = dueStages(90, daysBack(91), [], new Date(), adjustedOffsets);
    assert.ok(
      !decisions.find((d) => d.key === "replace30"),
      "replace30 must not be due when elapsed (91) < stored offset (92)",
    );
  });

  it("does not fire replace30 earlier in the cycle even when offset exceeds rated lifespan", () => {
    // Filter activated 88 days ago; rated lifespan 90. App set replace30 = 92 (4 days away).
    const adjustedOffsets = { replace30: 92, replace15: 93 };
    const decisions = dueStages(90, daysBack(88), [], new Date(), adjustedOffsets);
    assert.ok(
      !decisions.find((d) => d.key === "replace30"),
      "replace30 must not be due when elapsed (88) < stored offset (92)",
    );
  });
});
