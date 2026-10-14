import express, { type Express, type Request, type Response, type NextFunction } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import { clerkMiddleware } from "@clerk/express";
import { publishableKeyFromHost } from "@clerk/shared/keys";
import {
  CLERK_PROXY_PATH,
  clerkProxyMiddleware,
  getClerkProxyHost,
} from "./middlewares/clerkProxyMiddleware";
import { buildCorsOrigins } from "./lib/cors-origins.js";
import router from "./routes";
import { rejectDeletedUcAccounts } from "./lib/uc-deleted-guard.js";
import productImagesRouter from "./routes/product-images";
import { productImageDirectory } from "./lib/product-image-directory.js";
import { logger } from "./lib/logger";
import { runtimeRequestMiddleware, boundedApiRoute } from "./lib/runtime-observability.js";
import runtimeDiagnosticsRouter from "./routes/runtime-diagnostics.js";
import { createDevelopmentFixtureProxy } from "./dev/guest-pay-fixture-proxy.js";

const app: Express = express();
app.use(runtimeRequestMiddleware);
// Temporary synthetic-test ingress is handled before parsers/auth/loggers.
// Its own bounded logs never include capability paths, queries or request data.
app.use("/api/guest-pay-fixture", createDevelopmentFixtureProxy({
  record: fields => logger.info({ event: "guest_pay_fixture_proxy", ...fields }, "Synthetic test fixture request"),
}));

// ─── Raw-body capture for routes that need HMAC verification ─────────────────
// express.json() replaces the readable stream, so we must buffer the raw bytes
// BEFORE the global JSON middleware for any route that verifies HMAC signatures.
// We attach them to req.rawBody so the webhook handler can verify against the
// exact bytes received over the wire, not a re-serialised version.
function rawBodyMiddleware(req: Request, _res: Response, next: NextFunction): void {
  (req as Request & { rawBody: Buffer }).rawBody = req.body as Buffer;
  try {
    req.body = JSON.parse((req.body as Buffer).toString("utf8")) as unknown;
  } catch {
    req.body = {};
  }
  next();
}

app.use(
  ["/api/payments/paystack/webhook", "/api/payments/stripe/webhook"],
  express.raw({ type: "*/*", limit: "1mb" }),
  rawBodyMiddleware,
);

app.use(
  "/api/webhook/ingest",
  express.raw({ type: "*/*", limit: "1mb" }),
  rawBodyMiddleware,
);

app.use(
  "/api/uc/webhooks/woocommerce",
  express.raw({ type: "*/*", limit: "1mb" }),
  rawBodyMiddleware,
);

// Orchestrator status-callback (echo) endpoint — HMAC-verified against the
// exact raw bytes, same scheme as /api/webhook/ingest.
app.use(
  "/api/ai/echo",
  express.raw({ type: "*/*", limit: "1mb" }),
  rawBodyMiddleware,
);

app.use(
  pinoHttp({
    logger,
      genReqId: (_req, res) => res.locals.correlationId,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          route: boundedApiRoute(req.url || ""),
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
// ─── Clerk proxy (production social sign-in) ─────────────────────────────────
// Streams raw bytes to Clerk's Frontend API — must be mounted before any body
// parser. Dev traffic goes to Clerk's dev FAPI directly and never hits this.
if (process.env.PREVIEW_SAFE_MODE !== "1") {
  app.use(CLERK_PROXY_PATH, clerkProxyMiddleware());
}

// ─── CORS ─────────────────────────────────────────────────────────────────────
// Expo web and the separately hosted production web apps call the API from
// different origins. Native builds do not enforce CORS.
// Origin list is built by buildCorsOrigins() so the same logic can be tested
// without duplicating it.
app.use((req, res, next) => {
  res.setHeader("Access-Control-Expose-Headers", "X-Correlation-ID");
  if (req.path === "/api/uc/impact/forest" &&
      (req.method === "GET" || req.method === "HEAD" ||
       (req.method === "OPTIONS" && ["GET", "HEAD"].includes(String(req.headers["access-control-request-method"]))))) {
    return cors({ origin: "*", methods: ["GET", "HEAD", "OPTIONS"], credentials: false })(req, res, next);
  }
  return cors({ origin: buildCorsOrigins(process.env) })(req, res, next);
});
app.use("/api/diagnostics", runtimeDiagnosticsRouter);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
// Parser failures must never echo or log a capability/contact-containing
// request excerpt through Express's default error page/stack.
app.use("/api/guest-pay", (err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  res.set({ "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer", "X-Robots-Tag": "noindex" });
  res.status(400).json({ error: "Invalid private payment request", retryable: false });
});

// ─── UC deleted-account guard ────────────────────────────────────────────────
// Any /api/uc/* request carrying a valid customer JWT whose uc_users row has
// deleted_at set is rejected with 401. Mounted BEFORE the product-images
// mounts below so no /uc route — API or static — honours a stale
// post-deletion token. (Mounted at "/api" so req.path inside the guard keeps
// the /uc prefix it checks; DELETE /uc/customer stays exempt for idempotency.)
app.use("/api", rejectDeletedUcAccounts);

// Catalogue product images extracted from the official Ultra Clear catalogue.
// Served before the API router; long cache since these change rarely.
// The resize router handles ?w=/&fmt= requests (small WebP derivatives for
// the mobile app) and falls through to the static originals for everything
// else — including on any resize error.
app.use("/api/uc/product-images", productImagesRouter);
app.use(
  "/api/uc/product-images",
  express.static(productImageDirectory, {
    maxAge: "7d",
    immutable: true,
    fallthrough: false,
  }),
);

// Resolve the publishable key from the incoming request host so the same
// server can serve multiple Clerk custom domains. Falls back to
// CLERK_PUBLISHABLE_KEY when the host doesn't map to a custom domain.
// The isolated preview has no Clerk instance or credentials. Its public routes
// can still be checked, while authenticated flows require connected staging.
if (process.env.PREVIEW_SAFE_MODE !== "1") {
  app.use(
    clerkMiddleware((req) => ({
      publishableKey: publishableKeyFromHost(
        getClerkProxyHost(req) ?? "",
        process.env.CLERK_PUBLISHABLE_KEY,
      ),
    })),
  );
}

app.use("/api", router);

export default app;
