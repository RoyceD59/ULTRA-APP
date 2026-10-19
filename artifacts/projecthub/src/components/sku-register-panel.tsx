import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getAuthHeaders } from "@/lib/team-auth";
import { API_ORIGIN } from "@/lib/api-base";

interface RegisterSku {
  sku: string; parentSku: string; model: string; variant: string | null; colour: string | null;
  filterLifeLitres: number | null; lifecycle: string; sheetStockStatus: string; sheetQuantity: number;
  retailPriceKes: number | null; productPage: string | null;
  appStockStatus: string | null; appStockQuantity: number | null;
}

async function fetchRegister(): Promise<{ source: string | null; skus: RegisterSku[] }> {
  const res = await fetch(`${API_ORIGIN}/api/uc/admin/sku-register`, { headers: getAuthHeaders() ?? {} });
  if (!res.ok) {
    const d = await res.json().catch(() => ({})) as { error?: string };
    throw new Error(d.error ?? `Request failed (${res.status})`);
  }
  return res.json();
}

const kes = (n: number | null) => n === null ? "Not priced" : `KES ${n.toLocaleString("en-KE")}`;

export function SkuRegisterPanel() {
  const [query, setQuery] = useState("");
  const { data, isLoading, error } = useQuery({ queryKey: ["uc-sku-register"], queryFn: fetchRegister, staleTime: 60_000 });
  const q = query.trim().toLowerCase();
  const rows = (data?.skus ?? []).filter(r =>
    !q || [r.sku, r.parentSku, r.model, r.variant, r.colour].some(v => v?.toLowerCase().includes(q)));
  return (
    <section className="space-y-3" data-testid="sku-register">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-lg font-semibold">Company SKU register</h2>
          <p className="text-sm text-muted-foreground">
            Every company SKU from the master workbook{data?.source ? ` (${data.source})` : ""}. Retail price and the
            workbook's stock count are reference values; the app stock above is what customers see. SKUs without a
            product page cannot be bought in the app yet.
          </p>
        </div>
        <Input className="max-w-xs" placeholder="Search SKU or model" value={query} onChange={e => setQuery(e.target.value)} />
      </div>
      {isLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : error ? (
        <p className="text-sm text-destructive">{(error as Error).message}</p>
      ) : (
        <div className="rounded-lg border overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>SKU</TableHead><TableHead>Model</TableHead><TableHead>Variant</TableHead>
                <TableHead className="text-right">Retail</TableHead><TableHead className="text-right">Filter life</TableHead>
                <TableHead>Lifecycle</TableHead><TableHead className="text-right">Workbook stock</TableHead>
                <TableHead>App stock</TableHead><TableHead>Product page</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map(r => (
                <TableRow key={r.sku}>
                  <TableCell className="font-mono text-xs">{r.sku}</TableCell>
                  <TableCell>{r.model}</TableCell>
                  <TableCell>{[r.variant, r.colour].filter(Boolean).join(" · ") || "—"}</TableCell>
                  <TableCell className="text-right">{kes(r.retailPriceKes)}</TableCell>
                  <TableCell className="text-right">{r.filterLifeLitres === null ? "—" : `${r.filterLifeLitres} L`}</TableCell>
                  <TableCell><Badge variant="outline">{r.lifecycle}</Badge></TableCell>
                  <TableCell className="text-right">
                    {r.sheetQuantity}{r.sheetStockStatus === "FUTURE" ? " (future)" : ""}
                  </TableCell>
                  <TableCell>{r.appStockStatus === null ? "—" : r.appStockQuantity !== null
                    ? `${r.appStockQuantity} · ${r.appStockStatus}` : r.appStockStatus}</TableCell>
                  <TableCell>{r.productPage ?? <span className="text-muted-foreground">None</span>}</TableCell>
                </TableRow>
              ))}
              {rows.length === 0 && (
                <TableRow><TableCell colSpan={9} className="text-center text-muted-foreground">No SKUs match.</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      )}
    </section>
  );
}
