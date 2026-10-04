# Customer signup reporting

The customer dashboard's `GET /uc/admin/customers/count` endpoint uses
**Africa/Nairobi (Kenya time)**, as agreed with the product owner.

- **Weekly count:** active customers created at or after Monday at 00:00 Nairobi time.
- **Monthly count:** active customers created at or after the first day of the month
  at 00:00 Nairobi time.
- Midnight itself is included. Soft-deleted customers are excluded from all counts.
- These are calendar-to-date lower-bound counts, not rolling seven-day or thirty-day
  counts. The existing handling of future-dated records is unchanged.
- Database session, server, and viewer timezones do not affect the reset instant.

For example, October 2026 starts at `2026-09-30T21:00:00Z`, and the week beginning
Monday, October 5 starts at `2026-10-04T21:00:00Z`.

The query converts the current instant to Nairobi local time, truncates it to the
calendar boundary, and converts that boundary back to a timestamp with timezone
before comparing it with signup timestamps. No database timezone setting is changed.