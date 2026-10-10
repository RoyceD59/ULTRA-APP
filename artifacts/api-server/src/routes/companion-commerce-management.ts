import { Router } from "express";
import { pool } from "@workspace/db";
import { isAdminRequest } from "../lib/adminAuth.js";
import { companionCatalogue, updateCompanionInventory } from "../lib/companion-catalogue.js";
import { effectiveEditorial, validateEditorial } from "../lib/product-editorial.js";
import { normalizeProduct, invalidateCatalogueCache } from "./uc.js";
import { logger } from "../lib/logger.js";
import { verifyToken } from "../lib/jwt.js";
import { checkoutOrderResponse } from "../lib/checkout-orders.js";

const router = Router();
router.post("/uc/orders", async (req, res, next) => {
  if (req.body?.fulfillment !== undefined) { next(); return; }
  // Old clients may inspect an already-created owned order, but must not admit
  // a new unreserved checkout or replace a payment whose outcome is unknown.
  const claims = verifyToken(req.headers.authorization);
  const reference = req.body?.paymentReference;
  if (claims && typeof reference === "string" && reference.trim()) {
    const result = await pool.query("SELECT * FROM uc_orders WHERE user_id=$1 AND payment_reference=$2", [String(claims.id), reference]);
    const order = result.rows[0];
    if (order) {
      const response = await checkoutOrderResponse(order);
      res.status(order.checkout_state === "confirmed" ? 200 : 202)
        .json({ ...response, reconciliationRequired: order.checkout_state !== "confirmed" }); return;
    }
  }
  res.status(409).json({ error: "Refresh your basket and use the updated checkout. Keep any existing payment reference for recovery; do not pay again.", code: "APP_CHECKOUT_REFRESH_REQUIRED", retryable: false });
});
router.get("/uc/commerce/status", async (_req, res) => {
  const row = (await pool.query("SELECT state FROM uc_commerce_migration WHERE key='history'")).rows[0];
  res.setHeader("Cache-Control", "no-store");
  res.json({ authority: "companion", legacyHistory: row?.state === "complete_reviewed" ? "reviewed" : "pending_review" });
});
router.get("/uc/admin/commerce-migration", async (req, res) => {
  if (!await isAdminRequest(req.headers.authorization)) { res.status(403).json({ error: "Admin access required" }); return; }
  const history = (await pool.query("SELECT state,summary FROM uc_commerce_migration WHERE key='history'")).rows[0];
  const inventory = (await pool.query("SELECT COUNT(*)::integer AS unknown FROM uc_catalogue_inventory WHERE stock_status='unknown' AND archived=false")).rows[0];
  const review = await pool.query("SELECT woo_order_id,local_order_id,state FROM uc_legacy_order_imports WHERE state<>'imported' ORDER BY woo_order_id");
  res.setHeader("Cache-Control", "no-store");
  res.json({ authority: "companion", history: history ?? { state: "pending_review", summary: {} },
    unknownInventoryCount: inventory.unknown, unresolvedOrders: review.rows,
    productionCutoverApproved: false });
});
router.get("/uc/admin/sku-register", async (req, res) => {
  if (!await isAdminRequest(req.headers.authorization)) { res.status(403).json({ error: "Admin access required" }); return; }
  const result = await pool.query(`SELECT s.sku,s.parent_sku,s.model,s.variant,s.colour,s.filter_life_litres,
      s.life_source,s.lifecycle,s.sheet_stock_status,s.sheet_quantity,s.retail_price_kes,s.source,
      i.code AS page_code,i.stock_status AS app_stock_status,i.stock_quantity AS app_stock_quantity
    FROM uc_sku_register s LEFT JOIN uc_catalogue_inventory i ON i.sku=s.sku AND NOT i.archived
    ORDER BY s.parent_sku,s.sku`);
  res.setHeader("Cache-Control", "no-store");
  res.json({ source: result.rows[0]?.source ?? null, skus: result.rows.map(r => ({
    sku: r.sku, parentSku: r.parent_sku, model: r.model, variant: r.variant, colour: r.colour,
    filterLifeLitres: r.filter_life_litres, lifecycle: r.lifecycle, sheetStockStatus: r.sheet_stock_status,
    sheetQuantity: r.sheet_quantity, retailPriceKes: r.retail_price_kes === null ? null : Number(r.retail_price_kes),
    productPage: r.page_code, appStockStatus: r.app_stock_status, appStockQuantity: r.app_stock_quantity })) });
});
router.use("/uc/admin/products", async (req, res, next) => {
  if (!await isAdminRequest(req.headers.authorization)) {
    res.status(403).json({ error: "Admin access required" }); return;
  }
  next();
});
router.get("/uc/admin/products", async (_req, res) => {
  const products = await companionCatalogue(true);
  res.setHeader("Cache-Control", "no-store");
  res.json(products.filter(p => p.type !== "variation").map(p => ({
    ...normalizeProduct(p), recordCode: p.code, source: "companion",
  })));
});
router.get("/uc/admin/products/:id", async (req, res) => {
  const product = (await companionCatalogue(true)).find(p => p.id === Number(req.params.id));
  if (!product) { res.status(404).json({ error: "App product not found" }); return; }
  res.setHeader("Cache-Control", "no-store");
  res.json({ ...normalizeProduct(product), recordCode: product.code, source: "companion" });
});

router.get("/uc/admin/inventory", async (req, res) => {
  if (!await isAdminRequest(req.headers.authorization)) { res.status(403).json({ error: "Admin access required" }); return; }
  const products = await companionCatalogue(true);
  res.setHeader("Cache-Control", "no-store");
  res.json({ source: "companion", products: products.map(p => ({
    id: p.id, name: p.name, sku: p.sku, recordCode: p.code,
    parentId: p.parent_id ?? null, stockStatus: p.stock_status,
    stockQuantity: p.stock_on_hand, availableQuantity: p.stock_quantity,
    reservedQuantity: p.stock_reserved, manageStock: p.manage_stock,
    revision: p.revision, permalink: null, syncedAt: new Date().toISOString(),
  })) });
});

router.patch("/uc/admin/inventory/:productId", async (req, res) => {
  if (!await isAdminRequest(req.headers.authorization)) { res.status(403).json({ error: "Admin access required" }); return; }
  const id = Number(req.params.productId);
  if (!Number.isSafeInteger(id) || id < 1 ||
      !req.body || !Object.hasOwn(req.body, "stockQuantity") ||
      Object.keys(req.body).some(k => !["stockQuantity", "stockStatus", "revision"].includes(k))) {
    res.status(400).json({ error: "Provide a product ID and stock quantity (null means unmanaged)." }); return;
  }
  try {
    const updated = await updateCompanionInventory(id, {
      stock_quantity: req.body.stockQuantity,
      // An explicit count is reviewed availability, not an imported guess.
      stock_status: req.body.stockStatus ?? (req.body.stockQuantity === null ? "instock" :
        req.body.stockQuantity === 0 ? "outofstock" : "instock"),
      revision: req.body.revision,
    }, "authorized-admin");
    invalidateCatalogueCache();
    res.json({ ok: true, productId: id, stockQuantity: updated.stock_quantity,
      stockStatus: updated.stock_status, revision: updated.revision, source: "companion" });
  } catch (error) {
    const known = error as Error & { status?: number; code?: string };
    if (known.code) { logger.error({ err: error, productId: id }, "App inventory update failed"); res.status(500).json({ error: "Inventory could not be saved." }); return; }
    res.status(known.status ?? 400).json({ error: known.message });
  }
});

router.patch("/uc/admin/products/:id", async (req, res) => {
  const id = Number(req.params.id), body = req.body;
  if (!Number.isSafeInteger(id) || id < 1 || !body || Array.isArray(body) ||
      !Object.keys(body).length || Object.keys(body).some(k =>
        !["name", "description", "shortDescription", "regularPrice", "salePrice",
          "stockStatus", "stockQuantity", "revision"].includes(k))) {
    res.status(400).json({ error: "Invalid product update" }); return;
  }
  // The full authored editor owns content. This compatibility editor writes
  // the same price/name fields, never an independent commerce price.
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const row = (await client.query("SELECT * FROM uc_catalogue_inventory WHERE id=$1 FOR UPDATE", [id])).rows[0];
    if (!row) throw Object.assign(new Error("App product not found"), { status: 404 });
    if (row.parent_sku && ["name", "regularPrice", "description", "shortDescription"].some(k => k in body)) {
      throw new Error("Edit variant labels and shared prices through the authored parent record.");
    }
    if (body.salePrice !== undefined && body.salePrice !== "") throw new Error("Use managed promotions for discounts; there is one shared retail price.");
    const { input } = await effectiveEditorial();
    const previous = input.products.find((p: any) => p.code === row.code);
    if (!previous) throw new Error("The shared product record is unavailable");
    const record = structuredClone(previous);
    for (const key of ["name", "description", "shortDescription"]) {
      if (body[key] !== undefined && (typeof body[key] !== "string" || !body[key].trim() ||
          body[key].length > 12000 || /<\/?[a-z][^>]*>/i.test(body[key]))) throw new Error(`${key} must be nonempty plain text`);
    }
    if (body.name !== undefined) record.name = body.name.trim();
    if (body.description !== undefined) record.summary = { ...record.summary, heading: body.description };
    if (body.shortDescription !== undefined) record.seo.h1_sub = body.shortDescription;
    if (body.regularPrice !== undefined) {
      const price = typeof body.regularPrice === "string" && body.regularPrice.trim() !== "" ? Number(body.regularPrice) : NaN;
      if (!Number.isFinite(price) || price < 0 || !/^\d+(?:\.\d{1,2})?$/.test(body.regularPrice)) throw new Error("Price must be a nonnegative amount with at most two decimal places");
      record.price_kes = price;
      record.ownership = { ...record.ownership, product_price_kes: price };
    }
    validateEditorial(record, previous, input);
    await client.query(`SELECT code FROM uc_product_editorial WHERE code=$1 FOR UPDATE`, [row.code]);
    // Lock the authored revision as well as inventory. Never overwrite a full
    // editor save that completed after our snapshot was read.
    const current = (await client.query("SELECT record FROM uc_product_editorial WHERE code=$1", [row.code])).rows[0];
    if (JSON.stringify(current?.record) !== JSON.stringify(previous)) throw Object.assign(new Error("Product changed; refresh before saving."), { status: 409 });
    if (body.revision !== undefined && body.revision !== row.revision) throw Object.assign(new Error("Inventory changed; refresh before saving."), { status: 409 });
    if ("stockQuantity" in body || "stockStatus" in body) {
      const managed = "stockQuantity" in body ? body.stockQuantity !== null : row.manage_stock;
      const quantity = "stockQuantity" in body ? body.stockQuantity : row.stock_quantity;
      let status = body.stockStatus ?? row.stock_status;
      if (!["unknown", "instock", "outofstock", "onbackorder"].includes(status)) throw new Error("Invalid stock status");
      if (managed && (!Number.isSafeInteger(quantity) || quantity < 0)) throw new Error("Stock must be a nonnegative whole number");
      const held = Number((await client.query("SELECT COALESCE(SUM(quantity),0) AS held FROM uc_inventory_reservations WHERE inventory_id=$1 AND state='reserved'", [id])).rows[0].held);
      if (held && (!managed || quantity < held)) throw new Error("Resolve reserved orders before reducing available inventory.");
      if (managed && quantity === 0) status = "outofstock";
      await client.query(`UPDATE uc_catalogue_inventory SET stock_quantity=$2,manage_stock=$3,stock_status=$4,
        revision=revision+1,updated_at=now() WHERE id=$1`, [id, managed ? quantity : null, managed, status]);
    } else await client.query("UPDATE uc_catalogue_inventory SET revision=revision+1,updated_at=now() WHERE id=$1", [id]);
    await client.query("UPDATE uc_product_editorial SET record=$2,revision=revision+1,updated_at=now() WHERE code=$1", [row.code, JSON.stringify(record)]);
    await client.query("INSERT INTO uc_inventory_audit(inventory_id,actor,action,revision) SELECT id,'authorized-admin','product_edit',revision FROM uc_catalogue_inventory WHERE id=$1", [id]);
    await client.query("COMMIT");
    invalidateCatalogueCache();
    res.json({ ok: true, productId: id, updated: Object.keys(body), source: "companion" });
  } catch (error) {
    await client.query("ROLLBACK");
    const known = error as Error & { status?: number; code?: string };
    if (known.code) { logger.error({ err: error, productId: id }, "App product update failed"); res.status(500).json({ error: "Product could not be saved." }); return; }
    res.status(known.status ?? 400).json({ error: known.message });
  } finally { client.release(); }
});
router.post("/uc/admin/inventory/sync", async (req, res) => {
  if (!await isAdminRequest(req.headers.authorization)) { res.status(403).json({ error: "Admin access required" }); return; }
  res.status(410).json({ error: "External inventory writeback is retired. Review and edit app-owned stock in ProjectHub." });
});
export default router;
