import { hasWCCredentials, wcFetchArray, MOCK_PRODUCTS } from "../routes/uc.js";
import type { InstantWaterCheckResult } from "./instant-water-check.js";

// Exact SKUs from the maintained catalogue/product reference; family fit only,
// never a claim that a model removes contaminants for this particular supply.
export const WATER_RECOMMENDATION_TARGETS: Record<string, { sku: string; name: string }> = {
  "Shower & skin filtration": { sku: "UC-SHW-DCR-017", name: "Derma Care" },
  "Filter bottles & portable filtration": { sku: "UC-BTL-HFX-001", name: "Hydra Flux" },
  "Survivor-grade portable filtration": { sku: "UC-STR-SVV-007", name: "Survivor Straw" },
  "Home & kitchen filtration": { sku: "UC-FCT-SWH-011", name: "Sweet Home" },
  "Sweet Home faucet filtration": { sku: "UC-FCT-SWH-011", name: "Sweet Home" },
};

type CatalogueLoader = (sku: string) => Promise<Array<{ id?: unknown; sku?: unknown; name?: unknown }> | null>;
const loadCatalogue: CatalogueLoader = sku => hasWCCredentials()
  ? wcFetchArray("/products", { sku, status: "publish", per_page: "10" }, AbortSignal.timeout(5000))
  : Promise.resolve(MOCK_PRODUCTS);

export async function withWaterRecommendationTarget(rec: InstantWaterCheckResult["recommendation"], load: CatalogueLoader = loadCatalogue): Promise<InstantWaterCheckResult["recommendation"]> {
  const target = WATER_RECOMMENDATION_TARGETS[rec.name];
  if (!target) return { ...rec, action: "enquiry" };
  const products = await load(target.sku);
  const match = products?.find(p => p.sku === target.sku && p.name === target.name && Number.isSafeInteger(p.id) && Number(p.id) > 0);
  if (!match) return { ...rec, action: "enquiry" };
  return { ...rec, action: "product", productId: Number(match.id), productName: target.name };
}