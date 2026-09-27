# Lead backup Apps Script

`lead-backup.gs` is the paired, POST-only Google Sheets receiver for instant
water-check leads. It is intentionally separate from the application source:
the deployment URL is environment configuration and no secret or spreadsheet
identifier belongs in this repository.

## Configuration

Create a Google Apps Script project owned by the company, paste in
`lead-backup.gs`, and set Script Properties:

- `SPREADSHEET_ID`: the destination spreadsheet ID
- `SHEET_NAME`: optional tab name; defaults to `Leads`

Deploy a versioned web app and configure its `/exec` URL as
`GOOGLE_LEAD_APPS_SCRIPT_URL`. Keep the deployment access policy restricted to
the server/browser integration that the company has verified.

The receiver accepts only JSON `POST` requests with `schemaVersion: 1`. It
deduplicates by `submissionId` while holding a script lock and returns
`ok`, `duplicate`, `INVALID_*`, or `TEMPORARY_FAILURE`. It does not accept
JSONP, GET writes, credentials, internal database IDs, source attribution
details, or arbitrary fields.

If the URL or spreadsheet is not configured, the API outbox remains disabled
and the primary water assessment still succeeds.