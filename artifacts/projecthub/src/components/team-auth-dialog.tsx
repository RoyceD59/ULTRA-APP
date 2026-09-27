/**
 * TeamAuthDialog
 *
 * Shown whenever a WhatsApp action is attempted without a valid team session.
 * The user enters the team passcode (SESSION_SECRET value); on success the JWT
 * is stored via team-auth.ts and the dialog closes, signalling the parent.
 */
import { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { KeyRound, Loader2 } from "lucide-react";
import { loginWithPasscode } from "@/lib/team-auth";

interface Props {
  open: boolean;
  onAuthenticated: () => void;
  onClose: () => void;
}

export function TeamAuthDialog({ open, onAuthenticated, onClose }: Props) {
  const [passcode, setPasscode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!passcode.trim()) return;
    setError(null);
    setLoading(true);
    try {
      await loginWithPasscode(passcode.trim());
      setPasscode("");
      onAuthenticated();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Authentication failed.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <KeyRound className="w-5 h-5 text-amber-500" />
            Team Authentication
          </DialogTitle>
          <DialogDescription>
            Enter the team passcode to access WhatsApp features.
            Your session lasts 8 hours.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 pt-1">
          <div className="space-y-2">
            <Label htmlFor="passcode">Team Passcode</Label>
            <Input
              id="passcode"
              type="password"
              placeholder="Enter passcode…"
              value={passcode}
              onChange={(e) => setPasscode(e.target.value)}
              disabled={loading}
              autoFocus
            />
            {error && (
              <p className="text-xs text-destructive">{error}</p>
            )}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={loading}>
              Cancel
            </Button>
            <Button type="submit" disabled={loading || !passcode.trim()} className="bg-amber-500 hover:bg-amber-600 text-slate-950">
              {loading ? <><Loader2 className="w-4 h-4 animate-spin mr-1" /> Signing in…</> : "Sign In"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
