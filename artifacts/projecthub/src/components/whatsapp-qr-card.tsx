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
import { trackEvent } from "@/lib/analytics";
import { whatsappRequest } from "@/lib/whatsapp-request";

const BASE = API_ORIGIN;

type WaState = "disconnected" | "connecting" | "qr" | "connected" | "error";
interface WaError { code: string; message: string }
interface WaStatus { state: WaState; qr: string | null; error: WaError | null }
const POLL_INTERVAL_MS = 3_000;

async function request<T>(path: string, method = "GET"): Promise<T> {
  const headers = getAuthHeaders();
  if (!headers) throw new Error("Not authenticated");
  try {
    return await whatsappRequest<T>(
      `${BASE}/api/whatsapp/${path}`,
      { method, headers },
      path === "disconnect"
        ? "Session cleanup could not be confirmed. Retry Disconnect before pairing again."
        : "WhatsApp did not respond in time. Refresh status or disconnect the saved session before trying again.",
      path === "disconnect" ? 90_000 : 20_000,
    );
  } catch (error) {
    if (error instanceof Error && error.message === "Session expired") clearTeamToken();
    throw error;
  }
}

async function fetchStatus(): Promise<WaStatus> {
  return request<WaStatus>("status");
}

async function postConnect(): Promise<WaStatus> {
  trackEvent("whatsapp_connect_requested", {});
  return request<WaStatus>("connect", "POST");
}

async function postDisconnect(): Promise<void> {
  await request("disconnect", "POST");
}

export function WhatsAppQrCard() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [pairingStalled, setPairingStalled] = useState(false);
  const [authOpen, setAuthOpen] = useState(false);
  const [authed, setAuthed] = useState(() => isTeamAuthenticated());

  const { data, error: statusRequestError, isLoading, refetch: refetchStatus } = useQuery<WaStatus>({
    queryKey: ["whatsapp-status"],
    queryFn: fetchStatus,
    refetchInterval: POLL_INTERVAL_MS,
    staleTime: 0,
    retry: false,
    enabled: authed,
  });

  // Keep status live even after a transient disconnected event: the server
  // may reconnect and emit a QR after the initial request has returned.
  useEffect(() => {
    setPairingStalled(false);
    if (data?.state !== "connecting") return;
    const timer = setTimeout(() => setPairingStalled(true), 45_000);
    return () => clearTimeout(timer);
  }, [data?.state]);

  useEffect(() => {
    if (statusRequestError instanceof Error &&
      (statusRequestError.message.includes("authenticated") || statusRequestError.message.includes("expired"))) {
      setAuthed(false);
    }
  }, [statusRequestError]);

  const connectMut = useMutation({
    mutationFn: postConnect,
    retry: false,
    onMutate: () => {
      qc.setQueryData<WaStatus>(["whatsapp-status"], { state: "connecting", qr: null, error: null });
    },
    onSuccess: (status) => {
      qc.setQueryData(["whatsapp-status"], status);
      qc.invalidateQueries({ queryKey: ["whatsapp-status"] });
    },
    onError: (err: Error) => {
      if (err.message.includes("authenticated") || err.message.includes("expired")) {
        setAuthed(false);
      }
      qc.invalidateQueries({ queryKey: ["whatsapp-status"] });
      toast({ title: "Could not start WhatsApp session", description: err.message, variant: "destructive" });
    },
  });

  const disconnectMut = useMutation({
    mutationFn: postDisconnect,
    retry: false,
    onSuccess: async () => {
      await qc.cancelQueries({ queryKey: ["whatsapp-status"] });
      qc.setQueryData<WaStatus>(["whatsapp-status"], { state: "disconnected", qr: null, error: null });
      connectMut.reset();
      setPairingStalled(false);
      qc.invalidateQueries({ queryKey: ["whatsapp-status"] });
      toast({ title: "Saved WhatsApp session cleared", description: "Click Connect WhatsApp to pair the desired phone." });
    },
    onError: (err: Error) => {
      if (err.message.includes("authenticated") || err.message.includes("expired")) {
        setAuthed(false);
      }
      toast({ title: "Disconnect failed", description: err.message, variant: "destructive" });
    },
  });

  function handleAuthenticated() {
    setAuthed(true);
    setAuthOpen(false);
    qc.invalidateQueries({ queryKey: ["whatsapp-status"] });
  }

  const cleanupRequired = disconnectMut.isError || data?.error?.code === "SESSION_CLEANUP_REQUIRED";
  const state = cleanupRequired ? "error" : data?.state ?? "disconnected";
  const qr   = data?.qr ?? null;
  const stateError = data?.error?.message;
  const cleanupBlocked = disconnectMut.isPending || cleanupRequired;
  const connectDisabled = connectMut.isPending || cleanupBlocked;
  const requestError =
    (disconnectMut.error instanceof Error ? disconnectMut.error.message : null) ??
    stateError ??
    (statusRequestError instanceof Error ? statusRequestError.message : null) ??
    (state !== "qr" && state !== "connected" && connectMut.error instanceof Error ? connectMut.error.message : null) ??
    (pairingStalled ? "Pairing is taking too long. Disconnect the saved session below, then start a fresh connection." : null);

  function retryConnection() {
    if (cleanupRequired) {
      disconnectMut.mutate();
    } else if (statusRequestError) {
      void refetchStatus();
    } else if (!connectDisabled) {
      connectMut.mutate();
    }
  }

  function disconnectSession() {
    if (window.confirm("Disconnect WhatsApp and clear its saved pairing? You will need to scan a new QR code with the desired phone.")) {
      disconnectMut.mutate();
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
          <div className="flex flex-wrap items-center justify-between gap-2">
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
            </div>
          )}

          {authed && !isLoading && requestError && (
            <div
              className="mb-4 flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"
              role="alert"
              data-testid="status-whatsapp-error"
            >
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <div className="min-w-0 flex-1">
                <p>{requestError}</p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="mt-2 h-auto min-h-8 w-full gap-2 whitespace-normal border-destructive/30 text-destructive hover:bg-destructive/10"
                  onClick={retryConnection}
                  disabled={connectMut.isPending || disconnectMut.isPending}
                  data-testid="button-retry-whatsapp"
                >
                  {connectMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                  {cleanupRequired ? "Retry Disconnect" : "Retry"}
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

          {authed && !isLoading && state === "qr" && !qr && !requestError && (
            <div className="flex flex-col items-center gap-3 py-4 text-center">
              <AlertCircle className="h-8 w-8 text-amber-500" />
              <p className="text-sm text-muted-foreground">
                WhatsApp is waiting for a QR code. Retry if one does not appear shortly.
              </p>
              <Button type="button" variant="outline" onClick={retryConnection} disabled={connectDisabled}>
                Retry connection
              </Button>
            </div>
          )}

          {authed && !isLoading && state === "connecting" && !pairingStalled && !connectMut.isError && !cleanupBlocked && (
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
                disabled={connectDisabled}
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
                disabled={connectDisabled}
                className="gap-2 bg-emerald-600 hover:bg-emerald-700 text-white"
              >
                {connectMut.isPending
                  ? <Loader2 className="w-4 h-4 animate-spin" />
                  : <MessageCircle className="w-4 h-4" />}
                Connect WhatsApp
              </Button>
            </div>
          )}
          {authed && (
            <div className="mt-4 border-t border-emerald-500/20 pt-4 text-center">
              <Button
                variant="outline"
                size="sm"
                className="gap-2 text-destructive hover:text-destructive border-destructive/30"
                onClick={disconnectSession}
                disabled={disconnectMut.isPending || connectMut.isPending}
                data-testid="button-disconnect-whatsapp"
              >
                {disconnectMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogOut className="h-4 w-4" />}
                {disconnectMut.isPending ? "Clearing saved session…" : "Disconnect"}
              </Button>
              <p className="mt-2 text-xs text-muted-foreground">
                Clears the saved pairing, even if WhatsApp is not connected.
              </p>
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
