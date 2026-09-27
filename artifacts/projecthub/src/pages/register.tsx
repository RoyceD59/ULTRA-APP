import { useState } from "react";
import { useLocation, Link } from "wouter";
import { Loader2, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { register } from "@/lib/team-auth";

export default function RegisterPage() {
  const [, navigate] = useLocation();
  const params = new URLSearchParams(window.location.search);
  const inviteToken = params.get("token") ?? "";

  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [errorField, setErrorField] = useState<"password" | "confirm" | null>(null);
  const [isConflict, setIsConflict] = useState(false);
  const [isExpired, setIsExpired] = useState(false);
  const [loading, setLoading] = useState(false);

  if (!inviteToken) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background px-4">
        <div className="text-center space-y-3">
          <p className="text-lg font-semibold">Invalid invitation link</p>
          <p className="text-sm text-muted-foreground">This link is missing an invite token. Ask your admin to resend the invitation.</p>
        </div>
      </div>
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !password || !confirm) return;
    if (password !== confirm) { setErrorField("confirm"); setError("Passwords do not match."); return; }
    if (password.length < 8) { setErrorField("password"); setError("Password must be at least 8 characters."); return; }
    setError(null);
    setErrorField(null);
    setIsConflict(false);
    setIsExpired(false);
    setLoading(true);
    try {
      await register(inviteToken, name.trim(), password);
      navigate("/", { replace: true });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Registration failed.";
      if (msg.toLowerCase().includes("already exists")) {
        setIsConflict(true);
        setError(null);
      } else if (
        msg.toLowerCase().includes("invalid") ||
        msg.toLowerCase().includes("expired")
      ) {
        setIsExpired(true);
        setError(null);
      } else {
        setErrorField(null);
        setError(msg);
      }
    } finally {
      setLoading(false);
    }
  }

  // ── Error state: email already has an account ────────────────────────────
  if (isConflict) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background px-4">
        <div role="alert" className="text-center space-y-3 max-w-sm">
          <p className="text-lg font-semibold">You already have an account</p>
          <p className="text-sm text-muted-foreground">
            This email address is already registered.
          </p>
          <Button asChild className="w-full mt-2"><Link href="/login">Sign in instead</Link></Button>
        </div>
      </div>
    );
  }

  // ── Error state: token expired or already used ───────────────────────────
  if (isExpired) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background px-4">
        <div role="alert" className="text-center space-y-3 max-w-sm">
          <p className="text-lg font-semibold">This invite has expired or was already used</p>
          <p className="text-sm text-muted-foreground">
            Ask your admin to send a new invite link.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="flex flex-col items-center gap-3">
          <div className="w-12 h-12 rounded-xl bg-primary flex items-center justify-center shadow-md">
            <span className="text-primary-foreground font-mono text-2xl leading-none font-bold">P</span>
          </div>
          <div className="text-center">
            <h1 className="text-2xl font-bold tracking-tight">Create your account</h1>
            <p className="text-sm text-muted-foreground mt-1">You've been invited to ProjectHub</p>
          </div>
        </div>

        <Card>
          <CardHeader className="pb-4">
            <CardTitle className="flex items-center gap-2 text-base">
              <UserPlus className="w-4 h-4 text-primary" />
              Set up your account
            </CardTitle>
            <CardDescription>Choose a name and a strong password (min. 8 characters).</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="name">Full name</Label>
                <Input id="name" type="text" placeholder="Jane Doe" value={name} onChange={(e) => setName(e.target.value)} disabled={loading} autoFocus autoComplete="name" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <Input id="password" type="password" placeholder="••••••••" value={password} onChange={(e) => setPassword(e.target.value)} disabled={loading} autoComplete="new-password" aria-invalid={errorField === "password"} aria-describedby={errorField === "password" ? "register-error" : undefined} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="confirm">Confirm password</Label>
                <Input id="confirm" type="password" placeholder="••••••••" value={confirm} onChange={(e) => setConfirm(e.target.value)} disabled={loading} autoComplete="new-password" aria-invalid={errorField === "confirm"} aria-describedby={errorField === "confirm" ? "register-error" : undefined} />
                {error && (
                  <p id="register-error" role="alert" className="text-xs text-destructive">
                    {error}{" "}
                    <span className="text-muted-foreground">Ask your admin to send a new invite link.</span>
                  </p>
                )}
              </div>
              <Button type="submit" className="w-full" disabled={loading || !name.trim() || !password || !confirm}>
                {loading ? <><Loader2 className="w-4 h-4 animate-spin mr-2" /> Creating account…</> : "Create account"}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
