import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/team-auth";
import { trackEvent } from "@/lib/analytics";

export interface ProductMedia {
  id: number;
  productId: number;
  type: "photo" | "video";
  url: string;
  alt: string;
  position: number;
  createdAt: string;
}

/** "unknown" = awaiting staff stock review; not available and not zero. */
export type StockStatus = "instock" | "outofstock" | "onbackorder" | "unknown";
export const STOCK_LABELS: Record<StockStatus, string> = {
  instock: "In stock", outofstock: "Out of stock", onbackorder: "On backorder", unknown: "Stock unknown",
};

export interface Product {
  id: number;
  name: string;
  price: string;
  regularPrice: string;
  salePrice: string;
  description: string;
  shortDescription: string;
  tagline: string;
  categories: { id: number; name: string }[];
  images: { src: string; alt: string }[];
  sku: string;
  stockStatus: StockStatus;
  /** null = quantity not managed (never treat as zero). */
  stockQuantity: number | null;
  source?: string;
  tags: { name: string }[];
  lifespanDays: number;
  filterCapacityLitres: number;
  enquiryOnly: boolean;
  totalSales: number;
}

export interface ProductUpdate {
  name?: string;
  description?: string;
  shortDescription?: string;
  regularPrice?: string;
  salePrice?: string;
  stockStatus?: StockStatus;
  /** null switches to unmanaged quantity. */
  stockQuantity?: number | null;
}

export interface UploadUrlResponse {
  uploadURL: string;
  objectPath: string;
  reference?: string;
}

export function useProducts() {
  return useQuery({
    queryKey: ["uc-products"],
    queryFn: () => apiFetch<Product[]>("/uc/admin/products"),
    staleTime: 60_000,
  });
}

export function useProduct(id: number | null) {
  return useQuery({
    queryKey: ["uc-product", id],
    queryFn: () => apiFetch<Product>(`/uc/admin/products/${id}`),
    enabled: id !== null && !isNaN(id),
    staleTime: 60_000,
  });
}

export function useProductMedia(id: number | null) {
  return useQuery({
    queryKey: ["uc-product-media", id],
    queryFn: () => apiFetch<ProductMedia[]>(`/uc/admin/products/${id}/media`),
    enabled: id !== null && !isNaN(id),
    staleTime: 60_000,
  });
}

export function useUpdateProduct() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: number; data: ProductUpdate }) =>
      apiFetch<{ ok: boolean; productId: number; updated: string[]; source: string }>(`/uc/admin/products/${id}`, {
        method: "PATCH",
        body: JSON.stringify(data),
      }),
    onSuccess: (_, { id, data }) => {
      trackEvent("product_saved", { productId: id, fieldCount: Object.keys(data).length });
      if (data.stockQuantity !== undefined || data.stockStatus !== undefined) {
        trackEvent("inventory_updated", {
          productId: id,
          stockQuantity: data.stockQuantity ?? undefined,
          stockStatus: data.stockStatus === "unknown" ? undefined : data.stockStatus,
        });
      }
      qc.invalidateQueries({ queryKey: ["uc-product", id] });
      qc.invalidateQueries({ queryKey: ["uc-products"] });
      qc.invalidateQueries({ queryKey: ["uc-inventory"] });
    },
  });
}

export function useAddProductMedia() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, url, type, alt }: { id: number; url: string; type: "photo" | "video"; alt?: string }) =>
      apiFetch<ProductMedia>(`/uc/admin/products/${id}/media`, {
        method: "POST",
        body: JSON.stringify({ url, type, alt }),
      }),
    onSuccess: (_, { id }) => {
      qc.invalidateQueries({ queryKey: ["uc-product-media", id] });
      qc.invalidateQueries({ queryKey: ["uc-product", id] });
      qc.invalidateQueries({ queryKey: ["uc-products"] });
    },
  });
}

export function useDeleteProductMedia() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ productId, mediaId }: { productId: number; mediaId: number }) =>
      apiFetch<{ ok: boolean }>(`/uc/admin/media/${mediaId}`, {
        method: "DELETE",
      }),
    onSuccess: (_, { productId }) => {
      qc.invalidateQueries({ queryKey: ["uc-product-media", productId] });
      qc.invalidateQueries({ queryKey: ["uc-product", productId] });
      qc.invalidateQueries({ queryKey: ["uc-products"] });
    },
  });
}

export function requestUploadUrl(meta: { name: string; size: number; contentType: string }) {
  return apiFetch<UploadUrlResponse>("/uc/uploads/request-url", {
    method: "POST",
    body: JSON.stringify(meta),
  });
}
