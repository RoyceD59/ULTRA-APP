import { useState, useCallback, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Gift, Loader2, ToggleLeft, ToggleRight, Search, CheckCircle2, Camera,
  ScanLine, X, ShieldAlert, Droplets, RotateCcw,
  Download, Users, ArrowUpDown, ArrowUp, ArrowDown, Smartphone,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
} from "@/components/ui/sheet";
import { useToast } from "@/hooks/use-toast";
import { getAuthHeaders, getTeamUser, isTeamAdmin } from "@/lib/team-auth";
import { createQrScannerAdapter } from "@/lib/qr-scanner-adapter";
import { QrScannerController, type QrScannerFailure } from "@/lib/qr-scanner-controller";
import { API_ORIGIN } from "@/lib/api-base";

const base = () => API_ORIGIN;

// ─── Types ────────────────────────────────────────────────────────────────────

interface RewardsRule {
  id: number;
  eventType: string;
  label: string;
  pointsValue: number;
  active: boolean;
  updatedBy: string | null;
  updatedAt: string;
}

interface GrantResult {
  entry: { id: number; userId: number; points: number; reason: string; createdAt: string };
  customer: { id: number; email: string; firstName: string; phone: string };
  newBalance: number;
  notification?: { status?: string; message?: string };
}

interface CustomerBalance {
  userId: number;
  email: string;
  firstName: string;
  lastName: string;
  phone: string;
  balance: number;
  lifetimeRedeemed: number;
}

interface LedgerEntry {
  id: number;
  userId: number;
  email: string;
  firstName: string;
  lastName: string;
  points: number;
  reason: string;
  eventType: string;
  grantedBy: string | null;
  createdAt: string;
  notificationStatus: "sent" | "failed" | "skipped" | null;
  notificationEvent: string | null;
  notificationError: string | null;
}

// ─── API helpers ──────────────────────────────────────────────────────────────

async function listRules(): Promise<RewardsRule[]> {
  const headers = getAuthHeaders();
  if (!headers) throw new Error("Not authenticated");
  const res = await fetch(`${base()}/api/uc/admin/rewards/rules`, { headers });
  if (!res.ok) throw new Error(`Failed to fetch rules: ${res.status}`);
  const data = await res.json() as { rules: RewardsRule[] };
  return data.rules;
}

async function patchRule(id: number, updates: { pointsValue?: number; active?: boolean }, email: string): Promise<RewardsRule> {
  const headers = getAuthHeaders();
  if (!headers) throw new Error("Not authenticated");
  const res = await fetch(`${base()}/api/uc/admin/rewards/rules/${id}`, {
    method: "PATCH",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ ...updates, updatedBy: email }),
  });
  if (!res.ok) {
    const err = await res.json() as { error?: string };
    throw new Error(err.error ?? "Update failed");
  }
  const data = await res.json() as { rule: RewardsRule };
  return data.rule;
}

async function grantPoints(payload: {
  lookup: string; points: number; reason: string; grantedBy: string;
}): Promise<GrantResult> {
  const headers = getAuthHeaders();
  if (!headers) throw new Error("Not authenticated");
  const res = await fetch(`${base()}/api/uc/admin/rewards/grant`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await res.json() as { error?: string };
    throw new Error(err.error ?? "Grant failed");
  }
  return res.json() as Promise<GrantResult>;
}

interface RewardsBalancesResponse {
  customers: CustomerBalance[];
  lifetimeRedeemed: number;
}

async function fetchBalances(search: string): Promise<RewardsBalancesResponse> {
  const headers = getAuthHeaders();
  if (!headers) throw new Error("Not authenticated");
  const params = search ? `?search=${encodeURIComponent(search)}` : "";
  const res = await fetch(`${base()}/api/uc/admin/rewards/balances${params}`, { headers });
  if (!res.ok) throw new Error(`Failed to fetch balances: ${res.status}`);
  return res.json() as Promise<RewardsBalancesResponse>;
}

async function requestRewardsQrDisplay(userId: number): Promise<{ requestId: number; status: string }> {
  const headers = getAuthHeaders();
  if (!headers) throw new Error("Not authenticated");
  const res = await fetch(`${base()}/api/uc/admin/rewards/qr/request-display`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ userId }),
  });
  const data = await res.json().catch(() => ({})) as { requestId?: number; status?: string; error?: string };
  if (!res.ok) throw new Error(data.error ?? "QR display request failed");
  return { requestId: data.requestId!, status: data.status! };
}

async function fetchLedger(userId: number): Promise<LedgerEntry[]> {
  const headers = getAuthHeaders();
  if (!headers) throw new Error("Not authenticated");
  const res = await fetch(`${base()}/api/uc/admin/rewards/ledger?userId=${userId}`, { headers });
  if (!res.ok) throw new Error(`Failed to fetch ledger: ${res.status}`);
  const data = await res.json() as { ledger: LedgerEntry[] };
  return data.ledger;
}

// ─── Rules Table Row ──────────────────────────────────────────────────────────

function RuleRow({ rule, onSaved }: { rule: RewardsRule; onSaved: (r: RewardsRule) => void }) {
  const { toast } = useToast();
  const [editing, setEditing] = useState(false);
  const [pointsInput, setPointsInput] = useState(String(rule.pointsValue));

  const mutation = useMutation({
    mutationFn: (updates: { pointsValue?: number; active?: boolean }) =>
      patchRule(rule.id, updates, ""),
    onSuccess: (updated) => {
      onSaved(updated);
      setEditing(false);
      toast({ title: "Rule updated" });
    },
    onError: (err: Error) => toast({ title: "Update failed", description: err.message, variant: "destructive" }),
  });

  function handlePointsSave() {
    const v = parseInt(pointsInput, 10);
    if (isNaN(v) || v < 0) {
      toast({ title: "Invalid value", description: "Points must be a non-negative integer.", variant: "destructive" });
      return;
    }
    mutation.mutate({ pointsValue: v });
  }

  return (
    <TableRow>
      <TableCell className="font-medium">{rule.label}</TableCell>
      <TableCell className="font-mono text-xs text-muted-foreground">{rule.eventType}</TableCell>
      <TableCell>
        {editing ? (
          <div className="flex items-center gap-2">
            <Input
              type="number"
              min={0}
              value={pointsInput}
              onChange={(e) => setPointsInput(e.target.value)}
              className="w-24 h-8 text-sm"
              onKeyDown={(e) => { if (e.key === "Enter") handlePointsSave(); if (e.key === "Escape") setEditing(false); }}
              autoFocus
            />
            <Button size="sm" className="h-8" onClick={handlePointsSave} disabled={mutation.isPending}>
              {mutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : "Save"}
            </Button>
            <Button size="sm" variant="ghost" className="h-8" onClick={() => { setPointsInput(String(rule.pointsValue)); setEditing(false); }}>
              Cancel
            </Button>
          </div>
        ) : (
          <button
            className="font-semibold text-primary hover:underline cursor-pointer"
            onClick={() => setEditing(true)}
            title="Click to edit"
          >
            {rule.pointsValue} pts
          </button>
        )}
      </TableCell>
      <TableCell>
        <button
          onClick={() => mutation.mutate({ active: !rule.active })}
          disabled={mutation.isPending}
          className="flex items-center gap-1.5 text-sm"
          title={rule.active ? "Click to deactivate" : "Click to activate"}
        >
          {rule.active
            ? <ToggleRight className="w-5 h-5 text-green-500" />
            : <ToggleLeft className="w-5 h-5 text-muted-foreground" />}
          <Badge variant={rule.active ? "default" : "secondary"} className="text-xs">
            {rule.active ? "Active" : "Inactive"}
          </Badge>
        </button>
      </TableCell>
      <TableCell className="text-xs text-muted-foreground">
        {rule.updatedBy ?? "—"}
      </TableCell>
      <TableCell className="text-xs text-muted-foreground">
        {new Date(rule.updatedAt).toLocaleDateString()}
      </TableCell>
    </TableRow>
  );
}

// ─── Manual Award Form ────────────────────────────────────────────────────────

const REASON_PRESETS = [
  "Filter replacement reward",
  "Qualifying product purchase",
  "Referral bonus",
  "Promotional award",
  "Customer goodwill gesture",
  "Other",
];

function AwardForm() {
  const { toast } = useToast();
  const [lookup, setLookup]   = useState("");
  const [points, setPoints]   = useState("");
  const [reason, setReason]   = useState("");
  const [customReason, setCustomReason] = useState("");
  const [result, setResult]   = useState<GrantResult | null>(null);

  const effectiveReason = reason === "Other" ? customReason.trim() : reason;

  const mutation = useMutation({
    mutationFn: () => grantPoints({
      lookup: lookup.trim(),
      points: parseInt(points, 10),
      reason: effectiveReason,
      grantedBy: "",
    }),
    onSuccess: (data) => {
      setResult(data);
      setLookup("");
      setPoints("");
      setReason("");
      setCustomReason("");
      toast({
        title: `${data.entry.points} points awarded to ${data.customer.firstName}`,
        description: `New balance: ${data.newBalance} pts`,
      });
    },
    onError: (err: Error) => toast({ title: "Award failed", description: err.message, variant: "destructive" }),
  });

  const canSubmit = lookup.trim() && points && !isNaN(parseInt(points, 10)) && parseInt(points, 10) > 0 && effectiveReason;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {/* Account lookup */}
        <div className="space-y-2">
          <Label htmlFor="award-lookup">Account (phone, email, or QR string)</Label>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              id="award-lookup"
              placeholder="e.g. +254712345678 or user@email.com or uc-rewards:…"
              value={lookup}
              onChange={(e) => { setLookup(e.target.value); setResult(null); }}
              className="pl-9"
            />
          </div>
          <p className="text-xs text-muted-foreground">
            Enter a phone number, email address, or scan/paste the QR value from the app.
          </p>
        </div>

        {/* Points */}
        <div className="space-y-2">
          <Label htmlFor="award-points">Points to award</Label>
          <Input
            id="award-points"
            type="number"
            min={1}
            placeholder="e.g. 100"
            value={points}
            onChange={(e) => setPoints(e.target.value)}
          />
        </div>

        {/* Reason */}
        <div className="space-y-2 sm:col-span-2">
          <Label htmlFor="award-reason">Reason</Label>
          <Select value={reason} onValueChange={setReason}>
            <SelectTrigger id="award-reason">
              <SelectValue placeholder="Select a reason…" />
            </SelectTrigger>
            <SelectContent>
              {REASON_PRESETS.map((r) => (
                <SelectItem key={r} value={r}>{r}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {reason === "Other" && (
            <Input
              placeholder="Describe the reason…"
              value={customReason}
              onChange={(e) => setCustomReason(e.target.value)}
            />
          )}
        </div>
      </div>

      {/* Success result */}
      {result && (
        <div className="flex items-start gap-3 p-3 rounded-lg bg-green-50 border border-green-200">
          <CheckCircle2 className="w-4 h-4 text-green-600 mt-0.5 flex-shrink-0" />
          <div className="text-sm">
            <p className="font-medium text-green-800">
              {result.entry.points} points awarded to {result.customer.firstName} ({result.customer.email})
            </p>
            <p className="text-green-700">New balance: <strong>{result.newBalance} pts</strong></p>
            {result.notification?.status && <p className="text-green-700">Push: {result.notification.status}{result.notification.message ? ` — ${result.notification.message}` : ""}</p>}
          </div>
        </div>
      )}

      <div className="flex justify-end">
        <Button onClick={() => mutation.mutate()} disabled={!canSubmit || mutation.isPending}>
          {mutation.isPending
            ? <><Loader2 className="w-4 h-4 animate-spin mr-2" />Awarding…</>
            : "Award points"}
        </Button>
      </div>
    </div>
  );
}

// ─── Scanner and customer transaction workspace ──────────────────────────────

interface RegisteredFilter {
  id: string | number;
  productName: string;
  remainingCapacityLitres: number;
}
interface ResolvedCustomer {
  id: number;
  firstName: string;
  email: string;
  phone: string;
}
interface ResolvedRewardsCustomer {
  customer: ResolvedCustomer;
  balance: number;
  lifetimeRedeemed: number;
  impact?: { totalLitres?: number; starLevel?: number; remainingCapacity?: number; filters?: RegisteredFilter[] };
}
interface ConversionRule { mode: "kes" | "percentage"; value: number; active: boolean; updatedAt?: string; updatedBy?: string; canEdit?: boolean }

async function rewardsRequest<T>(path: string, method = "GET", body?: unknown): Promise<T> {
  const headers = getAuthHeaders();
  if (!headers) throw new Error("Not authenticated");
  const response = await fetch(`${base()}/api/uc/admin/rewards${path}`, {
    method, headers: { ...headers, ...(body ? { "Content-Type": "application/json" } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({})) as { error?: string };
    throw new Error(error.error ?? `Request failed (${response.status})`);
  }
  return response.json() as Promise<T>;
}

function ScannerWorkspace() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const videoRef = useRef<HTMLVideoElement>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);
  const scannerRef = useRef<QrScannerController | null>(null);
  const resolvingRef = useRef(false);
  const [lookup, setLookup] = useState("");
  const [resolved, setResolved] = useState<ResolvedRewardsCustomer | null>(null);
  const [scannerState, setScannerState] = useState<"idle" | "starting" | "active" | "photo" | "unavailable">("idle");
  const [scannerRequested, setScannerRequested] = useState(false);
  const [scanMessage, setScanMessage] = useState("");
  const [mode, setMode] = useState<"award" | "redeem" | "litres">("award");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [filterId, setFilterId] = useState("");
  const [confirmation, setConfirmation] = useState(false);
  const [transactionResult, setTransactionResult] = useState("");
  const user = getTeamUser();

  const { data: conversion } = useQuery({
    queryKey: ["rewards-conversion"],
    queryFn: () => rewardsRequest<{ conversion: ConversionRule }>("/conversion").then(d => d.conversion),
  });

  const stopScanner = useCallback((nextState: "idle" | "photo" | "unavailable" = "idle") => {
    scannerRef.current?.stop();
    scannerRef.current = null;
    setScannerRequested(false);
    setScannerState(nextState);
  }, []);
  useEffect(() => stopScanner, [stopScanner]);
  useEffect(() => {
    const pauseForBackground = () => {
      if (document.visibilityState === "hidden" && scannerRef.current) {
        stopScanner("photo");
        setScanMessage("Camera paused while this page was in the background. Take a QR photo, restart scanning, or use manual lookup.");
      }
    };
    const closeScanner = () => scannerRef.current?.stop();
    document.addEventListener("visibilitychange", pauseForBackground);
    window.addEventListener("pagehide", closeScanner);
    return () => {
      document.removeEventListener("visibilitychange", pauseForBackground);
      window.removeEventListener("pagehide", closeScanner);
    };
  }, [stopScanner]);

  const resolveMutation = useMutation({
    mutationFn: (value: string) => rewardsRequest<ResolvedRewardsCustomer>("/resolve", "POST", { lookup: value }),
    onSuccess: (data) => {
      setResolved(data); setScanMessage(""); setAmount(""); setReason(""); setConfirmation(false); setTransactionResult("");
       const filters = data.impact?.filters ?? [];
      setFilterId(filters[0] ? String(filters[0].id) : "");
    },
    onError: (error: Error) => setScanMessage(error.message),
    onSettled: () => { resolvingRef.current = false; },
  });
  const resolveLookup = (value = lookup) => {
    const trimmed = value.trim();
    if (trimmed && !resolvingRef.current) {
      resolvingRef.current = true;
      resolveMutation.mutate(trimmed);
    }
  };

  function openPhotoScanner(message: string, openCamera = false) {
    stopScanner("photo");
    setScanMessage(message);
    if (openCamera) photoInputRef.current?.click();
  }

  function liveCameraIsAvailable() {
    if (!navigator.mediaDevices?.getUserMedia) return false;
    const policy = (document as Document & {
      permissionsPolicy?: { allowsFeature?: (feature: string) => boolean };
    }).permissionsPolicy;
    return policy?.allowsFeature ? policy.allowsFeature("camera") : true;
  }

  function startScanner() {
    if (!liveCameraIsAvailable()) {
      openPhotoScanner(
        "Use your rear camera to photograph the customer's QR code. The image is read on this device and is not uploaded.",
        true,
      );
      return;
    }
    setScanMessage("");
    setScannerState("starting");
    setScannerRequested(true);
  }

  async function scanQrPhoto(file: File | undefined) {
    if (!file) return;
    setScanMessage("Reading QR photo…");
    const objectUrl = URL.createObjectURL(file);
    try {
      const image = new Image();
      await new Promise<void>((resolve, reject) => {
        image.onload = () => resolve();
        image.onerror = () => reject(new Error("Image could not be loaded"));
        image.src = objectUrl;
      });
      const canvas = document.createElement("canvas");
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) throw new Error("Image decoding is unavailable");
      context.drawImage(image, 0, 0);
      const frame = context.getImageData(0, 0, canvas.width, canvas.height);
      const { default: decodeQr } = await import("jsqr");
      const result = decodeQr(frame.data, frame.width, frame.height);
      if (!result?.data) {
        setScanMessage("No QR code was found in that photo. Try again with the code centred and well lit, or use manual lookup.");
        return;
      }
      setLookup(result.data);
      setScannerState("idle");
      resolveLookup(result.data);
    } catch {
      setScanMessage("That QR photo could not be read. Try another photo, or use manual lookup.");
      setScannerState("photo");
    } finally {
      URL.revokeObjectURL(objectUrl);
      if (photoInputRef.current) photoInputRef.current.value = "";
    }
  }

  useEffect(() => {
    if (!scannerRequested || !videoRef.current) return;
    const failureMessages: Record<QrScannerFailure, string> = {
      "insecure-context": "Camera scanning requires a secure HTTPS connection. Use manual lookup below.",
      "permission-denied": "Camera permission was denied. Enable camera access to scan, or use manual lookup.",
      "no-camera": "No camera is available on this device. Use manual lookup below.",
      "camera-busy": "The camera is being used by another app or browser tab. Close it and try again.",
      "decode-error": "The QR code could not be read. Hold it steady in good light, or use manual lookup.",
    };
    const controller = new QrScannerController(
      window.isSecureContext !== false,
      createQrScannerAdapter(videoRef.current),
      {
        onStarted: () => setScannerState("active"),
        onResult: (value) => {
          scannerRef.current = null;
          setScannerRequested(false);
          setScannerState("idle");
          setLookup(value);
          resolveLookup(value);
        },
        onFailure: (failure) => {
          scannerRef.current = null;
          setScannerRequested(false);
          setScannerState("photo");
          setScanMessage(`${failureMessages[failure]} Take a QR photo instead, or use manual lookup.`);
        },
      },
    );
    scannerRef.current = controller;
    void controller.start();
    return () => controller.stop();
  }, [scannerRequested]);

  const numericAmount = Number(amount);
   const selectedFilter = resolved?.impact?.filters?.find(filter => String(filter.id) === filterId);
  const validAmount = Number.isInteger(numericAmount) && numericAmount > 0
    && (mode !== "redeem" || numericAmount % 1000 === 0)
     && (mode !== "litres" || (!!selectedFilter && numericAmount <= selectedFilter.remainingCapacityLitres));
  const canProceed = !!resolved && validAmount && reason.trim().length > 0;
  const endpoint = mode === "litres" ? "/impact" : "/transaction";
  const transaction = useMutation({
    mutationFn: () => rewardsRequest<{ newBalance?: number; balance?: number; lifetimeRedeemed?: number; impact?: ResolvedRewardsCustomer["impact"]; notification?: { status?: string; message?: string }; push?: { status?: string; message?: string } }>(
      endpoint, "POST",
      mode === "litres"
        ? { lookup, registeredFilterId: filterId, litres: numericAmount, reason: reason.trim(), idempotencyKey: crypto.randomUUID() }
        : { direction: mode, lookup, points: numericAmount, reason: reason.trim(), idempotencyKey: crypto.randomUUID() },
    ),
    onSuccess: (data) => {
      setResolved(previous => previous ? {
        ...previous,
        balance: data.newBalance ?? data.balance ?? previous.balance,
        lifetimeRedeemed: data.lifetimeRedeemed ?? previous.lifetimeRedeemed,
        impact: data.impact ?? previous.impact,
      } : previous);
      setAmount(""); setReason(""); setConfirmation(false);
      const notification = data.notification ?? data.push;
      setTransactionResult(notification?.status
        ? `Saved. Push ${notification.status}${notification.message ? `: ${notification.message}` : ""}.`
        : "Saved. Push outcome was recorded.");
      void qc.invalidateQueries({ queryKey: ["rewards-balances"] });
      void qc.invalidateQueries({ queryKey: ["rewards-ledger"] });
      toast({ title: mode === "litres" ? "Litres added" : mode === "award" ? "Points awarded" : "Points redeemed" });
    },
    onError: (error: Error) => toast({ title: "Transaction failed", description: error.message, variant: "destructive" }),
  });
  const revoke = useMutation({
    mutationFn: () => rewardsRequest("/qr/revoke", "POST", { lookup }),
    onSuccess: () => { setResolved(null); setLookup(""); toast({ title: "QR code revoked", description: "Ask the customer to reopen their Rewards screen for a replacement." }); },
    onError: (error: Error) => toast({ title: "Could not revoke QR", description: error.message, variant: "destructive" }),
  });
  const valueText = conversion?.active && mode === "redeem"
    ? conversion.mode === "kes" ? `KES ${(numericAmount / 1000 * conversion.value).toLocaleString()}` : `${numericAmount / 1000 * conversion.value}%`
    : null;

  return (
    <section className="rounded-xl border bg-card overflow-hidden">
      <div className="p-4 sm:p-5 border-b bg-muted/30 flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <div><h2 className="text-lg font-semibold flex items-center gap-2"><ScanLine className="w-5 h-5 text-primary" /> Scan & transact</h2><p className="text-sm text-muted-foreground mt-1">Resolve a customer before changing Rewards or personal water impact.</p></div>
        <Button className="w-full sm:w-auto min-h-11" onClick={startScanner} disabled={scannerState === "starting" || scannerState === "active"}><Camera className="w-4 h-4 mr-2" />{scannerState === "starting" ? "Starting camera…" : "Scan customer"}</Button>
      </div>
      <div className="p-4 sm:p-5 space-y-5">
        <input
          ref={photoInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="sr-only"
          aria-label="Take a customer QR photo"
          onChange={(event) => void scanQrPhoto(event.target.files?.[0])}
        />
        {scannerRequested && <div className="relative w-full max-w-lg rounded-lg overflow-hidden bg-black"><video ref={videoRef} muted playsInline className="w-full max-h-[60dvh] object-cover" /><div className="absolute inset-6 sm:inset-8 border-2 border-primary rounded-lg pointer-events-none" aria-hidden /><Button variant="secondary" size="sm" className="absolute right-2 top-2 min-h-11" onClick={() => stopScanner()}><X className="w-4 h-4 mr-1" />Cancel</Button></div>}
        {(scannerState === "photo" || scannerState === "unavailable") && (
          <div className="flex flex-col sm:flex-row gap-2">
            <Button type="button" variant="secondary" className="min-h-11" onClick={() => photoInputRef.current?.click()}>
              <Camera className="w-4 h-4 mr-2" />Take QR photo
            </Button>
            <Button type="button" variant="outline" className="min-h-11" onClick={startScanner}>
              <ScanLine className="w-4 h-4 mr-2" />Try live scanner
            </Button>
          </div>
        )}
        <div className="flex flex-col sm:flex-row gap-2 max-w-2xl"><div className="flex-1"><Label htmlFor="customer-lookup">Phone, email, customer code, or QR value</Label><Input id="customer-lookup" value={lookup} onChange={event => setLookup(event.target.value)} onKeyDown={event => { if (event.key === "Enter") resolveLookup(); }} placeholder="Paste a QR value or enter phone/email" className="mt-1" /></div><Button className="sm:self-end" variant="outline" onClick={() => resolveLookup()} disabled={!lookup.trim() || resolveMutation.isPending}>{resolveMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : "Find customer"}</Button></div>
        {scanMessage && <p className="text-sm text-destructive flex gap-2"><ShieldAlert className="w-4 h-4 shrink-0 mt-0.5" />{scanMessage}</p>}
        {resolved && <div className="rounded-lg border p-4 space-y-4">
          <div className="flex flex-wrap justify-between gap-3"><div><p className="font-semibold">{resolved.customer.firstName}</p><p className="text-sm text-muted-foreground">{resolved.customer.email || "No email"} · {resolved.customer.phone || "No phone"}</p></div><div className="text-right"><p className="text-xs uppercase tracking-wide text-muted-foreground">Spendable balance</p><p className="text-xl font-bold text-primary">{resolved.balance.toLocaleString()} pts</p><p className="text-xs text-muted-foreground">Lifetime redeemed: {(resolved.lifetimeRedeemed ?? 0).toLocaleString()} pts</p></div></div>
          <div className="flex gap-2 flex-wrap" role="tablist" aria-label="Transaction type">{(["award", "redeem", "litres"] as const).map(item => <Button key={item} type="button" size="sm" variant={mode === item ? "default" : "outline"} onClick={() => { setMode(item); setConfirmation(false); }}>{item === "litres" ? "Add litres" : item === "award" ? "Award" : "Redeem"}</Button>)}</div>
           {mode === "litres" && <div className="space-y-2"><Label htmlFor="registered-filter">Registered filter</Label><Select value={filterId} onValueChange={setFilterId}><SelectTrigger id="registered-filter"><SelectValue placeholder="Select a registered filter" /></SelectTrigger><SelectContent>{(resolved.impact?.filters ?? []).map(filter => <SelectItem key={filter.id} value={String(filter.id)}>{filter.productName} — {filter.remainingCapacityLitres.toLocaleString()} L remaining</SelectItem>)}</SelectContent></Select>{!selectedFilter && <p className="text-xs text-destructive">This customer has no selectable registered filter with remaining capacity.</p>}</div>}
          <div className="grid sm:grid-cols-2 gap-3"><div><Label htmlFor="transaction-amount">{mode === "litres" ? "Whole litres" : mode === "redeem" ? "Points (1,000-point blocks)" : "Positive whole points"}</Label><Input id="transaction-amount" type="number" min={mode === "redeem" ? 1000 : 1} step={mode === "redeem" ? 1000 : 1} value={amount} onChange={event => setAmount(event.target.value)} /></div><div><Label htmlFor="transaction-reason">Reason</Label><Input id="transaction-reason" value={reason} onChange={event => setReason(event.target.value)} placeholder="Required for the receipt" /></div></div>
          {mode === "award" && <div className="flex gap-2 flex-wrap">{[50, 100, 250, 500].map(points => <Button type="button" key={points} size="sm" variant="outline" onClick={() => setAmount(String(points))}>+{points}</Button>)}</div>}
          {mode === "redeem" && <><div className="flex gap-2 flex-wrap">{[1000, 2000, 5000].map(points => <Button type="button" key={points} size="sm" variant="outline" onClick={() => setAmount(String(points))}>{points.toLocaleString()} pts</Button>)}</div>{valueText && <p className="text-sm text-muted-foreground">Configured equivalent: <strong>{valueText}</strong></p>}{numericAmount > resolved.balance && <p className="text-sm text-destructive">Insufficient balance: customer has {resolved.balance.toLocaleString()} points.</p>}</>}
           {mode === "litres" && selectedFilter && <p className="text-sm text-muted-foreground flex gap-1.5"><Droplets className="w-4 h-4" />{selectedFilter.remainingCapacityLitres.toLocaleString()} litres remain on this registered filter.</p>}
           {transactionResult && <p className="text-sm text-emerald-700" role="status">{transactionResult}</p>}
          {!confirmation ? <div className="flex flex-col-reverse sm:flex-row sm:justify-between sm:items-center gap-3"><Button variant="ghost" size="sm" className="min-h-11 text-destructive" onClick={() => revoke.mutate()} disabled={revoke.isPending}><RotateCcw className="w-4 h-4 mr-1" />Revoke QR</Button><Button className="min-h-11" onClick={() => setConfirmation(true)} disabled={!canProceed}>Review {mode === "litres" ? "contribution" : "transaction"}</Button></div> : <div className="rounded-md bg-muted p-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 text-sm"><span>Confirm <strong>{resolved.customer.firstName}</strong>: {mode === "award" ? "+" : mode === "redeem" ? "−" : "+"}{numericAmount.toLocaleString()} {mode === "litres" ? "L" : "points"}{valueText ? ` (${valueText})` : ""}. Recorded by {user?.name ?? user?.email ?? "you"}.</span><div className="grid grid-cols-2 gap-2"><Button className="min-h-11" size="sm" variant="outline" onClick={() => setConfirmation(false)} disabled={transaction.isPending}>Back</Button><Button className="min-h-11" size="sm" onClick={() => transaction.mutate()} disabled={transaction.isPending}>{transaction.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : "Confirm"}</Button></div></div>}
        </div>}
      </div>
    </section>
  );
}

function ConversionSettings() {
  const { toast } = useToast();
  const { data, isLoading } = useQuery({ queryKey: ["rewards-conversion-settings"], queryFn: () => rewardsRequest<{ conversion: ConversionRule; canEdit: boolean }>("/conversion") });
  const [mode, setMode] = useState<"kes" | "percentage">("kes");
  const [value, setValue] = useState("");
  useEffect(() => { if (data) { setMode(data.conversion.mode); setValue(String(data.conversion.value)); } }, [data]);
  const save = useMutation({
    mutationFn: () => rewardsRequest<{ conversion: ConversionRule }>("/conversion", "PATCH", { mode, value: Number(value), active: data?.conversion.active }),
    onSuccess: () => toast({ title: "Redemption settings saved" }),
    onError: (error: Error) => toast({ title: "Settings could not be saved", description: error.message, variant: "destructive" }),
  });
  if (isLoading || !data) return null;
  const example = mode === "kes" ? `1,000 points = KES ${Number(value || 0).toLocaleString()}` : `1,000 points = ${value || 0}%`;
  return <section className="rounded-lg border bg-card p-5 space-y-3">
    <div><h2 className="text-lg font-semibold">Redemption conversion</h2><p className="text-sm text-muted-foreground">Primary administrators manage the value used for each 1,000-point redemption.</p></div>
    <p className="font-medium text-sm">{example}</p>
    {data.canEdit ? <div className="flex flex-col sm:flex-row gap-3 sm:items-end max-w-lg"><div className="flex-1"><Label>Conversion type</Label><Select value={mode} onValueChange={value => setMode(value as "kes" | "percentage")}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="kes">KES value</SelectItem><SelectItem value="percentage">Percentage</SelectItem></SelectContent></Select></div><div className="flex-1"><Label htmlFor="conversion-value">Value per 1,000 points</Label><Input id="conversion-value" type="number" min={0} value={value} onChange={event => setValue(event.target.value)} /></div><Button onClick={() => save.mutate()} disabled={save.isPending || !Number.isFinite(Number(value))}>{save.isPending ? "Saving…" : "Save"}</Button></div> : <p className="text-xs text-muted-foreground">Only the primary administrator can change this setting.</p>}
  </section>;
}

// ─── Ledger Drawer ────────────────────────────────────────────────────────────

function LedgerDrawer({
  customer,
  open,
  onClose,
}: {
  customer: CustomerBalance | null;
  open: boolean;
  onClose: () => void;
}) {
  const { toast } = useToast();

  const { data: ledger = [], isLoading } = useQuery({
    queryKey: ["rewards-ledger", customer?.userId],
    queryFn: () => fetchLedger(customer!.userId),
    enabled: open && customer != null,
  });

  function downloadCsv(userId?: number) {
    const headers = getAuthHeaders();
    if (!headers) { toast({ title: "Not authenticated", variant: "destructive" }); return; }
    const params = userId ? `userId=${userId}&export=1` : `export=1`;
    fetch(`${base()}/api/uc/admin/rewards/ledger?${params}`, { headers })
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const blob = await res.blob();
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = userId ? `rewards-ledger-user${userId}.csv` : "rewards-ledger.csv";
        a.click();
        URL.revokeObjectURL(a.href);
      })
      .catch((err: Error) => toast({ title: "Export failed", description: err.message, variant: "destructive" }));
  }

  if (!customer) return null;

  return (
    <Sheet open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <SheetContent side="right" className="w-full sm:max-w-2xl flex flex-col gap-0 p-0">
        <SheetHeader className="px-6 pt-6 pb-4 border-b">
          <SheetTitle className="text-base">
            {customer.firstName} {customer.lastName}
          </SheetTitle>
          <SheetDescription className="text-xs">
            {customer.email} · {customer.phone || "no phone"} · <strong>{customer.balance} spendable pts</strong> · {Number(customer.lifetimeRedeemed ?? 0).toLocaleString()} lifetime redeemed pts
          </SheetDescription>
        </SheetHeader>

        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 px-4 sm:px-6 py-3 border-b bg-muted/30">
          <span className="text-sm text-muted-foreground">Full points history</span>
          <Button size="sm" variant="outline" onClick={() => downloadCsv(customer.userId)}>
            <Download className="w-3.5 h-3.5 mr-1.5" /> Export CSV
          </Button>
        </div>

        <div className="flex-1 overflow-auto">
          {isLoading ? (
            <div className="flex items-center gap-2 text-muted-foreground py-12 justify-center">
              <Loader2 className="w-4 h-4 animate-spin" /> Loading ledger…
            </div>
          ) : ledger.length === 0 ? (
            <div className="text-center text-muted-foreground py-12 text-sm">No entries found.</div>
          ) : (
            <Table className="min-w-[720px]">
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Points</TableHead>
                  <TableHead>Reason</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Granted by</TableHead>
                  <TableHead>Notification</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {ledger.map((entry) => (
                  <TableRow key={entry.id}>
                    <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                      {new Date(entry.createdAt).toLocaleDateString()}
                    </TableCell>
                    <TableCell>
                      <span className={entry.points >= 0 ? "text-green-600 font-semibold" : "text-red-600 font-semibold"}>
                        {entry.points >= 0 ? "+" : ""}{entry.points}
                      </span>
                    </TableCell>
                    <TableCell className="text-sm max-w-48 truncate" title={entry.reason}>
                      {entry.reason}
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary" className="text-xs font-mono">{entry.eventType}</Badge>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {entry.grantedBy ?? "—"}
                    </TableCell>
                    <TableCell>
                      {!entry.notificationEvent ? (
                        <span className="text-xs text-muted-foreground">—</span>
                      ) : (
                        <Badge
                          variant={entry.notificationStatus === "sent" ? "secondary" : entry.notificationStatus === "failed" ? "destructive" : "outline"}
                          className="text-xs"
                          title={entry.notificationError ?? undefined}
                        >
                          {entry.notificationEvent.replace(/_/g, " ")}
                        </Badge>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

// ─── Customer Balances Section ────────────────────────────────────────────────

type SortKey = "name" | "email" | "phone" | "balance";
type SortDir = "asc" | "desc";

function SortIcon({ col, sortKey, sortDir }: { col: SortKey; sortKey: SortKey; sortDir: SortDir }) {
  if (col !== sortKey) return <ArrowUpDown className="w-3.5 h-3.5 ml-1 opacity-40" />;
  return sortDir === "asc"
    ? <ArrowUp className="w-3.5 h-3.5 ml-1" />
    : <ArrowDown className="w-3.5 h-3.5 ml-1" />;
}

function CustomerBalancesSection({ eventTypes }: { eventTypes: string[] }) {
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [selectedCustomer, setSelectedCustomer] = useState<CustomerBalance | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("balance");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [exportFrom, setExportFrom] = useState("");
  const [exportTo, setExportTo] = useState("");
  const [exportEventType, setExportEventType] = useState("all");
  const requestQr = useMutation({
    mutationFn: requestRewardsQrDisplay,
    onSuccess: (result) => toast({
      title: "QR display request sent",
      description: `Request #${result.requestId} is recorded as sent and will update when the customer opens it.`,
    }),
    onError: (error: Error) => toast({ title: "QR display request failed", description: error.message, variant: "destructive" }),
  });

  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const handleSearchChange = useCallback((value: string) => {
    setSearch(value);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setDebouncedSearch(value), 350);
  }, []);

  const { data: balanceData, isLoading } = useQuery({
    queryKey: ["rewards-balances", debouncedSearch],
    queryFn: () => fetchBalances(debouncedSearch),
  });

  const customers = balanceData?.customers ?? [];
  const organizationLifetimeRedeemed = balanceData?.lifetimeRedeemed ?? 0;
  // Client-side sort applied on top of server data
  const sorted = [...customers].sort((a, b) => {
    let cmp = 0;
    if (sortKey === "name") {
      cmp = `${a.firstName} ${a.lastName}`.localeCompare(`${b.firstName} ${b.lastName}`);
    } else if (sortKey === "email") {
      cmp = a.email.localeCompare(b.email);
    } else if (sortKey === "phone") {
      cmp = (a.phone || "").localeCompare(b.phone || "");
    } else {
      cmp = a.balance - b.balance;
    }
    return sortDir === "asc" ? cmp : -cmp;
  });

  function toggleSort(col: SortKey) {
    if (sortKey === col) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(col);
      setSortDir(col === "balance" ? "desc" : "asc");
    }
  }

  function downloadFullCsv() {
    const headers = getAuthHeaders();
    if (!headers) { toast({ title: "Not authenticated", variant: "destructive" }); return; }
    if (exportFrom && exportTo && exportFrom > exportTo) {
      toast({ title: "Invalid date range", description: "The start date must be on or before the end date.", variant: "destructive" });
      return;
    }
    const params = new URLSearchParams({ export: "1" });
    if (exportFrom) params.set("from", exportFrom);
    if (exportTo) params.set("to", exportTo);
    if (exportEventType !== "all") params.set("eventType", exportEventType);
    fetch(`${base()}/api/uc/admin/rewards/ledger?${params}`, { headers })
      .then(async (res) => {
        if (!res.ok) {
          const error = await res.json().catch(() => ({})) as { error?: string };
          throw new Error(error.error ?? `HTTP ${res.status}`);
        }
        const blob = await res.blob();
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        const disposition = res.headers.get("Content-Disposition");
        const serverFilename = disposition?.match(/filename="([^"]+)"/)?.[1];
        a.download = serverFilename ?? "rewards-ledger.csv";
        a.click();
        URL.revokeObjectURL(a.href);
      })
      .catch((err: Error) => toast({ title: "Export failed", description: err.message, variant: "destructive" }));
  }

  const SortHead = ({ col, children, className }: { col: SortKey; children: React.ReactNode; className?: string }) => (
    <TableHead className={className}>
      <button
        className="flex items-center select-none hover:text-foreground transition-colors"
        onClick={() => toggleSort(col)}
      >
        {children}
        <SortIcon col={col} sortKey={sortKey} sortDir={sortDir} />
      </button>
    </TableHead>
  );

  return (
    <>
      <div className="space-y-3">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <Users className="w-4 h-4" /> Customer Balances
            </h2>
            <p className="text-sm text-muted-foreground">
              Current spendable points and all-time redeemed points. Click a row to view the full ledger.
            </p>
          </div>
          <div className="grid w-full grid-cols-1 sm:w-auto sm:grid-cols-2 lg:flex lg:flex-wrap items-end gap-2">
            <div className="space-y-1">
              <Label htmlFor="rewards-export-from" className="text-xs">From</Label>
              <Input id="rewards-export-from" type="date" value={exportFrom} onChange={(event) => setExportFrom(event.target.value)} className="h-11 w-full sm:w-40" data-testid="input-rewards-export-from" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="rewards-export-to" className="text-xs">To</Label>
              <Input id="rewards-export-to" type="date" value={exportTo} onChange={(event) => setExportTo(event.target.value)} className="h-11 w-full sm:w-40" data-testid="input-rewards-export-to" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="rewards-export-event-type" className="text-xs">Event type</Label>
              <Select value={exportEventType} onValueChange={setExportEventType}>
                <SelectTrigger id="rewards-export-event-type" className="h-11 w-full sm:w-48" data-testid="select-rewards-export-event-type"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All event types</SelectItem>
                  {eventTypes.map((eventType) => <SelectItem key={eventType} value={eventType}>{eventType}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <Button className="min-h-11 sm:col-span-2 lg:col-span-1" variant="outline" size="sm" onClick={downloadFullCsv} data-testid="button-export-rewards-ledger">
              <Download className="w-3.5 h-3.5 mr-1.5" />
              {exportFrom || exportTo || exportEventType !== "all" ? "Export Filtered Ledger CSV" : "Export Full Ledger CSV"}
            </Button>
          </div>
        </div>
        <div className="rounded-lg border border-primary/20 bg-primary/5 p-4" data-testid="rewards-lifetime-redeemed-total">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Organization lifetime redeemed</p>
          <p className="mt-1 text-2xl font-bold text-primary">{Number(organizationLifetimeRedeemed).toLocaleString()} pts</p>
        </div>

        {/* Search */}
        <div className="relative w-full max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            aria-label="Search customer balances"
            placeholder="Search by name or email…"
            value={search}
            onChange={(e) => handleSearchChange(e.target.value)}
            className="pl-9"
          />
        </div>

        {/* Table */}
        <div className="grid gap-2 md:hidden">
          {isLoading ? <div className="rounded-lg border bg-card p-6 text-center text-sm text-muted-foreground">Loading…</div> : sorted.length === 0 ? <div className="rounded-lg border bg-card p-6 text-center text-sm text-muted-foreground">{debouncedSearch ? "No customers match your search." : "No customers found."}</div> : sorted.map((c) => (
            <button key={c.userId} onClick={() => setSelectedCustomer(c)} className="min-h-16 rounded-lg border bg-card p-4 text-left focus-visible:ring-2 focus-visible:ring-ring">
              <span className="flex items-start justify-between gap-3"><span className="min-w-0"><span className="block font-medium">{c.firstName} {c.lastName}</span><span className="block truncate text-xs text-muted-foreground">{c.email}</span>{c.phone && <span className="block text-xs text-muted-foreground">{c.phone}</span>}</span><span className="shrink-0 text-right"><span className="block font-semibold text-primary">{Number(c.balance).toLocaleString()} pts</span><span className="block text-xs text-muted-foreground">Redeemed {Number(c.lifetimeRedeemed).toLocaleString()}</span></span></span>
            </button>
          ))}
        </div>
        <div className="hidden md:block rounded-lg border bg-card overflow-x-auto">
          <Table className="min-w-[680px]">
            <TableHeader>
              <TableRow>
                <SortHead col="name">Customer</SortHead>
                <SortHead col="email">Email</SortHead>
                <SortHead col="phone">Phone</SortHead>
                <SortHead col="balance" className="text-right">Spendable balance</SortHead>
                <TableHead className="text-right">Lifetime redeemed</TableHead>
                <TableHead className="w-36">QR action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-10">
                    <div className="flex items-center justify-center gap-2 text-muted-foreground">
                      <Loader2 className="w-4 h-4 animate-spin" /> Loading…
                    </div>
                  </TableCell>
                </TableRow>
              ) : sorted.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground py-10">
                    {debouncedSearch ? "No customers match your search." : "No customers found."}
                  </TableCell>
                </TableRow>
              ) : (
                sorted.map((c) => (
                  <TableRow
                    key={c.userId}
                    className="cursor-pointer hover:bg-muted/50"
                    onClick={() => setSelectedCustomer(c)}
                  >
                    <TableCell className="font-medium">
                      {c.firstName} {c.lastName}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">{c.email}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{c.phone || "—"}</TableCell>
                    <TableCell className="text-right font-semibold text-primary">
                      {Number(c.balance).toLocaleString()} pts
                    </TableCell>
                    <TableCell className="text-right text-muted-foreground">
                      {Number(c.lifetimeRedeemed).toLocaleString()} pts
                    </TableCell>
                    <TableCell>
                      <Button
                        size="sm"
                        variant="outline"
                        className="min-h-9"
                        data-testid={`request-rewards-qr-${c.userId}`}
                        disabled={requestQr.isPending}
                        onClick={(event) => { event.stopPropagation(); requestQr.mutate(c.userId); }}
                      >
                        {requestQr.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <><Smartphone className="w-3.5 h-3.5 mr-1" /> Show QR</>}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      <LedgerDrawer
        customer={selectedCustomer}
        open={selectedCustomer != null}
        onClose={() => setSelectedCustomer(null)}
      />
    </>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function AdminRewardsPage() {
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data: rules = [], isLoading, refetch } = useQuery({
    queryKey: ["rewards-rules"],
    queryFn: listRules,
  });

  const [localRules, setLocalRules] = useState<RewardsRule[] | null>(null);
  const displayRules = localRules ?? rules;

  function handleRuleSaved(updated: RewardsRule) {
    setLocalRules((prev) => {
      const base = prev ?? rules;
      return base.map((r) => (r.id === updated.id ? updated : r));
    });
    void qc.invalidateQueries({ queryKey: ["rewards-rules"] });
  }

  if (!isTeamAdmin()) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground">
        You don't have permission to view this page.
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Gift className="w-6 h-6" /> UC Rewards
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Scan or look up customers, manage their Rewards balance, and monitor customer balances.
        </p>
      </div>

      <ScannerWorkspace />
      <ConversionSettings />

      {/* Customer Balances */}
      <CustomerBalancesSection eventTypes={[...new Set([
        ...displayRules.map((rule) => rule.eventType),
        "manual",
        "redemption",
        "promotion_bonus",
      ])].sort()} />

      {/* Rules table */}
      <div className="space-y-3">
        <h2 className="text-lg font-semibold">Reward Rules</h2>
        <p className="text-sm text-muted-foreground">
          Click a points value to edit it inline. Toggle the status badge to activate or deactivate a rule.
        </p>
        {isLoading ? (
          <div className="flex items-center gap-2 text-muted-foreground py-8">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading rules…
          </div>
        ) : (
          <div className="rounded-lg border bg-card overflow-x-auto">
            <Table className="min-w-[760px]">
              <TableHeader>
                <TableRow>
                  <TableHead>Event</TableHead>
                  <TableHead>Type key</TableHead>
                  <TableHead>Points</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Last updated by</TableHead>
                  <TableHead>Date</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {displayRules.map((rule) => (
                  <RuleRow key={rule.id} rule={rule} onSaved={handleRuleSaved} />
                ))}
                {displayRules.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                      No reward rules configured yet. Seed the database to add default rules.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      {/* Manual award */}
      <div className="space-y-3">
        <h2 className="text-lg font-semibold">Award Points Manually</h2>
        <p className="text-sm text-muted-foreground">
          Look up a customer account and credit points with a reason. The entry will appear in their ledger immediately.
        </p>
        <div className="rounded-lg border bg-card p-4 sm:p-6">
          <AwardForm />
        </div>
      </div>
    </div>
  );
}
