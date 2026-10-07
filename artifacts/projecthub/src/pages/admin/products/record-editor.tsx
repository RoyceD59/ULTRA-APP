import { Link, useParams } from "wouter";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { isTeamAdmin } from "@/lib/team-auth";
import { ProductRecordEditor } from "@/components/product-record-editor";

/** Editorial-only editor addressed by slug; operational data is read-only/unavailable. */
export default function AdminRecordOnlyEditorPage() {
  const { slug } = useParams<{ slug: string }>();
  if (!isTeamAdmin()) return <div className="flex items-center justify-center h-64 text-muted-foreground">You don't have permission to view this page.</div>;
  return (
    <div className="space-y-6 pb-20">
      <div className="flex items-center gap-3">
        <Button variant="outline" size="icon" asChild className="h-9 w-9"><Link href="/admin/products"><ArrowLeft className="w-4 h-4" /></Link></Button>
        <h1 className="text-2xl font-bold truncate">Edit page record: {slug}</h1>
      </div>
      <ProductRecordEditor sku={slug} />
    </div>
  );
}
