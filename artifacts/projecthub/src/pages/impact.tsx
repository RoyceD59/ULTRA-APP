/**
 * UC Impact Admin — ProjectHub page
 *
 * Admin-gated page. Uses the same UC Companion credentials + JWT as the
 * Alison Feedback page. Token is stored in sessionStorage.
 *
 * Shows live impact stats and lets the team log individual offline client
 * purchases that count toward Litres Filtered, Customers Served, and
 * Plastics Avoided automatically.
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import {
  Leaf, Droplets, Trash2, Users, RefreshCw, Save, Info,
  PlusCircle, Pencil, X, ChevronDown, ChevronRight, AlertCircle, Lock, LogOut,
} from 'lucide-react';
import { getTeamToken } from '@/lib/team-auth';

const BASE      = import.meta.env.BASE_URL.replace(/\/$/, '');
const TOKEN_KEY = 'uc_impact_admin_token';

// ─── Types ────────────────────────────────────────────────────────────────────

interface OfflineProduct {
  productId?:     number;
  productName:    string;
  quantity:       number;
  litresPerUnit?: number;
}

interface OfflineClient {
  id:        number;
  clientRef: string;
  products:  OfflineProduct[];
  saleDate:  string;
  notes:     string;
  createdAt: string;
}

interface ImpactData {
  totalUsers:      number;
  litresFiltered:  number;
  plasticsAvoided: number;
  autoStats: {
    totalUsers:     number;
    litresFiltered: number;
  };
  offlineStats: {
    clientCount:    number;
    litresFiltered: number;
  };
  override: {
    litresOffset:  number;
    usersOffset:   number;
    lastUpdatedBy: string;
    lastUpdatedAt: string;
  };
  lastUpdated: string;
}

// ─── Known products list (mirrors PRODUCT_LITRES on server) ───────────────────

const KNOWN_PRODUCTS: { id: number; name: string; litres: number }[] = [
  { id: 1,  name: 'Hydra Flux bottle',         litres: 150   },
  { id: 2,  name: 'Truva Go bottle',           litres: 150   },
  { id: 3,  name: 'Viva Drop bottle',          litres: 150   },
  { id: 4,  name: 'Flex bottle',               litres: 150   },
  { id: 5,  name: 'Timbo bottle',              litres: 150   },
  { id: 6,  name: 'Gym Buddy bottle',          litres: 150   },
  { id: 7,  name: 'Survivor Straw',            litres: 400   },
  { id: 8,  name: 'Breeze bottle',             litres: 150   },
  { id: 9,  name: 'EcoSmart Elite',            litres: 400   },
  { id: 11, name: 'Sweet Home faucet',         litres: 1750  },
  { id: 12, name: 'Counter Reverse Osmosis',   litres: 1500  },
  { id: 13, name: 'Electric Pitcher',          litres: 400   },
  { id: 14, name: 'RO Home System',            litres: 10000 },
  { id: 20, name: 'Gift & Bundle',             litres: 300   },
  { id: 22, name: 'Bottle Filter Cartridge',   litres: 150   },
  { id: 23, name: 'Faucet Filter Cartridge',   litres: 1750  },
  { id: 26, name: 'Survivor Straw Cartridge',  litres: 400   },
  { id: 29, name: 'Aqua Stream 1200',          litres: 50000 },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000)     return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}

function calcOfflineLitres(products: OfflineProduct[]): number {
  let total = 0;
  for (const p of products) {
    const cap = p.litresPerUnit ??
      (p.productId !== undefined ? (KNOWN_PRODUCTS.find(k => k.id === p.productId)?.litres ?? 0) : 0);
    total += cap * p.quantity;
  }
  return total;
}

function productSummary(products: OfflineProduct[]): string {
  return products.map(p => `${p.productName} ×${p.quantity}`).join(', ');
}

function authHeaders(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

// ─── Login Gate ───────────────────────────────────────────────────────────────

function LoginGate({ onToken }: { onToken: (t: string) => void }) {
  const [email,    setEmail]    = useState('');
  const [password, setPassword] = useState('');
  const [error,    setError]    = useState('');
  const [busy,     setBusy]     = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim() || !password) return;
    setBusy(true); setError('');
    try {
      const loginRes = await fetch(`${BASE}/api/uc/auth/login`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ email: email.trim(), password }),
      });
      if (loginRes.status === 401) { setError('Incorrect email or password.'); return; }
      if (!loginRes.ok) { setError(`Login failed (${loginRes.status}). Try again.`); return; }

      const { token } = await loginRes.json() as { token: string };
      if (!token) { setError('No token returned. Please try again.'); return; }

      // Verify admin access by hitting a protected endpoint
      const checkRes = await fetch(`${BASE}/api/uc/offline-clients`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (checkRes.status === 401 || checkRes.status === 403) {
        setError('Your account does not have admin access. Contact the UCFilters team.');
        return;
      }
      if (!checkRes.ok) { setError(`Server error (${checkRes.status}). Try again.`); return; }

      sessionStorage.setItem(TOKEN_KEY, token);
      onToken(token);
    } catch {
      setError('Could not reach the server. Is the API running?');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center justify-center min-h-[60vh]">
      <Card className="w-full max-w-md shadow-lg">
        <CardHeader className="text-center pb-4">
          <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-3">
            <Lock className="w-6 h-6 text-primary" />
          </div>
          <CardTitle className="text-xl">Sign in to UC Impact</CardTitle>
          <p className="text-sm text-muted-foreground mt-1">
            Use your UCFilters admin account (same credentials as the Companion app).
          </p>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email" type="email" autoComplete="email"
                placeholder="you@ucfilters.com"
                value={email} onChange={e => setEmail(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password" type="password" autoComplete="current-password"
                placeholder="••••••••"
                value={password} onChange={e => setPassword(e.target.value)}
              />
            </div>
            {error && (
              <div className="flex items-start gap-2 text-sm text-destructive bg-destructive/10 rounded-md p-3">
                <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                {error}
              </div>
            )}
            <Button type="submit" className="w-full" disabled={!email.trim() || !password || busy}>
              {busy ? 'Signing in…' : 'Sign in'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

// ─── StatCard ─────────────────────────────────────────────────────────────────

function StatCard({
  icon: Icon, color, label, auto, offline, legacy, total,
}: {
  icon: React.ElementType; color: string; label: string;
  auto: number; offline: number; legacy: number; total: number;
}) {
  return (
    <Card className="shadow-sm">
      <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
        <CardTitle className="text-sm font-medium text-muted-foreground">{label}</CardTitle>
        <Icon className={`w-4 h-4 ${color}`} />
      </CardHeader>
      <CardContent className="space-y-2">
        <div className="text-3xl font-bold text-foreground">{fmt(total)}</div>
        <div className="text-xs space-y-0.5">
          <p className="text-muted-foreground">
            <span className="font-medium text-foreground">{fmt(auto)}</span> from app orders
          </p>
          {offline > 0 && (
            <p className="text-emerald-600 font-medium">+{fmt(offline)} from offline sales</p>
          )}
          {legacy !== 0 && (
            <p className="text-amber-600">{legacy > 0 ? '+' : ''}{fmt(legacy)} legacy offset</p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// ─── FormProductRow ───────────────────────────────────────────────────────────

function FormProductRow({
  product, index, onChange, onRemove,
}: {
  product:  OfflineProduct;
  index:    number;
  onChange: (index: number, updated: OfflineProduct) => void;
  onRemove: (index: number) => void;
}) {
  const isCustom    = product.productId === undefined;
  const selectedKnown = KNOWN_PRODUCTS.find(k => k.id === product.productId);

  function handleSelect(e: React.ChangeEvent<HTMLSelectElement>) {
    const val = e.target.value;
    if (val === 'custom') {
      onChange(index, { productName: product.productName || '', quantity: product.quantity, litresPerUnit: product.litresPerUnit ?? 0 });
    } else {
      const known = KNOWN_PRODUCTS.find(k => String(k.id) === val);
      if (known) onChange(index, { productId: known.id, productName: known.name, quantity: product.quantity });
    }
  }

  const litresEach  = isCustom ? (product.litresPerUnit ?? 0) : (selectedKnown?.litres ?? 0);
  const litresTotal = litresEach * product.quantity;

  return (
    <div className="flex items-start gap-2 p-3 rounded-lg border bg-muted/30">
      <div className="flex-1 space-y-2">
        <select
          className="w-full text-sm border rounded-md px-3 py-2 bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          value={isCustom ? 'custom' : String(product.productId ?? '')}
          onChange={handleSelect}
        >
          <option value="">— Select product —</option>
          {KNOWN_PRODUCTS.map(k => (
            <option key={k.id} value={String(k.id)}>
              {k.name} ({k.litres.toLocaleString()} L/unit)
            </option>
          ))}
          <option value="custom">Custom / other product…</option>
        </select>

        {isCustom && (
          <Input
            placeholder="Product name"
            value={product.productName}
            onChange={e => onChange(index, { ...product, productName: e.target.value })}
            className="text-sm"
          />
        )}

        <div className="flex items-center gap-2">
          <div className="w-28">
            <Input
              type="number" min="1" step="1" placeholder="Qty"
              value={product.quantity || ''}
              onChange={e => onChange(index, { ...product, quantity: Math.max(1, parseInt(e.target.value) || 1) })}
              className="text-sm font-mono"
            />
          </div>
          {isCustom && (
            <div className="flex-1">
              <Input
                type="number" min="0" step="1" placeholder="Litres per unit"
                value={product.litresPerUnit ?? ''}
                onChange={e => onChange(index, { ...product, litresPerUnit: parseFloat(e.target.value) || 0 })}
                className="text-sm font-mono"
              />
            </div>
          )}
          {litresTotal > 0 && (
            <span className="text-xs text-emerald-600 font-medium whitespace-nowrap">= {fmt(litresTotal)} L</span>
          )}
        </div>
      </div>
      <button
        type="button" onClick={() => onRemove(index)}
        className="mt-1 p-1 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function ImpactPage() {
  const [token, setToken] = useState<string | null>(() => getTeamToken() ?? sessionStorage.getItem(TOKEN_KEY));

  function handleToken(t: string) { setToken(t); }
  function handleSignOut() { sessionStorage.removeItem(TOKEN_KEY); setToken(null); }

  if (!token) return <LoginGate onToken={handleToken} />;
  return <ImpactDashboard token={token} onSignOut={handleSignOut} />;
}

// ─── ImpactDashboard (authenticated) ─────────────────────────────────────────

function ImpactDashboard({ token, onSignOut }: { token: string; onSignOut: () => void }) {
  const [data,    setData]    = useState<ImpactData | null>(null);
  const [clients, setClients] = useState<OfflineClient[]>([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState('');

  // Legacy offset form
  const [litresOffset, setLitresOffset] = useState('');
  const [usersOffset,  setUsersOffset]  = useState('');
  const [legacySaving, setLegacySaving] = useState(false);
  const [legacyMsg,    setLegacyMsg]    = useState('');
  const [legacyError,  setLegacyError]  = useState('');
  const [showLegacy,   setShowLegacy]   = useState(false);

  // Offline client form dialog
  const [dialogOpen,    setDialogOpen]    = useState(false);
  const [editingClient, setEditingClient] = useState<OfflineClient | null>(null);
  const [formRef,       setFormRef]       = useState('');
  const [formDate,      setFormDate]      = useState('');
  const [formNotes,     setFormNotes]     = useState('');
  const [formProducts,  setFormProducts]  = useState<OfflineProduct[]>([]);
  const [formSaving,    setFormSaving]    = useState(false);
  const [formError,     setFormError]     = useState('');

  // Delete confirm
  const [deletingId, setDeletingId] = useState<number | null>(null);

  const loadRef = useRef(false);

  const load = useCallback(async () => {
    if (loadRef.current) return;
    loadRef.current = true;
    setLoading(true); setError('');
    try {
      const hdrs = { Authorization: `Bearer ${token}` };
      const [impactRes, clientsRes] = await Promise.all([
        fetch(`${BASE}/api/uc/impact`),
        fetch(`${BASE}/api/uc/offline-clients`, { headers: hdrs }),
      ]);
      if (impactRes.status === 401 || clientsRes.status === 401) { onSignOut(); return; }
      if (!impactRes.ok)  throw new Error(`Impact API: ${impactRes.status}`);
      if (!clientsRes.ok) throw new Error(`Clients API: ${clientsRes.status}`);
      const d = await impactRes.json()  as ImpactData;
      const c = await clientsRes.json() as { clients: OfflineClient[] };
      setData(d);
      setClients(c.clients);
      setLitresOffset(String(d.override.litresOffset));
      setUsersOffset(String(d.override.usersOffset));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load. Is the API server running?');
    } finally {
      setLoading(false);
      loadRef.current = false;
    }
  }, [token, onSignOut]);

  const refresh = useCallback(async () => { loadRef.current = false; await load(); }, [load]);

  useEffect(() => { load(); }, [load]);

  // ── Legacy offset save ────────────────────────────────────────────────────

  async function saveLegacyOffset() {
    setLegacySaving(true); setLegacyError(''); setLegacyMsg('');
    try {
      const litres = parseFloat(litresOffset) || 0;
      const users  = parseFloat(usersOffset)  || 0;
      const res = await fetch(`${BASE}/api/uc/impact/override`, {
        method:  'POST',
        headers: authHeaders(token),
        body:    JSON.stringify({ litresOffset: litres, usersOffset: users, updatedBy: 'admin' }),
      });
      if (res.status === 401) { onSignOut(); return; }
      if (!res.ok) {
        const err = await res.json().catch(() => ({} as Record<string, unknown>)) as { error?: string };
        throw new Error(err.error ?? String(res.status));
      }
      setLegacyMsg('Saved. Refreshing…');
      await refresh();
    } catch (e) {
      setLegacyError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setLegacySaving(false);
    }
  }

  // ── Dialog helpers ────────────────────────────────────────────────────────

  function openAdd() {
    setEditingClient(null);
    setFormRef(''); setFormDate(new Date().toISOString().slice(0, 10));
    setFormNotes(''); setFormProducts([{ productName: '', quantity: 1 }]);
    setFormError(''); setDialogOpen(true);
  }

  function openEdit(c: OfflineClient) {
    setEditingClient(c); setFormRef(c.clientRef); setFormDate(c.saleDate);
    setFormNotes(c.notes);
    setFormProducts(c.products.length > 0 ? [...c.products] : [{ productName: '', quantity: 1 }]);
    setFormError(''); setDialogOpen(true);
  }

  function addProductRow()                                       { setFormProducts(prev => [...prev, { productName: '', quantity: 1 }]); }
  function updateProductRow(i: number, updated: OfflineProduct) { setFormProducts(prev => prev.map((p, j) => j === i ? updated : p)); }
  function removeProductRow(i: number)                          { setFormProducts(prev => prev.filter((_, j) => j !== i)); }

  async function saveClient() {
    const validProducts = formProducts.filter(p => p.productName.trim() !== '' && p.quantity >= 1);
    if (validProducts.length === 0) { setFormError('Add at least one product with a name and quantity.'); return; }
    if (!formDate)                  { setFormError('Please enter the sale date.'); return; }
    setFormError(''); setFormSaving(true);
    try {
      const url  = editingClient ? `${BASE}/api/uc/offline-clients/${editingClient.id}` : `${BASE}/api/uc/offline-clients`;
      const res  = await fetch(url, {
        method:  editingClient ? 'PUT' : 'POST',
        headers: authHeaders(token),
        body:    JSON.stringify({ clientRef: formRef.trim(), products: validProducts, saleDate: formDate, notes: formNotes.trim() }),
      });
      if (res.status === 401) { onSignOut(); return; }
      if (!res.ok) {
        const err = await res.json().catch(() => ({} as Record<string, unknown>)) as { error?: string };
        throw new Error(err.error ?? String(res.status));
      }
      setDialogOpen(false);
      await refresh();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setFormSaving(false);
    }
  }

  async function deleteClient(id: number) {
    try {
      const res = await fetch(`${BASE}/api/uc/offline-clients/${id}`, {
        method: 'DELETE', headers: { Authorization: `Bearer ${token}` },
      });
      if (res.status === 401) { onSignOut(); return; }
      if (!res.ok) throw new Error(`${res.status}`);
      setDeletingId(null);
      await refresh();
    } catch (e) { console.error('Delete failed', e); }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  const offlineLitres = data?.offlineStats.litresFiltered ?? 0;
  const offlineCount  = data?.offlineStats.clientCount    ?? 0;

  return (
    <div className="space-y-8 animate-in-up">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground flex items-center gap-2">
            <Leaf className="w-7 h-7 text-green-500" />
            UC Impact Metrics
          </h1>
          <p className="text-muted-foreground mt-1">
            Auto-calculated from app orders, plus offline client entries you log here.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={refresh} disabled={loading} className="gap-2">
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
          <Button variant="ghost" size="sm" onClick={onSignOut} className="gap-2 text-muted-foreground">
            <LogOut className="w-4 h-4" />
            Sign out
          </Button>
        </div>
      </div>

      {/* Error banner */}
      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          <AlertCircle className="w-4 h-4 shrink-0" />
          {error}
        </div>
      )}

      {/* Live Stat Cards */}
      {loading && !data ? (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {[1,2,3].map(i => <div key={i} className="h-36 bg-muted rounded-lg animate-pulse" />)}
        </div>
      ) : data ? (
        <>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <StatCard
              icon={Users}    color="text-blue-500"    label="Customers Served"
              auto={data.autoStats.totalUsers}      offline={offlineCount}
              legacy={data.override.usersOffset}    total={data.totalUsers}
            />
            <StatCard
              icon={Droplets} color="text-emerald-500" label="Litres Filtered"
              auto={data.autoStats.litresFiltered}  offline={offlineLitres}
              legacy={data.override.litresOffset}   total={data.litresFiltered}
            />
            <StatCard
              icon={Trash2}   color="text-orange-500"  label="Plastic Bottles Avoided (500 ml)"
              auto={data.autoStats.litresFiltered * 2} offline={offlineLitres * 2}
              legacy={data.override.litresOffset * 2}  total={data.plasticsAvoided}
            />
          </div>
          <p className="text-xs text-muted-foreground -mt-4">
            Last calculated: {new Date(data.lastUpdated).toLocaleString()}
          </p>
        </>
      ) : null}

      {/* ── Offline Clients Section ─────────────────────────────────────────── */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-semibold text-foreground">Offline Client Sales</h2>
            <p className="text-sm text-muted-foreground mt-0.5">
              Log clients who purchased from the sales team and never registered in the app.
              {offlineCount > 0 && (
                <span className="ml-1 font-medium text-emerald-600">
                  {offlineCount} {offlineCount === 1 ? 'entry' : 'entries'} · {fmt(offlineLitres)} L counted
                </span>
              )}
            </p>
          </div>
          <Button onClick={openAdd} className="gap-2">
            <PlusCircle className="w-4 h-4" />
            Add offline sale
          </Button>
        </div>

        {clients.length === 0 ? (
          <div className="rounded-lg border border-dashed p-10 text-center text-muted-foreground">
            <Users className="w-8 h-8 mx-auto mb-2 opacity-30" />
            <p className="text-sm">No offline client entries yet.</p>
            <p className="text-xs mt-1">Add one for every sale made outside the app.</p>
          </div>
        ) : (
          <Card className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground">Date</th>
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground">Client / Ref</th>
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground">Products</th>
                    <th className="text-right px-4 py-3 font-medium text-muted-foreground">Litres</th>
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground">Notes</th>
                    <th className="px-4 py-3" />
                  </tr>
                </thead>
                <tbody>
                  {clients.map((c, i) => {
                    const litres = calcOfflineLitres(c.products);
                    return (
                      <tr key={c.id} className={`border-b last:border-0 ${i % 2 === 0 ? '' : 'bg-muted/20'}`}>
                        <td className="px-4 py-3 whitespace-nowrap text-muted-foreground">{c.saleDate}</td>
                        <td className="px-4 py-3">
                          {c.clientRef
                            ? <span className="font-medium text-foreground">{c.clientRef}</span>
                            : <span className="text-muted-foreground italic">—</span>}
                        </td>
                        <td className="px-4 py-3 max-w-xs">
                          <span className="text-foreground">{productSummary(c.products)}</span>
                        </td>
                        <td className="px-4 py-3 text-right font-mono text-emerald-600 font-medium">
                          {litres > 0 ? fmt(litres) : '—'}
                        </td>
                        <td className="px-4 py-3 max-w-xs">
                          {c.notes
                            ? <span className="text-muted-foreground text-xs">{c.notes}</span>
                            : <span className="text-muted-foreground/40">—</span>}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1 justify-end">
                            <Button variant="ghost" size="sm" onClick={() => openEdit(c)} className="h-7 w-7 p-0">
                              <Pencil className="w-3.5 h-3.5" />
                            </Button>
                            {deletingId === c.id ? (
                              <div className="flex items-center gap-1">
                                <Button variant="destructive" size="sm" onClick={() => deleteClient(c.id)} className="h-7 text-xs px-2">Confirm</Button>
                                <Button variant="ghost" size="sm" onClick={() => setDeletingId(null)} className="h-7 w-7 p-0"><X className="w-3.5 h-3.5" /></Button>
                              </div>
                            ) : (
                              <Button variant="ghost" size="sm" onClick={() => setDeletingId(c.id)} className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive">
                                <Trash2 className="w-3.5 h-3.5" />
                              </Button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        )}
      </div>

      {/* ── Legacy Bulk Offset ───────────────────────────────────────────────── */}
      <Card className="border-dashed">
        <CardHeader className="cursor-pointer select-none" onClick={() => setShowLegacy(v => !v)}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Info className="w-4 h-4 text-muted-foreground" />
              <CardTitle className="text-sm text-muted-foreground font-medium">Legacy Bulk Adjustment</CardTitle>
              {(data?.override.litresOffset || data?.override.usersOffset) ? (
                <Badge variant="outline" className="text-xs text-amber-600 border-amber-300">active</Badge>
              ) : null}
            </div>
            {showLegacy ? <ChevronDown className="w-4 h-4 text-muted-foreground" /> : <ChevronRight className="w-4 h-4 text-muted-foreground" />}
          </div>
          <CardDescription className="text-xs">
            For pre-system historical data that can't be entered as individual clients. Use the Offline Clients section above for ongoing sales.
          </CardDescription>
        </CardHeader>

        {showLegacy && (
          <CardContent className="space-y-4 pt-0">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="litresOffset" className="flex items-center gap-2 text-sm">
                  <Droplets className="w-4 h-4 text-emerald-500" />
                  Additional Litres (bulk)
                </Label>
                <Input id="litresOffset" type="number" step="1" value={litresOffset}
                  onChange={e => setLitresOffset(e.target.value)} placeholder="e.g. 250000" className="font-mono" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="usersOffset" className="flex items-center gap-2 text-sm">
                  <Users className="w-4 h-4 text-blue-500" />
                  Additional Users (bulk)
                </Label>
                <Input id="usersOffset" type="number" step="1" value={usersOffset}
                  onChange={e => setUsersOffset(e.target.value)} placeholder="e.g. 500" className="font-mono" />
              </div>
            </div>
            {legacyError && <p className="text-sm text-destructive">{legacyError}</p>}
            {legacyMsg   && <p className="text-sm text-green-600">{legacyMsg}</p>}
            <Button onClick={saveLegacyOffset} disabled={legacySaving} size="sm" className="gap-2">
              <Save className="w-4 h-4" />
              {legacySaving ? 'Saving…' : 'Save bulk adjustment'}
            </Button>
          </CardContent>
        )}
      </Card>

      {/* ── How it's calculated ─────────────────────────────────────────────── */}
      <Card className="border-dashed">
        <CardHeader>
          <CardTitle className="text-sm text-muted-foreground">How litres are calculated</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-sm text-muted-foreground space-y-2">
            <p>For each completed app order and each offline client entry:</p>
            <p className="font-mono text-xs bg-muted rounded px-3 py-2">litres += quantity × product_capacity</p>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-3">
              {[
                ['Bottle filters', '150 L'], ['Survivor Straw', '400 L'],
                ['EcoSmart Elite', '400 L'], ['Electric Pitcher', '400 L'],
                ['Sweet Home faucet', '1,750 L'], ['Counter RO', '1,500 L'],
                ['RO Home System', '10,000 L'], ['Aqua Stream 1200', '50,000 L'],
              ].map(([name, cap]) => (
                <div key={name} className="text-xs border rounded p-2">
                  <div className="font-medium text-foreground">{name}</div>
                  <div className="text-muted-foreground">{cap} / unit</div>
                </div>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ── Add / Edit Dialog ───────────────────────────────────────────────── */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingClient ? 'Edit offline sale' : 'Add offline sale'}</DialogTitle>
            <DialogDescription>
              Log a client who purchased directly from the sales team.
              Their products will count toward the UC Impact metrics automatically.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="clientRef">Client name / reference <span className="text-muted-foreground font-normal">(optional)</span></Label>
              <Input id="clientRef" placeholder="e.g. Jane Kamau, WS-001, +254…"
                value={formRef} onChange={e => setFormRef(e.target.value)} />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="saleDate">Sale date <span className="text-destructive">*</span></Label>
              <Input id="saleDate" type="date" value={formDate} onChange={e => setFormDate(e.target.value)} />
            </div>

            <div className="space-y-2">
              <Label>Products <span className="text-destructive">*</span></Label>
              <div className="space-y-2">
                {formProducts.map((p, i) => (
                  <FormProductRow key={i} product={p} index={i} onChange={updateProductRow} onRemove={removeProductRow} />
                ))}
              </div>
              <Button type="button" variant="outline" size="sm" onClick={addProductRow} className="gap-1.5 mt-1">
                <PlusCircle className="w-3.5 h-3.5" />
                Add product
              </Button>
              {(() => {
                const total = calcOfflineLitres(formProducts.filter(p => p.productName.trim()));
                return total > 0 ? (
                  <p className="text-xs text-emerald-600 font-medium">Total: {fmt(total)} litres filtered</p>
                ) : null;
              })()}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="notes">Notes <span className="text-muted-foreground font-normal">(optional)</span></Label>
              <Input id="notes" placeholder="e.g. Paid via M-Pesa, delivered to Westlands"
                value={formNotes} onChange={e => setFormNotes(e.target.value)} />
            </div>

            {formError && (
              <div className="flex items-center gap-2 text-sm text-destructive">
                <AlertCircle className="w-4 h-4 shrink-0" />
                {formError}
              </div>
            )}
          </div>

          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={formSaving}>Cancel</Button>
            <Button onClick={saveClient} disabled={formSaving} className="gap-2">
              <Save className="w-4 h-4" />
              {formSaving ? 'Saving…' : editingClient ? 'Save changes' : 'Add entry'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
