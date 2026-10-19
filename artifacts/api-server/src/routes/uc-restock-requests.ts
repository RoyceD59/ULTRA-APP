import { Router } from "express";
import type { PoolClient } from "pg";
import rateLimit from "express-rate-limit";
import { pool } from "@workspace/db";
import {
  SubmitUcRestockRequestBody, SubmitUcRestockRequestResponse,
  ListUcRestockRequestsQueryParams, ListUcRestockRequestsResponse,
  UpdateUcRestockRequestBody, UpdateUcRestockRequestParams, UpdateUcRestockRequestResponse,
} from "@workspace/api-zod";
import { verifyToken } from "../lib/jwt.js";
import { isAdminRequest } from "../lib/adminAuth.js";
import { normalizePhone } from "../lib/customer-identity.js";
import { effectiveEditorial } from "../lib/product-editorial.js";
import { restockKeys, safeRestockErrorCode } from "../lib/restock-requests.js";
import { logger } from "../lib/logger.js";

const router = Router();
const LIMIT = 50;
router.use(["/uc/restock-requests", "/uc/admin/restock-requests"], (_req, res, next) => {
  res.setHeader("Cache-Control", "private, no-store");
  next();
});
const submissionLimit = rateLimit({
  windowMs: 15 * 60_000, limit: 20, standardHeaders: "draft-7", legacyHeaders: false,
  skip: () => process.env.NODE_ENV === "test",
  message: { error: "Too many requests. Please wait before trying again." },
});

router.post("/uc/restock-requests", submissionLimit, async (req, res): Promise<void> => {
  const parsed = SubmitUcRestockRequestBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Check the product and required contact details." }); return; }
  const input = parsed.data;
  const name = input.contact.name.trim(), location = input.contact.location.trim();
  const phone = normalizePhone(input.contact.phone);
  if (!phone || name.length < 2 || location.length < 2 || /[\u0000-\u001f]/.test(name + location)
    || !/^[a-zA-Z0-9_-]{16,100}$/.test(input.idempotencyKey)) {
    res.status(400).json({ error: "Enter a name, an international phone number (for example +254…) and a town or area." }); return;
  }
  const authorization = req.headers.authorization;
  const claims = authorization ? verifyToken(authorization) : null;
  if (authorization && (!claims || claims.type === "team-session" || claims.mustChangePassword
    || !Number.isSafeInteger(Number(claims.id)) || Number(claims.id) <= 0 || Number(claims.id) >= 1_000_000_000)) {
    res.status(401).json({ error: "Sign in again before saving this customer request." }); return;
  }
  const customerId = claims ? Number(claims.id) : null;
  let client: PoolClient | undefined;
  try {
    // Resolve independent reads before reserving a transaction connection.
    // effectiveEditorial uses this same pool: holding a client here can
    // deadlock all writers when concurrent submissions fill the pool.
    const { collection } = await effectiveEditorial();
    const product = collection.products.find((record: any) =>
      [record.slug, record.code, record.parentSku].includes(input.productKey.trim()));
    if (!product) { res.status(404).json({ error: "Published product not found." }); return; }
    const variants = product.variants ?? [];
    const variant = variants.find((item: any) => item.childSku === input.variantSku);
    if ((variants.length > 0 && !variant) || (input.variantSku && !variant)) {
      res.status(400).json({ error: "Choose an available product option before requesting a stock update." }); return;
    }
    const variantSku = variant?.childSku ?? null;
    const keys = restockKeys(customerId ? `customer:${customerId}` : `guest:${phone}`, product.code, variantSku, input.idempotencyKey);
    client = await pool.connect();
    await client.query("BEGIN");
    if (customerId) {
      const account = await client.query(`SELECT credential_version FROM uc_users
        WHERE id = $1 AND deleted_at IS NULL FOR SHARE`, [customerId]);
      if (!account.rowCount || (claims!.credentialVersion ?? 0) !== account.rows[0].credential_version) {
        await client.query("ROLLBACK");
        res.status(401).json({ error: "Sign in again before saving this customer request." }); return;
      }
    }
    await client.query(`INSERT INTO uc_restock_requests
      (customer_id,kind,name,phone,location,product_code,product_name,product_slug,parent_sku,
        variant_sku,variant_label,request_key,demand_key)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) ON CONFLICT DO NOTHING`,
    [customerId, customerId ? "customer" : "guest", name, phone, location, product.code, product.name,
      product.slug, product.parentSku, variantSku, variant?.label ?? null, keys.requestKey, keys.demandKey]);
    // Preserve registered restock notifications using only an exact local
    // parent SKU identity. Guest contact data never enters the wishlist.
    if (customerId) {
      await client.query(`INSERT INTO uc_wishlist(user_id,product_id,product_name)
        SELECT $1::text,id,$2 FROM uc_catalogue_inventory
        WHERE sku = $3 AND parent_sku IS NULL AND archived = false
        ON CONFLICT(user_id,product_id) DO NOTHING`, [String(customerId), product.name, product.parentSku]);
    }
    await client.query("COMMIT");
    res.status(202).json(SubmitUcRestockRequestResponse.parse({ saved: true, status: "pending" }));
  } catch (error) {
    await client?.query("ROLLBACK").catch(() => undefined);
    (req.log ?? logger).error({ code: safeRestockErrorCode(error) }, "Restock request could not be saved");
    res.status(503).json({ error: "We could not save your request. Please retry explicitly." });
  } finally { client?.release(); }
});

router.get("/uc/admin/restock-requests", async (req, res): Promise<void> => {
  if (!await isAdminRequest(req.headers.authorization)) {
    res.status(req.headers.authorization ? 403 : 401).json({ error: "Staff administration required." }); return;
  }
  const query = ListUcRestockRequestsQueryParams.safeParse(req.query);
  const page = query.success ? query.data.page ?? 1 : 0;
  if (!query.success || !Number.isSafeInteger(page) || page < 1 || page > 1_000_000) {
    res.status(400).json({ error: "Invalid status filter or page." }); return;
  }
  const status = query.data.status ?? "pending";
  try {
    const filter = status === "all" ? null : status;
    const [rows, total, demand] = await Promise.all([
      pool.query(`SELECT id,customer_id::text AS "customerId",kind,name,phone,location,
        product_code AS "productCode",product_name AS "productName",product_slug AS "productSlug",
        parent_sku AS "parentSku",variant_sku AS "variantSku",variant_label AS "variantLabel",status,
        created_at::text AS "createdAt",updated_at::text AS "updatedAt"
        FROM uc_restock_requests WHERE ($1::text IS NULL OR status=$1)
        ORDER BY created_at DESC,id DESC LIMIT $2 OFFSET $3`, [filter, LIMIT, (page - 1) * LIMIT]),
      pool.query("SELECT count(*)::int AS n FROM uc_restock_requests WHERE ($1::text IS NULL OR status=$1)", [filter]),
      pool.query(`SELECT product_code AS "productCode",product_name AS "productName",variant_sku AS "variantSku",
        count(*)::int AS "waitingCount",count(*) FILTER(WHERE kind='guest')::int AS "guestCount",
        count(*) FILTER(WHERE kind='customer')::int AS "customerCount"
        FROM uc_restock_requests WHERE status IN ('pending','contacted')
        GROUP BY product_code,product_name,variant_sku ORDER BY count(*) DESC,product_code,variant_sku`),
    ]);
    res.json(ListUcRestockRequestsResponse.parse({ requests: rows.rows, demand: demand.rows, total: total.rows[0].n, page, pageSize: LIMIT }));
  } catch (error) {
    (req.log ?? logger).error({ code: safeRestockErrorCode(error) }, "Restock staff list unavailable");
    res.status(503).json({ error: "Restock requests are temporarily unavailable." });
  }
});

router.patch("/uc/admin/restock-requests/:id", async (req, res): Promise<void> => {
  if (!await isAdminRequest(req.headers.authorization)) {
    res.status(req.headers.authorization ? 403 : 401).json({ error: "Staff administration required." }); return;
  }
  const params = UpdateUcRestockRequestParams.safeParse(req.params);
  const body = UpdateUcRestockRequestBody.safeParse(req.body);
  if (!params.success || !body.success || !Number.isSafeInteger(params.data.id) || params.data.id < 1) {
    res.status(400).json({ error: "Invalid request or status." }); return;
  }
  try {
    const result = await pool.query(`UPDATE uc_restock_requests SET status=$2,updated_at=now(),
      resolved_at=CASE WHEN $2='resolved' THEN COALESCE(resolved_at,now()) ELSE NULL END
      WHERE id=$1 AND ($2='resolved' OR (name IS NOT NULL AND phone IS NOT NULL AND location IS NOT NULL))
      RETURNING id`, [params.data.id, body.data.status]);
    if (!result.rowCount) {
      const exists = await pool.query("SELECT id FROM uc_restock_requests WHERE id=$1", [params.data.id]);
      res.status(exists.rowCount ? 409 : 404).json({ error: exists.rowCount
        ? "Contact details were erased. A new request is needed before reopening."
        : "Request not found." }); return;
    }
    res.json(UpdateUcRestockRequestResponse.parse({ saved: true, status: body.data.status }));
  } catch (error) {
    const conflict = safeRestockErrorCode(error) === "23505";
    if (!conflict) (req.log ?? logger).error({ code: safeRestockErrorCode(error) }, "Restock status update failed");
    res.status(conflict ? 409 : 503).json({ error: conflict
      ? "A newer pending request already exists for this customer and product."
      : "The request could not be updated. Please retry." });
  }
});
export default router;
