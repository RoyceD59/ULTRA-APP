import { Router, type Request } from "express";
import { createHmac, timingSafeEqual } from "node:crypto";
import { pool } from "@workspace/db";
import { transitionOrderStatus } from "../lib/order-status-pipeline.js";
import { logger } from "../lib/logger.js";

const router = Router();

function validWooSignature(raw: Buffer, provided: string | undefined, secret: string): boolean {
  if (!provided) return false;
  const expectedBase64 = createHmac("sha256", secret).update(raw).digest("base64");
  const expectedHex = createHmac("sha256", secret).update(raw).digest("hex");
  const candidates = [provided.trim(), provided.trim().replace(/^sha256=/i, "")];
  return candidates.some((candidate) => {
    const expected = candidate.length === expectedHex.length ? expectedHex : expectedBase64;
    const left = Buffer.from(candidate);
    const right = Buffer.from(expected);
    return left.length === right.length && timingSafeEqual(left, right);
  });
}

/** WooCommerce order status webhook.  Signature verification happens before
 * any database lookup, and the delivery id makes retries idempotent. */
router.post("/uc/webhooks/woocommerce", async (req, res): Promise<void> => {
  const secret = process.env["WC_WEBHOOK_SECRET"] || process.env["WOOCOMMERCE_WEBHOOK_SECRET"];
  if (!secret) {
    res.status(503).json({ error: "WooCommerce webhook secret is not configured" });
    return;
  }
  const raw = (req as Request & { rawBody?: Buffer }).rawBody;
  if (!raw || !validWooSignature(raw, String(req.headers["x-wc-webhook-signature"] ?? ""), secret)) {
    res.status(401).json({ error: "Invalid or missing WooCommerce webhook signature" });
    return;
  }
  const body = (req.body ?? {}) as Record<string, unknown>;
  const wooId = Number(body["id"]);
  const status = typeof body["status"] === "string" ? body["status"] : "";
  if (!Number.isInteger(wooId) || wooId <= 0 || !status) {
    res.status(400).json({ error: "WooCommerce order id and status are required" });
    return;
  }
  try {
    const found = await pool.query(
      "SELECT id FROM uc_orders WHERE wc_order_id=$1 LIMIT 1",
      [wooId],
    );
    if (!found.rows[0]) {
      // Woo can deliver a status before the local checkout confirmation. It is
      // safe to acknowledge; reconciliation will pick it up once linked.
      res.json({ accepted: true, linked: false });
      return;
    }
    const result = await transitionOrderStatus({
      orderId: Number(found.rows[0].id),
      status,
      deliveryId: String(req.headers["x-wc-webhook-delivery-id"] ?? ""),
      modifiedAt: typeof body["date_modified_gmt"] === "string"
        ? body["date_modified_gmt"]
        : typeof body["date_modified"] === "string" ? body["date_modified"] : undefined,
      sourceVersion: typeof body["version"] === "string" || typeof body["version"] === "number"
        ? String(body["version"])
        : undefined,
      actor: "woocommerce",
      source: "woocommerce",
    });
    res.json({ accepted: true, linked: true, repeated: result.repeated, customerStage: result.customerStage });
  } catch (error) {
    logger.error({ err: error, wooId }, "WooCommerce order status webhook failed");
    res.status(500).json({ error: "Order status could not be recorded" });
  }
});

export default router;