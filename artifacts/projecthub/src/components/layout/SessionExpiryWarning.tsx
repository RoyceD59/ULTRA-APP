import { useEffect, useState } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";
import { getTeamSessionRemainingMs, getTeamUser, renewTeamSession } from "@/lib/team-auth";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";

const WARNING_WINDOW_MS = 15 * 60 * 1000;

export function SessionExpiryWarning() {
  const [remaining, setRemaining] = useState(getTeamSessionRemainingMs);
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { toast } = useToast();

  useEffect(() => {
    const update = () => setRemaining(getTeamSessionRemainingMs());
    const timer = window.setInterval(update, 1000);
    window.addEventListener("storage", update);
    window.addEventListener("focus", update);
    document.addEventListener("visibilitychange", update);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("storage", update);
      window.removeEventListener("focus", update);
      document.removeEventListener("visibilitychange", update);
    };
  }, []);

  const close = () => {
    if (loading) return;
    setOpen(false);
    setPassword("");
    setError(null);
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (loading) return;
    setLoading(true);
    setError(null);
    try {
      await renewTeamSession(password);
      setRemaining(getTeamSessionRemainingMs());
      setOpen(false);
      setPassword("");
      toast({ title: "Session renewed", description: "You can keep working for another 8 hours." });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not renew your session. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const showWarning = remaining !== null && remaining <= WARNING_WINDOW_MS;
  const minutes = Math.ceil((remaining ?? 0) / 60_000);
  return <>
    {showWarning && <div role="status" className="flex flex-wrap items-center gap-2 text-sm text-amber-800 dark:text-amber-300">
      <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
      <span>{minutes > 0 ? `Session expires in ${minutes} min.` : "Session expired."}</span>
      <Button variant="outline" size="sm" onClick={() => { setError(null); setOpen(true); }}>Renew session</Button>
    </div>}
    <Dialog open={open} onOpenChange={(value) => { if (!value) close(); }}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Renew your session</DialogTitle>
          <DialogDescription>Confirm your password for {getTeamUser()?.email} to keep working without leaving this page. Your unsaved work stays open.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="renew-session-password">Password</Label>
            <Input id="renew-session-password" type="password" autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} disabled={loading} aria-invalid={!!error} aria-describedby={error ? "renew-session-error" : undefined} />
            {error && <p id="renew-session-error" role="alert" className="text-sm text-destructive">{error}</p>}
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={close} disabled={loading}>Cancel</Button>
            <Button type="submit" disabled={loading || !password}>{loading ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Renewing…</> : "Confirm password"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  </>;
}