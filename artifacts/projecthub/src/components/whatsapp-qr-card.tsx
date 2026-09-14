/**
 * WhatsAppQrCard
 *
 * Polls /api/whatsapp/status every 3 s and shows:
 *   - A scannable QR code while waiting to pair
 *   - A "Connected" badge once the session is open
 *   - A "Connect" button when disconnected
 *
 * Requires a valid team-session JWT (from POST /api/auth/token).
 * Shows a TeamAuthDialog if no valid session exists.
 */
import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { MessageCircle, RefreshCw, Wifi, WifiOff, LogOut, Loader2, KeyRound, AlertCircle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { TeamAuthDialog } from "@/components/team-auth-dialog";
import { getAuthHeaders, isTeamAuthenticated, clearTeamToken } from "@/lib/team-auth";
import { API_ORIGIN } from "@/lib/api-base";

const BASE = API_ORIGIN;

type WaState = "disconnected" | "connecting" | "qr" | "connected" | "error";
interface WaError { code: string; message: string }
interface WaStatus { state: WaState; qr: string | null; error: WaError | null }
const POLL_INTERVAL_MS = 3_000;

async function apiError(res: Response, fallback: string): Promise<Error> {
  try {
    const body = await res.json() as { error?: string | { message?: string } };
    const message = typeof body.error === "string" ? body.error : body.error?.message;
    if (message) return new Error(message);
  } catch {
    // Use the safe operation-specific fallback when the server did not return
    // JSON (for example, during a proxy or deployment failure).
  }
  return new Error(fallback);
}

async function fetchStatus(): Promise<WaStatus> {
  const headers = getAuthHeaders();
  if (!headers) throw new Error("Not authenticated");
  const res = await fetch(`${BASE}/api/whatsapp/status`, { headers });
  if (res.status === 401) { clearTeamToken(); throw new Error("Session expired"); }
  if (!res.ok) throw await apiError(res, "Could not retrieve WhatsApp status. Retry.");
  return res.json();
}

async function postConnect(): Promise<WaStatus> {
  const headers = getAuthHeaders();
  if (!headers) throw new Error("Not authenticated");
  const res = await fetch(`${BASE}/api/whatsapp/connect`, { method: "POST", headers });
  if (res.status === 401) { clearTeamToken(); throw new Error("Session expired"); }
  if (!res.ok) throw await apiError(res, "Could not start WhatsApp session. Retry.");
  return res.json();
}

async function postDisconnect(): Promise<void> {
  const headers = getAuthHeaders();
  if (!headers) throw new Error("Not authenticated");
  const res = await fetch(`${BASE}/api/whatsapp/disconnect`, { method: "POST", headers });
  if (res.status === 401) { clearTeamToken(); throw new Error("Session expired"); }
  if (!res.ok) throw await apiError(res, "Disconnect request failed. Retry.");
}

export function WhatsAppQrCard() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [pollEnabled, setPollEnabled] = useState(true);
  const [authOpen, setAuthOpen] = useState(false);
  const [authed, setAuthed] = useState(() => isTeamAuthenticated());

  const { data, error: statusRequestError, isLoading, refetch: refetchStatus } = useQuery<WaStatus>({
    queryKey: ["whatsapp-status"],
    queryFn: fetchStatus,
    refetchInterval: pollEnabled ? POLL_INTERVAL_MS : false,
    staleTime: 0,
    enabled: authed,
  });

  // Stop aggressive polling once connected; resume if disconnected
  useEffect(() => {
    if (data?.state === "connected") setPollEnabled(false);
    else setPollEnabled(true);
  }, [data?.state]);

  useEffect(() => {
    if (statusRequestError instanceof Error &&
      (statusRequestError.message.includes("authenticated") || statusRequestError.message.includes("expired"))) {
      setAuthed(false);
    }
  }, [statusRequestError]);

  const connectMut = useMutation({
    mutationFn: postConnect,
    onSuccess: () => {
      setPollEnabled(true);
      qc.invalidateQueries({ queryKey: ["whatsapp-status"] });
    },
    onError: (err: Error) => {
      if (err.message.includes("authenticated") || err.message.includes("expired")) {
        setAuthed(false);
      }
      toast({ title: "Could not start WhatsApp session", variant: "destructive" });
    },
  });

  const disconnectMut = useMutation({
    mutationFn: postDisconnect,
    onSuccess: () => {
      setPollEnabled(true);
      qc.invalidateQueries({ queryKey: ["whatsapp-status"] });
      toast({ title: "WhatsApp session ended" });
    },
    onError: (err: Error) => {
      if (err.message.includes("authenticated") || err.message.includes("expired")) {
        setAuthed(false);
      }
      toast({ title: "Disconnect failed", variant: "destructive" });
    },
  });

  function handleAuthenticated() {
    setAuthed(true);
    setAuthOpen(false);
    qc.invalidateQueries({ queryKey: ["whatsapp-status"] });
  }

  const state = data?.state ?? "disconnected";
  const qr   = data?.qr ?? null;
  const stateError = data?.error?.message;
  const requestError =
    stateError ??
    (statusRequestError instanceof Error ? statusRequestError.message : null) ??
    (connectMut.error instanceof Error ? connectMut.error.message : null) ??
    (disconnectMut.error instanceof Error ? disconnectMut.error.message : null);

  function retryConnection() {
    if (statusRequestError) {
      void refetchStatus();
    } else {
      connectMut.mutate();
    }
  }

  return (
    <>
      <TeamAuthDialog
        open={authOpen}
        onAuthenticated={handleAuthenticated}
        onClose={() => setAuthOpen(false)}
      />

      <Card className="overflow-hidden border-2 border-dashed border-emerald-500/30 bg-emerald-500/5">
        <CardHeader className="pb-3 border-b border-emerald-500/20 bg-emerald-500/5">
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2 text-base">
              <MessageCircle className="w-5 h-5 text-emerald-500" />
              WhatsApp Connection
            </CardTitle>
            {authed ? <StateBadge state={state} /> : (
              <Badge variant="outline" className="gap-1 text-muted-foreground">
                <KeyRound className="w-3 h-3" /> Requires auth
              </Badge>
            )}
          </div>
          <CardDescription>
            Scan the QR code with your phone to enable WhatsApp notifications.
          </CardDescription>
        </CardHeader>

        <CardContent className="pt-5">
          {/* Not authenticated */}
          {!authed && (
            <div className="flex flex-col items-center gap-4 py-4">
              <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center">
                <KeyRound className="w-8 h-8 text-muted-foreground" />
              </div>
              <div className="text-center">
                <p className="font-semibold text-foreground">Authentication required</p>
                <p className="text-sm text-muted-foreground mt-1">
                  Sign in with the team passcode to manage the WhatsApp connection.
                </p>
              </div>
              <Button onClick={() => setAuthOpen(true)} className="gap-2 bg-amber-500 hover:bg-amber-600 text-slate-950">
                <KeyRound className="w-4 h-4" />
                Sign In
              </Button>
            </div>
          )}

          {/* Authenticated states */}
          {authed && isLoading && (
            <div className="flex items-center gap-2 text-muted-foreground text-sm">
              <Loader2 className="w-4 h-4 animate-spin" /> Checking status…
            </div>
          )}

          {authed && !isLoading && state === "connected" && (
            <div className="flex flex-col items-center gap-4 py-4">
              <div className="w-16 h-16 rounded-full bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center">
                <Wifi className="w-8 h-8 text-emerald-500" />
              </div>
              <div className="text-center">
                <p className="font-semibold text-foreground">Session active</p>
                <p className="text-sm text-muted-foreground mt-1">
                  WhatsApp notifications are enabled and ready to send.
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="gap-2 text-destructive hover:text-destructive border-destructive/30 hover:bg-destructive/5"
                onClick={() => disconnectMut.mutate()}
                disabled={disconnectMut.isPending}
              >
                {disconnectMut.isPending
                  ? <Loader2 className="w-4 h-4 animate-spin" />
                  : <LogOut className="w-4 h-4" />}
                Disconnect
              </Button>
            </div>
          )}

          {authed && !isLoading && requestError && (
            <div
              className="mb-4 flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"
              role="alert"
              data-testid="status-whatsapp-error"
            >
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <div className="flex-1">
                <p>{requestError}</p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="mt-2 gap-2 border-destructive/30 text-destructive hover:bg-destructive/10"
                  onClick={retryConnection}
                  disabled={connectMut.isPending}
                  data-testid="button-retry-whatsapp"
                >
                  {connectMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                  Retry
                </Button>
              </div>
            </div>
          )}

          {authed && !isLoading && state === "qr" && qr && (
            <div className="flex flex-col items-center gap-3">
              <p className="text-sm text-muted-foreground text-center">
                Open <strong>WhatsApp</strong> on your phone → Settings → Linked Devices → Link a device
              </p>
              <div className="rounded-xl border-2 border-emerald-500/30 overflow-hidden shadow-sm bg-white p-2 w-fit">
                <img src={qr} alt="WhatsApp QR code" className="w-52 h-52 block" />
              </div>
              <p className="text-xs text-muted-foreground flex items-center gap-1">
                 <RefreshCw className="w-3 h-3" /> Refreshes automatically every 3 s
              </p>
            </div>
          )}

          {authed && !isLoading && state === "connecting" && (
            <div className="flex items-center gap-2 text-muted-foreground text-sm py-2">
              <Loader2 className="w-4 h-4 animate-spin text-emerald-500" />
              Connecting to WhatsApp servers…
            </div>
          )}

          {authed && !isLoading && state === "error" && !requestError && (
            <div className="flex flex-col items-center gap-4 py-4">
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-destructive/10">
                <AlertCircle className="h-8 w-8 text-destructive" />
              </div>
              <div className="text-center">
                <p className="font-semibold text-foreground">WhatsApp connection needs attention</p>
                <p className="mt-1 text-sm text-muted-foreground">Retry to generate a new QR code.</p>
              </div>
              <Button
                onClick={retryConnection}
                disabled={connectMut.isPending}
                className="gap-2 bg-emerald-600 text-white hover:bg-emerald-700"
                data-testid="button-retry-whatsapp-state"
              >
                {connectMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                Retry connection
              </Button>
            </div>
          )}

          {authed && !isLoading && state === "disconnected" && (
            <div className="flex flex-col items-center gap-4 py-4">
              <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center">
                <WifiOff className="w-8 h-8 text-muted-foreground" />
              </div>
              <div className="text-center">
                <p className="font-semibold text-foreground">Not connected</p>
                <p className="text-sm text-muted-foreground mt-1">
                  Start the pairing flow to link your WhatsApp account.
                </p>
              </div>
              <Button
                onClick={() => connectMut.mutate()}
                disabled={connectMut.isPending}
                className="gap-2 bg-emerald-600 hover:bg-emerald-700 text-white"
              >
                {connectMut.isPending
                  ? <Loader2 className="w-4 h-4 animate-spin" />
                  : <MessageCircle className="w-4 h-4" />}
                Connect WhatsApp
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </>
  );
}

function StateBadge({ state }: { state: WaState }) {
  switch (state) {
    case "connected":
      return <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-400 border gap-1"><Wifi className="w-3 h-3" /> Connected</Badge>;
    case "qr":
      return <Badge className="bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-900/30 dark:text-amber-400 border gap-1"><RefreshCw className="w-3 h-3 animate-spin" /> Scan QR</Badge>;
    case "connecting":
      return <Badge className="bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-900/30 dark:text-blue-400 border gap-1"><Loader2 className="w-3 h-3 animate-spin" /> Connecting</Badge>;
    case "error":
      return <Badge variant="destructive" className="gap-1"><AlertCircle className="w-3 h-3" /> Needs attention</Badge>;
    default:
      return <Badge variant="outline" className="gap-1 text-muted-foreground"><WifiOff className="w-3 h-3" /> Disconnected</Badge>;
  }
}
