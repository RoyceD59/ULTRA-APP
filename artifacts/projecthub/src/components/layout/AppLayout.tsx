import { Link, useLocation } from "wouter";
import {
  LayoutDashboard, FolderKanban, CheckSquare, Users, Bell,
  Bot, Leaf, MessageSquareOff, Contact2, BellRing, Activity,
  Webhook, ShoppingBag, LogOut, KeyRound, Loader2, Shield,
  UserCog, ChevronDown, BellOff,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  clearTeamAuth, changePassword, isTeamAdmin, getTeamUser, canView,
} from "@/lib/team-auth";
import type { PageSlug } from "@/lib/team-auth";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogDescription,
  DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useToast } from "@/hooks/use-toast";

const ALL_NAVIGATION = [
  { name: "Dashboard",        href: "/",                slug: "dashboard"       as PageSlug, icon: LayoutDashboard },
  { name: "Projects",         href: "/projects",        slug: "projects"        as PageSlug, icon: FolderKanban },
  { name: "Tasks",            href: "/tasks",           slug: "tasks"           as PageSlug, icon: CheckSquare },
  { name: "Team",             href: "/team",            slug: "team"            as PageSlug, icon: Users },
  { name: "AI Monitor",       href: "/ai-monitor",      slug: "ai-monitor"      as PageSlug, icon: Bot },
  { name: "UC Impact",        href: "/impact",          slug: "impact"          as PageSlug, icon: Leaf },
  { name: "Alison Feedback",  href: "/alison-feedback", slug: "alison-feedback" as PageSlug, icon: MessageSquareOff },
  { name: "Contacts",         href: "/contacts",        slug: "contacts"        as PageSlug, icon: Contact2 },
  { name: "Notifications",    href: "/notifications",   slug: "notifications"   as PageSlug, icon: BellRing },
  { name: "System Status",    href: "/system",          slug: "system"          as PageSlug, icon: Activity },
  { name: "Webhook Tester",   href: "/webhook",         slug: "webhook"         as PageSlug, icon: Webhook },
  { name: "Orders",           href: "/orders",          slug: "orders"          as PageSlug, icon: ShoppingBag },
  { name: "Notif. Failures",  href: "/uc-notifications", slug: "uc-notifications" as PageSlug, icon: BellOff },
];

// ─── Change Password Dialog ────────────────────────────────────────────────────

function ChangePasswordDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { toast } = useToast();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reset() { setCurrent(""); setNext(""); setConfirm(""); setError(null); }
  function handleClose() { reset(); onClose(); }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!current.trim() || !next.trim() || !confirm.trim()) return;
    if (next !== confirm) { setError("Passwords do not match."); return; }
    if (next.length < 8) { setError("New password must be at least 8 characters."); return; }
    setError(null);
    setLoading(true);
    try {
      await changePassword(current, next);
      toast({ title: "Password updated", description: "Your new password is active." });
      handleClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to change password.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) handleClose(); }}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <KeyRound className="w-4 h-4 text-primary" /> Change password
          </DialogTitle>
          <DialogDescription>Enter your current password and choose a new one (min. 8 characters).</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 pt-1">
          <div className="space-y-2">
            <Label htmlFor="cp-current">Current password</Label>
            <Input id="cp-current" type="password" value={current} onChange={(e) => setCurrent(e.target.value)} disabled={loading} autoComplete="current-password" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="cp-new">New password</Label>
            <Input id="cp-new" type="password" value={next} onChange={(e) => setNext(e.target.value)} disabled={loading} autoComplete="new-password" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="cp-confirm">Confirm new password</Label>
            <Input id="cp-confirm" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} disabled={loading} autoComplete="new-password" />
            {error && <p className="text-xs text-destructive">{error}</p>}
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={handleClose} disabled={loading}>Cancel</Button>
            <Button type="submit" disabled={loading || !current || !next || !confirm}>
              {loading ? <><Loader2 className="w-4 h-4 animate-spin mr-2" />Updating…</> : "Update password"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ─── AppLayout ─────────────────────────────────────────────────────────────────

export function AppLayout({ children }: { children: React.ReactNode }) {
  const [location, navigate] = useLocation();
  const { toast } = useToast();
  const [changePassOpen, setChangePassOpen] = useState(false);
  const admin = isTeamAdmin();
  const user = getTeamUser();

  // Filter nav to pages the current user can access
  const navigation = ALL_NAVIGATION.filter((item) => canView(item.slug));

  function handleSignOut() {
    clearTeamAuth();
    toast({ title: "Signed out", description: "See you next time." });
    navigate("/login", { replace: true });
  }

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      {/* Sidebar */}
      <div className="w-64 flex-shrink-0 border-r bg-sidebar flex flex-col">
        {/* Logo */}
        <div className="h-16 flex items-center px-6 border-b flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center">
              <span className="text-primary-foreground font-mono text-sm font-bold">P</span>
            </div>
            <span className="font-semibold text-sm tracking-tight">ProjectHub</span>
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-0.5">
          {navigation.map((item) => {
            const active = item.href === "/" ? location === "/" : location.startsWith(item.href);
            return (
              <Link key={item.href} href={item.href}>
                <button className={cn(
                  "w-full flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors",
                  active
                    ? "bg-primary/10 text-primary font-medium"
                    : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
                )}>
                  <item.icon className="w-4 h-4 flex-shrink-0" />
                  {item.name}
                </button>
              </Link>
            );
          })}

          {/* Admin section */}
          {admin && (
            <>
              <div className="pt-4 pb-1 px-3">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">Admin</p>
              </div>
              <Link href="/admin/users">
                <button className={cn(
                  "w-full flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors",
                  location.startsWith("/admin/users")
                    ? "bg-primary/10 text-primary font-medium"
                    : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
                )}>
                  <UserCog className="w-4 h-4 flex-shrink-0" />
                  User Management
                </button>
              </Link>
            </>
          )}
        </nav>

        {/* User section */}
        <div className="flex-shrink-0 border-t p-3">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="w-full flex items-center gap-3 px-3 py-2 rounded-md hover:bg-accent/50 transition-colors group">
                <div className="w-7 h-7 rounded-full bg-primary/15 flex items-center justify-center flex-shrink-0">
                  <span className="text-xs font-semibold text-primary">
                    {(user?.name ?? user?.email ?? "?")[0]?.toUpperCase()}
                  </span>
                </div>
                <div className="flex-1 min-w-0 text-left">
                  <p className="text-xs font-medium truncate">{user?.name ?? user?.email ?? "Team"}</p>
                  <p className="text-[10px] text-muted-foreground truncate flex items-center gap-1">
                    {user?.role === "admin" ? <><Shield className="w-2.5 h-2.5" />Admin</> : "Member"}
                  </p>
                </div>
                <ChevronDown className="w-3 h-3 text-muted-foreground group-hover:text-foreground transition-colors" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-52">
              {user?.email && (
                <>
                  <div className="px-2 py-1.5 text-xs text-muted-foreground truncate">{user.email}</div>
                  <DropdownMenuSeparator />
                </>
              )}
              <DropdownMenuItem onClick={() => setChangePassOpen(true)}>
                <KeyRound className="w-4 h-4 mr-2" /> Change password
              </DropdownMenuItem>
              {admin && (
                <DropdownMenuItem onClick={() => navigate("/admin/users")}>
                  <UserCog className="w-4 h-4 mr-2" /> User Management
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={handleSignOut} className="text-destructive focus:text-destructive">
                <LogOut className="w-4 h-4 mr-2" /> Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden relative">
        <header className="h-16 border-b bg-background/80 backdrop-blur-md flex items-center justify-between px-8 flex-shrink-0 sticky top-0 z-10">
          <div className="flex items-center gap-4" />
          <div className="flex items-center gap-2">
            {admin && (
              <Badge variant="secondary" className="gap-1 text-xs">
                <Shield className="w-3 h-3" /> Admin
              </Badge>
            )}
            <button className="relative p-2 text-muted-foreground hover:text-foreground transition-colors rounded-full hover:bg-accent/10">
              <Bell className="w-5 h-5" />
              <span className="absolute top-2 right-2 w-2 h-2 rounded-full bg-destructive border-2 border-background" />
            </button>
            <Button variant="ghost" size="sm" onClick={handleSignOut} className="text-muted-foreground hover:text-foreground gap-2">
              <LogOut className="w-4 h-4" /> Sign out
            </Button>
          </div>
        </header>
        <main className="flex-1 overflow-y-auto p-8 relative">
          <div className="max-w-6xl mx-auto">{children}</div>
        </main>
      </div>

      <ChangePasswordDialog open={changePassOpen} onClose={() => setChangePassOpen(false)} />
    </div>
  );
}
