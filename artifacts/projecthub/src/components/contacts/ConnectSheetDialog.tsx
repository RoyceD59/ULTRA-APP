/**
 * ConnectSheetDialog
 *
 * Supports two modes for connecting a Google Sheet:
 *   1. OAuth (preferred) — "Connect with Google" button opens a popup OAuth flow
 *      so the team can access private sheets using their Google account.
 *   2. Public URL — team pastes a "Anyone with the link" share URL (legacy fallback).
 *
 * The connected state shows the linked Google account (if OAuth) or the sheet URL,
 * and lets the user sync now or disconnect / change the sheet.
 */

import { useState, useEffect, useCallback } from "react";
import { getAuthHeaders } from "@/lib/team-auth";
import { apiUrl } from "@/lib/api-base";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { getListContactsQueryKey } from "@workspace/api-client-react";
import {
  Link2,
  Loader2,
  CheckCircle2,
  RefreshCw,
  Info,
  AlertCircle,
  LogOut,
  Shield,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface RawRow {
  [key: string]: string;
}

interface SheetStatus {
  connected: boolean;
  id?: number;
  sheetUrl?: string;
  sheetLabel?: string;
  lastSyncedAt?: string | null;
  reconnectRequired?: boolean;
}

interface GoogleStatus {
  connected: boolean;
  googleEmail?: string;
  connectedAt?: string;
  oauthConfigured?: boolean;
}

interface SyncResult {
  created: number;
  updated: number;
  skipped: number;
  failed: number;
  syncedAt: string;
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface ConnectSheetDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  syncStatus: SheetStatus | null;
  onStatusChange: () => void;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function teamHeaders(): HeadersInit {
  return {
    "Content-Type": "application/json",
    ...(getAuthHeaders() ?? {}),
  };
}

function extractGid(shareUrl: string): string | undefined {
  const m = shareUrl.match(/[#&?]gid=(\d+)/);
  return m?.[1];
}


// ─── Component ────────────────────────────────────────────────────────────────

type Step = "url" | "preview" | "connected";

export function ConnectSheetDialog({
  open,
  onOpenChange,
  syncStatus,
  onStatusChange,
}: ConnectSheetDialogProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [step, setStep] = useState<Step>("url");
  const [url, setUrl] = useState("");
  const [detectedGid, setDetectedGid] = useState<string | undefined>();
  const [previewHeaders, setPreviewHeaders] = useState<string[]>([]);
  const [previewRows, setPreviewRows] = useState<RawRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [syncResult, setSyncResult] = useState<SyncResult | null>(null);
  const [syncing, setSyncing] = useState(false);

  // Google OAuth state
  const [googleStatus, setGoogleStatus] = useState<GoogleStatus | null>(null);
  const [oauthBusy, setOauthBusy] = useState(false);

  // Load Google OAuth status
  const loadGoogleStatus = useCallback(async () => {
    try {
      const res = await fetch(apiUrl("/contacts/sync/google/status"), {
        headers: getAuthHeaders() ?? {},
      });
      if (res.ok) {
        const data = await res.json() as GoogleStatus;
        setGoogleStatus(data);
      }
    } catch {
      // non-fatal
    }
  }, []);

  // When dialog opens, show correct initial step + load OAuth status
  useEffect(() => {
    if (open) {
      loadGoogleStatus();
      if (syncStatus?.connected) {
        setStep("connected");
        setUrl(syncStatus.sheetUrl ?? "");
      } else {
        setStep("url");
        setUrl("");
        setDetectedGid(undefined);
        setPreviewHeaders([]);
        setPreviewRows([]);
        setPreviewError(null);
        setSyncResult(null);
      }
    }
  }, [open, syncStatus?.connected, syncStatus?.sheetUrl, loadGoogleStatus]);

  // Listen for OAuth popup result
  useEffect(() => {
    function handleMessage(event: MessageEvent) {
      if (event.data?.type !== "google-oauth-result") return;
      const payload = event.data.payload as { success: boolean; googleEmail?: string; message?: string };
      setOauthBusy(false);
      if (payload.success) {
        loadGoogleStatus();
        onStatusChange();
        toast({
          title: "Google account connected",
          description: `Signed in as ${payload.googleEmail}. You can now access private sheets.`,
        });
      } else {
        toast({
          title: "Google authorization failed",
          description: payload.message ?? "Could not connect Google account.",
          variant: "destructive",
        });
      }
    }
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [loadGoogleStatus, toast, onStatusChange]);

  // ── Google OAuth: start flow ──────────────────────────────────────────────

  async function handleConnectGoogle() {
    setOauthBusy(true);
    try {
      const res = await fetch(apiUrl("/contacts/sync/google/auth"), {
        headers: teamHeaders(),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      const { authUrl } = await res.json() as { authUrl: string };

      // Open OAuth consent in a popup
      const w = 600;
      const h = 700;
      const left = Math.round(window.screenX + (window.outerWidth - w) / 2);
      const top = Math.round(window.screenY + (window.outerHeight - h) / 2);
      const popup = window.open(
        authUrl,
        "google-oauth",
        `width=${w},height=${h},left=${left},top=${top},toolbar=no,menubar=no`
      );

      if (!popup) {
        setOauthBusy(false);
        toast({
          title: "Popup blocked",
          description: "Allow popups for this site and try again.",
          variant: "destructive",
        });
        return;
      }

      // Poll for popup close (in case postMessage doesn't fire)
      const timer = setInterval(() => {
        if (popup.closed) {
          clearInterval(timer);
          setOauthBusy(false);
          loadGoogleStatus();
        }
      }, 500);
    } catch (err) {
      setOauthBusy(false);
      toast({
        title: "Could not start Google sign-in",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    }
  }

  // ── Google OAuth: disconnect ──────────────────────────────────────────────

  async function handleDisconnectGoogle() {
    setOauthBusy(true);
    try {
      const res = await fetch(apiUrl("/contacts/sync/google"), {
        method: "DELETE",
        headers: teamHeaders(),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setGoogleStatus({ connected: false, oauthConfigured: googleStatus?.oauthConfigured });
      toast({ title: "Google account disconnected" });
    } catch (err) {
      toast({
        title: "Disconnect failed",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setOauthBusy(false);
    }
  }

  // ── Load preview ─────────────────────────────────────────────────────────

  async function handlePreview() {
    const trimmed = url.trim();
    if (!trimmed) return;
    if (!trimmed.includes("docs.google.com/spreadsheets")) {
      setPreviewError("Paste a Google Sheets share link (docs.google.com/spreadsheets/...)");
      return;
    }
    setBusy(true);
    setPreviewError(null);
    try {
      // Always use the server-side preview endpoint: it applies the stored OAuth
      // token automatically so private sheets work without any extra steps.
      const gid = extractGid(trimmed);
      const params = new URLSearchParams({ url: trimmed });
      if (gid) params.set("gid", gid);

      const res = await fetch(apiUrl(`/contacts/sync/sheets/preview?${params.toString()}`), {
        headers: getAuthHeaders() ?? {},
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      const data = await res.json() as { headers: string[]; rows: RawRow[]; usedOAuth: boolean };
      if (data.headers.length === 0) {
        throw new Error("The sheet appears to be empty.");
      }
      setDetectedGid(gid);
      setPreviewHeaders(data.headers);
      setPreviewRows(data.rows);
      setStep("preview");
    } catch (err) {
      setPreviewError(err instanceof Error ? err.message : "Could not load sheet");
    } finally {
      setBusy(false);
    }
  }

  // ── Save connection ───────────────────────────────────────────────────────

  async function handleConnect() {
    setBusy(true);
    try {
      const res = await fetch(apiUrl("/contacts/sync/sheets"), {
        method: "POST",
        headers: teamHeaders(),
        body: JSON.stringify({
          sheetUrl: url.trim(),
          sheetLabel: detectedGid ? `Tab (gid=${detectedGid})` : "Default tab",
          gid: detectedGid,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
      }
      onStatusChange();
      setStep("connected");
      toast({
        title: "Google Sheet connected!",
        description: "You can now sync contacts from this sheet.",
      });
    } catch (err) {
      toast({
        title: "Failed to save connection",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  }

  // ── Sync now ─────────────────────────────────────────────────────────────

  async function handleSyncNow() {
    setSyncing(true);
    setSyncResult(null);
    try {
      const res = await fetch(apiUrl("/contacts/sync/sheets/run"), {
        method: "POST",
        headers: teamHeaders(),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
      }
      const result = (await res.json()) as SyncResult;
      setSyncResult(result);
      onStatusChange();
      queryClient.invalidateQueries({ queryKey: getListContactsQueryKey() });
      toast({
        title: "Sync complete",
        description: `${result.created} created, ${result.updated} updated, ${result.skipped} skipped${result.failed > 0 ? `, ${result.failed} failed` : ""}.`,
      });
    } catch (err) {
      onStatusChange();
      toast({
        title: "Sync failed",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setSyncing(false);
    }
  }

  // ── Change sheet ─────────────────────────────────────────────────────────

  function handleChangeSheet() {
    setStep("url");
    setUrl("");
    setDetectedGid(undefined);
    setPreviewHeaders([]);
    setPreviewRows([]);
    setPreviewError(null);
    setSyncResult(null);
  }

  // ─── Render ───────────────────────────────────────────────────────────────

  const oauthConfigured = googleStatus?.oauthConfigured ?? false;
  const googleConnected = googleStatus?.connected ?? false;
  const reconnectRequired = syncStatus?.reconnectRequired ?? false;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onOpenChange(false)}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Link2 className="w-5 h-5 text-primary" />
            Connect Google Sheet
          </DialogTitle>
          <DialogDescription>
            {reconnectRequired
              ? "Your Google account needs to be reconnected to resume contacts sync."
              : googleConnected
              ? "Your Google account is connected — you can access private sheets."
              : "Connect your Google account to access private sheets, or paste a public share URL."}
          </DialogDescription>
        </DialogHeader>

        {/* ── Google Account section (shown on URL and connected steps) ── */}
        {(step === "url" || step === "connected") && oauthConfigured && (
          <div className="rounded-lg border p-3 space-y-2">
            <p className="text-sm font-semibold text-foreground flex items-center gap-2">
              <Shield className="w-4 h-4 text-primary" />
              Google account access
            </p>
            {reconnectRequired ? (
              <Alert variant="destructive">
                <AlertCircle className="w-4 h-4" />
                <AlertDescription>
                  <p>Your Google account needs to be reconnected. Google access was revoked or expired.</p>
                  <Button data-testid="button-dialog-reconnect-google" onClick={handleConnectGoogle} disabled={oauthBusy} className="mt-2 gap-2">
                    {oauthBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                    Reconnect Google account
                  </Button>
                </AlertDescription>
              </Alert>
            ) : googleConnected ? (
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 min-w-0">
                  <CheckCircle2 className="w-4 h-4 text-green-600 shrink-0" />
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-green-800 dark:text-green-300 truncate">
                      {googleStatus?.googleEmail}
                    </p>
                    {googleStatus?.connectedAt && (
                      <p className="text-xs text-muted-foreground">
                        Connected {new Date(googleStatus.connectedAt).toLocaleDateString()}
                      </p>
                    )}
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleDisconnectGoogle}
                  disabled={oauthBusy}
                  className="gap-1.5 text-muted-foreground hover:text-destructive shrink-0"
                >
                  {oauthBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <LogOut className="w-3.5 h-3.5" />}
                  Disconnect
                </Button>
              </div>
            ) : (
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm text-muted-foreground">
                  Not connected — only public sheets can be synced.
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleConnectGoogle}
                  disabled={oauthBusy}
                  className="gap-2 shrink-0"
                >
                  {oauthBusy ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <svg className="w-4 h-4" viewBox="0 0 24 24" aria-hidden="true">
                      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                      <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                    </svg>
                  )}
                  Connect with Google
                </Button>
              </div>
            )}
          </div>
        )}

        {/* ── Step: URL entry ── */}
        {step === "url" && (
          <div className="space-y-4">
            {oauthConfigured && <Separator />}

            <div className="space-y-2">
              <Label htmlFor="sheet-url">Google Sheets URL</Label>
              <Input
                id="sheet-url"
                placeholder="https://docs.google.com/spreadsheets/d/..."
                value={url}
                onChange={(e) => {
                  setUrl(e.target.value);
                  setPreviewError(null);
                }}
                onKeyDown={(e) => { if (e.key === "Enter") handlePreview(); }}
              />
              {previewError && (
                <div className="flex items-start gap-2 text-sm text-destructive">
                  <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                  <span>{previewError}</span>
                </div>
              )}
            </div>

            {!googleConnected && (
              <Alert className="border-blue-200 bg-blue-50 dark:bg-blue-950/20 dark:border-blue-800">
                <Info className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                <AlertDescription className="text-blue-800 dark:text-blue-300 text-sm">
                  {oauthConfigured
                    ? <>Connect your Google account above to access <strong>private sheets</strong>. Otherwise the sheet must be shared as <span className="font-medium">"Anyone with the link can view"</span>.</>
                    : <>The sheet must be shared as <span className="font-medium text-foreground">"Anyone with the link can view"</span>. To sync a specific tab, click the tab then copy the URL — it will include <code className="bg-blue-100 dark:bg-blue-900 px-1 rounded text-xs">#gid=XXXXXXXX</code>.</>
                  }
                </AlertDescription>
              </Alert>
            )}

            <div className="rounded-lg border p-3 bg-muted/20 text-sm">
              <p className="font-semibold text-foreground mb-2">Expected column headers</p>
              <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-muted-foreground text-xs">
                {[
                  ["full_name", "Full Name (required)"],
                  ["email", "Email"],
                  ["phone", "Phone"],
                  ["Preferred_contact", "sms / whatsapp"],
                  ["Primary_Product", "tag"],
                  ["Secondary_product", "tag"],
                  ["Customer_active", "active / inactive tag"],
                  ["Unique Record_ID", "id:… tag (dedup & update key)"],
                ].map(([col, desc]) => (
                  <span key={col}>
                    <span className="font-mono bg-muted px-1 rounded">{col}</span>
                    {" "}
                    <span className="text-muted-foreground/70">→ {desc}</span>
                  </span>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ── Step: Preview ── */}
        {step === "preview" && (
          <div className="space-y-4">
            <div className="flex items-center justify-between gap-4 p-3 rounded-lg bg-muted/40 border">
              <div className="flex items-center gap-2 min-w-0">
                <Link2 className="w-4 h-4 text-primary shrink-0" />
                <span className="text-sm font-medium truncate">{url}</span>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {detectedGid && (
                  <Badge variant="outline" className="text-xs font-mono">
                    gid={detectedGid}
                  </Badge>
                )}
                <Badge variant="secondary" className="text-xs">
                  {previewRows.length} preview rows
                </Badge>
              </div>
            </div>

            {!detectedGid && (
              <Alert className="border-amber-200 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-800">
                <Info className="w-4 h-4 text-amber-600 dark:text-amber-400" />
                <AlertDescription className="text-amber-800 dark:text-amber-300 text-sm">
                  No tab ID detected — this will sync the <strong>first (default) tab</strong>.
                  To sync a different tab, go back and paste the URL while viewing that tab.
                </AlertDescription>
              </Alert>
            )}

            {previewHeaders.length > 0 && (
              <div>
                <p className="text-sm font-semibold text-muted-foreground mb-2">
                  Data preview (first {previewRows.length} rows)
                </p>
                <ScrollArea className="rounded-lg border" style={{ maxHeight: 200 }}>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        {previewHeaders.map((col) => (
                          <TableHead key={col} className="text-xs whitespace-nowrap">{col}</TableHead>
                        ))}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {previewRows.map((row, i) => (
                        <TableRow key={i}>
                          {previewHeaders.map((col) => (
                            <TableCell key={col} className="text-xs truncate max-w-[120px]">
                              {row[col] ?? ""}
                            </TableCell>
                          ))}
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </ScrollArea>
              </div>
            )}
          </div>
        )}

        {/* ── Step: Connected ── */}
        {step === "connected" && (
          <div className="space-y-4">
            <div className="flex items-start gap-3 p-4 rounded-lg border bg-green-50 dark:bg-green-950/20 border-green-200 dark:border-green-800">
              <CheckCircle2 className="w-5 h-5 text-green-600 dark:text-green-400 shrink-0 mt-0.5" />
              <div className="min-w-0 space-y-1">
                <p className="text-sm font-semibold text-green-800 dark:text-green-300">
                  Google Sheet connected
                </p>
                <p className="text-xs text-green-700 dark:text-green-400 break-all">
                  {syncStatus?.sheetUrl ?? url}
                </p>
                {syncStatus?.sheetLabel && (
                  <Badge variant="outline" className="text-xs border-green-300 text-green-700 dark:text-green-400">
                    {syncStatus.sheetLabel}
                  </Badge>
                )}
                {syncStatus?.lastSyncedAt && (
                  <p className="text-xs text-muted-foreground">
                    Last synced: {new Date(syncStatus.lastSyncedAt).toLocaleString()}
                  </p>
                )}
              </div>
            </div>

            {syncResult && (
              <div className="rounded-lg border p-3 bg-muted/20 text-sm space-y-1">
                <p className="font-semibold text-foreground">Last sync result</p>
                <p className="text-muted-foreground">
                  <span className="font-medium text-foreground">{syncResult.created}</span> created,{" "}
                  <span className="font-medium text-foreground">{syncResult.updated}</span> updated,{" "}
                  <span className="font-medium text-foreground">{syncResult.skipped}</span> skipped
                  {syncResult.failed > 0 && (
                    <>
                      ,{" "}
                      <span className="font-medium text-destructive">{syncResult.failed}</span> failed
                    </>
                  )}
                </p>
                <p className="text-xs text-muted-foreground">
                  {new Date(syncResult.syncedAt).toLocaleString()}
                </p>
              </div>
            )}

            <div className="flex items-center gap-3">
              <Button onClick={handleSyncNow} disabled={syncing} className="gap-2">
                {syncing ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <RefreshCw className="w-4 h-4" />
                )}
                {syncing ? "Syncing…" : "Sync now"}
              </Button>
              <Button variant="outline" onClick={handleChangeSheet}>
                Connect different sheet
              </Button>
            </div>

            <p className="text-xs text-muted-foreground">
              A daily automatic sync runs at 06:00 UTC. Contacts removed from
              the sheet are kept in the database.
            </p>
          </div>
        )}

        <DialogFooter>
          {step === "url" && (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button
                onClick={handlePreview}
                disabled={busy || !url.trim()}
                className="gap-2"
              >
                {busy && <Loader2 className="w-4 h-4 animate-spin" />}
                {busy ? "Loading…" : "Preview sheet →"}
              </Button>
            </>
          )}
          {step === "preview" && (
            <>
              <Button variant="outline" onClick={() => setStep("url")}>
                ← Back
              </Button>
              <Button onClick={handleConnect} disabled={busy} className="gap-2">
                {busy && <Loader2 className="w-4 h-4 animate-spin" />}
                {busy ? "Saving…" : "Connect Sheet"}
              </Button>
            </>
          )}
          {step === "connected" && (
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Close
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
