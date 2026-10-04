import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { readFile, mkdtemp, rm, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Server } from "node:http";
import { chromium, expect } from "@playwright/test";

// Opt in through the isolated API runner, never against the development DB.
test("authenticated customer CSV download preserves search and joined-date filters", {
  skip: process.env.PROJECTHUB_BROWSER_TEST !== "1"
    ? "Run pnpm test:customers-browser to exercise the real browser download"
    : false,
  timeout: 120_000,
}, async (t) => {
  assert.match(new URL(process.env.DATABASE_URL!).pathname, /^\/test_api_\d+_\d+$/,
    "Browser fixtures must use the isolated API test database");

  // Avoid real providers and production identity services in this local test.
  process.env.PREVIEW_SAFE_MODE = "1";
  process.env.SESSION_SECRET ??= randomUUID();
  for (const key of Object.keys(process.env)) {
    if (/^(WC_|MPESA_|PAYSTACK_|STRIPE_)/.test(key)) delete process.env[key];
  }
  const { pool } = await import("@workspace/db");
  const { default: bcrypt } = await import("bcryptjs");
  const { default: app } = await import("../../app.js");
  app.use((err: Error & { cause?: Error }, _req: unknown, res: { status: (code: number) => { json: (body: unknown) => void } }, _next: unknown) => {
    // Report the underlying DB/setup error without logging auth request bodies.
    t.diagnostic(err.cause?.message ?? err.message);
    res.status(500).json({ error: "Browser test API request failed" });
  });
  const suffix = randomUUID();
  const email = `export-admin-${suffix}@test.internal`;
  const password = randomUUID();
  await pool.query(
    `INSERT INTO team_users (id, email, name, password_hash, role, is_active)
     VALUES ($1, $2, 'Browser Export Admin', $3, 'admin', true)`,
    [suffix, email, await bcrypt.hash(password, 4)],
  );

  // A search-only match, two date-only failures, and an unrelated in-range
  // customer ensure that dropping ANY filter changes the downloaded rows.
  await pool.query(
    `INSERT INTO uc_users (email, password_hash, first_name, last_name, phone, created_at)
     VALUES
       ($1, 'x', 'CsvBrowser', 'Match', '+254700000001', '2026-02-10T12:00:00Z'),
       ($2, 'x', 'CsvBrowser', 'Before', '+254700000002', '2026-01-31T12:00:00Z'),
       ($3, 'x', 'CsvBrowser', 'After', '+254700000003', '2026-03-01T12:00:00Z'),
       ($4, 'x', 'Unrelated', 'InRange', '+254700000004', '2026-02-15T12:00:00Z')`,
    ["match", "before", "after", "unrelated"].map((name) => `${name}-${suffix}@test.internal`),
  );

  let api: Server | undefined;
  t.after(async () => {
    if (api) {
      api.closeAllConnections();
      await new Promise<void>((resolve, reject) => api!.close((err) => err ? reject(err) : resolve()));
    }
    await pool.end();
  });
  api = await new Promise<Server>((resolve, reject) => {
    const server = app.listen(0, "127.0.0.1", () => resolve(server));
    server.once("error", reject);
  });
  const apiPort = (api.address() as { port: number }).port;

  // Load the product's actual Vite config, adding only an isolated same-origin
  // API proxy and an ephemeral port. No API responses or downloads are mocked.
  const hubDir = fileURLToPath(new URL("../../../../projecthub/", import.meta.url));
  const hubRequire = createRequire(path.join(hubDir, "package.json"));
  const { createServer } = await import(pathToFileURL(hubRequire.resolve("vite")).href);
  process.env.PORT = "5173";
  process.env.BASE_PATH = "/";
  process.env.VITE_API_BASE_URL = "";
  process.env.VITE_API_DOMAIN = "";
  const vite = await createServer({
    configFile: path.join(hubDir, "vite.config.ts"),
    cacheDir: path.join(tmpdir(), `customer-export-vite-${suffix}`),
    server: {
      host: "127.0.0.1", port: 0,
      proxy: { "/api": `http://127.0.0.1:${apiPort}` },
    },
  });
  t.after(async () => {
    await vite.close();
    await rm(vite.config.cacheDir, { recursive: true, force: true });
  });
  await vite.listen();
  const hubPort = (vite.httpServer.address() as { port: number }).port;
  process.env.PREVIEW_ALLOWED_ORIGINS = `http://127.0.0.1:${hubPort}`;

  const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
    || (await access("/repl/tools/bin/chromium").then(() => "/repl/tools/bin/chromium", () => undefined));
  const browser = await chromium.launch({ executablePath, args: ["--no-sandbox"] });
  t.after(() => browser.close());
  const context = await browser.newContext({ acceptDownloads: true });
  const page = await context.newPage();
  page.setDefaultTimeout(30_000);
  const pageErrors: string[] = [];
  page.on("pageerror", (err) => pageErrors.push(err.message));
  // Fail closed if an unexpected dependency tries to reach a live service.
  const externalRequests: string[] = [];
  await page.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (url.protocol === "http:" && url.hostname === "127.0.0.1") return route.continue();
    // Remote font CSS is optional presentation, not a live API dependency.
    if (url.origin === "https://fonts.googleapis.com" && url.pathname === "/css2") return route.abort();
    externalRequests.push(`${url.origin}${url.pathname}`);
    return route.abort();
  });

  await page.goto(`http://127.0.0.1:${hubPort}/login?next=/admin/customers`);
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  const loginResponse = page.waitForResponse((res) => new URL(res.url()).pathname === "/api/auth/login");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  assert.equal((await loginResponse).status(), 200);
  await expect(page).toHaveURL(/\/admin\/customers$/);
  await expect(page.getByRole("heading", { name: "Customers", exact: true })).toBeVisible();
  await expect(page.getByRole("cell", { name: `match-${suffix}@test.internal`, exact: true })).toBeVisible();

  const filteredList = page.waitForResponse((res) => {
    const url = new URL(res.url());
    return url.pathname === "/api/uc/admin/customers"
      && url.searchParams.get("q") === "CsvBrowser"
      && url.searchParams.get("from") === "2026-02-01"
      && url.searchParams.get("to") === "2026-02-28";
  });
  await page.getByPlaceholder("Search by name, email, or phone…").fill("CsvBrowser");
  await page.locator('input[type="date"]').nth(0).fill("2026-02-01");
  await page.locator('input[type="date"]').nth(1).fill("2026-02-28");
  assert.equal((await filteredList).status(), 200);
  await expect(page.locator("tbody tr")).toHaveCount(1);
  await expect(page.getByRole("cell", { name: "CsvBrowser Match", exact: true })).toBeVisible();

  const earliestDate = new Date().toISOString().slice(0, 10);
  const exportResponse = page.waitForResponse((res) =>
    new URL(res.url()).pathname === "/api/uc/admin/customers/export");
  const downloaded = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export CSV", exact: true }).click();
  const [response, download] = await Promise.all([exportResponse, downloaded]);
  assert.equal(response.status(), 200);
  assert.equal(response.request().method(), "GET");
  assert.match(response.request().headers().authorization ?? "", /^Bearer .+/);
  assert.deepEqual(Object.fromEntries(new URL(response.url()).searchParams), {
    q: "CsvBrowser", from: "2026-02-01", to: "2026-02-28",
  });
  assert.match(response.headers()["content-type"], /^text\/csv/);
  const filename = response.headers()["content-disposition"]?.match(/filename="([^"]+)"/)?.[1];
  assert.ok(filename, "The server must provide a download filename");
  const currentDates = [earliestDate, new Date().toISOString().slice(0, 10)];
  assert.ok(currentDates.some((date) =>
    filename === `customers_${date}_search-csvbrowser_from-2026-02-01_to-2026-02-28.csv`),
  `Unexpected filter-aware filename: ${filename}`);
  assert.equal(download.suggestedFilename(), filename, "Browser must honor the server-provided filename");
  assert.equal(await download.failure(), null);
  const downloadDir = await mkdtemp(path.join(tmpdir(), "customer-export-download-"));
  t.after(() => rm(downloadDir, { recursive: true, force: true }));
  const downloadedPath = path.join(downloadDir, download.suggestedFilename());
  await download.saveAs(downloadedPath);
  const csv = await readFile(downloadedPath, "utf8");
  assert.equal(csv,
    "name,email,phone,joinedDate,orderCount\r\n"
    + `CsvBrowser Match,match-${suffix}@test.internal,"'+254700000001",2026-02-10T12:00:00.000Z,0\r\n`);
  assert.deepEqual(pageErrors, []);
  assert.deepEqual(externalRequests, []);
});