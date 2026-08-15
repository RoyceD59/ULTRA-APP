---
name: UC orders CSV column contract
description: Column-order compatibility rule for the admin orders CSV export
---

# Orders CSV column contract

**Rule:** In the admin orders CSV export, the original static columns
(id … shippingCountry) must keep their historical positions. New columns are
appended after them, before the dynamic per-item columns. Never insert a
column mid-row.

**Why:** External bookkeeping/CRM spreadsheet imports map by column position;
an inserted column silently feeds wrong data into every downstream field with
no error. A review flagged exactly this when receipt/UTM columns were first
inserted next to related fields instead of appended.

**How to apply:** Any new order export field goes at the end of the static
section. The CSV test files assert the legacy prefix order and count static
columns via `STATIC_COL_COUNT` — bump it when appending.
