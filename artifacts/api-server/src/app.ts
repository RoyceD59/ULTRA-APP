import express, { type Express, type Request, type Response, type NextFunction } from "express";
import path from "node:path";
import cors from "cors";
import pinoHttp from "pino-http";
import { clerkMiddleware } from "@clerk/express";
import { publishableKeyFromHost } from "@clerk/shared/keys";
import {
  CLERK_PROXY_PATH,
  clerkProxyMiddleware,
  getClerkProxyHost,
} from "./middlewares/clerkProxyMiddleware";
import router from "./routes";
import { logger } from "./lib/logger";

const app: Express = express();

// ─── Raw-body capture for Paystack webhook ────────────────────────────────────
// express.json() replaces the readable stream, so we must buffer the raw bytes
// BEFORE the global JSON middleware for any route that needs HMAC verification.
// We attach them to req.rawBody so the webhook handler can verify the signature.
app.use(
  "/api/payments/paystack/webhook",
  express.raw({ type: "*/*", limit: "1mb" }),
  (req: Request, _res: Response, next: NextFunction) => {
    // express.raw() puts the Buffer in req.body; expose it as rawBody and also
    // parse the JSON so the rest of the handler can read req.body normally.
    (req as Request & { rawBody: Buffer }).rawBody = req.body as Buffer;
    try {
      req.body = JSON.parse((req.body as Buffer).toString("utf8")) as unknown;
    } catch {
      req.body = {};
    }
    next();
  }
);

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
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
app.use(CLERK_PROXY_PATH, clerkProxyMiddleware());

// ─── CORS ─────────────────────────────────────────────────────────────────────
// The Expo web preview runs on a different origin (https://$REPLIT_EXPO_DEV_DOMAIN)
// than the API server, so its browser fetches need CORS headers. We only allow
// the Replit dev-domain origins, and only outside production — native builds
// don't enforce CORS, and the production web apps are served same-origin.
const corsAllowedOrigins: string[] = [];
if (process.env.NODE_ENV !== "production") {
  for (const domain of [
    process.env.REPLIT_EXPO_DEV_DOMAIN,
    process.env.REPLIT_DEV_DOMAIN,
  ]) {
    if (domain) corsAllowedOrigins.push(`https://${domain}`);
  }
}
app.use(cors({ origin: corsAllowedOrigins.length > 0 ? corsAllowedOrigins : false }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Catalogue product images extracted from the official Ultra Clear catalogue.
// Served before the API router; long cache since these change rarely.
app.use(
  "/api/uc/product-images",
  express.static(path.join(process.cwd(), "public", "products"), {
    maxAge: "7d",
    immutable: true,
    fallthrough: false,
  }),
);

// Resolve the publishable key from the incoming request host so the same
// server can serve multiple Clerk custom domains. Falls back to
// CLERK_PUBLISHABLE_KEY when the host doesn't map to a custom domain.
app.use(
  clerkMiddleware((req) => ({
    publishableKey: publishableKeyFromHost(
      getClerkProxyHost(req) ?? "",
      process.env.CLERK_PUBLISHABLE_KEY,
    ),
  })),
);

app.use("/api", router);

export default app;
