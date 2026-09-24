import { useEffect, useRef, useState } from "react";
import { Link } from "wouter";
import { Loader2, KeyRound, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { resetPassword } from "@/lib/team-auth";

export default function ResetPasswordPage() {
  const params = new URLSearchParams(window.location.search);
  const token = params.get("token") ?? "";

  const [newPassword, setNewPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorField, setErrorField] = useState<"new-password" | "confirm" | null>(null);
  const successHeading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (done) successHeading.current?.focus();
  }, [done]);

  if (!token) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background px-4">
        <div className="text-center space-y-3">
          <p className="text-lg font-semibold">Invalid reset link</p>
          <p className="text-sm text-muted-foreground">This link is missing a token.</p>
          <Button asChild variant="outline"><Link href="/forgot-password">Request a new link</Link></Button>
        </div>
      </div>
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!newPassword || !confirm) return;
    if (newPassword !== confirm) { setErrorField("confirm"); setError("Passwords do not match."); return; }
    if (newPassword.length < 8) { setErrorField("new-password"); setError("Password must be at least 8 characters."); return; }
    setError(null);
    setErrorField(null);
    setLoading(true);
    try {
      await resetPassword(token, newPassword);
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Reset failed. The link may have expired.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="flex flex-col items-center gap-3">
          <div className="w-12 h-12 rounded-xl bg-primary flex items-center justify-center shadow-md">
            <span className="text-primary-foreground font-mono text-2xl leading-none font-bold">P</span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight">ProjectHub</h1>
        </div>

        <Card>
          {done ? (
            <>
              <CardHeader className="pb-4">
                <h2 ref={successHeading} tabIndex={-1} className="font-semibold leading-none tracking-tight flex items-center gap-2 text-base">
                  <CheckCircle2 className="w-4 h-4 text-green-600" />
                  Password updated
                </h2>
                <CardDescription role="status">Your password has been changed. You can now sign in.</CardDescription>
              </CardHeader>
              <CardContent>
                <Button asChild className="w-full"><Link href="/login">Sign in</Link></Button>
              </CardContent>
            </>
          ) : (
            <>
              <CardHeader className="pb-4">
                <CardTitle className="flex items-center gap-2 text-base">
                  <KeyRound className="w-4 h-4 text-primary" />
                  Set a new password
                </CardTitle>
                <CardDescription>Choose a strong password of at least 8 characters.</CardDescription>
              </CardHeader>
              <CardContent>
                <form onSubmit={handleSubmit} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="new-password">New password</Label>
                    <Input id="new-password" type="password" placeholder="••••••••" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} disabled={loading} autoFocus autoComplete="new-password" aria-invalid={errorField === "new-password"} aria-describedby={errorField === "new-password" ? "reset-error" : undefined} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="confirm">Confirm password</Label>
                    <Input id="confirm" type="password" placeholder="••••••••" value={confirm} onChange={(e) => setConfirm(e.target.value)} disabled={loading} autoComplete="new-password" aria-invalid={errorField === "confirm"} aria-describedby={errorField === "confirm" ? "reset-error" : undefined} />
                    {error && <p id="reset-error" role="alert" className="text-xs text-destructive">{error}</p>}
                  </div>
                  <Button type="submit" className="w-full" disabled={loading || !newPassword || !confirm}>
                    {loading ? <><Loader2 className="w-4 h-4 animate-spin mr-2" /> Updating…</> : "Update password"}
                  </Button>
                </form>
              </CardContent>
            </>
          )}
        </Card>
      </div>
    </div>
  );
}
