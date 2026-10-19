# Reviewing customer enquiries

The read-only `GET /api/uc/enquiries` endpoint returns all PostgreSQL
submissions as a JSON array, newest first. Each entry includes `productName`,
`name`, `email`, `phone`, `message`, and `createdAt` (an ISO timestamp), plus
the enquiry and product IDs. No database login or email provider is needed.

## Access

Configure a strong, random `ADMIN_SECRET` in the API server's secret
configuration and restart the service. Keep it server-side: do not put it in
frontend code, query strings, source control, or shared documents.
Access is disabled (503) when the secret is unset; missing or incorrect
`X-Admin-Key` headers return 401. Responses are marked `Cache-Control: no-store`.

From a trusted terminal, set `API_BASE_URL` to the API URL ending in `/api`.
Load `ADMIN_SECRET` securely into that terminal's environment, then run:

```sh
printf 'X-Admin-Key: %s\n' "$ADMIN_SECRET" |
  curl --fail-with-body --silent --show-error --header @- \
    "$API_BASE_URL/uc/enquiries"
```

This passes the header over stdin rather than embedding the key in curl's
command-line arguments. Treat the returned contact details as confidential.

## Date filters

```sh
printf 'X-Admin-Key: %s\n' "$ADMIN_SECRET" |
  curl --fail-with-body --silent --show-error --header @- \
    "$API_BASE_URL/uc/enquiries?from=2026-10-01&to=2026-10-04"
```

Both bounds are optional and include the entire named UTC day. Invalid dates,
repeated parameters, or `from` later than `to` return 400. No matching entries
returns `[]`; database failure returns 503, not a misleading empty list.

Only persisted submissions are returned. The existing submission handler's
temporary in-memory fallback is not durable and is not part of this list.