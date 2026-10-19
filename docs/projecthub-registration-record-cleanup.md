# Clear selected test registration records

## Scope

This operation removes selected durable registration/recovery records only.
It does **not** delete customer accounts, assignments, orders, payments, or
customer history. It is not a customer-account deletion tool.

An administrator may select recovered/resolved, pending, conflicted,
retryable, or contacted-only records. There is no automatic inference that a
record is test data: the administrator must identify and confirm each record.
An unresolved record can be the only remaining record of a failed signup.
Removing it ends automatic and staff recovery for that record.

## Use

1. Sign in to ProjectHub as an administrator.
2. Open **Unsynced Registrations**.
3. Check the individual test records to remove (up to 100 at a time).
4. Select **Clear selected test records**.
5. Review the listed names, emails, timestamps and states.
6. Choose **Clear these test records**, or **Cancel** to keep everything.

Only the confirmed selection is sent. The existing **Clear resolved logs**
operation remains separate and still excludes unresolved/contacted-only logs.
Clearing the last displayed record does not prove all registrations synced.

## Safety and verification

- The API checks the administrator's live active role.
- Opaque selection keys identify exact record snapshots, not just a customer
  ID or email. Records sharing an email/timestamp are distinguishable.
- A changed, missing, or ambiguous selection returns a conflict without
  partially clearing other selected records. Refresh and select again.
- Clearing shares the same write queue as registration appends and recovery.
  It uses atomic file replacement, preserves unselected/malformed lines, and
  never runs a customer database deletion.
- Logs contain the administrator identifier, action and count, not the removed
  names, email addresses, phone numbers, or record contents.
- Checks use a disposable test database, temporary files and fixture identities.
  No real registration records were cleared during implementation.

These are development changes and require publication before appearing in the
published ProjectHub.
