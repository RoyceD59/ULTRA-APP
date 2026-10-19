import { useState } from "react";
import { Link } from "wouter";
import { PackageSearch, Search, Loader2, Edit } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { isTeamAdmin } from "@/lib/team-auth";
import { useProducts, STOCK_LABELS, type StockStatus } from "@/hooks/use-products";
import { CreateProductRecordDialog } from "@/components/create-product-record-dialog";
import { useAuthoredRecords } from "@/hooks/use-product-records";
import { Card, CardContent } from "@/components/ui/card";
import { API_ORIGIN } from "@/lib/api-base";

export default function AdminProductsPage() {
  const [searchQuery, setSearchQuery] = useState("");
  const [stockFilter, setStockFilter] = useState<"all" | StockStatus>("all");
  const { data: products, isLoading, error } = useProducts();
  const authored = useAuthoredRecords();
  const matched = new Set((products ?? []).map(p => p.sku));

  if (!isTeamAdmin()) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground">
        You don't have permission to view this page.
      </div>
    );
  }

  const normalizedSearch = searchQuery.trim().toLocaleLowerCase();
  const filteredProducts = (products ?? []).filter((product) => {
    const searchMatches = normalizedSearch === ""
      || product.name.toLocaleLowerCase().includes(normalizedSearch)
      || product.sku.toLocaleLowerCase().includes(normalizedSearch);
    const stockMatches = stockFilter === "all" || product.stockStatus === stockFilter;
    return searchMatches && stockMatches;
  });

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <PackageSearch className="w-6 h-6" /> Product Catalogue
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            App-owned products: create, edit, manage variants and archive. Archiving keeps orders and history.
          </p>
        </div>
        {authored.data && <CreateProductRecordDialog templates={authored.data} />}
      </div>

      <div className="flex flex-wrap items-center gap-4 bg-card p-4 rounded-lg border">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input 
            type="search" 
            placeholder="Search products by name or SKU..." 
            className="pl-9"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
        <select
          aria-label="Filter products by stock status"
          value={stockFilter}
          onChange={(event) => setStockFilter(event.target.value as typeof stockFilter)}
          className="h-10 rounded-md border border-input bg-background px-3 text-sm"
        >
          <option value="all">All stock states</option>
          <option value="instock">In stock</option>
          <option value="outofstock">Out of stock</option>
          <option value="onbackorder">On backorder</option>
          <option value="unknown">Stock unknown</option>
        </select>
        <div className="text-sm text-muted-foreground">
          Showing {filteredProducts.length} {filteredProducts.length === 1 ? 'product' : 'products'}
        </div>
      </div>

      <Card><CardContent className="p-4 space-y-3">
        <h2 className="font-semibold text-sm">Product records</h2>
        {authored.isLoading ? <div className="text-sm text-muted-foreground flex gap-2"><Loader2 className="w-4 h-4 animate-spin" />Loading records...</div>
          : authored.isError ? <div className="text-sm text-destructive">Records unavailable: {authored.error.message} <Button size="sm" variant="outline" onClick={() => authored.refetch()}>Retry</Button></div>
          : <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {(authored.data ?? []).filter(r => !normalizedSearch || r.name.toLocaleLowerCase().includes(normalizedSearch) || r.parent_sku.toLocaleLowerCase().includes(normalizedSearch)).map(r => (
              <div key={r.code} className="flex items-center justify-between gap-2 rounded-md border p-3">
                <div className="min-w-0"><div className="text-sm font-medium truncate">{r.name}</div>
                  <div className="text-xs font-mono text-muted-foreground">{r.parent_sku}</div>
                  <div className="flex gap-1 mt-1">
                    <Badge variant={r.publishable ? "default" : "secondary"}>{r.publishable ? "Publishable" : "Held back"}</Badge>
                    {!matched.has(r.parent_sku) && <Badge variant="outline">No operational link</Badge>}
                  </div></div>
                <Button size="sm" variant="secondary" asChild><Link href={products?.filter(p => p.sku === r.parent_sku).length === 1
                  ? `/admin/products/${products.find(p => p.sku === r.parent_sku)!.id}` : `/admin/products/record/${r.slug}`}><Edit className="w-3.5 h-3.5 mr-1.5" />Page</Link></Button>
              </div>))}
          </div>}
      </CardContent></Card>

      {isLoading ? (
        <div className="flex items-center justify-center h-40 text-muted-foreground gap-2">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading catalogue...
        </div>
      ) : error ? (
        <div className="rounded-lg border border-destructive/50 bg-destructive/5 p-6 text-sm text-destructive">
          Failed to load products: {(error as Error).message}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {filteredProducts.map((product) => (
            <Card key={product.id} className="overflow-hidden flex flex-col">
              <div className="aspect-[4/3] bg-muted relative overflow-hidden flex-shrink-0">
                {product.images[0] ? (
                  <img 
                    src={product.images[0].src.startsWith("http") ? product.images[0].src : `${API_ORIGIN}${product.images[0].src}`} 
                    alt={product.images[0].alt || product.name} 
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-muted-foreground">
                    <PackageSearch className="w-8 h-8 opacity-20" />
                  </div>
                )}
                {product.stockStatus !== "instock" && (
                  <div className="absolute top-2 right-2">
                    <Badge variant={product.stockStatus === "unknown" ? "secondary" : "destructive"} className="shadow-sm">{STOCK_LABELS[product.stockStatus] ?? product.stockStatus}</Badge>
                  </div>
                )}
              </div>
              <CardContent className="p-4 flex-1 flex flex-col">
                <div className="text-xs font-mono text-muted-foreground mb-1">{product.sku || "No SKU"}</div>
                <h3 className="font-semibold text-sm leading-tight line-clamp-2 mb-2">{product.name}</h3>
                
                <div className="mt-auto pt-4 flex items-center justify-between">
                  <div className="font-medium text-sm">
                    {product.salePrice ? (
                      <div className="flex flex-col">
                        <span className="line-through text-xs text-muted-foreground">{product.regularPrice}</span>
                        <span className="text-green-600 dark:text-green-500">{product.salePrice} KES</span>
                      </div>
                    ) : (
                      <span>{product.regularPrice || product.price ? `${product.regularPrice || product.price} KES` : "—"}</span>
                    )}
                  </div>
                  
                  <Button size="sm" variant="secondary" asChild>
                    <Link href={`/admin/products/${product.id}`}>
                      <Edit className="w-3.5 h-3.5 mr-1.5" />
                      Edit
                    </Link>
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
          
          {filteredProducts.length === 0 && (
            <div className="col-span-full py-12 text-center text-muted-foreground">
              <PackageSearch className="w-12 h-12 mx-auto opacity-20 mb-3" />
              <p>{(products ?? []).length === 0 ? "No operational products yet. Create a product record to begin." : "No products match these filters."}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
