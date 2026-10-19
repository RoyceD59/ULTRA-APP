# Customer dashboard count performance

## Target and switch-over

The budget for the dashboard's customer **database query** is p95 ≤ 50 ms.
This is a query budget, not a claim about browser rendering, network latency,
the rest of the dashboard, or production hardware.

At **5,000 active customers**, the count endpoint switches from the indexed
direct aggregate to the transactional summary. The selector uses the maintained
total, not a count or an estimated planner statistic. It switches back below
that threshold without rebuilding the summary. All counters and the selector
are read in one statement and therefore share one PostgreSQL snapshot.

In the first Nairobi-calendar run, 9,000 active accounts passed (p95 14.302 ms)
and 90,000 exceeded the budget (p95 93.865 ms). A repeat run under workspace
load exceeded the target even at 9,000 active accounts (53.043 ms). Therefore
the conservative 5,000 threshold switches before the earliest observed failure.
Explicit Kenya-time conversion is part of the benchmark, not just index access.
This is not a claim that every installation has an exact performance cliff at
that value, or that a volume threshold can guarantee latency on saturated hardware.

## Reproducible benchmark

Run from `artifacts/api-server`:

```sh
CUSTOMER_COUNT_BENCHMARK=1 \
TEST_GLOB=src/tests/customer-count-benchmark.test.ts pnpm test
```

The package test wrapper creates and drops a separate test database. The
benchmark creates connection-local temporary relations; it never inserts
benchmark customers into the development or production customer table.

The dataset spans two years of creation dates, has 10% soft-deleted accounts,
and tests 1,000 through 2,000,000 accounts. Each dataset is vacuumed/analyzed,
then measured after two warm-up runs with 20 recorded executions. Sequential
scans are disabled to measure the best-case covering partial index path.
The index contains the same keys and included creation timestamp as the live
index. Baseline queries use the previous aggregate; summary/adaptive queries
use the actual endpoint SQL with temporary relation names.

The results below were recorded on 2026-10-05, PostgreSQL 16.10, x86-64, database
timezone GMT, in the development container. Execution times are from
`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)`, excluding network/planning time.
Temporary tables do not model parallel scans, write contention, cold-cache
loads, or production infrastructure. The benchmark compares read paths; it
does not claim registration throughput. The opt-in test checks both paths
against direct counts at each volume but does not assert environment-sensitive
timing numbers in ordinary CI.

| All accounts | Active | Previous indexed p95 ms | Adaptive endpoint SQL p95 ms | Forced-summary p95 ms |
| ---: | ---: | ---: | ---: | ---: |
| 50,000 | 45,000 | 614.259 | 3.906 | 1.155 |
| 100,000 | 90,000 | 148.132 | 0.939 | 0.448 |
| 250,000 | 225,000 | 274.978 | 0.137 | 0.143 |
| 500,000 | 450,000 | 487.700 | 0.229 | 0.135 |
| 1,000,000 | 900,000 | 857.864 | 0.194 | 0.098 |
| 2,000,000 | 1,800,000 | 1564.020 | 0.197 | 0.135 |

The table reflects the loaded repeat run. These larger datasets already used
the summary branch with the previous 25,000 selector; lowering it to 5,000
does not change their executed branch. The small-volume verification below
uses the final 5,000 selector. Its shorter opt-in command is:

```sh
CUSTOMER_COUNT_BENCHMARK=1 CUSTOMER_COUNT_BENCHMARK_SMALL=1 \
TEST_GLOB=src/tests/customer-count-benchmark.test.ts pnpm test
```

| All accounts | Active | Indexed p95 ms | Final adaptive p95 ms | Forced-summary p95 ms |
| ---: | ---: | ---: | ---: | ---: |
| 1,000 | 900 | 1.323 | 29.234 | 0.141 |
| 10,000 | 9,000 | 16.091 | 0.575 | 0.151 |
| 25,000 | 22,500 | 34.151 | 0.122 | 0.138 |

## Accuracy and rollout

- Total means accounts with `deleted_at IS NULL`. Weekly/monthly counts mean
  active accounts created since Monday/the first of the month, not change in
  total or a percentage. Restoring an older account restores the total but
  does not make it a new signup.
- The business calendar is explicitly Africa/Nairobi, as chosen by the user.
  Kenya-local bucket creation and Kenya-local read boundaries stay aligned regardless of
  the connection timezone. Future-dated rows retain the existing `>= boundary`
  semantics rather than being silently excluded.
- Database row triggers update the singleton total and creation-day buckets
  atomically with inserts, soft deletion, restoration, timestamp corrections,
  and hard deletion. Profile-only edits do not touch the summary. Failed or
  rolled-back writes roll back counters too.
- Writers always lock the singleton before changing buckets, so concurrent
  registrations cannot lose increments or acquire bucket locks in conflicting
  order. This serializes counter-changing transactions; sustained signup
  throughput is a separate operational concern from read latency.
- Reads scan recent day buckets (usually at most 31), not customer index
  entries. Cost depends on relevant calendar dates, not account volume.
  Future-dated imports can add relevant future-date buckets.
- Month/week rollover requires no scheduled job or recount; read boundaries
  naturally move over the daily buckets.
- The first migration blocks customer writes while seeding existing accounts
  and installing triggers. Existing reads can continue. Budget that one-time
  backfill for the actual account volume; subsequent startups use the singleton
  initialization marker and never repeat the full backfill unless its calendar
  tag differs. Untagged UTC summaries from an earlier preview are rebuilt once
  under the same write lock; their dates are never reinterpreted as Kenya dates.
- Shared SQL, the isolated test runner, and deployed startup all use the same
  migration. The build copies it next to the bundled server. Missing summary
  initialization is an explicit error, not a zero-count fallback.
- Data maintenance must leave the triggers enabled. `TRUNCATE uc_users` has
  its own transactional reset trigger. Loading customer data with triggers
  disabled is unsupported and would require a supervised rebuild.

## Verification

`customer-statistics.test.ts` compares the production summary query with direct
counts in one snapshot across registration, soft deletion, restoration,
creation-date changes, hard deletion, repeated operations, failed writes,
rollback, concurrent commits, and calendar rollover. It also verifies that
the large-volume plan never scans `uc_users`, and tests fresh legacy backfill,
repeated rollout, and truncate in an isolated schema.

`customer-count.test.ts` retains auth/route checks and verifies numeric
`count`, `newThisWeek`, and `newThisMonth` responses from the summary path.