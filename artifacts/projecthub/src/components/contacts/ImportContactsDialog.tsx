import { useState, useCallback, useRef } from "react";
import * as XLSX from "@e965/xlsx";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useToast } from "@/hooks/use-toast";
import {
  Upload,
  FileSpreadsheet,
  X,
  CheckCircle2,
} from "lucide-react";
import { getListContactsQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";

// ─── Types ────────────────────────────────────────────────────────────────────

interface RawRow {
  [key: string]: string | number | boolean | null | undefined;
}

interface ImportRow {
  fullName: string;
  tags: string[];
  email?: string;
  phone?: string;
  phoneChannel: "sms" | "whatsapp";
  recordId?: string;
}

interface ImportResult {
  created: number;
  skipped: number;
  failed: number;
}

// ─── Column Mapping ───────────────────────────────────────────────────────────

function mapRow(row: RawRow): ImportRow | null {
  const str = (v: unknown) =>
    v === null || v === undefined ? "" : String(v).trim();

  const fullName = str(row["full_name"]);
  if (!fullName) return null;

  const tags: string[] = [];

  // Primary_Product → tag
  const primary = str(row["Primary_Product"]);
  if (primary) tags.push(primary);

  // Secondary_product → tag
  const secondary = str(row["Secondary_product"]);
  if (secondary) tags.push(secondary);

  // Customer_active → "active" / "inactive"
  const active = str(row["Customer_active"]).toLowerCase();
  if (active === "yes" || active === "true" || active === "1") {
    tags.push("active");
  } else if (active === "no" || active === "false" || active === "0") {
    tags.push("inactive");
  }

  // Consent → "consent:yes" / "consent:no"
  const consent = str(row["Consent"]).toLowerCase();
  if (consent === "yes" || consent === "true" || consent === "1") {
    tags.push("consent:yes");
  } else if (consent === "no" || consent === "false" || consent === "0") {
    tags.push("consent:no");
  }

  // Unique Record_ID → id:<value>
  const recordId = str(row["Unique Record_ID"]);
  if (recordId) tags.push(`id:${recordId}`);

  // Preferred_contact → channel for phone
  const preferred = str(row["Preferred_contact"]).toLowerCase();
  const phoneChannel: "sms" | "whatsapp" =
    preferred === "whatsapp" ? "whatsapp" : "sms";

  return {
    fullName,
    tags,
    email: str(row["email"]) || undefined,
    phone: str(row["phone"]) || undefined,
    phoneChannel,
    recordId: recordId || undefined,
  };
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface ImportContactsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function ImportContactsDialog({
  open,
  onOpenChange,
}: ImportContactsDialogProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [dragging, setDragging] = useState(false);
  const [workbook, setWorkbook] = useState<XLSX.WorkBook | null>(null);
  const [fileName, setFileName] = useState("");
  const [sheets, setSheets] = useState<string[]>([]);
  const [selectedSheet, setSelectedSheet] = useState("");
  const [previewRows, setPreviewRows] = useState<RawRow[]>([]);
  const [mappedRows, setMappedRows] = useState<ImportRow[]>([]);
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [step, setStep] = useState<"pick" | "preview" | "done">("pick");
  const [result, setResult] = useState<ImportResult | null>(null);

  // ── File parsing ──────────────────────────────────────────────────────────

  function parseWorkbook(file: File) {
    const reader = new FileReader();
    reader.onload = (e) => {
      const data = e.target?.result;
      const wb = XLSX.read(data, { type: "array" });
      setWorkbook(wb);
      setFileName(file.name);
      setSheets(wb.SheetNames);
      const firstSheet = wb.SheetNames[0] ?? "";
      setSelectedSheet(firstSheet);
      loadSheet(wb, firstSheet);
    };
    reader.readAsArrayBuffer(file);
  }

  function loadSheet(wb: XLSX.WorkBook, sheetName: string) {
    const ws = wb.Sheets[sheetName];
    if (!ws) return;
    const rows: RawRow[] = XLSX.utils.sheet_to_json(ws, { defval: "" });
    setPreviewRows(rows.slice(0, 5));
    const mapped = rows
      .map(mapRow)
      .filter((r): r is ImportRow => r !== null);
    setMappedRows(mapped);
    setStep("preview");
  }

  // ── Drag & drop ───────────────────────────────────────────────────────────

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) parseWorkbook(file);
  }, []);

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) parseWorkbook(file);
  };

  // ── Sheet change ──────────────────────────────────────────────────────────

  function handleSheetChange(name: string) {
    setSelectedSheet(name);
    if (workbook) loadSheet(workbook, name);
  }

  // ── Import ────────────────────────────────────────────────────────────────

  async function handleImport() {
    if (!mappedRows.length) return;
    setImporting(true);
    setProgress(10);

    try {
      // Send all rows to the server-side import endpoint.
      // The server handles:
      //  - deduplication against existing contact methods (emails) and record IDs
      //  - atomic contact + method creation (DB transaction per row)
      const response = await fetch("/api/contacts/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows: mappedRows }),
      });

      setProgress(90);

      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(
          (body as { error?: string }).error ?? `HTTP ${response.status}`
        );
      }

      const importResult = (await response.json()) as ImportResult;
      setProgress(100);
      setResult(importResult);
      setStep("done");

      queryClient.invalidateQueries({ queryKey: getListContactsQueryKey() });

      toast({
        title: "Import complete",
        description: `${importResult.created} contact${importResult.created !== 1 ? "s" : ""} created, ${importResult.skipped} skipped${importResult.failed > 0 ? `, ${importResult.failed} failed` : ""}.`,
      });
    } catch (err) {
      toast({
        title: "Import failed",
        description:
          err instanceof Error ? err.message : "An unexpected error occurred.",
        variant: "destructive",
      });
    } finally {
      setImporting(false);
    }
  }

  // ── Reset ─────────────────────────────────────────────────────────────────

  function handleClose() {
    setStep("pick");
    setWorkbook(null);
    setFileName("");
    setSheets([]);
    setSelectedSheet("");
    setPreviewRows([]);
    setMappedRows([]);
    setProgress(0);
    setResult(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
    onOpenChange(false);
  }

  // ── Preview column headers from raw data ──────────────────────────────────
  const previewColumns = previewRows.length
    ? Object.keys(previewRows[0]).slice(0, 6)
    : [];

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <Dialog open={open} onOpenChange={(o) => !o && handleClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileSpreadsheet className="w-5 h-5 text-primary" />
            Import Contacts from Excel / CSV
          </DialogTitle>
          <DialogDescription>
            Upload an Excel workbook or CSV. Columns are mapped automatically
            from your customer value book format.
          </DialogDescription>
        </DialogHeader>

        {/* ── Step 1: File pick ── */}
        {step === "pick" && (
          <div
            className={`relative border-2 border-dashed rounded-xl p-10 flex flex-col items-center justify-center gap-4 transition-colors cursor-pointer ${
              dragging
                ? "border-primary bg-primary/5"
                : "border-muted-foreground/30 hover:border-primary/50 hover:bg-muted/30"
            }`}
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
            onClick={() => fileInputRef.current?.click()}
          >
            <Upload className="w-10 h-10 text-muted-foreground/60" />
            <div className="text-center">
              <p className="font-semibold text-foreground">
                Drag & drop your file here
              </p>
              <p className="text-sm text-muted-foreground mt-1">
                or click to browse — .xlsx, .xls, .csv accepted
              </p>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.xls,.csv"
              className="hidden"
              onChange={onFileChange}
            />
          </div>
        )}

        {/* ── Step 2: Preview ── */}
        {step === "preview" && (
          <div className="space-y-4">
            {/* File info + sheet selector */}
            <div className="flex items-center justify-between gap-4 p-3 rounded-lg bg-muted/40 border">
              <div className="flex items-center gap-2 min-w-0">
                <FileSpreadsheet className="w-4 h-4 text-primary shrink-0" />
                <span className="text-sm font-medium truncate">{fileName}</span>
                <Badge variant="secondary" className="shrink-0">
                  {mappedRows.length} rows
                </Badge>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 shrink-0"
                onClick={() => {
                  setStep("pick");
                  setWorkbook(null);
                }}
              >
                <X className="w-4 h-4" />
              </Button>
            </div>

            {sheets.length > 1 && (
              <div className="flex items-center gap-3">
                <span className="text-sm font-medium text-muted-foreground whitespace-nowrap">
                  Sheet:
                </span>
                <Select value={selectedSheet} onValueChange={handleSheetChange}>
                  <SelectTrigger className="w-48">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {sheets.map((s) => (
                      <SelectItem key={s} value={s}>
                        {s}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* Column mapping summary */}
            <div className="rounded-lg border p-3 bg-muted/20 text-sm">
              <p className="font-semibold text-foreground mb-2">
                Auto-detected column mapping
              </p>
              <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-muted-foreground">
                <span>
                  <span className="font-mono text-xs bg-muted px-1 rounded">full_name</span> → Full Name
                </span>
                <span>
                  <span className="font-mono text-xs bg-muted px-1 rounded">email</span> → Email method
                </span>
                <span>
                  <span className="font-mono text-xs bg-muted px-1 rounded">phone</span> → SMS / WhatsApp
                </span>
                <span>
                  <span className="font-mono text-xs bg-muted px-1 rounded">Preferred_contact</span> → channel type
                </span>
                <span>
                  <span className="font-mono text-xs bg-muted px-1 rounded">Primary_Product</span> → tag
                </span>
                <span>
                  <span className="font-mono text-xs bg-muted px-1 rounded">Secondary_product</span> → tag
                </span>
                <span>
                  <span className="font-mono text-xs bg-muted px-1 rounded">Customer_active</span> → active / inactive tag
                </span>
                <span>
                  <span className="font-mono text-xs bg-muted px-1 rounded">Consent</span> → consent:yes / no tag
                </span>
                <span>
                  <span className="font-mono text-xs bg-muted px-1 rounded">Unique Record_ID</span> → id:… tag
                </span>
              </div>
            </div>

            {/* 5-row preview */}
            <div>
              <p className="text-sm font-semibold text-muted-foreground mb-2">
                First {previewRows.length} row
                {previewRows.length !== 1 ? "s" : ""} preview
              </p>
              <ScrollArea className="rounded-lg border" style={{ maxHeight: 180 }}>
                <Table>
                  <TableHeader>
                    <TableRow>
                      {previewColumns.map((col) => (
                        <TableHead
                          key={col}
                          className="text-xs whitespace-nowrap"
                        >
                          {col}
                        </TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {previewRows.map((row, i) => (
                      <TableRow key={i}>
                        {previewColumns.map((col) => (
                          <TableCell
                            key={col}
                            className="text-xs truncate max-w-[120px]"
                          >
                            {String(row[col] ?? "")}
                          </TableCell>
                        ))}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </ScrollArea>
            </div>

            {/* Progress during import */}
            {importing && (
              <div className="space-y-1">
                <Progress value={progress} className="h-2" />
                <p className="text-xs text-muted-foreground text-right">
                  Importing {mappedRows.length} contacts…
                </p>
              </div>
            )}
          </div>
        )}

        {/* ── Step 3: Done ── */}
        {step === "done" && result && (
          <div className="flex flex-col items-center gap-4 py-6">
            <CheckCircle2 className="w-14 h-14 text-green-500" />
            <div className="text-center space-y-1">
              <p className="text-xl font-bold text-foreground">
                Import Complete
              </p>
              <p className="text-muted-foreground">
                <span className="font-semibold text-foreground">
                  {result.created}
                </span>{" "}
                contact{result.created !== 1 ? "s" : ""} created
                {result.skipped > 0 && (
                  <>
                    ,{" "}
                    <span className="font-semibold text-muted-foreground">
                      {result.skipped}
                    </span>{" "}
                    skipped (duplicates)
                  </>
                )}
                {result.failed > 0 && (
                  <>
                    ,{" "}
                    <span className="font-semibold text-destructive">
                      {result.failed}
                    </span>{" "}
                    failed
                  </>
                )}
              </p>
            </div>
          </div>
        )}

        <DialogFooter>
          {step === "pick" && (
            <Button variant="outline" onClick={handleClose}>
              Cancel
            </Button>
          )}
          {step === "preview" && (
            <>
              <Button
                variant="outline"
                onClick={handleClose}
                disabled={importing}
              >
                Cancel
              </Button>
              <Button
                onClick={handleImport}
                disabled={importing || mappedRows.length === 0}
              >
                {importing
                  ? "Importing…"
                  : `Import ${mappedRows.length} Contact${mappedRows.length !== 1 ? "s" : ""}`}
              </Button>
            </>
          )}
          {step === "done" && (
            <Button onClick={handleClose}>Close</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
