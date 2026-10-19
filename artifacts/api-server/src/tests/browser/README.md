# Customer export browser regression

From the workspace root:

```sh
pnpm test:customers-browser
```

This opt-in Node test uses Playwright Chromium, the actual ProjectHub Vite app,
real team sign-in, and the real API export endpoint. The existing API test
wrapper creates and drops a disposable database; development customer data and
staff credentials are never used. No export responses are intercepted.

Chromium uses `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` when supplied, the Replit
Chromium executable when available, or Playwright's installed Chromium otherwise.
On CI, provision Chromium with `pnpm exec playwright install --with-deps chromium`.
The ordinary API suite skips this browser test unless `PROJECTHUB_BROWSER_TEST=1`.

The fixture includes a matching customer, search matches before and after the
joined-date range, and an unrelated customer inside the date range. The test
asserts the outgoing query, authenticated response, server filename (including
the current UTC date and all three filters), browser download filename, and
exact saved CSV contents. Services, browser, and temporary files are cleaned up.