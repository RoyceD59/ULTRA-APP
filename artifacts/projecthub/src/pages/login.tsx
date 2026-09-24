import { useState } from "react";
import { useLocation, Link } from "wouter";
import { KeyRound, Loader2, Shield } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { loginWithEmail } from "@/lib/team-auth";

export default function LoginPage() {
  const [, navigate] = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const params = new URLSearchParams(window.location.search);
  const next = params.get("next") ?? "/";

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim() || !password) return;
    setError(null);
    setLoading(true);
    try {
      await loginWithEmail(email.trim(), password);
      navigate(next, { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign-in failed.");
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
          <div className="text-center">
            <h1 className="text-2xl font-bold tracking-tight">ProjectHub</h1>
            <p className="text-sm text-muted-foreground mt-1">Team workspace</p>
          </div>
        </div>

        <Card>
          <CardHeader className="pb-4">
            <CardTitle className="flex items-center gap-2 text-base">
              <Shield className="w-4 h-4 text-primary" />
              Sign in
            </CardTitle>
            <CardDescription>Enter your email and password to access ProjectHub.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  disabled={loading}
                  autoFocus
                  autoComplete="email"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={loading}
                  autoComplete="current-password"
                />
                {error && (
                  <p role="alert" className="text-xs text-destructive flex items-center gap-1">
                    <KeyRound className="w-3 h-3" />
                    {error}
                  </p>
                )}
              </div>
              <Button type="submit" className="w-full" disabled={loading || !email.trim() || !password}>
                {loading ? <><Loader2 className="w-4 h-4 animate-spin mr-2" /> Signing in…</> : "Sign in"}
              </Button>
            </form>
          </CardContent>
          <CardFooter className="pt-0">
            <Link href="/forgot-password" className="text-xs text-muted-foreground hover:text-primary transition-colors mx-auto">
              Forgot password?
            </Link>
          </CardFooter>
        </Card>
      </div>
    </div>
  );
}
