import { useState, useEffect, useRef } from "react";
import { useParams, Link } from "wouter";
import { 
  ArrowLeft, Save, Loader2, Image as ImageIcon, Video, Trash2,
  UploadCloud
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { 
  useProduct, useProductMedia, useUpdateProduct, 
  useAddProductMedia, useDeleteProductMedia, requestUploadUrl, ProductUpdate, STOCK_LABELS, type StockStatus
} from "@/hooks/use-products";
import { isTeamAdmin } from "@/lib/team-auth";
import { API_ORIGIN } from "@/lib/api-base";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ProductRecordEditor } from "@/components/product-record-editor";

export default function AdminProductEditorPage() {
  const params = useParams<{ id: string }>();
  const productId = parseInt(params.id ?? "", 10);
  const { toast } = useToast();
  const { data: product, isLoading, error } = useProduct(productId);
  const { data: media, isLoading: mediaLoading } = useProductMedia(productId);
  
  const updateProduct = useUpdateProduct();
  const addMedia = useAddProductMedia();
  const deleteMedia = useDeleteProductMedia();

  const [formData, setFormData] = useState<ProductUpdate>({});
  const initializedForId = useRef<number | null>(null);
  const [qtyText, setQtyText] = useState("");
  const [saveState, setSaveState] = useState<{ kind: "saved" | "error"; message: string } | null>(null);

  useEffect(() => {
    if (product && initializedForId.current !== productId) {
      setFormData({
        name: product.name,
        shortDescription: product.shortDescription.replace(/<[^>]*>/g, ""),
        description: product.description.replace(/<[^>]*>/g, ""),
        regularPrice: product.regularPrice,
        stockStatus: product.stockStatus,
        stockQuantity: product.stockQuantity,
      });
      setQtyText(product.stockQuantity === null || product.stockQuantity === undefined ? "" : String(product.stockQuantity));
      initializedForId.current = productId;
    }
  }, [product, productId]);

  const handleSave = () => {
    setSaveState(null);
    const t = qtyText.trim();
    if (t !== "" && !/^\d+$/.test(t)) {
      setSaveState({ kind: "error", message: "Managed quantity must be a whole number of 0 or more, or blank for unmanaged." });
      return;
    }
    const data: ProductUpdate = { ...formData, stockQuantity: t === "" ? null : Number(t) };
    if (data.stockStatus === "unknown") delete data.stockStatus;
    updateProduct.mutate({ id: productId, data }, {
      onSuccess: () => {
        setSaveState({ kind: "saved", message: `Saved at ${new Date().toLocaleTimeString()}. Companion reads these values from the shared product record.` });
        toast({ title: "Product saved", description: "Operational fields saved to the app product record." });
      },
      onError: (err: Error) => {
        const conflict = (err as { status?: number }).status === 409;
        setSaveState({ kind: "error", message: conflict ? "Someone else changed this product. Reload the page to see the latest values before saving again." : err.message });
        toast({ title: "Failed to save", description: err.message, variant: "destructive" });
      }
    });
  };

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setUploading(true);
    try {
      const type = file.type.startsWith("video/") ? "video" : "photo";
      const { uploadURL, objectPath, reference } = await requestUploadUrl({
        name: file.name,
        size: file.size,
        contentType: file.type,
      });

      const putRes = await fetch(uploadURL, {
        method: "PUT",
        body: file,
        headers: { "Content-Type": file.type },
      });

      if (!putRes.ok) throw new Error("Upload to storage failed");

      const url = reference || `/api/storage${objectPath}`;
      
      await addMedia.mutateAsync({ id: productId, url, type, alt: file.name });
      toast({ title: "Media uploaded", description: "File has been added to the product." });
      if (fileInputRef.current) fileInputRef.current.value = "";
    } catch (err) {
      toast({ title: "Upload failed", description: err instanceof Error ? err.message : String(err), variant: "destructive" });
    } finally {
      setUploading(false);
    }
  };

  if (!isTeamAdmin()) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground">
        You don't have permission to view this page.
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground gap-2">
        <Loader2 className="w-5 h-5 animate-spin" /> Loading product...
      </div>
    );
  }

  if (error || !product) {
    return (
      <div className="rounded-lg border border-destructive/50 bg-destructive/5 p-6 text-sm text-destructive">
        Failed to load product: {error?.message || "Not found"}
      </div>
    );
  }

  // Identify base images (those not overridden by team media)
  const overlayUrls = new Set((media || []).map(m => m.url));
  const baseImages = (product.images || []).filter(img => !overlayUrls.has(img.src));

  return (
    <div className="space-y-6 pb-20">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Button variant="outline" size="icon" asChild className="h-9 w-9">
            <Link href="/admin/products"><ArrowLeft className="w-4 h-4" /></Link>
          </Button>
          <h1 className="text-2xl font-bold truncate">Edit {product.name}</h1>
        </div>
        <Button 
          onClick={handleSave} 
          disabled={updateProduct.isPending}
          className="gap-2"
        >
          {updateProduct.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          Save product fields
        </Button>
      </div>
      {saveState && (
        <div role={saveState.kind === "error" ? "alert" : "status"} data-testid="status-product-save"
          className={saveState.kind === "error" ? "rounded-md border border-destructive/50 bg-destructive/5 p-3 text-sm text-destructive" : "rounded-md border border-green-300 bg-green-50 dark:bg-green-950/20 p-3 text-sm text-green-800 dark:text-green-300"}>
          {saveState.message}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>General Information</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="name">Product Name</Label>
                <Input 
                  id="name" 
                  value={formData.name ?? ""} 
                  onChange={e => setFormData({ ...formData, name: e.target.value })} 
                />
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="shortDescription">Short Description</Label>
                <Textarea 
                  id="shortDescription" 
                  value={formData.shortDescription ?? ""} 
                  onChange={e => setFormData({ ...formData, shortDescription: e.target.value })} 
                  rows={3}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="description">Full Description</Label>
                <Textarea 
                  id="description" 
                  value={formData.description ?? ""} 
                  onChange={e => setFormData({ ...formData, description: e.target.value })} 
                  rows={8}
                />
              </div>
            </CardContent>
          </Card>

          <ProductRecordEditor sku={product.sku} product={product} media={media || []} />

          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>Team Media</CardTitle>
                  <CardDescription>Extra photos or product video.</CardDescription>
                </div>
                <div>
                  <input 
                    type="file" 
                    ref={fileInputRef} 
                    className="hidden" 
                    accept="image/*,video/mp4,video/webm" 
                    onChange={handleFileUpload} 
                  />
                  <Button 
                    variant="outline" 
                    size="sm" 
                    onClick={() => fileInputRef.current?.click()}
                    disabled={uploading || addMedia.isPending}
                  >
                    {uploading || addMedia.isPending ? (
                      <Loader2 className="w-4 h-4 animate-spin mr-2" />
                    ) : (
                      <UploadCloud className="w-4 h-4 mr-2" />
                    )}
                    Upload Media
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {mediaLoading ? (
                <div className="flex justify-center p-4 text-muted-foreground"><Loader2 className="w-5 h-5 animate-spin" /></div>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                  {(media || []).map((m) => (
                    <div key={m.id} className="relative group aspect-square rounded-md border overflow-hidden bg-muted">
                      {m.type === "photo" ? (
                        <img src={m.url.startsWith("http") ? m.url : `${API_ORIGIN}${m.url}`} alt={m.alt} className="w-full h-full object-cover" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center bg-primary/10 text-primary">
                          <Video className="w-8 h-8" />
                        </div>
                      )}
                      <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                        <Button 
                          variant="destructive" 
                          size="icon" 
                          onClick={() => {
                            if (window.confirm("Remove this team-uploaded media from the product?")) {
                              deleteMedia.mutate({ productId, mediaId: m.id });
                            }
                          }}
                          disabled={deleteMedia.isPending}
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    </div>
                  ))}
                  {(media || []).length === 0 && (
                    <div className="col-span-full text-center text-sm text-muted-foreground py-6 border border-dashed rounded-md">
                      No team media uploaded yet.
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Catalogue Images</CardTitle>
              <CardDescription>Read-only images already attached to this product record.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-3 sm:grid-cols-5 gap-4">
                {baseImages.map((img, i) => (
                  <div key={i} className="aspect-square rounded-md border overflow-hidden bg-muted relative">
                    <img src={img.src.startsWith("http") ? img.src : `${API_ORIGIN}${img.src}`} alt={img.alt} className="w-full h-full object-cover" />
                    <div className="absolute bottom-1 right-1 bg-black/60 rounded px-1.5 py-0.5">
                      <ImageIcon className="w-3 h-3 text-white" />
                    </div>
                  </div>
                ))}
                {baseImages.length === 0 && (
                  <div className="col-span-full text-center text-sm text-muted-foreground py-4">
                    No catalogue images.
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Companion Preview</CardTitle>
              <CardDescription>Customer-facing summary. Visible only once the record is publishable.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="aspect-[4/3] overflow-hidden rounded-md border bg-muted">
                {product.images[0] ? (
                  <img
                    src={product.images[0].src.startsWith("http") ? product.images[0].src : `${API_ORIGIN}${product.images[0].src}`}
                    alt={product.images[0].alt || product.name}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div className="flex h-full items-center justify-center text-muted-foreground">
                    <ImageIcon className="h-8 w-8" />
                  </div>
                )}
              </div>
              <div>
                <p className="font-semibold">{formData.name || product.name}</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {formData.shortDescription || "No short description"}
                </p>
              </div>
              <p className="font-medium">
                KES {formData.regularPrice || product.price || "—"}
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Pricing</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="regularPrice">Regular Price (KES)</Label>
                <Input 
                  id="regularPrice" 
                  value={formData.regularPrice ?? ""} 
                  onChange={e => setFormData({ ...formData, regularPrice: e.target.value })} 
                />
              </div>
              <p className="text-xs text-muted-foreground" data-testid="text-sale-price-note">
                Regular price is the authoritative record price used at checkout. There is no separate sale price: discounts come from promotions, so they stay consistent and auditable.
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Inventory</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="sku">SKU</Label>
                <Input id="sku" value={product.sku || ""} disabled className="bg-muted" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="stockStatus">Stock Status</Label>
                <select
                  id="stockStatus"
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                  value={formData.stockStatus ?? "unknown"}
                  onChange={e => setFormData({
                    ...formData,
                    stockStatus: e.target.value as StockStatus,
                  })}
                >
                  {formData.stockStatus === "unknown" && <option value="unknown" disabled>{STOCK_LABELS.unknown} (choose a reviewed state)</option>}
                  <option value="instock">In Stock</option>
                  <option value="outofstock">Out of Stock</option>
                  <option value="onbackorder">On Backorder</option>
                </select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="stockQuantity">Managed quantity</Label>
                <Input 
                  id="stockQuantity" 
                  type="number"
                  min={0}
                  placeholder="Unmanaged"
                  value={qtyText}
                  onChange={e => setQtyText(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">Leave blank for unmanaged quantity. Blank is not zero.</p>
              </div>
              {formData.stockStatus === "unknown" && (
                <div className="rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-950/20 p-3 text-xs text-amber-900 dark:text-amber-300">
                  Stock has not been reviewed. Customers cannot buy this product until a staff member sets a reviewed status.
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
