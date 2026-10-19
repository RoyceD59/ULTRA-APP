import { pool } from "@workspace/db";
import { ensureCompanionCatalogueSchema } from "../src/lib/companion-catalogue.js";
import { ensureSkuRegister, applySkuMasterStock } from "../src/lib/sku-master.js";

// Applies the 7 Oct 2026 master-workbook stock snapshot to inventory rows that
// are still "unknown". Preview by default; --apply writes with audit rows.
const apply = process.argv.includes("--apply");
try {
  if (process.argv.slice(2).some(a => !["--apply", "--approved-production-import"].includes(a))) throw new Error("usage");
  if (apply && !["development", "test"].includes(process.env.NODE_ENV ?? "") &&
      !process.argv.includes("--approved-production-import")) throw new Error("Production stock changes require separate explicit approval.");
  await ensureSkuRegister();
  if (!apply) {
    const r = await pool.query(`SELECT COUNT(*)::int AS n FROM uc_sku_register s JOIN uc_catalogue_inventory i ON i.sku=s.sku
      WHERE i.stock_status='unknown'`);
    process.stdout.write(`${JSON.stringify({ mode: "preview", wouldUpdateChildren: r.rows[0].n })}\n`);
  } else {
    await ensureCompanionCatalogueSchema();
    process.stdout.write(`${JSON.stringify({ mode: "apply", ...(await applySkuMasterStock("sku-master-v7")) })}\n`);
  }
} catch (e) {
  process.stderr.write(`Stock snapshot not applied: ${(e as Error).message}\n`);
  process.exitCode = 1;
} finally { await pool.end(); }
