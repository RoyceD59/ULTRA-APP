---
name: Orval date fields vs Drizzle string-mode dates
description: Type mismatch between Orval-generated Zod schemas and Drizzle date columns, and the fix.
---

When an OpenAPI schema declares a field as `type: string, format: date`, Orval's Zod codegen emits
`zod.coerce.date().nullish()` — parsing that field always produces a JS `Date` object, even from a
`"YYYY-MM-DD"` string input.

Drizzle `date()` columns are commonly declared with `{ mode: "string" }` so reads/writes stay as
plain date strings (avoids timezone drift). This creates a type mismatch: inserting/updating with the
Zod-parsed body (`Date`) directly into a Drizzle string-mode column fails to typecheck.

**Why:** the two libraries pick different date representations by convention, independently of each other.

**How to apply:** at the route-handler DB boundary, convert `Date | null | undefined` to
`"YYYY-MM-DD" | null | undefined` (e.g. `value?.toISOString().slice(0, 10)`) before passing values to
Drizzle insert/update calls. Keep this as a small shared helper rather than inlining the conversion in
every route.

Raw node-postgres queries have another date boundary: PostgreSQL `DATE` may come
back as a local-midnight JavaScript `Date`, even when Drizzle declares that
column in string mode. Preserve the local calendar year/month/day when making
date-only idempotency comparisons; `String(date).slice(0,10)` is not a date and
UTC conversion can shift the day outside UTC.

**Why:** Exact retry comparisons incorrectly rejected an unchanged saved date
because the raw SQL result bypassed Drizzle's string-mode conversion.

**How to apply:** Normalize raw date-only query results explicitly before
comparing or returning calendar dates.
