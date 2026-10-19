/**
 * Local-only preparation fixture. Start through scripts/guest-pay-fixture.cjs,
 * never directly: the supervisor owns the isolated database and cleanup.
 */
import http from "node:http";
import { createRequire, registerHooks } from "node:module";
import { writeFile, chmod } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

const require = createRequire(import.meta.url);
const safety = require("../../scripts/lib/guest-pay-fixture-safety.cjs");
const { encodeState } = require("../../scripts/lib/guest-pay-fixture-state.cjs");

function event(name: string, details: Record<string, unknown> = {}) {
  // This fixture deliberately emits no URL, body, credential, contact or raw error.
  process.stdout.write(JSON.stringify({ event: name, ...details }) + "\n");
}

let server: http.Server | undefined;
let pool: import("pg").Pool | undefined;
let stopping = false;
let phase = "configuration";

async function stop() {
  if (stopping) return;
  stopping = true;
  if (server) {
    server.close();
    server.closeAllConnections();
  }
  await pool?.end();
}
for (const signal of ["SIGTERM", "SIGINT"]) process.on(signal, () => {
  void stop().then(() => process.exit(0));
});

try {
  safety.assertChildEnvironment(process.env);
  const port = Number(process.env.GUEST_PAY_FIXTURE_PORT);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("Invalid fixture port");
  const directory = process.env.GUEST_PAY_FIXTURE_DIRECTORY!;
  const origin = `http://127.0.0.1:${port}`;
  const mpesa = process.env.GUEST_PAY_FIXTURE === "mpesa-sandbox";
  const publicOrigin = process.env.GUEST_PAY_FIXTURE_PUBLIC_ORIGIN;
  const basePath = process.env.GUEST_PAY_FIXTURE_BASE_PATH || "";
  let paymentsEnabled = false;
  const guard = safety.installNetworkGuard(process.env.DATABASE_URL, port, { mpesa,
    onProviderDiagnostic: (details: Record<string, unknown>) => event("fixture_provider_diagnostic", details) });
  // Payment helpers transitively import review classification's eager AI client.
  // Disable that unrelated integration rather than borrowing its live credentials.
  const disabledAi = new URL("../../scripts/lib/guest-pay-disabled-ai.mjs", import.meta.url).href;
  registerHooks({
    resolve(specifier, context, nextResolve) {
      if (specifier === "@workspace/integrations-anthropic-ai") {
        return { url: disabledAi, format: "module", shortCircuit: true };
      }
      return nextResolve(specifier, context);
    },
  });
  // Dynamic imports are important: no application module sees the workspace environment.
  phase = "database_identity";
  const pg = await import("pg");
  const probe = new pg.default.Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const result = await probe.query("SELECT current_database() AS name");
    if (result.rows[0]?.name !== process.env.GUEST_PAY_FIXTURE_DATABASE) throw new Error("Wrong database");
  } finally { await probe.end(); }
  const configuration = await import("../lib/payment-configuration.js");
  if (configuration.paymentMocksAllowed() ||
      ["paystack", "stripe"].some(configuration.paymentProviderConfigured) ||
      configuration.paymentProviderConfigured("mpesa") !== mpesa) {
    throw new Error("Provider or simulation unexpectedly enabled");
  }
  const database = await import("@workspace/db");
  pool = database.pool;
  phase = "application_import";
  // Mount the real payment router, not the full app's unrelated AI/auth routers.
  const { default: express } = await import("express");
  const { default: pinoHttp } = await import("pino-http");
  const { logger } = await import("../lib/logger.js");
  const { default: paymentsRouter } = await import("../routes/payments.js");
  const app = express();
  app.disable("x-powered-by");
  app.use(pinoHttp({ logger, autoLogging: false }));
  app.use(express.json({ limit: "8kb" }));
  app.use("/api", paymentsRouter);
  app.use((_error: unknown, _req: import("express").Request, res: import("express").Response,
    _next: import("express").NextFunction) => {
    res.status(503).json({ error: "Fixture request unavailable", retryable: false });
  });
  const { prepareCheckoutOrder } = await import("../lib/checkout-orders.js");
  const { issuePayLink, GUEST_PAY_DDL } = await import("../lib/guest-pay.js");
  const catalogue = await import("../lib/companion-catalogue.js");
  safety.assertChildEnvironment(process.env);
  if (configuration.paymentMocksAllowed()) throw new Error("Simulation enabled during import");
  phase = "seed_catalogue";
  await catalogue.ensureCompanionCatalogueSchema();
  await catalogue.synchronizeCatalogueIdentities();
  // Synthetic stock affects this brand-new database only.
  await pool.query("UPDATE uc_catalogue_inventory SET stock_quantity=10,stock_status='instock'");
  const products = await catalogue.companionCatalogue();
  const product = products.find((p: any) => p.status === "publish" && Number(p.price) > 0);
  if (!product) throw new Error("No fixture product");
  const variations = product.type === "variable"
    ? await catalogue.readCompanionCollection(`/products/${product.id}/variations`) : [];
  if (product.type === "variable" && !variations?.length) throw new Error("Fixture variant unavailable");
  const variant: any = variations?.[0];
  const address = { firstName: "Fixture", lastName: "Buyer", country: "KE",
    phone: "+254712345678", address1: "Synthetic test address", city: "Nairobi" };
  phase = "seed_buyer";
  const buyer = await pool.query(`INSERT INTO uc_users
    (email,password_hash,first_name,last_name,phone,address)
    VALUES('buyer@example.invalid','unused','Fixture','Buyer',$1,$2) RETURNING id`,
    [address.phone, address.address1]);
  const buyerId = buyer.rows[0].id;
  phase = "seed_order";
  const order = await prepareCheckoutOrder({
    lineItems: [{ productId: Number(product.id), quantity: 1,
      ...(variant ? { variationId: Number(variant.id), childSku: variant.sku } : {}) }],
    fulfillment: "collection", shippingAddress: address, idempotencyKey: randomUUID(),
  }, String(buyerId), mpesa ? "mpesa" : "paystack");
  await pool.query(GUEST_PAY_DDL);
  phase = "issue_link";
  const link = await issuePayLink(order);
  const { createGuestPayDelivery } = require("../../../uc-companion/server/guest-pay-delivery.cjs");
  const delivery = createGuestPayDelivery({ apiOrigin: origin, basePath });
  const allowedApi = new Set([
    "/api/guest-pay/summary", "/api/guest-pay/initialize", "/api/guest-pay/reconcile",
  ]);
  server = http.createServer(async (req, res) => {
    const requestId = randomUUID();
    const pathname = new URL(req.url || "/", origin).pathname;
    const family = pathname === "/_fixture/health" ? "health" :
      pathname.startsWith("/pay") ? "private_document" :
      pathname.startsWith("/guest-pay/") ? "private_proxy" :
      pathname === "/api/payments/mpesa/callback" ? "mpesa_callback" :
      allowedApi.has(pathname) ? "guest_api" : "blocked";
    res.on("finish", () => event("fixture_request", { requestId, family, status: res.statusCode }));
    const deny = (status: number) => {
      res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
      res.end('{"error":"Unavailable in local preparation fixture"}');
    };
    // Deny DNS rebinding, foreign browser origins and any non-fixture API surface.
    if (![`127.0.0.1:${port}`, `localhost:${port}`].includes(req.headers.host || "") ||
        (req.headers.origin && ![origin, `http://localhost:${port}`, publicOrigin].includes(req.headers.origin))) {
      deny(403); return;
    }
    try {
      if (pathname === "/_fixture/health" && req.method === "GET") {
        const check = await pool!.query(`SELECT current_database() AS database,
          (SELECT count(*)::int FROM uc_orders) AS orders,
          (SELECT count(*)::int FROM uc_users) AS buyers`);
        const stored = await pool!.query(`SELECT user_id,status,checkout_state,payment_reference,
          payment_confirmed_at FROM uc_orders WHERE id=$1`, [order.id]);
        const row = stored.rows[0];
        res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
        res.end(JSON.stringify({ isolated: check.rows[0].database === process.env.GUEST_PAY_FIXTURE_DATABASE,
          localOnly: !publicOrigin, syntheticData: true, providersEnabled: mpesa, simulationsEnabled: false,
          instance: process.env.GUEST_PAY_FIXTURE_INSTANCE, mode: process.env.GUEST_PAY_FIXTURE,
          publicOrigin, basePath, paymentsEnabled,
          notificationsEnabled: false, analyticsEnabled: false, blockedOutbound: guard.blocked(),
          orders: check.rows[0].orders, buyers: check.rows[0].buyers,
          originalBuyerRetained: row?.user_id === String(buyerId),
          orderState: row?.checkout_state, paymentStarted: !!row?.payment_reference || !!row?.payment_confirmed_at }));
        return;
      }
      // This control path is not exposed by the public proxy. Activation follows
      // actual HTTPS privacy/reachability checks and remains bound to this run.
      if (pathname === "/_fixture/activate-mpesa" && req.method === "POST" && mpesa &&
          !req.headers.origin && req.headers["x-fixture-instance"] === process.env.GUEST_PAY_FIXTURE_INSTANCE) {
        paymentsEnabled = true;
        res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
        res.end('{"paymentsEnabled":true,"sandboxOnly":true}');
        return;
      }
      if (mpesa && !paymentsEnabled && ["/guest-pay/initialize", "/api/guest-pay/initialize"].includes(pathname)) {
        deny(503); return;
      }
      if (await delivery(req, res, pathname)) return;
      if ((!allowedApi.has(pathname) && !(mpesa && pathname === "/api/payments/mpesa/callback")) ||
          req.method !== "POST") { deny(403); return; }
      app(req, res);
    } catch {
      event("fixture_request_failed", { requestId, family });
      if (!res.headersSent) deny(503); else res.end();
    }
  });
  phase = "listen";
  await new Promise<void>((resolve, reject) => {
    server!.once("error", reject);
    server!.listen(port, "127.0.0.1", () => { server!.off("error", reject); resolve(); });
  });
  // Bearer material stays in a private temporary directory, never logs/evidence/Git.
  const statePath = path.join(directory, "state.json");
  await writeFile(statePath, JSON.stringify(encodeState({ origin, token: link.token, url: `${origin}/pay/${link.token}`,
    ...(publicOrigin ? { publicUrl: `${publicOrigin}${basePath}/pay/${link.token}` } : {}),
    ...(mpesa ? { sessionSecret: process.env.SESSION_SECRET, orderId: order.id, buyerId } : {}),
  }, mpesa ? process.env.MPESA_WEBHOOK_SECRET : undefined)),
    { mode: 0o600, flag: "wx" });
  await chmod(statePath, 0o600);
  event("fixture_ready", { localOnly: !publicOrigin, providersEnabled: mpesa, simulationsEnabled: false });
} catch (error: any) {
  event("fixture_start_failed", {
    phase,
    code: typeof error?.code === "string" && /^[A-Z0-9_]{1,40}$/.test(error.code) ? error.code : "FIXTURE_START_FAILED",
    ...(typeof error?.column === "string" && /^[a-z_]{1,63}$/.test(error.column) ? { column: error.column } : {}),
  });
  await stop();
  process.exitCode = 1;
}
