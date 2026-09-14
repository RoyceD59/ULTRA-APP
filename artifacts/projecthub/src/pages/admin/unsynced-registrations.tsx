/**
 * Admin page: Unsynced Registrations
 *
 * Lists accounts.jsonl entries where dbPersisted is false (DB insert failed
 * during an outage) and lets the ops team retry the insert with one click.
 *
 * Password-auth accounts: a secure temporary password is generated server-side
 * and displayed once — the admin must relay it to the customer out-of-band.
 * Social-auth accounts: restored immediately; customer logs in via their
 * existing social provider (no password involved).
 */

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  RefreshCw, CheckCircle2, AlertCircle, Loader2, UserX, Copy, Check,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { getTeamToken } from "@/lib/team-auth";
import { apiUrl } from "@/lib/api-base";

function authFetch(path: string, init?: RequestInit) {
  const token = getTeamToken();
  return fetch(apiUrl(path), {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init?.headers ?? {}),
    },
  });
}

// ─── Types ─────────────────────────────────────────────────────────────────────

interface UnsyncedRecord {
  id: number | null;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  authProvider: string;
  createdAt: string;
  recordedAt: string;
  source: string;
  dbPersisted: boolean;
  recoveryStatus?: "pending" | "blocked";
  recoveryReason?: "email_conflict" | "phone_conflict" | "invalid_phone";
  recoveryAttempts?: number;
  followUpStatus?: "resolved";
  resolvedAt?: string;
}

interface RetryResult {
  inserted: boolean;
  alreadyExists: boolean;
  id: number | null;
  status: "synced" | "blocked";
  reason?: "email_conflict" | "phone_conflict" | "invalid_phone";
  tempPassword?: string;
}

// ─── API helpers ───────────────────────────────────────────────────────────────

async function fetchUnsynced(): Promise<UnsyncedRecord[]> {
  const res = await authFetch("/api/admin/unsynced-registrations");
  if (!res.ok) throw new Error(`Failed to load: ${res.status}`);
  const data = (await res.json()) as { records: UnsyncedRecord[] };
  return data.records;
}

async function retryRecord(email: string, recordedAt: string): Promise<RetryResult> {
  const res = await authFetch("/api/admin/unsynced-registrations/retry", {
    method: "POST",
    body: JSON.stringify({ email, recordedAt }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `Server error ${res.status}`);
  }
  return res.json() as Promise<RetryResult>;
}

async function resolveRecord(email: string, recordedAt: string): Promise<void> {
  const res = await authFetch("/api/admin/unsynced-registrations/resolve", {
    method: "POST",
    body: JSON.stringify({ email, recordedAt }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `Server error ${res.status}`);
  }
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

function formatDate(iso: string) {
  try {
    return new Date(iso).toLocaleString(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    });
  } catch {
    return iso;
  }
}

// ─── Temp Password Dialog ──────────────────────────────────────────────────────

function TempPasswordDialog({
  email,
  tempPassword,
  wasReset,
  onClose,
}: {
  email: string;
  tempPassword: string;
  wasReset?: boolean;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);

  function handleCopy() {
    navigator.clipboard.writeText(tempPassword).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            {wasReset ? "Credentials reset — temporary password" : "Account restored — temporary password"}
          </DialogTitle>
          <DialogDescription>
            {wasReset
              ? <>
                  The database row for <strong>{email}</strong> already existed
                  (a previous retry may have partially succeeded). A new temporary
                  password has been generated and the stored hash has been updated.
                  Copy it and send it to the customer securely so they can log in
                  and set their own password.
                </>
              : <>
                  A database row has been created for <strong>{email}</strong>.
                  Because the original password was never stored in the folder, a
                  secure temporary password was generated. Copy it and send it to
                  the customer securely so they can log in and set their own
                  password.
                </>
            }
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 pt-2">
          <div className="flex items-center gap-2 rounded-md border bg-muted/50 px-4 py-3">
            <code className="flex-1 font-mono text-sm tracking-widest select-all">
              {tempPassword}
            </code>
            <Button size="sm" variant="ghost" onClick={handleCopy} className="shrink-0">
              {copied ? (
                <Check className="w-4 h-4 text-green-500" />
              ) : (
                <Copy className="w-4 h-4" />
              )}
            </Button>
          </div>

          <p className="text-xs text-muted-foreground">
            This password is shown <strong>once only</strong> and is not stored
            anywhere after you close this dialog. The customer should change it
            immediately after logging in.
          </p>

          <div className="flex justify-end">
            <Button onClick={onClose}>Done</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Page ──────────────────────────────────────────────────────────────────────

export default function AdminUnsyncedRegistrationsPage() {
  const { toast } = useToast();
  const qc = useQueryClient();

  // Track which rows are mid-retry so we can show per-row loading state.
  const [retrying, setRetrying] = useState<Set<string>>(new Set());

  // When a retry returns a temp password, hold it here to show the dialog.
  const [pendingTempPw, setPendingTempPw] = useState<{
    email: string;
    password: string;
    wasReset?: boolean;
  } | null>(null);

  const { data: records, isLoading, isError, refetch } = useQuery({
    queryKey: ["admin-unsynced-registrations"],
    queryFn: fetchUnsynced,
  });

  const mutation = useMutation({
    mutationFn: ({ email, recordedAt }: { email: string; recordedAt: string }) =>
      retryRecord(email, recordedAt),
    onSuccess: (result, { email }) => {
      if (result.status === "blocked") {
        toast({
          variant: "destructive",
          title: "Staff review required",
          description: result.reason === "phone_conflict"
            ? "Another active account already owns this phone number. No account was created."
            : result.reason === "email_conflict"
              ? "Another active account already owns this email address. No account was created."
              : "The saved phone number must be corrected before recovery.",
        });
        qc.invalidateQueries({ queryKey: ["admin-unsynced-registrations"] });
        return;
      }
      // Show the temp password dialog whenever a credential was issued — this
      // covers both a fresh insert AND the re-issue path (alreadyExists but
      // folder-rewrite failed on a prior attempt).
      if (result.tempPassword) {
        setPendingTempPw({
          email,
          password: result.tempPassword,
          wasReset: result.alreadyExists,
        });
        qc.invalidateQueries({ queryKey: ["admin-unsynced-registrations"] });
        return;
      }

      // No temp password — social auth (account is immediately usable via
      // their social provider) or already-synced with no credential reset.
      const title = result.alreadyExists ? "Already in database" : "Account restored";
      const description = result.alreadyExists
        ? `${email} was already in the database — folder record marked as synced.`
        : `${email} has been added to the database. They can log in immediately using their social account.`;
      toast({ title, description });
      qc.invalidateQueries({ queryKey: ["admin-unsynced-registrations"] });
    },
    onError: (err: Error, { email }) => {
      toast({
        title: "Retry failed",
        description: `Could not restore ${email}: ${err.message}`,
        variant: "destructive",
      });
      setRetrying((prev) => {
        const next = new Set(prev);
        next.delete(email);
        return next;
      });
    },
  });

  const resolveMutation = useMutation({
    mutationFn: ({ email, recordedAt }: { email: string; recordedAt: string }) =>
      resolveRecord(email, recordedAt),
    onSuccess: (_result, { email }) => {
      toast({
        title: "Follow-up resolved",
        description: `${email} has been marked as contacted / resolved.`,
      });
      qc.invalidateQueries({ queryKey: ["admin-unsynced-registrations"] });
    },
    onError: (err: Error, { email }) => {
      toast({
        title: "Could not update follow-up",
        description: `Could not mark ${email} as resolved: ${err.message}`,
        variant: "destructive",
      });
    },
  });

  function handleRetry(record: UnsyncedRecord) {
    const key = `${record.email}::${record.recordedAt}`;
    setRetrying((prev) => new Set(prev).add(key));
    mutation.mutate(
      { email: record.email, recordedAt: record.recordedAt },
      {
        onSettled: () => {
          setRetrying((prev) => {
            const next = new Set(prev);
            next.delete(key);
            return next;
          });
        },
      },
    );
  }

  return (
    <div className="space-y-6 p-6 max-w-5xl mx-auto">
      {/* Temp password dialog — shown once after a successful password-auth retry */}
      {pendingTempPw && (
        <TempPasswordDialog
          email={pendingTempPw.email}
          tempPassword={pendingTempPw.password}
          wasReset={pendingTempPw.wasReset}
          onClose={() => setPendingTempPw(null)}
        />
      )}

      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Unsynced Registrations</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Accounts recorded in the durable folder but never saved to the
            database. Use <strong>Retry DB insert</strong> once the database is
            healthy to promote each record.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()}>
          <RefreshCw className="w-4 h-4 mr-2" />
          Refresh
        </Button>
      </div>

      {/* Body */}
      {isLoading && (
        <div className="flex items-center gap-2 text-muted-foreground py-12 justify-center">
          <Loader2 className="w-5 h-5 animate-spin" />
          Loading…
        </div>
      )}

      {isError && (
        <div className="flex items-center gap-2 text-destructive py-12 justify-center">
          <AlertCircle className="w-5 h-5" />
          Failed to load unsynced registrations.
        </div>
      )}

      {records && records.length === 0 && (
        <div className="flex flex-col items-center gap-3 py-16 text-center">
          <CheckCircle2 className="w-10 h-10 text-green-500" />
          <p className="text-lg font-medium">All registrations are synced</p>
          <p className="text-sm text-muted-foreground">
            No folder-only records were found.
          </p>
        </div>
      )}

      {records && records.length > 0 && (
        <>
          <div className="rounded-lg border overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Phone</TableHead>
                  <TableHead>Auth</TableHead>
                  <TableHead>Recorded at</TableHead>
                  <TableHead>Recovery</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {records.map((record) => {
                  const rowKey = `${record.email}::${record.recordedAt}`;
                  const isRowRetrying = retrying.has(rowKey);
                  return (
                    <TableRow key={rowKey}>
                      <TableCell className="font-medium">
                        {record.firstName} {record.lastName}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {record.email}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {record.phone || (
                          <span className="italic text-muted-foreground/60">—</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-xs">
                          {record.authProvider}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-muted-foreground text-sm">
                        {formatDate(record.recordedAt)}
                      </TableCell>
                      <TableCell>
                        {record.recoveryStatus === "blocked" ? (
                          <div className="space-y-1">
                            <Badge variant="destructive">Staff review</Badge>
                            <p className="text-xs text-muted-foreground">
                              {record.recoveryReason === "phone_conflict"
                                ? "Phone belongs to an active account"
                                : record.recoveryReason === "email_conflict"
                                  ? "Email belongs to an active account"
                                  : "Phone needs correction"}
                            </p>
                          </div>
                        ) : (
                          <div className="space-y-1">
                            <Badge variant="secondary">Pending</Badge>
                            {record.recoveryAttempts ? (
                              <p className="text-xs text-muted-foreground">
                                {record.recoveryAttempts} attempt{record.recoveryAttempts === 1 ? "" : "s"}
                              </p>
                            ) : null}
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-2">
                          {record.followUpStatus === "resolved" ? (
                            <Badge variant="outline" className="border-green-600 text-green-700">
                              <Check className="w-3.5 h-3.5 mr-1.5" />
                              Resolved
                            </Badge>
                          ) : (
                            <Button
                              size="sm"
                              variant="secondary"
                              disabled={resolveMutation.isPending}
                              onClick={() => resolveMutation.mutate({
                                email: record.email,
                                recordedAt: record.recordedAt,
                              })}
                            >
                              <Check className="w-3.5 h-3.5 mr-1.5" />
                              Contacted / resolved
                            </Button>
                          )}
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={isRowRetrying}
                            onClick={() => handleRetry(record)}
                          >
                            {isRowRetrying ? (
                              <>
                                <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                                Retrying…
                              </>
                            ) : (
                              <>
                                <UserX className="w-3.5 h-3.5 mr-1.5" />
                                Retry DB insert
                              </>
                            )}
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
            <div className="px-4 py-2 border-t bg-muted/30 text-xs text-muted-foreground">
              {records.length} unsynced registration{records.length !== 1 ? "s" : ""}
            </div>
          </div>

          <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 space-y-1">
            <p className="font-medium">What happens when you retry?</p>
            <ul className="list-disc list-inside space-y-0.5 text-amber-700">
              <li>
                <strong>Password account:</strong> a temporary password is generated
                and shown once. Send it to the customer — they can log in and change
                it immediately.
              </li>
              <li>
                <strong>Social account</strong> (Google etc.): the account is
                restored and the customer can log in via their social provider straight
                away.
              </li>
            </ul>
          </div>
        </>
      )}
    </div>
  );
}
