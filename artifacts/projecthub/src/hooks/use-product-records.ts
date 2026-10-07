import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/team-auth";

export interface RecordImage {
  slot: number; label: string; file: string; alt: string | null; approved: boolean;
  pictured_colour?: string; child_sku?: string;
}
export type RecordJson = Record<string, unknown> & {
  code: string; slug: string; parent_sku: string; publishable?: boolean; name?: string;
  price_kes: number | null; images: RecordImage[];
  variants: { child_sku: string; label: string }[];
};
export interface AdminRecord { revision: string | number; record: RecordJson }

export const SLOT_LABELS = ["Product", "In use", "Parts", "Included", "Colours", "Size"];
export const IMMUTABLE_KEYS = ["code", "slug", "parent_sku"];

export function isConflict(err: unknown) {
  return (err as { status?: number })?.status === 409
    || (err instanceof Error && /conflict|revision|changed by someone/i.test(err.message));
}

export function useProductRecord(sku: string | undefined) {
  return useQuery({
    queryKey: ["uc-product-record", sku],
    queryFn: () => apiFetch<AdminRecord>(`/uc/admin/product-records/${encodeURIComponent(sku!)}`),
    enabled: !!sku,
    retry: false,
    staleTime: 0,
  });
}

export function useSaveProductRecord(sku: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: AdminRecord) =>
      apiFetch<AdminRecord>(`/uc/admin/product-records/${encodeURIComponent(sku!)}`, {
        method: "PUT", body: JSON.stringify(body),
      }),
    onSuccess: (saved) => {
      if (saved?.record) qc.setQueryData(["uc-product-record", sku], saved);
      else qc.invalidateQueries({ queryKey: ["uc-product-record", sku] });
    },
  });
}

export interface AuthoredRecordSummary { code: string; slug: string; name: string; parent_sku: string; publishable?: boolean }
/** Lists every authored full record, matched to commerce or not. */
export function useAuthoredRecords() {
  return useQuery({
    queryKey: ["uc-product-records-admin"],
    queryFn: async () => {
      const r = await apiFetch<{ records: AuthoredRecordSummary[] } | AuthoredRecordSummary[]>("/uc/admin/product-records");
      return Array.isArray(r) ? r : r.records;
    },
    retry: false,
    staleTime: 60_000,
  });
}
