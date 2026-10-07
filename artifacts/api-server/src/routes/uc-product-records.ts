import { Router } from "express";
import { pool, db, ucProductMediaTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { isAdminRequest } from "../lib/adminAuth.js";
import { effectiveEditorial, validateEditorial } from "../lib/product-editorial.js";
import { hasWCCredentials, wcFetchAllPages, wcFetchOne, normalizeProduct } from "./uc.js";

const router = Router();
async function inventory() {
  if (!hasWCCredentials()) throw new Error("Live WooCommerce provider is not configured");
  const products = await wcFetchAllPages("/products", { status: "publish", per_page: "100" });
  if (!products) throw new Error("Published commerce identities could not be verified");
  return products;
}
async function operation(record: any, catalogue: any[]) {
  const parents = catalogue.filter(p => p.sku === record.parentSku);
  const unavailable = (diagnostic: string) => ({ ...record, imageMappings: undefined,
    commerceId: null, availability: null, livePrice: null, images: [], videoUrl: null, diagnostics: [diagnostic],
    variants: record.variants.map((v: any) => ({ ...v, variationId: null, price: null, stockStatus: null, diagnostic })) });
  if (parents.length !== 1) return unavailable(parents.length ? "commerce-identity-ambiguous" : "commerce-identity-unmatched");
  const parent = await wcFetchOne(`/products/${parents[0].id}`);
  if (!parent || parent.sku !== record.parentSku || parent.status !== "publish" ||
    !Number.isSafeInteger(Number(parent.id)) || Number(parent.id) <= 0 ||
    Number(parent.id) !== Number(parents[0].id)) return unavailable("live-identity-mismatch");
  const normalized = normalizeProduct(parent);
  const media = await db.select().from(ucProductMediaTable).where(eq(ucProductMediaTable.productId, Number(parent.id)));
  const uploaded = media.filter(m => m.type === "photo").sort((a,b) => a.position - b.position || a.id - b.id);
  const candidates = [...uploaded.map(m => ({ slot: m.position + 1, src: m.url, alt: m.alt })),
    ...((normalized.images as any[]) || []).map((p,i) => ({ ...p, slot: i + 1 }))].filter(p => {
    if (typeof p.src !== "string" || !/^https:\/\/|^\/api\//.test(p.src)) return false;
    try { const uri = new URL(p.src, "https://media.example.test");
      return !uri.username && !uri.password && !/(?:placeholder|favicon|(?:^|[/-])logo(?:[./-]|$))/i.test(uri.pathname);
    } catch { return false; }
  });
  const photos = new Map<number, any>();
  // Authored approval is only a metadata mapping onto real catalogue/attached
  // media; no placeholder files or arbitrary remote URLs become photographs.
  const actual = new Set(candidates.map(p => p.src));
  for (const mapping of record.imageMappings || []) {
    if (actual.has(mapping.src)) photos.set(mapping.slot, mapping);
  }
  for (const photo of record.galleryMapped ? [] : candidates) {
    if (photo.slot >= 1 && photo.slot <= 6 && !photos.has(photo.slot) && photo.alt?.trim()
      && ![...photos.values()].some(p => p.src === photo.src)) photos.set(photo.slot, photo);
  }
  const diagnostics: string[] = [];
  const livePrice = Number(normalized.salePrice || normalized.price || normalized.regularPrice);
  if (record.price !== null && (!Number.isFinite(livePrice) || livePrice !== record.price)) diagnostics.push("commerce-price-differs-from-approved");
  let children: any[] = [];
  if (record.variants.length) {
    const result = await wcFetchAllPages(`/products/${parent.id}/variations`, { per_page: "100" });
    if (!result) diagnostics.push("live-variations-unavailable");
    else children = result;
  }
  const variants = record.variants.map((v: any) => {
    const matches = children.filter(c => c.sku === v.childSku);
    const found = matches.length === 1 ? matches[0] : null;
    const child = found && Number.isSafeInteger(Number(found.id)) && Number(found.id) > 0 &&
      (found.parent_id === undefined || Number(found.parent_id) === Number(parent.id)) && found.status === "publish" ? found : null;
    const commercePrice = child?.price !== "" && child?.price != null ? Number(child.price) : null;
    const price = child ? record.price : null;
    const stockStatus = child && ["instock", "outofstock", "onbackorder"].includes(child.stock_status) ? child.stock_status : null;
    const diagnostic = !child ? (matches.length ? "commerce-variant-ambiguous" : "commerce-variant-unmatched")
      : !stockStatus ? "live-stock-unknown" : undefined;
    return { ...v, variationId: child ? Number(child.id) : null, price, commercePrice, stockStatus, ...(diagnostic ? { diagnostic } : {}) };
  });
  const availability = ({ instock: "InStock", outofstock: "OutOfStock", onbackorder: "BackOrder" } as Record<string,string>)[String(normalized.stockStatus)] ?? null;
  if (!availability) diagnostics.push("live-stock-unknown");
  return { ...record, imageMappings: undefined, commerceId: Number(parent.id), availability, livePrice: Number.isFinite(livePrice) ? livePrice : null,
    images: [...photos.values()].sort((a,b) => a.slot - b.slot), variants,
    videoUrl: media.find(m => m.type === "video")?.url ?? null, diagnostics };
}

router.get("/uc/product-records", async (_req, res): Promise<void> => {
  res.setHeader("Cache-Control", "no-store");
  const { collection } = await effectiveEditorial();
  res.json({ products: collection.products.map(({ imageMappings: _, ...p }: any) => p), topics: collection.topics });
});
router.get("/uc/product-records/:key", async (req, res): Promise<void> => {
  res.setHeader("Cache-Control", "no-store");
  const { collection, input } = await effectiveEditorial();
  const key = String(req.params.key);
  let record = collection.products.find((p: any) => [p.slug, p.code, p.parentSku].includes(key));
  let catalogue: any[] = [];
  try { catalogue = await inventory(); }
  catch {
    if (!record) { res.status(503).json({ error: "Live product identity unavailable. Open the product's permanent address or retry." }); return; }
  }
  if (!record && /^[1-9]\d*$/.test(key)) {
    const parent = catalogue.find(p => Number(p.id) === Number(key));
    record = collection.products.find((p: any) => p.parentSku === parent?.sku);
  }
  if (!record) {
    const live = catalogue.find(p => String(p.id) === key);
    const accessory = live && input.accessories.find((a: any) => a.sku === live.sku);
    const held = (input.held_back || []).some((p: any) => p.sku === live?.sku);
    res.status(404).json({ error: "Published product record not found", ...(accessory && !held ? { legacy: true } : {}) }); return;
  }
  try { res.json(await operation(record, catalogue)); }
  catch { res.json({ ...record, imageMappings: undefined, commerceId: null, availability: null, images: [],
    videoUrl: null, variants: record.variants.map((v: any) => ({ ...v, variationId: null, price: null, stockStatus: null })),
    diagnostics: ["commerce-provider-unavailable"] }); }
});
router.get("/uc/admin/product-records/:key", async (req, res): Promise<void> => {
  if (!(await isAdminRequest(req.headers.authorization))) { res.status(403).json({ error: "Admin access required" }); return; }
  res.setHeader("Cache-Control", "no-store");
  const { input, rows } = await effectiveEditorial();
  let record = input.products.find((p: any) => [p.slug,p.code,p.parent_sku].includes(String(req.params.key)));
  if (!record) { res.status(404).json({ error: "Full v2.4 product record not found" }); return; }
  let revision = rows.get(record.code)?.revision ?? 1;
  // One-time non-destructive metadata migration. Existing storage objects and
  // WooCommerce images are not changed. A concurrent editor always wins.
  if (!rows.get(record.code)?.gallery_mapped && record.images.every((i: any) => !i.approved && i.file.startsWith("images/"))) {
    try {
      const { collection } = await effectiveEditorial();
      const projected = collection.products.find((p: any) => p.code === record.code);
      if (projected) {
        const current = await operation(projected, await inventory());
        if (current.images.length) {
          const migrated = { ...record, images: record.images.map((i: any) => {
            const actual = current.images.find((p: any) => p.slot === i.slot);
            return actual ? { ...i, file: actual.src, alt: actual.alt, approved: true } : i;
          }) };
          const changed = await pool.query(`UPDATE uc_product_editorial SET record=$3,gallery_mapped=true,revision=revision+1,updated_at=now()
            WHERE code=$1 AND revision=$2 RETURNING record,revision`, [record.code,revision,JSON.stringify(migrated)]);
          if (changed.rows[0]) { record = changed.rows[0].record; revision = changed.rows[0].revision; }
          else {
            const latest = await pool.query("SELECT record,revision FROM uc_product_editorial WHERE code=$1", [record.code]);
            if (latest.rows[0]) { record = latest.rows[0].record; revision = latest.rows[0].revision; }
          }
        }
      }
    } catch { /* Live media is optional for editing text; do not invent mapping. */ }
  }
  res.json({ revision, record });
});
router.get("/uc/admin/product-records", async (req, res): Promise<void> => {
  if (!(await isAdminRequest(req.headers.authorization))) { res.status(403).json({ error: "Admin access required" }); return; }
  res.setHeader("Cache-Control", "no-store");
  const { input } = await effectiveEditorial();
  res.json({ records: input.products.map((p: any) => ({ code: p.code, slug: p.slug,
    name: p.name, parent_sku: p.parent_sku, publishable: p.publishable })) });
});
router.put("/uc/admin/product-records/:key", async (req, res): Promise<void> => {
  if (!(await isAdminRequest(req.headers.authorization))) { res.status(403).json({ error: "Admin access required" }); return; }
  const { input } = await effectiveEditorial();
  const previous = input.products.find((p: any) => [p.slug,p.code,p.parent_sku].includes(String(req.params.key)));
  if (!previous) { res.status(404).json({ error: "Full v2.4 product record not found" }); return; }
  const { revision, record } = req.body ?? {};
  try {
    if (!Number.isInteger(revision) || revision < 1 || Object.keys(req.body).some(k => !["revision","record"].includes(k))) throw new Error("Expected revision and record");
    validateEditorial(record, previous, input);
    const changedImages = record.images.filter((i: any) => i.approved && !previous.images.some((old: any) => old.file === i.file && old.approved));
    if (changedImages.length) {
      const matches = (await inventory()).filter(p => p.sku === previous.parent_sku);
      if (matches.length !== 1) throw new Error("Verify a unique live product before assigning photographs");
      const media = await db.select().from(ucProductMediaTable).where(eq(ucProductMediaTable.productId, Number(matches[0].id)));
      const urls = new Set([...media.filter(m => m.type === "photo").map(m => m.url),
        ...((normalizeProduct(matches[0]).images as any[]) || []).map(i => i.src)]);
      if (changedImages.some((i: any) => !urls.has(i.file))) throw new Error("Choose an existing product photo or attach it through the secure upload flow first");
    }
  } catch (error) { res.status(400).json({ error: (error as Error).message }); return; }
  const result = await pool.query(`UPDATE uc_product_editorial SET record=$3,gallery_mapped=(gallery_mapped OR $4),revision=revision+1,updated_at=now()
    WHERE code=$1 AND revision=$2 RETURNING revision,record`, [previous.code,revision,JSON.stringify(record),
      JSON.stringify(previous.images) !== JSON.stringify(record.images)]);
  if (!result.rows[0]) { res.status(409).json({ error: "Another editor saved this product. Reload the latest record before saving." }); return; }
  res.json(result.rows[0]);
});
export default router;
