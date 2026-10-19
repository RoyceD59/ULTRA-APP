import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  Clock3,
  KeyRound,
  Loader2,
  LockKeyhole,
  MessagesSquare,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import type { AlisonChat } from "@workspace/api-client-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { trackEvent } from "@/lib/analytics";
import {
  AlisonMachineApiError,
  alisonConnectionHelp,
  issueAlisonMachineToken,
  listAlisonMachineChats,
} from "@/lib/alison-machine-api";

function formatTimestamp(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function errorStatus(error: unknown): number | undefined {
  return error instanceof AlisonMachineApiError ? error.status : undefined;
}

function ConversationListSkeleton() {
  return (
    <div className="space-y-2" data-testid="status-alison-conversations-loading">
      {[0, 1, 2, 3].map((item) => (
        <div key={item} className="rounded-lg border p-3 space-y-2">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-3 w-48" />
        </div>
      ))}
    </div>
  );
}

export default function AlisonConversationsPage() {
  const queryClient = useQueryClient();
  const [connectionVersion, setConnectionVersion] = useState(0);
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());
  const [cursor, setCursor] = useState<string | undefined>();
  const [cursorHistory, setCursorHistory] = useState<(string | undefined)[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const tokenExpired = expiresAt !== null && now >= expiresAt;
  const connected = Boolean(accessToken) && !tokenExpired;
  const tokenMutation = useMutation({
    mutationFn: ({ id, secret }: { id: string; secret: string }) =>
      issueAlisonMachineToken(id, secret),
  });
  const chatsQuery = useQuery({
    queryKey: ["alison-machine-chats", connectionVersion, cursor],
    queryFn: ({ signal }) => listAlisonMachineChats(accessToken!, cursor, signal),
    enabled: connected,
    retry: false,
    gcTime: 0,
  });

  useEffect(() => () => {
    void queryClient.cancelQueries({ queryKey: ["alison-machine-chats"] });
    queryClient.removeQueries({ queryKey: ["alison-machine-chats"] });
  }, [queryClient]);

  useEffect(() => {
    if (!expiresAt) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [expiresAt]);

  useEffect(() => {
    if (tokenExpired) {
      setAccessToken(null);
      setSelectedId(null);
      void queryClient.cancelQueries({ queryKey: ["alison-machine-chats"] });
      queryClient.removeQueries({ queryKey: ["alison-machine-chats"] });
      tokenMutation.reset();
    }
  }, [tokenExpired, queryClient]);

  useEffect(() => {
    const first = chatsQuery.data?.chats[0];
    if (!chatsQuery.data) return;
    setSelectedId((current) =>
      current && chatsQuery.data.chats.some((chat) => chat.conversationId === current)
        ? current
        : first?.conversationId ?? null,
    );
  }, [chatsQuery.data]);

  const selectedChat = useMemo(
    () => chatsQuery.data?.chats.find((chat) => chat.conversationId === selectedId) ?? null,
    [chatsQuery.data, selectedId],
  );
  const lastTrackedChat = useRef<string | null>(null);
  useEffect(() => {
    // Include the first transcript opened automatically, but not query refetches.
    const openedId = connected && !chatsQuery.isError ? selectedChat?.conversationId ?? null : null;
    if (!openedId) {
      lastTrackedChat.current = null;
      return;
    }
    if (lastTrackedChat.current === openedId) return;
    lastTrackedChat.current = openedId;
    trackEvent("alison_conversation_opened", { messageCount: selectedChat!.messages.length });
  }, [connected, chatsQuery.isError, selectedChat]);

  const connect = () => {
    tokenMutation.mutate(
      { id: clientId.trim(), secret: clientSecret.trim() },
      {
        onSuccess: (token) => {
          setConnectionVersion((current) => current + 1);
          setAccessToken(token.access_token);
          setExpiresAt(Date.now() + token.expires_in * 1_000);
          setNow(Date.now());
          setClientSecret("");
          setCursor(undefined);
          setCursorHistory([]);
          setSelectedId(null);
        },
      },
    );
  };

  const disconnect = () => {
    void queryClient.cancelQueries({ queryKey: ["alison-machine-chats"] });
    queryClient.removeQueries({ queryKey: ["alison-machine-chats"] });
    tokenMutation.reset();
    setAccessToken(null);
    setExpiresAt(null);
    setCursor(undefined);
    setCursorHistory([]);
    setSelectedId(null);
  };

  const requestStatus = errorStatus(chatsQuery.error);
  const authorizationError = requestStatus === 401 || requestStatus === 403;
  const secondsRemaining = expiresAt ? Math.max(0, Math.ceil((expiresAt - now) / 1_000)) : 0;

  if (!connected) {
    return (
      <div className="mx-auto max-w-xl space-y-6">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <MessagesSquare className="h-6 w-6 text-primary" />
            <h1 className="text-2xl font-semibold">Alison conversations</h1>
          </div>
          <p className="text-sm text-muted-foreground">
            Browse anonymous transcripts retained during the last 30 days.
          </p>
        </div>

        {tokenExpired && (
          <Alert data-testid="status-machine-session-expired">
            <Clock3 className="h-4 w-4" />
            <AlertTitle>Machine session expired</AlertTitle>
            <AlertDescription>Reconnect to request a new 15-minute access token.</AlertDescription>
          </Alert>
        )}

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <LockKeyhole className="h-5 w-5" />
              Connect a machine client
            </CardTitle>
            <CardDescription>
              Use a confidential client with the <code>alison.read</code> scope. The secret is never stored.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-md border bg-muted/40 p-3 text-sm space-y-2">
              <p>Ask a ProjectHub administrator to open <strong>Agent operations</strong> and choose <strong>Create Alison viewer</strong>.</p>
              <p>Copy the client ID and one-time secret from the same panel, in this environment. Your ProjectHub password or a provider API key will not work here.</p>
              <p>If the secret is lost, the administrator can rotate it. Rotation replaces the old secret but does not add permissions or extend client expiry.</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="alison-client-id">Client ID</Label>
              <Input
                id="alison-client-id"
                data-testid="input-alison-client-id"
                autoComplete="username"
                value={clientId}
                onChange={(event) => setClientId(event.target.value)}
                placeholder="agent_…"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="alison-client-secret">Client secret</Label>
              <Input
                id="alison-client-secret"
                data-testid="input-alison-client-secret"
                type="password"
                autoComplete="off"
                value={clientSecret}
                onChange={(event) => setClientSecret(event.target.value)}
              />
            </div>
            {tokenMutation.isError && (
              <Alert variant="destructive" data-testid="status-machine-authorization-error">
                <AlertCircle className="h-4 w-4" />
                <AlertTitle>Authorization failed</AlertTitle>
                <AlertDescription>
                  {alisonConnectionHelp(tokenMutation.error)}
                </AlertDescription>
              </Alert>
            )}
            <Button
              data-testid="button-connect-alison-client"
              className="w-full"
              disabled={!clientId.trim() || !clientSecret.trim() || tokenMutation.isPending}
              onClick={connect}
            >
              {tokenMutation.isPending
                ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Authorizing…</>
                : <><KeyRound className="mr-2 h-4 w-4" />Connect securely</>}
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <MessagesSquare className="h-6 w-6 text-primary" />
            <h1 className="text-2xl font-semibold">Alison conversations</h1>
          </div>
          <p className="text-sm text-muted-foreground">
            Anonymous transcripts from the last 30 days. No customer identity is collected or shown.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary" data-testid="status-machine-session-active">
            <ShieldCheck className="mr-1 h-3 w-3" />
            Connected · {Math.ceil(secondsRemaining / 60)} min
          </Badge>
          <Button
            variant="outline"
            size="sm"
            data-testid="button-refresh-alison-conversations"
            disabled={chatsQuery.isFetching}
            onClick={() => void chatsQuery.refetch()}
          >
            <RefreshCw className={cn("mr-2 h-4 w-4", chatsQuery.isFetching && "animate-spin")} />
            Refresh
          </Button>
          <Button variant="ghost" size="sm" data-testid="button-disconnect-alison-client" onClick={disconnect}>
            Disconnect
          </Button>
        </div>
      </div>

      {chatsQuery.isLoading ? (
        <ConversationListSkeleton />
      ) : chatsQuery.isError ? (
        <Alert variant="destructive" data-testid="status-alison-conversations-error">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>{authorizationError ? "Machine authorization failed" : "Conversations unavailable"}</AlertTitle>
          <AlertDescription className="space-y-3">
            <p>
              {authorizationError
                ? "This token is expired, revoked, or missing the alison.read scope."
                : "ProjectHub could not load the anonymous transcripts. Try again."}
            </p>
            <Button
              size="sm"
              variant="outline"
              onClick={authorizationError ? disconnect : () => void chatsQuery.refetch()}
              data-testid="button-recover-alison-conversations"
            >
              {authorizationError ? "Reconnect" : "Try again"}
            </Button>
          </AlertDescription>
        </Alert>
      ) : chatsQuery.data?.chats.length === 0 ? (
        <Card data-testid="status-alison-conversations-empty">
          <CardContent className="flex min-h-64 flex-col items-center justify-center text-center">
            <MessagesSquare className="mb-3 h-9 w-9 text-muted-foreground/60" />
            <h2 className="font-medium">No retained conversations</h2>
            <p className="mt-1 max-w-sm text-sm text-muted-foreground">
              Alison conversations appear here after a customer chats, and are removed after 30 days.
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid min-h-[32rem] overflow-hidden rounded-xl border bg-card lg:grid-cols-[19rem_1fr]">
            <aside className="border-b lg:border-b-0 lg:border-r">
              <div className="border-b px-4 py-3">
                <p className="text-sm font-medium">Conversations</p>
                <p className="text-xs text-muted-foreground">{chatsQuery.data?.chats.length ?? 0} on this page</p>
              </div>
              <div className="max-h-72 overflow-y-auto p-2 lg:max-h-[34rem]">
                {chatsQuery.data?.chats.map((chat, index) => (
                  <button
                    key={chat.conversationId}
                    type="button"
                    data-testid={`button-alison-conversation-${chat.conversationId}`}
                    onClick={() => setSelectedId(chat.conversationId)}
                    className={cn(
                      "mb-1 w-full rounded-lg px-3 py-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      selectedId === chat.conversationId ? "bg-primary/10 text-primary" : "hover:bg-muted",
                    )}
                  >
                    <span className="block text-sm font-medium">Conversation {index + 1}</span>
                    <span className="mt-1 block text-xs text-muted-foreground">{formatTimestamp(chat.createdAt)}</span>
                    <span className="mt-1 block text-xs text-muted-foreground">{chat.messages.length} messages</span>
                  </button>
                ))}
              </div>
            </aside>
            <ConversationTranscript chat={selectedChat} />
          </div>
          <div className="flex items-center justify-between">
            <Button
              variant="outline"
              data-testid="button-previous-alison-page"
              disabled={cursorHistory.length === 0 || chatsQuery.isFetching}
              onClick={() => {
                const history = [...cursorHistory];
                setCursor(history.pop());
                setCursorHistory(history);
                setSelectedId(null);
              }}
            >
              <ArrowLeft className="mr-2 h-4 w-4" />Previous
            </Button>
            <span className="text-xs text-muted-foreground" data-testid="text-alison-page-number">
              Page {cursorHistory.length + 1}
            </span>
            <Button
              variant="outline"
              data-testid="button-next-alison-page"
              disabled={!chatsQuery.data?.nextCursor || chatsQuery.isFetching}
              onClick={() => {
                setCursorHistory((history) => [...history, cursor]);
                setCursor(chatsQuery.data?.nextCursor ?? undefined);
                setSelectedId(null);
              }}
            >
              Next<ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

function ConversationTranscript({ chat }: { chat: AlisonChat | null }) {
  if (!chat) return <div className="flex items-center justify-center p-8 text-sm text-muted-foreground">Select a conversation.</div>;
  return (
    <section className="min-w-0" data-testid={`panel-alison-conversation-${chat.conversationId}`}>
      <div className="border-b px-4 py-3 sm:px-6">
        <h2 className="font-medium">Anonymous conversation</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Started {formatTimestamp(chat.createdAt)} · Updated {formatTimestamp(chat.updatedAt)}
        </p>
      </div>
      <div className="max-h-[34rem] space-y-4 overflow-y-auto p-4 sm:p-6">
        {chat.messages.map((message, index) => (
          <div
            key={`${message.createdAt}-${index}`}
            className={cn("flex", message.role === "user" ? "justify-end" : "justify-start")}
            data-testid={`message-alison-${index}`}
          >
            <div className={cn(
              "max-w-[88%] rounded-2xl px-4 py-3 sm:max-w-[75%]",
              message.role === "user" ? "bg-primary text-primary-foreground" : "bg-muted text-foreground",
            )}>
              <p className="whitespace-pre-wrap break-words text-sm">{message.content}</p>
              <p className={cn(
                "mt-2 text-[11px]",
                message.role === "user" ? "text-primary-foreground/70" : "text-muted-foreground",
              )}>
                {message.role === "user" ? "Customer" : "Alison"} · {formatTimestamp(message.createdAt)}
              </p>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}