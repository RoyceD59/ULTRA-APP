import { Link, useLocation } from "wouter";
import {
  Activity, Bell, BellOff, Bot, CheckSquare, Contact2, CreditCard, Droplets, MapPin, Tag,
  FolderKanban, Gauge, Gift, LayoutDashboard, Leaf, Link2, LogOut,
  KeyRound, Loader2, MessageSquareOff, Package, ShoppingBag, UserCog, Users, Webhook, Wrench,
  AlertTriangle, BellRing, Menu, WifiOff, X, FileText, PackageSearch, MessagesSquare, Newspaper
} from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { changePassword, clearTeamAuth, getTeamToken, getTeamUser, isTeamAdmin, canView } from "@/lib/team-auth";
import type { PageSlug } from "@/lib/team-auth";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { apiUrl } from "@/lib/api-base";

const NAVIGATION = [
  ["Dashboard", "/", "dashboard", LayoutDashboard],
  ["Projects", "/projects", "projects", FolderKanban],
  ["Tasks", "/tasks", "tasks", CheckSquare],
  ["Team", "/team", "team", Users],
  ["AI Monitor", "/ai-monitor", "ai-monitor", Bot],
  ["UC Impact", "/impact", "impact", Leaf],
  ["Alison Feedback", "/alison-feedback", "alison-feedback", MessageSquareOff],
  ["Alison Conversations", "/alison-conversations", "alison-feedback", MessagesSquare],
  ["Contacts", "/contacts", "contacts", Contact2],
  ["Notifications", "/notifications", "notifications", Bell],
  ["System Status", "/system", "system", Activity],
  ["Monitoring", "/monitoring", "monitoring", Gauge],
  ["Webhook Tester", "/webhook", "webhook", Webhook],
  ["Orders", "/orders", "orders", ShoppingBag],
  ["Tickets", "/tickets", "tickets", Wrench],
  ["Water Tests", "/water-tests", "water-tests", Droplets],
  ["Notif. Failures", "/uc-notifications", "uc-notifications", BellOff],
  ["Library", "/library", "library", Package],
  ["Companion Blog", "/blog", "blog", Newspaper],
] as const satisfies readonly [string, string, PageSlug, typeof LayoutDashboard][];

const ADMIN_NAVIGATION = [
  ["User Management", "/admin/users", UserCog],
  ["Payment Settings", "/admin/payment-settings", CreditCard],
  ["Notification Settings", "/admin/notification-settings", Bell],
  ["Products", "/admin/products", PackageSearch],
  ["Inventory", "/admin/inventory", Package],
  ["Integrations", "/admin/integrations", Link2],
  ["Rewards", "/admin/rewards", Gift],
  ["Referral Support", "/admin/referrals", BellRing],
  ["Promotions", "/admin/promotions", Tag],
  ["Locations", "/admin/locations", MapPin],
  ["Customers", "/admin/customers", Users],
  ["Unsynced Registrations", "/admin/unsynced-registrations", AlertTriangle],
  ["Agent Operations", "/admin/agent-operations", Bot],
  ["Companion Guides", "/admin/guides", FileText],
] as const;

const SECURITY_BANNER_DISMISS_KEY = "ph_sec_mpesa_dismissed";

function readSecurityBannerDismissal() {
  try {
    return sessionStorage.getItem(SECURITY_BANNER_DISMISS_KEY) === "1";
  } catch {
    return false;
  }
}

function writeSecurityBannerDismissal(dismissed: boolean) {
  try {
    if (dismissed) sessionStorage.setItem(SECURITY_BANNER_DISMISS_KEY, "1");
    else sessionStorage.removeItem(SECURITY_BANNER_DISMISS_KEY);
  } catch {
    // sessionStorage can be unavailable in restricted browser contexts.
  }
}

function useCount(path: string, select: (body: any) => number) {
  const [count, setCount] = useState(0);
  useEffect(() => {
    const token = getTeamToken();
    if (!token) return;
    let active = true;
    fetch(apiUrl(path), { headers: { Authorization: `Bearer ${token}` } })
      .then((res) => res.ok ? res.json() : null)
      .then((body) => { if (active && body) setCount(select(body)); })
      .catch(() => undefined);
    return () => { active = false; };
  }, [path, select]);
  return count;
}

function SecurityBanner({ onDismiss }: { onDismiss: () => void }) {
  return (
    <div className="flex items-center gap-3 px-4 py-2.5 bg-destructive/10 border-b border-destructive/20 text-sm text-destructive">
      <AlertTriangle className="w-4 h-4 shrink-0" />
      <span className="flex-1"><strong>Security misconfiguration:</strong> The M-Pesa webhook secret is not set. <Link href="/admin/payment-settings" className="underline font-medium">Fix in Payment Settings →</Link></span>
      <button onClick={onDismiss} aria-label="Dismiss security warning" className="p-1 rounded hover:bg-destructive/20"><X className="w-4 h-4" /></button>
    </div>
  );
}

function ChangePasswordDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { toast } = useToast();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const close = () => { setCurrent(""); setNext(""); setConfirm(""); setError(null); onClose(); };
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (next !== confirm) return setError("Passwords do not match.");
    if (next.length < 8) return setError("New password must be at least 8 characters.");
    setLoading(true);
    setError(null);
    try {
      await changePassword(current, next);
      toast({ title: "Password updated", description: "Your new password is active." });
      close();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Failed to change password.");
    } finally {
      setLoading(false);
    }
  };
  return <Dialog open={open} onOpenChange={(value) => { if (!value) close(); }}>
    <DialogContent className="sm:max-w-sm">
      <DialogHeader><DialogTitle>Change password</DialogTitle><DialogDescription>Choose a new password with at least 8 characters.</DialogDescription></DialogHeader>
      <form onSubmit={submit} className="space-y-4">
        <div className="space-y-2"><Label htmlFor="current-password">Current password</Label><Input id="current-password" type="password" value={current} onChange={(event) => setCurrent(event.target.value)} autoComplete="current-password" disabled={loading} /></div>
        <div className="space-y-2"><Label htmlFor="new-password">New password</Label><Input id="new-password" type="password" value={next} onChange={(event) => setNext(event.target.value)} autoComplete="new-password" disabled={loading} /></div>
        <div className="space-y-2"><Label htmlFor="confirm-password">Confirm new password</Label><Input id="confirm-password" type="password" value={confirm} onChange={(event) => setConfirm(event.target.value)} autoComplete="new-password" disabled={loading} />{error && <p className="text-xs text-destructive">{error}</p>}</div>
        <DialogFooter><Button type="button" variant="ghost" onClick={close} disabled={loading}>Cancel</Button><Button type="submit" disabled={loading || !current || !next || !confirm}>{loading ? <><Loader2 className="w-4 h-4 animate-spin mr-2" />Updating…</> : "Update password"}</Button></DialogFooter>
      </form>
    </DialogContent>
  </Dialog>;
}

export function AppLayout({ children }: { children: React.ReactNode }) {
  const [location, navigate] = useLocation();
  const { toast } = useToast();
  const admin = isTeamAdmin();
  const user = getTeamUser();
  const [securityBannerDismissed, setSecurityBannerDismissed] = useState(readSecurityBannerDismissal);
  const [mpesaSecretMissing, setMpesaSecretMissing] = useState(false);
  const [securityStatusKnown, setSecurityStatusKnown] = useState(false);
  const [changePasswordOpen, setChangePasswordOpen] = useState(false);
  const [mobileNavigationOpen, setMobileNavigationOpen] = useState(false);
  const [online, setOnline] = useState(() => navigator.onLine);
  const recoveryCount = useCount("/api/uc/admin/orders/recovery-count", (body) => body.count ?? 0);
  const reminderGapCount = useCount("/api/uc/admin/orders/reminder-gaps", (body) => body.orders?.length ?? 0);

  useEffect(() => {
    if (!admin) return;
    const checkSecurityWarning = () => {
      fetch(apiUrl("/admin/payment-settings"), { headers: { Authorization: `Bearer ${getTeamToken() ?? ""}` } })
        .then((res) => res.ok ? res.json() : null)
        .then((body) => {
          if (!body) return;
          setMpesaSecretMissing(body.mpesaWebhookSecret?.source === "none");
          setSecurityStatusKnown(true);
        })
        .catch(() => undefined);
    };
    checkSecurityWarning();
    const interval = window.setInterval(checkSecurityWarning, 60_000);
    return () => window.clearInterval(interval);
  }, [admin]);

  useEffect(() => {
    if (securityStatusKnown && !mpesaSecretMissing && securityBannerDismissed) {
      writeSecurityBannerDismissal(false);
      setSecurityBannerDismissed(false);
    }
  }, [securityStatusKnown, mpesaSecretMissing, securityBannerDismissed]);

  const signOut = () => {
    writeSecurityBannerDismissal(false);
    clearTeamAuth();
    toast({ title: "Signed out", description: "See you next time." });
    navigate("/login", { replace: true });
  };
  const allowedNavigation = NAVIGATION.filter(([, , slug]) => canView(slug));
  const showWarning = admin && mpesaSecretMissing && !securityBannerDismissed;
  useEffect(() => setMobileNavigationOpen(false), [location]);
  useEffect(() => {
    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, []);

  const navigationContent = (
    <>
      <nav aria-label="Primary navigation" className="flex-1 overflow-y-auto px-3 py-4 space-y-0.5">
        {allowedNavigation.map(([name, href, slug, Icon]) => {
          const active = href === "/" ? location === "/" : location.startsWith(href);
          const badge = slug === "orders" ? recoveryCount + reminderGapCount : 0;
          return <Link key={href} href={href} className={cn("min-h-11 w-full flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", active ? "bg-primary/10 text-primary font-medium" : "text-muted-foreground hover:bg-accent/50 hover:text-foreground")}><Icon className="w-4 h-4 shrink-0" /><span className="flex-1 text-left">{name}</span>{badge > 0 && <span className="rounded-full bg-amber-500 text-white text-[10px] font-bold px-1.5 py-0.5">{badge}</span>}</Link>;
        })}
        {admin && <><div className="pt-4 pb-1 px-3"><p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">Admin</p></div>{ADMIN_NAVIGATION.map(([name, href, Icon]) => <Link key={href} href={href} className={cn("min-h-11 w-full flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", location.startsWith(href) ? "bg-primary/10 text-primary font-medium" : "text-muted-foreground hover:bg-accent/50 hover:text-foreground")}><Icon className="w-4 h-4 shrink-0" />{name}</Link>)}</>}
      </nav>
      <div className="border-t p-3">
        <p className="px-3 text-xs font-medium truncate">{user?.name ?? user?.email ?? "Team"}</p>
        <Button variant="ghost" onClick={() => setChangePasswordOpen(true)} className="mt-1 min-h-11 w-full justify-start text-muted-foreground"><KeyRound className="w-4 h-4 mr-2" />Change password</Button>
        <Button variant="ghost" onClick={signOut} className="mt-1 min-h-11 w-full justify-start text-muted-foreground"><LogOut className="w-4 h-4 mr-2" />Sign out</Button>
      </div>
    </>
  );

  return (
    <div className="projecthub-shell flex min-h-dvh h-dvh overflow-hidden bg-background">
      <aside className="hidden md:flex w-64 shrink-0 border-r bg-sidebar flex-col">
        <div className="h-16 flex items-center px-6 border-b shrink-0">
          <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center"><span className="text-primary-foreground font-mono text-sm font-bold">P</span></div>
          <span className="ml-3 font-semibold text-sm tracking-tight">ProjectHub</span>
        </div>
        {navigationContent}
      </aside>
      <Sheet open={mobileNavigationOpen} onOpenChange={setMobileNavigationOpen}>
        <SheetContent side="left" className="w-[min(20rem,88vw)] p-0 flex flex-col bg-sidebar">
          <div className="h-16 flex items-center px-5 border-b shrink-0">
            <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center"><span className="text-primary-foreground font-mono text-sm font-bold">P</span></div>
            <SheetTitle className="ml-3 text-sm">ProjectHub</SheetTitle>
          </div>
          {navigationContent}
        </SheetContent>
      </Sheet>
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {showWarning && <SecurityBanner onDismiss={() => {
          writeSecurityBannerDismissal(true);
          setSecurityBannerDismissed(true);
        }} />}
        {!online && <div role="status" className="flex items-center justify-center gap-2 bg-amber-500 px-4 py-2 text-xs font-semibold text-white"><WifiOff className="h-4 w-4" />Offline — viewing the app shell. Changes and new records refresh when connectivity returns.</div>}
        <header className="app-safe-top min-h-16 border-b bg-background/80 flex items-center justify-between md:justify-end px-4 sm:px-6 md:px-8 shrink-0">
          <Button variant="ghost" size="icon" className="md:hidden min-h-11 min-w-11" onClick={() => setMobileNavigationOpen(true)} aria-label="Open navigation"><Menu className="w-5 h-5" /></Button>
          <span className="md:hidden font-semibold text-sm">ProjectHub</span>
          {admin && <Badge variant="secondary">Admin</Badge>}
        </header>
        <main className="app-safe-bottom flex-1 overflow-y-auto overflow-x-hidden p-4 sm:p-6 md:p-8"><div className="max-w-6xl mx-auto min-w-0">{children}</div></main>
      </div>
      <ChangePasswordDialog open={changePasswordOpen} onClose={() => setChangePasswordOpen(false)} />
    </div>
  );
}
